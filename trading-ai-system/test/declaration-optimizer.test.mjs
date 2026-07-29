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
