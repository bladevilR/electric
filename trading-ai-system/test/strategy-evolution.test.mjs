import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStrategyEvolutionAction,
  buildStrategyEvolution,
} from '../lib/strategy-evolution.mjs';

test('buildStrategyEvolution 产出四中心闭环与版本对比', () => {
  const evolution = buildStrategyEvolution({
    date: '2026-07-31',
    strategyValidation: {
      declarationOptimizer: {
        status: 'validated',
        selectedModel: { id: 'same_slot_mean_w42_a1', windowDays: 42 },
        holdout: {
          improvementPct: 9.64,
          dailyWinRatePct: 86.05,
          modelMaeMwh: 1.48,
          baselineMaeMwh: 1.64,
          pointCount: 4128,
          dateCount: 43,
        },
      },
      sampleCoverage: { evaluationDateCount: 214, pricePointCount: 20544 },
    },
  });

  assert.equal(evolution.version, 1);
  assert.equal(evolution.sampleKind, 'derived_from_validation');
  assert.ok(evolution.centers.evolution);
  assert.ok(evolution.centers.experiment);
  assert.ok(evolution.centers.operations);
  assert.ok(evolution.centers.governance);

  const { champion, challenger, comparison } = evolution.centers.evolution;
  assert.equal(champion.role, 'champion');
  assert.equal(challenger.role, 'challenger');
  assert.equal(challenger.status, 'shadow');
  assert.ok(comparison.improvementDeltaPp > 0);
  assert.equal(comparison.verdict, 'challenger_ahead');

  assert.equal(evolution.centers.experiment.experiments.length >= 4, true);
  assert.equal(evolution.centers.governance.policy.autoPromote, false);
  assert.equal(evolution.centers.governance.policy.allowAutoSubmit, false);
  assert.equal(evolution.centers.governance.queue[0].status, 'pending_approval');
  assert.ok(evolution.loop.some((step) => step.id === 'shadow' && step.status === 'active'));
  assert.ok(evolution.centers.operations.kpis.some((kpi) => kpi.id === 'drift'));
});

test('applyStrategyEvolutionAction 审批后切换 Champion 并可回滚', () => {
  const base = buildStrategyEvolution({ date: '2026-07-31' });
  const approved = applyStrategyEvolutionAction(base, 'approve_challenger');
  assert.equal(approved.handled, true);
  assert.equal(approved.evolution.centers.evolution.champion.id, 'v3-challenger');
  assert.equal(approved.evolution.centers.evolution.champion.status, 'live');
  assert.equal(approved.evolution.centers.governance.queue[0].status, 'approved');
  assert.match(approved.message, /不会自动提交申报/);

  const rolled = applyStrategyEvolutionAction(approved.evolution, 'rollback_champion');
  assert.equal(rolled.handled, true);
  assert.equal(rolled.evolution.centers.evolution.champion.id, 'v2-champion');
  assert.equal(rolled.evolution.centers.evolution.challenger.status, 'shadow');
});

test('治理策略禁止自动上线与自动申报', () => {
  const evolution = buildStrategyEvolution({});
  assert.equal(evolution.centers.governance.policy.autoPromote, false);
  assert.equal(evolution.centers.governance.policy.requireHumanApproval, true);
  assert.equal(evolution.centers.governance.policy.requireShadowPass, true);
  assert.equal(evolution.centers.governance.rollback.available, true);
});
