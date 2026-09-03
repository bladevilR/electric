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
        temperatureActualC: { points: [{ pointIndex: 1, value: 29 }] },
        actualAverageLoadMw: { points: [{ pointIndex: 1, value: 610 }] },
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

test('accuracy evidence is isolated by prediction target instead of reusing price metrics', () => {
  const model = buildStrategyFoundationModel({
    accuracyReport: {
      metrics: { mae: 21.4, rmse: 31.8, mape: 6.3 },
      byTarget: {
        temperature: {
          metrics: { mae: 0.8, rmse: 1.1, mape: 2.4 },
          modelVersion: 'temp-v6',
        },
      },
    },
  });

  assert.equal(model.accuracy.byTab.price.metrics.mae, 21.4);
  assert.equal(model.accuracy.byTab.temperature.metrics.mae, 0.8);
  assert.equal(model.accuracy.byTab.temperature.modelVersion, 'temp-v6');
  assert.equal(model.accuracy.byTab.load.metrics.mae, null);
});

test('collection evidence carries the exact snapshot and history storage locations', () => {
  const model = buildStrategyFoundationModel({
    ukeyStatus: {
      visibleSnapshot: { storagePath: 'E:\\electric\\data\\snapshot.json' },
      visibleHistory: {
        storagePath: 'C:\\Users\\R\\history.json',
        rowCount: 79,
        dates: ['2026-06-29'],
      },
      collector: {
        state: 'stopped',
        lastPageTitle: '实时价格',
        lastPageUrl: 'https://example.invalid/realtime',
      },
    },
  });

  assert.equal(model.collection.current.storagePath, 'E:\\electric\\data\\snapshot.json');
  assert.equal(model.collection.history.storagePath, 'C:\\Users\\R\\history.json');
  assert.equal(model.collection.lastPageTitle, '实时价格');
});

test('demo collection provenance is never labelled as real data', () => {
  const model = buildStrategyFoundationModel({
    mode: 'demo',
    targetDate: '2026-07-31',
    workbench: {
      metrics: { marketPricePointCount: 96 },
      readiness: { status: 'ready' },
    },
    ukeyStatus: {
      visibleHistory: { rowCount: 96, dates: ['2026-07-31'] },
    },
  });

  assert.equal(model.collection.current.kind, 'current_simulation');
  assert.equal(model.collection.current.label, '今日模拟数据');
  assert.equal(model.collection.history.kind, 'historical_simulation');
  assert.equal(model.collection.history.label, '历史模拟数据');
  assert.equal(model.collection.strategyExecutable, false);
});

test('price chart only accepts the canonical price forecast target', () => {
  const model = buildStrategyFoundationModel({
    forecastReport: {
      forecasts: [
        { target: 'realTimeAvgPrice', pointIndex: 1, pointForecast: 321 },
        { target: 'priceSpread', pointIndex: 1, pointForecast: -18 },
        { target: 'highPriceRiskLabel', pointIndex: 1, pointForecast: 1 },
      ],
    },
  });

  assert.deepEqual(model.forecastTabs[0].series[1].points, [{ pointIndex: 1, value: 321 }]);
});

test('market cockpit contract maps actual and forecast load without inventing temperature', () => {
  const model = buildStrategyFoundationModel({
    marketCockpit: {
      series: {
        actualAverageLoadMw: { points: [{ pointIndex: 1, value: 610 }] },
        systemLoadForecastMw: { points: [{ pointIndex: 1, value: 625 }] },
      },
    },
  });

  assert.equal(model.forecastTabs[2].series[0].points[0].value, 610);
  assert.equal(model.forecastTabs[2].series[1].points[0].value, 625);
  assert.deepEqual(model.forecastTabs[1].series.flatMap((series) => series.points), []);
});

test('evidence cutoff does not reuse the cockpit request time', () => {
  const model = buildStrategyFoundationModel({
    now: '2026-09-03T09:30:00+08:00',
    marketCockpit: { identity: { asOf: '2026-09-03T09:30:00+08:00' } },
  });

  assert.equal(model.identity.now, '2026-09-03T09:30:00+08:00');
  assert.equal(model.identity.dataCutoff, null);
});

test('ratio-form skill versus baseline is normalized to display percent', () => {
  const model = buildStrategyFoundationModel({
    accuracyReport: { metrics: { skillVsBaseline: 0.096 } },
  });

  assert.equal(model.accuracy.metrics.baselineSkill, 9.6);
});

test('history coverage uses the latest date count instead of the cumulative row count', () => {
  const model = buildStrategyFoundationModel({
    ukeyStatus: {
      visibleHistory: {
        rowCount: 175,
        dates: ['2026-06-29', '2026-06-30'],
        coverageByDate: { '2026-06-29': 96, '2026-06-30': 79 },
      },
    },
  });

  assert.equal(model.collection.history.date, '2026-06-30');
  assert.equal(model.collection.history.coverage, 79);
});

test('sandbox does not claim cost peak-valley or risk impact without evidence', () => {
  const model = buildStrategyFoundationModel({
    workbench: {
      declarationRecommendation: {
        rows: [{ pointIndex: 1, recommendedPowerMw: 100 }],
      },
    },
  });
  const result = applyFoundationSandbox(model, { riskProfile: 'active' });

  assert.equal(result.estimatedCostChangeYuan, null);
  assert.equal(result.peakValleyShiftMwh, null);
  assert.equal(result.riskExposureChangePct, null);
});

test('issued forecast ledger drives version comparison and decision cutoff evidence', () => {
  const model = buildStrategyFoundationModel({
    forecastRuns: {
      runs: [
        {
          forecastRunId: 'run-1',
          targetField: 'realTimeAvgPrice',
          modelVersion: 'price-v1',
          forecastGeneratedAt: '2026-09-03T07:00:00+08:00',
          decisionCutoffAt: '2026-09-03T06:45:00+08:00',
          rows: [{ pointIndex: 1, p50: 300 }],
        },
        {
          forecastRunId: 'run-2',
          targetField: 'realTimeAvgPrice',
          modelVersion: 'price-v2',
          forecastGeneratedAt: '2026-09-03T07:30:00+08:00',
          decisionCutoffAt: '2026-09-03T07:15:00+08:00',
          rows: [{ pointIndex: 1, p50: 320 }],
        },
        {
          forecastRunId: 'spread-run',
          targetField: 'priceSpread',
          modelVersion: 'spread-v1',
          forecastGeneratedAt: '2026-09-03T07:40:00+08:00',
          decisionCutoffAt: '2026-09-03T07:20:00+08:00',
          rows: [{ pointIndex: 1, p50: -20 }],
        },
        {
          forecastRunId: 'replay-run',
          forecastRunType: 'point_in_time_replay',
          targetField: 'realTimeAvgPrice',
          modelVersion: 'replay-v9',
          forecastGeneratedAt: '2026-09-03T08:00:00+08:00',
          decisionCutoffAt: '2026-09-03T07:50:00+08:00',
          rows: [{ pointIndex: 1, p50: 999 }],
        },
      ],
    },
  });

  assert.equal(model.identity.dataCutoff, '2026-09-03T07:15:00+08:00');
  assert.equal(model.accuracy.modelVersion, 'price-v2');
  assert.deepEqual(model.forecastTabs[0].series[1].points, [{ pointIndex: 1, value: 320 }]);
  assert.deepEqual(model.forecastTabs[0].series[2].points, [{ pointIndex: 1, value: 300 }]);
  assert.deepEqual(model.accuracy.versions.map((version) => version.modelVersion), [
    'price-v2',
    'price-v1',
  ]);
});

test('real workbench review states can close complete data without enabling demo execution', () => {
  for (const status of ['review_required', 'verified']) {
    const model = buildStrategyFoundationModel({
      mode: 'real',
      workbench: { metrics: { marketPricePointCount: 96 }, status },
    });
    assert.equal(model.collection.current.complete, true);
    assert.equal(model.collection.strategyExecutable, true);
  }
});

test('strategy trace is indexed into node-specific evidence', () => {
  const model = buildStrategyFoundationModel({
    strategyTrace: {
      stages: [
        {
          id: 'objectiveConstraints',
          title: '目标与硬约束',
          status: 'available',
          conclusion: {
            conclusionId: 'decision:objective',
            inputRefs: ['fact:price:66'],
            featureSnapshotId: 'snapshot-7',
            forecastRunIds: ['forecast-3'],
            modelVersions: ['optimizer-v2'],
            constraintRefs: ['constraint-v7'],
            warnings: [],
          },
        },
      ],
    },
  });

  assert.deepEqual(model.derivation.evidenceByExplanation.optimizer, {
    stageStatus: ['目标与硬约束：available'],
    conclusionIds: ['decision:objective'],
    inputRefs: ['fact:price:66'],
    featureSnapshotIds: ['snapshot-7'],
    forecastRunIds: ['forecast-3'],
    modelVersions: ['optimizer-v2'],
    constraintRefs: ['constraint-v7'],
    warnings: [],
  });
});

test('SQLite evidence workbench separates actual, p50 and interval series and exposes backfill progress', () => {
  const priceRows = Array.from({ length: 96 }, (_, index) => ({
    pointIndex: index + 1,
    pointForecast: 300 + index,
    p10: 280 + index,
    p50: 300 + index,
    p90: 325 + index,
  }));
  const facts = Array.from({ length: 96 }, (_, index) => [
    { fieldId: 'temperatureForecastC', businessDate: '2026-09-03', pointIndex: index + 1, value: 26 + index / 96 },
    { fieldId: 'temperatureActualC', businessDate: '2026-09-03', pointIndex: index + 1, value: 25.5 + index / 96 },
    { fieldId: 'loadForecastMw', businessDate: '2026-09-03', pointIndex: index + 1, value: 1000 + index },
    { fieldId: 'actualLoadMw', businessDate: '2026-09-03', pointIndex: index + 1, value: 990 + index },
  ]).flat();
  const model = buildStrategyFoundationModel({
    mode: 'real',
    targetDate: '2026-09-03',
    collectorStatus: {
      browser: { state: 'ready' },
      weather: { provider: 'Open-Meteo', forecastLeadHours: 24 },
      jobs: [{ id: 'job-1', state: 'running', earliestDate: '2024-01-01', latestDate: '2026-09-02', completedChunks: 43, totalChunks: 50 }],
      storage: { engine: 'SQLite', path: 'C:\\evidence.sqlite' },
    },
    historyCoverage: { coverage: { dateCount: 611, earliestDate: '2024-01-01', latestDate: '2026-09-02' } },
    historyFacts: { rows: facts },
    forecastRuns: { runs: [{
      forecastRunId: 'live-evidence-1',
      forecastRunType: 'live_issued',
      targetField: 'dayAheadUserPriceFinalYuanPerMwh',
      targetTradingDate: '2026-09-03',
      modelId: 'interpretable_weather_load_ridge_v1',
      modelVersion: '1.0.0',
      decisionCutoffAt: '2026-09-02T10:00:00.000Z',
      forecastGeneratedAt: '2026-09-02T10:05:00.000Z',
      rows: priceRows,
    }] },
  });

  assert.deepEqual(model.forecast.tabs.map((tab) => tab.id), ['price', 'temperature', 'load']);
  assert.equal(model.forecast.tabs[0].series.p50.length, 96);
  assert.equal(model.forecast.tabs[0].series.p10.length, 96);
  assert.equal(model.forecast.tabs[0].series.p90.length, 96);
  assert.equal(model.forecast.tabs[1].series.actual.length, 96);
  assert.equal(model.forecast.tabs[1].series.p50.length, 96);
  assert.equal(model.collection.backfill.progressPct, 86);
  assert.equal(model.collection.weather.provider, 'Open-Meteo');
  assert.equal(model.collection.storagePath, 'C:\\evidence.sqlite');
});
