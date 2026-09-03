import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEvidencePriceForecast } from '../lib/evidence-price-model.mjs';

function trainingRows() {
  const rows = [];
  for (let day = 1; day <= 12; day += 1) {
    for (let pointIndex = 1; pointIndex <= 2; pointIndex += 1) {
      const temperatureForecastC = 12 + day + pointIndex * 0.5;
      const loadForecastMw = 900 + day * day * 2 + pointIndex * 20;
      rows.push({
        date: `2026-08-${String(day).padStart(2, '0')}`,
        pointIndex,
        dayAheadUserPriceFinalYuanPerMwh:
          80 + pointIndex * 10 + temperatureForecastC * 3 + loadForecastMw * 0.2,
        temperatureForecastC,
        loadForecastMw,
      });
    }
  }
  return rows;
}

test('weather and load forecasts materially influence the price forecast with visible contributions', () => {
  const history = trainingRows();
  const base = buildEvidencePriceForecast({
    rows: [...history, { date: '2026-09-03', pointIndex: 1, temperatureForecastC: 25, loadForecastMw: 1100 }],
    targetDate: '2026-09-03',
    expectedPointCount: 1,
  });
  const stressed = buildEvidencePriceForecast({
    rows: [...history, { date: '2026-09-03', pointIndex: 1, temperatureForecastC: 28, loadForecastMw: 1150 }],
    targetDate: '2026-09-03',
    expectedPointCount: 1,
  });

  assert.equal(base.status, 'ready');
  assert.equal(base.rows.length, 1);
  assert.ok(stressed.rows[0].pointForecast > base.rows[0].pointForecast);
  assert.ok(Math.abs(base.rows[0].contributions.temperatureYuanPerMwh) > 0);
  assert.ok(Math.abs(base.rows[0].contributions.loadYuanPerMwh) > 0);
  assert.ok(base.rows[0].p10 <= base.rows[0].p50 && base.rows[0].p50 <= base.rows[0].p90);
  assert.equal(base.algorithm.formula, 'price = slot_baseline + beta_temp * temp_delta + beta_load * load_delta');
});

test('missing target weather forecast is explicit instead of silently substituted with actual weather', () => {
  const result = buildEvidencePriceForecast({
    rows: [...trainingRows(), { date: '2026-09-03', pointIndex: 1, loadForecastMw: 1100 }],
    targetDate: '2026-09-03',
    expectedPointCount: 1,
  });

  assert.equal(result.status, 'insufficient_inputs');
  assert.deepEqual(result.missingInputs, [{ pointIndex: 1, fields: ['temperatureForecastC'] }]);
  assert.deepEqual(result.rows, []);
});
