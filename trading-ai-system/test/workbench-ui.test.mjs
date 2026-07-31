import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildStandaloneDemoWorkbenchPayload,
  renderWorkbenchMarkup,
} from '../workbench.js';

function blockedPayload() {
  return {
    date: '2026-07-27',
    status: 'blocked',
    currentStage: 'connect',
    dataFreshness: {
      status: 'stale',
      generatedAt: '2026-06-29T07:55:02.693Z',
      ageMinutes: 40145,
    },
    savings: {
      estimatedNetYuan: null,
      realizedNetYuan: null,
      formulaComplete: false,
      formula: '基准成本 − 实际结算成本 − 手续费 − 偏差成本 − 系统运行成本',
      costs: {},
    },
    execution: {
      dataReady: false,
      reviewed: false,
      allowed: false,
      mode: 'human_decision_only',
    },
    stages: [
      { id: 'connect', label: '数据接入', status: 'active', description: '需要采集当日数据' },
      { id: 'validate', label: '质量校验', status: 'blocked', description: '缺失项会阻止执行' },
      { id: 'execute', label: '策略决策', status: 'blocked', description: '等待数据校验' },
      { id: 'settle', label: '结算评估', status: 'blocked', description: '结算后才计入已实现成本优化额' },
    ],
    blockers: [
      {
        id: 'current_day_missing',
        title: '<script>没有当日业务数据</script>',
        detail: '2026-07-27 没有可用于决策的业务行。',
        actionId: 'collect_today_data',
      },
    ],
    dataEvidence: [
      {
        id: 'market_price',
        label: '当日市场价格',
        status: 'missing',
        value: '0/96 点',
        detail: '所选交易日没有价格数据。',
      },
    ],
    primaryAction: {
      id: 'collect_today_data',
      label: '采集并校验当日数据',
    },
    auditEvents: [
      {
        type: 'production_readiness_checked',
        createdAt: '2026-07-27T01:45:00.000Z',
      },
    ],
    strategyValidation: {
      overallStatus: 'not_validated',
      operatingMode: 'validated_optimizer',
      reviewRecommendationAllowed: true,
      executionAllowed: false,
      priceModel: {
        status: 'rejected',
        preferredModelId: 'naive_same_slot',
        candidateImprovementPct: -1.75,
        sampleCount: 307,
        preferredMae: 29.121824,
      },
      sampleCoverage: {
        evaluationDateCount: 220,
      },
      costStrategy: {
        status: 'not_validated',
        estimatedSavingsYuan: null,
      },
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
      reasons: [
        'candidate_not_better_than_baseline',
        'declaration_not_better_than_default',
        'strategy_savings_unavailable',
      ],
    },
    declarationRecommendation: {
      status: 'missing_baseline',
      operatingMode: 'baseline_fallback',
      coverage: {
        baselinePointCount: 0,
        recommendedPointCount: 0,
        requiredPointCount: 96,
      },
      rows: [],
      fallbackReasons: ['target_default_declaration_incomplete'],
      costSavingsYuan: null,
    },
  };
}

test('blocked workbench renders four steps, one action, and no invented savings', () => {
  const html = renderWorkbenchMarkup(blockedPayload(), { mode: 'operation', evidenceOpen: true });

  assert.equal([...html.matchAll(/data-stage=/g)].length, 4);
  assert.equal([...html.matchAll(/data-primary-action=/g)].length, 1);
  assert.match(html, /预计综合成本优化额/);
  assert.match(html, /未获取/);
  assert.match(html, /不可执行/);
  assert.match(html, /数据未就绪 · 禁止下发/);
  assert.match(html, /成本机会/);
  assert.match(html, /策略依据/);
  assert.match(html, /风险约束/);
  assert.match(html, /可执行动作/);
  assert.match(html, /采集并校验当日数据/);
  assert.match(html, /历史策略验证/);
  assert.match(html, /307/);
  assert.match(html, /未优于基线/);
  assert.match(html, /策略节省尚未验证/);
  assert.match(html, /申报偏差回放/);
  assert.match(html, /未优于默认申报/);
  assert.match(html, /-6.41%/);
  assert.match(html, /20,544 个点/);
  assert.match(html, /30.16%/);
  assert.match(html, /申报优化策略/);
  assert.match(html, /已通过独立留出集/);
  assert.match(html, /42 日同点位均值/);
  assert.match(html, /\+9\.64%/);
  assert.match(html, /86\.05%/);
  assert.match(html, /4,128 个点/);
  assert.match(html, /当前回退默认申报/);
  assert.match(html, /补齐目标日 96 点默认申报/);
  assert.match(html, /偏差改善不等于已实现人民币节省/);
  assert.doesNotMatch(html, /立即下单|自动提交/);
  assert.doesNotMatch(html, /预计综合成本优化额[\s\S]{0,120}¥\s*0/);
});

test('demo scenarios are visibly labeled and never replace the default payload silently', async () => {
  const module = await import('../workbench.js');
  assert.equal(typeof module.buildDemoWorkbenchScenario, 'function');

  const original = blockedPayload();
  const reviewable = module.buildDemoWorkbenchScenario(original, 'reviewable');
  const settled = module.buildDemoWorkbenchScenario(original, 'settled');

  assert.equal(original.demoMode, undefined);
  assert.equal(reviewable.demoMode, true);
  assert.equal(reviewable.demoLabel, '演示状态 · 策略待复核');
  assert.equal(reviewable.status, 'review_required');
  assert.equal(reviewable.execution.dataReady, true);
  assert.equal(settled.demoMode, true);
  assert.equal(settled.demoLabel, '演示状态 · 结算已核验');
  assert.equal(settled.status, 'verified');
  assert.equal(settled.savings.realizedNetYuan, 24000);
  assert.equal(typeof module.buildDemoActionResult, 'function');
  assert.deepEqual(module.buildDemoActionResult(reviewable, 'review_strategy'), {
    handled: true,
    mode: 'review',
    evidenceOpen: true,
    message: '演示：策略草稿已生成并进入人工复核。',
  });
});

test('standalone reviewable demo does not depend on external standard data', async () => {
  const module = await import('../workbench.js');

  assert.equal(typeof module.buildStandaloneDemoWorkbenchPayload, 'function');
  const payload = module.buildStandaloneDemoWorkbenchPayload();
  const reviewable = module.buildDemoWorkbenchScenario(payload, 'reviewable');

  assert.equal(reviewable.demoMode, true);
  assert.equal(reviewable.declarationRecommendation.status, 'ready');
  assert.equal(reviewable.declarationRecommendation.rows.length, 96);
  assert.equal(reviewable.costStrategy.dataConfidence.score, 88);
  assert.equal(reviewable.execution.dataReady, true);
});

test('workbench markup escapes untrusted blocker text', () => {
  const html = renderWorkbenchMarkup(blockedPayload(), { mode: 'operation', evidenceOpen: true });

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;没有当日业务数据&lt;\/script&gt;/);
});

test('review mode shows the savings formula and evidence without an execution button', () => {
  const html = renderWorkbenchMarkup(blockedPayload(), { mode: 'review', evidenceOpen: true });

  assert.match(html, /成本优化证据链/);
  assert.match(html, /基准成本 − 实际结算成本 − 手续费 − 偏差成本 − 系统运行成本/);
  assert.match(html, /仅在结算完成且成本口径完整后，计入已实现成本优化额/);
  assert.match(html, /数据准备校验/);
  assert.match(html, /2026\/07\/27 09:45/);
  assert.equal([...html.matchAll(/data-primary-action=/g)].length, 0);
});

test('selecting the validation stage changes the main task to the data checklist', () => {
  const html = renderWorkbenchMarkup(blockedPayload(), {
    mode: 'operation',
    activeStage: 'validate',
    evidenceOpen: false,
  });

  assert.match(html, /执行前数据质量校验/);
  assert.match(html, /当日市场价格/);
  assert.doesNotMatch(html, /<h1>当日交易决策中心<\/h1>/);
  assert.equal([...html.matchAll(/data-primary-action=/g)].length, 1);
});

test('decision mode renders the AI declaration dashboard as the primary theme', () => {
  const payload = blockedPayload();
  payload.declarationRecommendation = {
    status: 'ready',
    coverage: {
      recommendedPointCount: 2,
      requiredPointCount: 2,
      optimizerPointCount: 2,
      fallbackPointCount: 0,
    },
    rows: [
      {
        pointIndex: 1,
        timePoint: '00:15',
        baselinePowerMw: 10,
        recommendedPowerMw: 12,
        deltaPowerMw: 2,
      },
      {
        pointIndex: 2,
        timePoint: '00:30',
        baselinePowerMw: 11,
        recommendedPowerMw: 9,
        deltaPowerMw: -2,
      },
    ],
  };
  payload.costStrategy = { dataConfidence: { score: 88 } };
  payload.execution = {
    dataReady: true,
    reviewed: false,
    allowed: false,
  };

  const html = renderWorkbenchMarkup(payload, {
    mode: 'operation',
    evidenceOpen: false,
  });

  assert.match(html, /AI申报优化/);
  assert.match(html, /96 点申报曲线对比/);
  assert.match(html, /\+9\.64%/);
  assert.match(html, /88\/100/);
  assert.match(html, /进入人工复核/);
  assert.match(html, /data-curve-point="1"/);
  assert.doesNotMatch(html, /立即下单|自动提交/);
});

test('decision dashboard never invents savings or confidence', () => {
  const html = renderWorkbenchMarkup(blockedPayload(), {
    mode: 'operation',
    evidenceOpen: false,
  });

  assert.match(html, /待校验/);
  assert.doesNotMatch(html, /92\/100|¥3,215,600/);
});

test('dashboard exposes only functional navigation actions', () => {
  const html = renderWorkbenchMarkup(blockedPayload(), {
    mode: 'operation',
    evidenceOpen: false,
  });

  assert.match(html, /data-dashboard-nav="curve"/);
  assert.match(html, /data-dashboard-nav="validate"/);
  assert.match(html, /data-dashboard-nav="review"/);
  assert.match(html, /data-action="open-evidence"/);
  assert.doesNotMatch(html, /href="#"/);
});

test('96-point curve keeps interaction coverage without rendering a bead on every point', () => {
  const payload = buildStandaloneDemoWorkbenchPayload();
  const html = renderWorkbenchMarkup(payload, {
    mode: 'operation',
    evidenceOpen: false,
  });

  assert.equal([...html.matchAll(/data-curve-point=/g)].length, 96);
  const anchorCount = [...html.matchAll(/data-curve-anchor=/g)].length;
  assert.ok(anchorCount >= 10 && anchorCount <= 14);
});

test('curve canvas expands with its panel instead of leaving fixed-height dead space', async () => {
  const css = await readFile(new URL('../workbench.css', import.meta.url), 'utf8');

  assert.match(css, /\.curve-canvas\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.curve-canvas svg\s*\{[^}]*height:\s*100%/s);
  assert.doesNotMatch(css, /\.curve-canvas svg\s*\{[^}]*height:\s*292px/s);
});

test('wide curve canvas lets the data geometry fill the available panel width', () => {
  const payload = buildStandaloneDemoWorkbenchPayload();
  const html = renderWorkbenchMarkup(payload, {
    mode: 'operation',
    evidenceOpen: false,
  });

  assert.match(
    html,
    /<svg[^>]*preserveAspectRatio="none"[^>]*aria-label="历史申报与 AI 建议申报曲线"/
  );
});
