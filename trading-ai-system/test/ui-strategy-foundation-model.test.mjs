import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFoundationSandbox,
  buildStrategyFoundationModel,
} from '../ui/view-models/strategy-foundation-model.js';

test('foundation model separates current, historical, and simulated truth', () => {
  const model = buildStrategyFoundationModel({
    mode: 'real',
    targetDate: '2026-09-03',
    now: '2026-09-03T09:30:00+08:00',
    ukeyStatus: {
      collector: { state: 'stopped' },
      visibleHistory: {
        dates: ['2026-06-29'],
        rowCount: 79,
        generatedAt: '2026-06-29T07:55:02.693Z',
      },
    },
    workbench: {
      metrics: { marketPricePointCount: 0 },
      readiness: { status: 'data_blocked' },
    },
  });

  assert.equal(model.identity.environment, '真实环境');
  assert.equal(model.collection.current.kind, 'current_real');
  assert.equal(model.collection.current.coverage, 0);
  assert.equal(model.collection.current.label, '今日真实数据');
  assert.equal(model.collection.history.kind, 'historical_real');
  assert.equal(model.collection.history.coverage, 79);
  assert.equal(model.collection.history.date, '2026-06-29');
  assert.equal(model.collection.simulation.kind, 'simulation');
  assert.equal(model.collection.strategyExecutable, false);
  assert.equal(model.collection.collectorState, 'stopped');
});

test('foundation model exposes price temperature and load tabs with isolated units', () => {
  const model = buildStrategyFoundationModel({
    mode: 'real',
    targetDate: '2026-09-03',
    forecastReport: {
      forecasts: [{ pointIndex: 1, predictedValue: 321 }],
      metrics: { mae: 78.6, rmse: 112.4, mape: 8.2 },
    },
    marketCockpit: {
      series: {
        temperature: { points: [{ pointIndex: 1, value: 29 }] },
        load: { points: [{ pointIndex: 1, value: 610 }] },
      },
    },
  });

  assert.deepEqual(model.forecastTabs.map((tab) => tab.id), [
    'price',
    'temperature',
    'load',
  ]);
  assert.deepEqual(model.forecastTabs.map((tab) => tab.unit), [
    '元/MWh',
    '°C',
    'MW',
  ]);
  assert.equal(model.forecastTabs[0].series[1].points[0].value, 321);
  assert.equal(model.forecastTabs[1].series[0].points[0].value, 29);
  assert.equal(model.forecastTabs[2].series[0].points[0].value, 610);
});

test('foundation model keeps unavailable accuracy null and carries formula caveats', () => {
  const model = buildStrategyFoundationModel({ mode: 'real', targetDate: '2026-09-03' });

  assert.equal(model.accuracy.metrics.mae, null);
  assert.equal(model.accuracy.metrics.rmse, null);
  assert.equal(model.accuracy.metrics.mape, null);
  assert.match(model.explanations.mape.formula, /1\/n/);
  assert.match(model.explanations.mape.caveat, /接近 0/);
  assert.equal(model.explanations.optimizer.variables[0].unit, 'MWh');
});

test('sandbox returns bounded simulated output without mutating the formal model', () => {
  const model = buildStrategyFoundationModel({
    mode: 'demo',
    targetDate: '2026-09-03',
    workbench: {
      declarationRecommendation: {
        rows: [
          { pointIndex: 1, recommendedPowerMw: 100 },
          { pointIndex: 2, recommendedPowerMw: 80 },
        ],
      },
    },
  });
  const original = structuredClone(model);
  const result = applyFoundationSandbox(model, {
    priceWeight: 0.7,
    temperatureWeight: 0.5,
    loadWeight: 0.6,
    riskProfile: 'balanced',
  });

  assert.deepEqual(model, original);
  assert.equal(result.kind, 'simulation');
  assert.equal(result.persisted, false);
  assert.equal(result.submitAllowed, false);
  assert.equal(result.series.length, 2);
  assert.ok(result.series.every((row) => Number.isFinite(row.adjustedMw)));
  assert.ok(result.series.every((row) => Math.abs(row.adjustedMw - row.formalMw) <= row.formalMw * 0.12));
});

test('sandbox with no formal recommendation does not invent a strategy or savings', () => {
  const model = buildStrategyFoundationModel({ mode: 'real', targetDate: '2026-09-03' });
  const result = applyFoundationSandbox(model, { priceWeight: 1 });

  assert.deepEqual(result.series, []);
  assert.equal(result.estimatedCostChangeYuan, null);
  assert.equal(result.riskExposureChangePct, null);
});
