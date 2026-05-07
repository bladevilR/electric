import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  compactDataset,
  summarizeDataset,
  writeBrowserDataFile,
} from '../lib/system-data.mjs';

const fixture = {
  generatedAt: '2026-05-07T02:45:41.700Z',
  quality: {
    dates: ['2026-05-07', '2026-05-08'],
    gaps: [{ id: 'actual_load_96_empty' }],
    fieldCompleteness: {
      defaultDeclarationPower: 96,
      realTimeAvgPrice: 57,
      actualKwh: 0,
    },
  },
  sources: {
    user_default_bid_96: { captures: 3, rows: 288 },
    realtime_average_price: { captures: 1, rows: 96 },
  },
  rows: [
    {
      date: '2026-05-07',
      pointIndex: 1,
      timePoint: '00:15',
      defaultDeclarationPower: 35.5,
      realTimeAvgPrice: 322.4,
      actualKwh: null,
      extraLargeField: 'drop me',
      sourceTargets: ['realtime_average_price'],
    },
  ],
};

test('compactDataset keeps only frontend-safe row fields and top-level metadata', () => {
  const compact = compactDataset(fixture);

  assert.equal(compact.generatedAt, fixture.generatedAt);
  assert.deepEqual(compact.quality.dates, ['2026-05-07', '2026-05-08']);
  assert.equal(compact.sources.realtime_average_price.rows, 96);
  assert.equal(compact.rows.length, 1);
  assert.equal(compact.rows[0].realTimeAvgPrice, 322.4);
  assert.equal(compact.rows[0].extraLargeField, undefined);
});

test('summarizeDataset returns system health metrics', () => {
  const summary = summarizeDataset(fixture);

  assert.equal(summary.rowCount, 1);
  assert.equal(summary.dateCount, 2);
  assert.equal(summary.p0SourceCoverage.present, 2);
  assert.equal(summary.p0SourceCoverage.total, 8);
  assert.equal(summary.gapCount, 1);
  assert.equal(summary.fieldCompleteness.realTimeAvgPrice, 57);
});

test('writeBrowserDataFile writes a browser global data file', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-system-'));
  const sourcePath = path.join(temp, 'standard-96.json');
  const outputPath = path.join(temp, 'standard-96.js');

  try {
    await writeFile(sourcePath, JSON.stringify(fixture), 'utf8');
    const result = await writeBrowserDataFile({ sourcePath, outputPath });
    const written = await readFile(outputPath, 'utf8');

    assert.equal(result.rowCount, 1);
    assert.match(written, /^window\.TRADING_SYSTEM_DATA = /);
    assert.match(written, /realTimeAvgPrice/);
    assert.doesNotMatch(written, /extraLargeField/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
