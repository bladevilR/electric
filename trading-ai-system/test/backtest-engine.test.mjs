import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRegressionMetrics,
  computeStrategyBacktest,
  runForecastBacktest,
} from '../lib/backtest-engine.mjs';

const rows = [
  { date: '2026-06-24', pointIndex: 1, realTimeAvgPrice: 100, priceSpread: 1 },
  { date: '2026-06-25', pointIndex: 1, realTimeAvgPrice: 110, priceSpread: 2 },
  { date: '2026-06-26', pointIndex: 1, realTimeAvgPrice: 120, priceSpread: 3 },
  { date: '2026-06-27', pointIndex: 1, realTimeAvgPrice: 130, priceSpread: 4 },
  { date: '2026-06-28', pointIndex: 1, realTimeAvgPrice: 140, priceSpread: 5 },
  { date: '2026-06-29', pointIndex: 1, realTimeAvgPrice: 150, priceSpread: 6 },
];

test('computeRegressionMetrics reports deterministic error metrics', () => {
  const metrics = computeRegressionMetrics([100, 120], [90, 130]);

  assert.equal(metrics.sampleCount, 2);
  assert.equal(metrics.mae, 10);
  assert.equal(metrics.rmse, 10);
  assert.equal(metrics.bias, 0);
});

test('runForecastBacktest walks forward without evaluating dates lacking prior history', () => {
  const result = runForecastBacktest({ rows }, { minHistoryDates: 2 });

  assert.equal(result.status, 'ready');
  assert.equal(result.evaluationDates.includes('2026-06-24'), false);
  assert.ok(result.evaluationDates.includes('2026-06-26'));
  assert.ok(result.metrics.realTimeAvgPrice.sampleCount > 0);
  assert.ok(result.modelComparison.some((item) => item.modelId === 'rolling_same_slot_median'));
});

test('computeStrategyBacktest does not claim savings without actual load and settlement', () => {
  const result = computeStrategyBacktest({ rows }, {}, {});

  assert.equal(result.status, 'insufficient_actuals');
  assert.ok(result.warnings.includes('actual_load_missing'));
  assert.ok(result.warnings.includes('settlement_missing'));
  assert.equal(result.estimatedSavings, null);
});

test('computeStrategyBacktest does not claim savings from historical labels without strategy actions', () => {
  const result = computeStrategyBacktest(
    {
      rows: [
        { date: '2026-01-01', pointIndex: 1, actualKwh: 20163, settleAmount: 6579.17 },
        { date: '2026-01-01', pointIndex: 2, actualKwh: 19842, settleAmount: 6310.55 },
      ],
    },
    { status: 'ready' },
    {}
  );

  assert.equal(result.status, 'savings_unavailable');
  assert.equal(result.baseline, 'no_action');
  assert.equal(result.estimatedSavings, null);
  assert.ok(result.warnings.includes('strategy_action_missing'));
});

test('runForecastBacktest keeps price metrics separate from unavailable savings backtest', () => {
  const labeledRows = [
    { date: '2026-06-24', pointIndex: 1, realTimeAvgPrice: 100, priceSpread: 1, actualKwh: 1000, settleAmount: 300 },
    { date: '2026-06-25', pointIndex: 1, realTimeAvgPrice: 110, priceSpread: 2, actualKwh: 1000, settleAmount: 300 },
    { date: '2026-06-26', pointIndex: 1, realTimeAvgPrice: 120, priceSpread: 3, actualKwh: 1000, settleAmount: 300 },
    { date: '2026-06-27', pointIndex: 1, realTimeAvgPrice: 130, priceSpread: 4, actualKwh: 1000, settleAmount: 300 },
    { date: '2026-06-28', pointIndex: 1, realTimeAvgPrice: 140, priceSpread: 5, actualKwh: 1000, settleAmount: 300 },
    { date: '2026-06-29', pointIndex: 1, realTimeAvgPrice: 150, priceSpread: 6, actualKwh: 1000, settleAmount: 300 },
  ];

  const result = runForecastBacktest({ rows: labeledRows }, { minHistoryDates: 2 });

  assert.equal(result.status, 'ready');
  assert.ok(result.metrics.realTimeAvgPrice.sampleCount > 0);
  assert.equal(result.strategyComparison.status, 'savings_unavailable');
  assert.equal(result.strategyComparison.estimatedSavings, null);
  assert.ok(result.warnings.includes('strategy_action_missing'));
});
