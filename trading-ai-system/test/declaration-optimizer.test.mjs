import test from 'node:test';
import assert from 'node:assert/strict';

async function optimizerModule() {
  return import('../lib/declaration-optimizer.mjs').catch(() => null);
}

function point(date, actualMw, baselineMw = 20) {
  return {
    date,
    pointIndex: 1,
    defaultDeclarationPower: baselineMw,
    actualKwh: actualMw * 250,
  };
}

test('backtestDeclarationOptimizer selects on validation and promotes on untouched holdout', async () => {
  const module = await optimizerModule();
  assert.equal(typeof module?.backtestDeclarationOptimizer, 'function');

  const rows = Array.from({ length: 20 }, (_, index) =>
    point(`2026-01-${String(index + 1).padStart(2, '0')}`, 10)
  );
  const result = module.backtestDeclarationOptimizer(
    { rows },
    {
      expectedPointsPerDay: 1,
      splitRatios: [0.6, 0.2, 0.2],
      candidateWindows: [3],
      candidateWeights: [1],
      minHistoryPerPoint: 3,
      minHoldoutDays: 4,
      minHoldoutPoints: 4,
      minImprovementPct: 3,
      minDailyWinRatePct: 60,
    }
  );

  assert.equal(result.status, 'validated');
  assert.equal(result.selectedModel.id, 'same_slot_mean_w3_a1');
  assert.equal(result.selectedModel.windowDays, 3);
  assert.equal(result.selectedModel.weight, 1);
  assert.equal(result.split.validationDateCount, 4);
  assert.equal(result.split.holdoutDateCount, 4);
  assert.equal(result.holdout.pointCount, 4);
  assert.equal(result.holdout.baselineMaeMwh, 2.5);
  assert.equal(result.holdout.modelMaeMwh, 0);
  assert.equal(result.holdout.improvementPct, 100);
  assert.equal(result.holdout.dailyWinRatePct, 100);
  assert.equal(result.promotion.eligible, true);
  assert.deepEqual(result.promotion.reasons, []);
  assert.equal(result.costSavingsYuan, null);
});

test('backtestDeclarationOptimizer rejects a model that misses holdout gates', async () => {
  const { backtestDeclarationOptimizer } = await optimizerModule();
  const rows = Array.from({ length: 20 }, (_, index) =>
    point(
      `2026-02-${String(index + 1).padStart(2, '0')}`,
      index >= 16 ? 30 : 10
    )
  );
  const result = backtestDeclarationOptimizer(
    { rows },
    {
      expectedPointsPerDay: 1,
      splitRatios: [0.6, 0.2, 0.2],
      candidateWindows: [3],
      candidateWeights: [1],
      minHistoryPerPoint: 3,
      minHoldoutDays: 4,
      minHoldoutPoints: 4,
    }
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.promotion.eligible, false);
  assert.ok(
    result.promotion.reasons.includes('mae_improvement_below_threshold')
  );
});

test('backtestDeclarationOptimizer requires complete chronological evidence', async () => {
  const { backtestDeclarationOptimizer } = await optimizerModule();
  const result = backtestDeclarationOptimizer(
    { rows: [point('2026-03-01', 10)] },
    { expectedPointsPerDay: 1 }
  );

  assert.equal(result.status, 'insufficient_history');
  assert.equal(result.selectedModel, null);
  assert.equal(result.costSavingsYuan, null);
});

test('buildDeclarationRecommendation emits bounded point recommendations from earlier actuals', async () => {
  const { buildDeclarationRecommendation } = await optimizerModule();
  assert.equal(typeof buildDeclarationRecommendation, 'function');
  const rows = [];
  for (let day = 1; day <= 7; day += 1) {
    const date = `2026-04-${String(day).padStart(2, '0')}`;
    rows.push(point(date, 10), {
      ...point(date, 20),
      pointIndex: 2,
    });
  }
  rows.push(
    {
      date: '2026-04-08',
      pointIndex: 1,
      timePoint: '00:15',
      defaultDeclarationPower: 14,
    },
    {
      date: '2026-04-08',
      pointIndex: 2,
      timePoint: '00:30',
      defaultDeclarationPower: 24,
    }
  );
  const validation = {
    status: 'validated',
    selectedModel: {
      id: 'same_slot_mean_w7_a1',
      windowDays: 7,
      weight: 1,
      minHistoryPerPoint: 7,
    },
  };

  const result = buildDeclarationRecommendation(
    { rows },
    '2026-04-08',
    validation,
    { expectedPointsPerDay: 2, maxActualAgeHours: 48 }
  );

  assert.equal(result.status, 'ready');
  assert.equal(result.operatingMode, 'validated_optimizer');
  assert.equal(result.coverage.recommendedPointCount, 2);
  assert.equal(result.rows[0].recommendedPowerMw, 10);
  assert.equal(result.rows[1].recommendedPowerMw, 20);
  assert.equal(
    result.rows.every((row) => row.recommendedPowerMw >= 0),
    true
  );
  assert.equal(result.costSavingsYuan, null);
});

test('buildDeclarationRecommendation blocks stale actual-load history', async () => {
  const { buildDeclarationRecommendation } = await optimizerModule();
  const result = buildDeclarationRecommendation(
    {
      rows: [
        point('2026-04-01', 10),
        {
          date: '2026-04-08',
          pointIndex: 1,
          defaultDeclarationPower: 14,
        },
      ],
    },
    '2026-04-08',
    {
      status: 'validated',
      selectedModel: {
        id: 'same_slot_mean_w7_a1',
        windowDays: 7,
        weight: 1,
        minHistoryPerPoint: 1,
      },
    },
    { expectedPointsPerDay: 1, maxActualAgeHours: 48 }
  );

  assert.equal(result.status, 'stale_inputs');
  assert.equal(result.operatingMode, 'baseline_fallback');
  assert.ok(result.fallbackReasons.includes('actual_history_stale'));
  assert.deepEqual(result.rows, []);
});

test('buildDeclarationRecommendation requires a complete target baseline', async () => {
  const { buildDeclarationRecommendation } = await optimizerModule();
  const result = buildDeclarationRecommendation(
    { rows: [point('2026-04-07', 10)] },
    '2026-04-08',
    {
      status: 'validated',
      selectedModel: {
        id: 'same_slot_mean_w7_a1',
        windowDays: 7,
        weight: 1,
        minHistoryPerPoint: 1,
      },
    },
    { expectedPointsPerDay: 1 }
  );

  assert.equal(result.status, 'missing_baseline');
  assert.ok(
    result.fallbackReasons.includes(
      'target_default_declaration_incomplete'
    )
  );
});

test('buildDeclarationRecommendation keeps a complete default baseline reviewable when optimizer is rejected', async () => {
  const { buildDeclarationRecommendation } = await optimizerModule();
  const result = buildDeclarationRecommendation(
    {
      rows: [
        {
          date: '2026-04-08',
          pointIndex: 1,
          timePoint: '00:15',
          defaultDeclarationPower: 14,
        },
      ],
    },
    '2026-04-08',
    { status: 'rejected', selectedModel: null },
    { expectedPointsPerDay: 1 }
  );

  assert.equal(result.status, 'baseline_ready');
  assert.equal(result.operatingMode, 'baseline_fallback');
  assert.equal(result.coverage.recommendedPointCount, 1);
  assert.equal(result.rows[0].recommendedPowerMw, 14);
  assert.equal(result.rows[0].fallbackUsed, true);
  assert.ok(result.fallbackReasons.includes('optimizer_not_validated'));
});
