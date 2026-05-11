import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { parseCsv, readBusinessInputs, summarizeBusinessInputs } from '../lib/business-inputs.mjs';

test('parseCsv handles quoted fields and numeric-looking strings', () => {
  const rows = parseCsv('date,pointIndex,note\n2026-05-07,1,"早峰, 复核"\n');

  assert.deepEqual(rows, [{ date: '2026-05-07', pointIndex: '1', note: '早峰, 复核' }]);
});

test('readBusinessInputs loads forecast, position, and trade limits', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-inputs-'));
  const inputDir = path.join(temp, 'business-inputs');

  try {
    await mkdir(inputDir, { recursive: true });
    await writeFile(
      path.join(inputDir, 'forecast-load-96.csv'),
      [
        'date,pointIndex,timePoint,forecastKwh,confidence,note',
        '2026-05-07,1,00:15,1200,0.8,调度预测',
        '2026-05-07,2,00:30,1300,0.7,调度预测',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(inputDir, 'position-96.csv'),
      [
        'date,pointIndex,timePoint,availableBuyMwh,availableSellMwh,contractedMwh,tradedMwh,note',
        '2026-05-07,1,00:15,0.5,0.2,1.5,0.1,合同边界',
        '2026-05-07,2,00:30,0.7,0.3,1.5,0.2,合同边界',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(inputDir, 'trade-limits.json'),
      JSON.stringify({
        minQuantityMwh: 0.1,
        maxDraftQuantityMwh: 1,
        buyPriceCeilingYuanPerMwh: 180,
        sellPriceFloorYuanPerMwh: 210,
      }),
      'utf8'
    );

    const inputs = await readBusinessInputs(inputDir);
    const summary = summarizeBusinessInputs(inputs);

    assert.equal(inputs.forecastLoad96.rows.length, 2);
    assert.equal(inputs.forecastLoad96.rows[0].forecastKwh, 1200);
    assert.equal(inputs.position96.rows[1].availableBuyMwh, 0.7);
    assert.equal(inputs.tradeLimits.values.maxDraftQuantityMwh, 1);
    assert.equal(summary.forecastLoad96.rowCount, 2);
    assert.equal(summary.position96.rowCount, 2);
    assert.equal(summary.tradeLimits.configured, true);
    assert.equal(summary.readyForDraftPrefill, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('readBusinessInputs tolerates empty templates without fake data', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-inputs-'));

  try {
    const inputs = await readBusinessInputs(temp);
    const summary = summarizeBusinessInputs(inputs);

    assert.deepEqual(inputs.forecastLoad96.rows, []);
    assert.deepEqual(inputs.position96.rows, []);
    assert.equal(summary.tradeLimits.configured, false);
    assert.equal(summary.readyForDraftPrefill, false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
