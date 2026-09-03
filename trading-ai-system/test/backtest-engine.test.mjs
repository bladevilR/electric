import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRegressionMetrics,
  computeStrategyBacktest,
  runForecastBacktest,
  runPointInTimeBacktest,
  validateBacktestSplit,
} from '../lib/backtest-engine.mjs';

test('point-in-time backtest uses isolated snapshots and split dates cannot overlap', async () => {
  const split = validateBacktestSplit({trainingDates:['2026-01-01'],validationDates:['2026-01-02'],holdoutDates:['2026-01-02'],liveDates:[]});
  assert.equal(split.ok,false);assert.ok(split.errors.includes('split_dates_overlap'));
  const report=await runPointInTimeBacktest({dates:['2026-08-24'],buildSnapshot:async()=>({selectedFactIds:['safe-r1'],rows:[]}),forecast:async()=>[],outcomes:[],config:{decisionCutoffAt:'2026-08-23T10:00:00+08:00'}});
  assert.equal(report.runType,'point_in_time_replay');assert.deepEqual(report.usedFactIds,['safe-r1']);
});

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
  assert.equal(result.metrics.realTimeAvgPrice.modelId, 'naive_same_slot');
  assert.ok(result.modelComparison.some((item) => item.modelId === 'rolling_same_slot_median'));
});

test('buildStrategyValidation rejects a candidate that does not beat the baseline', async () => {
  const module = await import('../lib/backtest-engine.mjs');
  assert.equal(typeof module.buildStrategyValidation, 'function');
  const result = module.buildStrategyValidation(
    {
      status: 'ready',
      evaluationDates: Array.from({ length: 220 }, (_, index) => `date-${index}`),
      modelComparison: [
        {
          modelId: 'naive_same_slot',
          target: 'realTimeAvgPrice',
          sampleCount: 307,
          mae: 29.121824,
          rmse: 42.987782,
          bias: -6.192182,
        },
        {
          modelId: 'rolling_same_slot_median',
          target: 'realTimeAvgPrice',
          sampleCount: 307,
          mae: 29.631433,
          rmse: 42.816151,
          bias: -11.160749,
        },
      ],
      strategyComparison: {
        status: 'savings_unavailable',
        estimatedSavings: null,
        warnings: ['strategy_action_missing'],
      },
    },
    {
      declarationReplay: {
        status: 'validated',
        verdict: 'not_improved',
        comparablePointCount: 20544,
        dateCount: 214,
        submittedMaeMwh: 3.191345,
        baselineMaeMwh: 2.998971,
        improvementPct: -6.41,
        winRatePct: 30.16,
        costSavingsYuan: null,
      },
      declarationOptimizer: {
        status: 'validated',
        selectedModel: {
          id: 'same_slot_mean_w42_a1',
          windowDays: 42,
          weight: 1,
        },
        holdout: {
          pointCount: 4128,
          dateCount: 43,
          baselineMaeMwh: 1.638775,
          modelMaeMwh: 1.480843,
          improvementPct: 9.64,
          pointWinRatePct: 58.48,
          dailyWinRatePct: 86.05,
        },
        promotion: { eligible: true, reasons: [] },
        costSavingsYuan: null,
      },
    }
  );

  assert.equal(result.overallStatus, 'not_validated');
  assert.equal(result.operatingMode, 'validated_optimizer');
  assert.equal(result.reviewRecommendationAllowed, true);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.priceModel.status, 'rejected');
  assert.equal(result.priceModel.preferredModelId, 'naive_same_slot');
  assert.equal(result.priceModel.candidateImprovementPct, -1.75);
  assert.equal(result.priceModel.sampleCount, 307);
  assert.equal(result.sampleCoverage.evaluationDateCount, 220);
  assert.equal(result.costStrategy.status, 'not_validated');
  assert.equal(result.costStrategy.estimatedSavingsYuan, null);
  assert.equal(result.declarationReplay.verdict, 'not_improved');
  assert.equal(result.declarationReplay.comparablePointCount, 20544);
  assert.equal(result.declarationOptimizer.status, 'validated');
  assert.equal(result.declarationOptimizer.holdout.improvementPct, 9.64);
  assert.equal(result.executionAllowed, false);
  assert.ok(result.reasons.includes('candidate_not_better_than_baseline'));
  assert.ok(result.reasons.includes('declaration_not_better_than_default'));
  assert.ok(result.reasons.includes('strategy_savings_unavailable'));
  assert.equal(
    result.reasons.includes('declaration_optimizer_unavailable'),
    false
  );
});

test('buildStrategyValidation keeps the default declaration baseline reviewable when optimizer is rejected', async () => {
  const { buildStrategyValidation } = await import('../lib/backtest-engine.mjs');
  const result = buildStrategyValidation(
    {
      status: 'ready',
      evaluationDates: ['2026-01-01'],
      modelComparison: [],
      strategyComparison: {
        status: 'savings_unavailable',
        estimatedSavings: null,
        warnings: ['strategy_action_missing'],
      },
    },
    {
      declarationOptimizer: {
        status: 'rejected',
        selectedModel: {
          id: 'same_slot_mean_w42_a1',
          windowDays: 42,
          weight: 1,
        },
        holdout: {
          pointCount: 4128,
          dateCount: 43,
          improvementPct: -2,
          dailyWinRatePct: 40,
        },
        promotion: {
          eligible: false,
          reasons: ['mae_improvement_below_threshold'],
        },
        costSavingsYuan: null,
      },
    }
  );

  assert.equal(result.operatingMode, 'baseline_fallback');
  assert.equal(result.reviewRecommendationAllowed, true);
  assert.equal(result.executionAllowed, false);
  assert.ok(result.reasons.includes('declaration_optimizer_rejected'));
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
