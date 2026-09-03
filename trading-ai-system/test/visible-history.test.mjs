import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  mergeVisibleHistory,
  readVisibleHistory,
  writeVisibleHistoryAtomic,
} from '../lib/visible-history.mjs';

function snapshot(date, rows, generatedAt = `${date}T12:00:00.000Z`) {
  return {
    accepted: true,
    generatedAt,
    source: 'visible_page_snapshot',
    rowCount: rows.length,
    rows: rows.map((row) => ({ date, sourceTargets: ['visible_page_snapshot'], ...row })),
  };
}

test('mergeVisibleHistory keeps prior dates and enriches the same date-point key', () => {
  const existing = mergeVisibleHistory(
    {},
    snapshot('2026-08-17', [{ pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: 320 }])
  );

  const merged = mergeVisibleHistory(
    existing,
    snapshot('2026-08-18', [
      { pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: 330 },
      { pointIndex: 2, timePoint: '00:30', realTimeAvgPrice: 331 },
    ])
  );
  const enriched = mergeVisibleHistory(
    merged,
    snapshot('2026-08-18', [{ pointIndex: 1, timePoint: '00:15', dayAheadPublicPrice: 300 }])
  );

  assert.deepEqual(enriched.dates, ['2026-08-17', '2026-08-18']);
  assert.deepEqual(enriched.coverageByDate, { '2026-08-17': 1, '2026-08-18': 2 });
  assert.equal(enriched.rows.length, 3);
  assert.deepEqual(
    enriched.rows.find((row) => row.date === '2026-08-18' && row.pointIndex === 1),
    {
      date: '2026-08-18',
      pointIndex: 1,
      timePoint: '00:15',
      realTimeAvgPrice: 330,
      dayAheadPublicPrice: 300,
      sourceTargets: ['visible_page_snapshot'],
    }
  );
});

test('mergeVisibleHistory ignores rejected snapshots', () => {
  const existing = mergeVisibleHistory(
    {},
    snapshot('2026-08-17', [{ pointIndex: 1, realTimeAvgPrice: 320 }])
  );
  const merged = mergeVisibleHistory(existing, {
    accepted: false,
    rows: [{ date: '2026-08-18', pointIndex: 1, realTimeAvgPrice: 999 }],
  });

  assert.deepEqual(merged, existing);
});

test('readVisibleHistory migrates an accepted legacy snapshot only when history is absent', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'visible-history-'));
  const historyPath = path.join(temp, 'state', 'ukey-visible-history.json');
  const legacyPath = path.join(temp, 'ukey-visible-snapshot.json');
  const legacy = snapshot('2026-08-18', [{ pointIndex: 1, realTimeAvgPrice: 330 }]);
  await writeFile(legacyPath, `${JSON.stringify(legacy)}\n`, 'utf8');

  const migrated = await readVisibleHistory(historyPath, legacyPath);
  assert.deepEqual(migrated.dates, ['2026-08-18']);
  assert.equal(migrated.rows.length, 1);

  await writeVisibleHistoryAtomic(historyPath, migrated);
  await writeFile(legacyPath, `${JSON.stringify(snapshot('2026-08-19', [{ pointIndex: 1, realTimeAvgPrice: 340 }]))}\n`, 'utf8');
  const persisted = await readVisibleHistory(historyPath, legacyPath);
  assert.deepEqual(persisted.dates, ['2026-08-18']);
  assert.equal(JSON.parse(await readFile(historyPath, 'utf8')).rows.length, 1);
});
