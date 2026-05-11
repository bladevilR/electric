import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStrategyAdvice,
  buildStrategySuggestions,
  numeric,
  quantile,
  windowLabel,
} from '../lib/strategy-engine.mjs';

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

test('numeric treats empty market fields as missing instead of zero', () => {
  assert.equal(numeric(null), null);
  assert.equal(numeric(undefined), null);
  assert.equal(numeric(''), null);
  assert.equal(numeric('0'), 0);
});

test('windowLabel compresses strategy points into readable windows', () => {
  const label = windowLabel([
    { timePoint: '00:15' },
    { timePoint: '00:30' },
    { timePoint: '00:45' },
  ]);

  assert.match(label, /00:15/);
  assert.match(label, /00:30/);
  assert.match(label, /00:45/);
});

test('buildStrategySuggestions identifies low-price and high-price windows', () => {
  const suggestions = buildStrategySuggestions(dataset, { date: '2026-05-07' });

  assert.equal(suggestions[0].type, 'low_price');
  assert.match(suggestions[0].description, /00:15/);
  assert.equal(suggestions[1].type, 'high_price_risk');
  assert.match(suggestions[1].description, /01:00/);
});

test('buildStrategySuggestions reports data gaps', () => {
  const suggestions = buildStrategySuggestions(dataset, { date: '2026-05-07' });
  const gap = suggestions.find((item) => item.type === 'data_gap');

  assert.ok(gap);
  assert.ok(gap.requiredData.some((item) => item.id === 'actual_load_96'));
  assert.ok(gap.requiredData.some((item) => item.id === 'settle_day'));
});

test('buildStrategySuggestions marks current baseline suggestions as trial-only', () => {
  const suggestions = buildStrategySuggestions(dataset, { date: '2026-05-07' });

  assert.ok(suggestions.length >= 3);
  assert.ok(suggestions.every((item) => item.executable === false));
  assert.ok(suggestions.every((item) => Array.isArray(item.blockingReasons)));
  assert.ok(suggestions.every((item) => item.blockingReasons.length > 0));
});

test('price window suggestions declare execution dependencies', () => {
  const suggestions = buildStrategySuggestions(dataset, { date: '2026-05-07' });
  const low = suggestions.find((item) => item.type === 'low_price');
  const high = suggestions.find((item) => item.type === 'high_price_risk');

  assert.ok(low.requiredData.some((item) => item.id === 'forecast_load_96'));
  assert.ok(low.requiredData.some((item) => item.id === 'position_96'));
  assert.ok(high.requiredData.some((item) => item.id === 'position_96'));
  assert.ok(low.blockingReasons.length > 0);
  assert.ok(high.blockingReasons.length > 0);
});

test('data gap suggestion names missing source dependencies', () => {
  const suggestions = buildStrategySuggestions(dataset, { date: '2026-05-07' });
  const gap = suggestions.find((item) => item.type === 'data_gap');

  assert.ok(gap.requiredData.some((item) => item.id === 'actual_load_96'));
  assert.ok(gap.requiredData.some((item) => item.id === 'settle_day'));
  assert.ok(gap.blockingReasons.length > 0);
});

test('buildStrategyAdvice exposes trial-only AI advice readiness from price snapshots', () => {
  const advice = buildStrategyAdvice(dataset, { date: '2026-05-07' });

  assert.equal(advice.status, 'observation_ready');
  assert.equal(advice.executionBoundary.executable, false);
  assert.equal(advice.realtimePrice.required, true);
  assert.equal(advice.realtimePrice.status, 'available_snapshot');
  assert.equal(advice.realtimePrice.pointCount, 4);
  assert.equal(advice.priceSignal.averageRealTimePrice, 153.75);
  assert.equal(advice.priceSignal.lowThreshold, 100);
  assert.equal(advice.priceSignal.highThreshold, 210);
  assert.ok(advice.nextDataNeeds.some((item) => item.id === 'forecast_load_96'));
  assert.ok(advice.nextDataNeeds.some((item) => item.id === 'position_96'));
});

test('buildStrategyAdvice blocks AI advice when realtime price is absent', () => {
  const advice = buildStrategyAdvice(
    { quality: { fieldCompleteness: {} }, rows: [] },
    { date: '2026-05-07' }
  );

  assert.equal(advice.status, 'waiting_for_realtime_price');
  assert.equal(advice.realtimePrice.status, 'missing');
  assert.equal(advice.realtimePrice.pointCount, 0);
  assert.equal(advice.priceSignal.averageRealTimePrice, null);
  assert.ok(advice.nextDataNeeds.some((item) => item.id === 'realtime_average_price'));
});

test('buildStrategyAdvice ignores blank realtime price points', () => {
  const advice = buildStrategyAdvice(
    {
      rows: [
        { date: '2026-05-07', pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: null },
        { date: '2026-05-07', pointIndex: 2, timePoint: '00:30', realTimeAvgPrice: '' },
        { date: '2026-05-07', pointIndex: 3, timePoint: '00:45', realTimeAvgPrice: 120 },
        { date: '2026-05-07', pointIndex: 4, timePoint: '01:00', realTimeAvgPrice: 180 },
      ],
      quality: { fieldCompleteness: {} },
    },
    { date: '2026-05-07' }
  );

  assert.equal(advice.realtimePrice.pointCount, 2);
  assert.equal(advice.priceSignal.minRealTimePrice, 120);
  assert.equal(advice.priceSignal.lowThreshold, 120);
});
