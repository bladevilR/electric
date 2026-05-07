import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStrategySuggestions, quantile, windowLabel } from '../lib/strategy-engine.mjs';

const dataset = {
  quality: {
    gaps: [{ id: 'actual_load_96_empty' }, { id: 'settle_day_empty' }],
    fieldCompleteness: { actualKwh: 0, settleAmount: 0 },
  },
  rows: [
    { date: '2026-05-07', pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: 100 },
    { date: '2026-05-07', pointIndex: 2, timePoint: '00:30', realTimeAvgPrice: 105 },
    { date: '2026-05-07', pointIndex: 3, timePoint: '00:45', realTimeAvgPrice: 200 },
    { date: '2026-05-07', pointIndex: 4, timePoint: '01:00', realTimeAvgPrice: 210 },
    { date: '2026-05-08', pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: 80 },
  ],
};

test('quantile returns a deterministic value from sorted numeric input', () => {
  assert.equal(quantile([10, 20, 30, 40, 50], 0.8), 40);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.2), 10);
  assert.equal(quantile([], 0.8), null);
});

test('windowLabel compresses strategy points into readable windows', () => {
  assert.equal(
    windowLabel([
      { timePoint: '00:15' },
      { timePoint: '00:30' },
      { timePoint: '00:45' },
    ]),
    '00:15、00:30、00:45'
  );
});

test('buildStrategySuggestions identifies low-price and high-price windows', () => {
  const suggestions = buildStrategySuggestions(dataset, { date: '2026-05-07' });

  assert.equal(suggestions[0].type, 'low_price');
  assert.match(suggestions[0].title, /低价/);
  assert.match(suggestions[0].description, /00:15/);
  assert.equal(suggestions[1].type, 'high_price_risk');
  assert.match(suggestions[1].description, /01:00/);
});

test('buildStrategySuggestions reports data gaps', () => {
  const suggestions = buildStrategySuggestions(dataset, { date: '2026-05-07' });
  const gap = suggestions.find((item) => item.type === 'data_gap');

  assert.ok(gap);
  assert.match(gap.description, /实际负荷/);
  assert.match(gap.description, /日结算/);
});
