# Operational Declaration Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-safe 96-point declaration optimizer that proves improvement on a chronological holdout set, generates recommendations only from fresh complete inputs, and otherwise runs the default declaration baseline.

**Architecture:** A new pure `declaration-optimizer` module owns chronological model selection, holdout promotion, and target-date recommendations. `backtest-engine` exposes optimizer readiness independently from price and cost validation; `server.mjs` publishes validation and recommendation APIs; the workbench shows the active operating mode, evidence, fallback, and recovery action without creating executable trades or invented yuan savings.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing HTTP server, vanilla JavaScript/CSS workbench, Playwright Chromium through the in-app Browser.

## Global Constraints

- Use the chronological 60%/20%/20% train/validation/holdout split; holdout data must never select the model.
- Candidate windows are exactly 7, 14, 21, 28, 42, and 56 valid days.
- Candidate shrinkage weights are exactly 0.50, 0.75, and 1.00.
- A point requires 7 earlier actual-load samples; otherwise it falls back to `defaultDeclarationPower`.
- Promotion requires at least 30 complete holdout days, 2,880 points, 3% MAE improvement, and 60% daily win rate.
- A target-date recommendation requires 96 default-declaration points and actual-load history no more than 48 hours older than the target date.
- Price-model rejection must not block baseline declaration review or a validated declaration optimizer.
- No automatic UKey submission; all recommendations remain human-decision-only.
- `costSavingsYuan` stays `null` until aligned price, fee, deviation-cost, and system-cost fields exist.
- Real UI states must not display invented savings; mock states must remain explicitly labeled.

---

### Task 1: Chronological optimizer backtest and promotion

**Files:**
- Create: `lib/declaration-optimizer.mjs`
- Create: `test/declaration-optimizer.test.mjs`

**Interfaces:**
- Consumes: `featureStore.rows[]` with `date`, `pointIndex`, `defaultDeclarationPower`, and `actualKwh`.
- Produces: `backtestDeclarationOptimizer(featureStore, options): DeclarationOptimizerValidation`.

- [ ] **Step 1: Write the failing test for leak-free model selection and holdout promotion**

Create a literal fixture with one point per date and use `expectedPointsPerDay: 1`, reduced evidence thresholds, fixed candidates, and a chronology where the rolling mean beats a biased baseline:

```js
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
```

The production mutation this catches is selecting a model from holdout rows, using target-day actuals, applying the wrong MW/MWh conversion, or failing to promote a genuinely better model.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
node --test test/declaration-optimizer.test.mjs
```

Expected: FAIL because `lib/declaration-optimizer.mjs` and `backtestDeclarationOptimizer` do not exist.

- [ ] **Step 3: Implement chronological candidate evaluation**

Create `lib/declaration-optimizer.mjs` with:

```js
const DEFAULT_WINDOWS = [7, 14, 21, 28, 42, 56];
const DEFAULT_WEIGHTS = [0.5, 0.75, 1];

function numeric(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function completeDates(rows, expectedPointsPerDay) {
  const pointsByDate = new Map();
  rows.forEach((row) => {
    if (!pointsByDate.has(row.date)) pointsByDate.set(row.date, new Set());
    pointsByDate.get(row.date).add(row.pointIndex);
  });
  return [...pointsByDate.entries()]
    .filter(([, points]) => points.size === expectedPointsPerDay)
    .map(([date]) => date)
    .sort();
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function modelId(windowDays, weight) {
  return `same_slot_mean_w${windowDays}_a${String(weight).replace(/^0\./, '')}`;
}
```

Normalize only complete rows, convert `actualKwh / 250` to average MW, split complete dates chronologically, evaluate every candidate on the validation slice using only history with `historyDate < forecastDate`, and choose the lowest validation MAE. Evaluate that fixed model once on the holdout slice. Return:

```js
{
  status: 'validated' | 'rejected' | 'insufficient_history',
  selectedModel: { id, windowDays, weight, minHistoryPerPoint },
  split: {
    totalDateCount,
    trainingDateCount,
    validationDateCount,
    holdoutDateCount,
  },
  validation: {
    pointCount,
    baselineMaeMwh,
    modelMaeMwh,
    improvementPct,
    pointWinRatePct,
    dailyWinRatePct,
  },
  holdout: {
    pointCount,
    dateCount,
    baselineMaeMwh,
    modelMaeMwh,
    improvementPct,
    pointWinRatePct,
    dailyWinRatePct,
  },
  promotion: { eligible, reasons },
  costSavingsYuan: null,
  warnings: ['cost_attribution_unavailable'],
}
```

Promotion reasons use exact machine values:

```js
[
  'holdout_days_insufficient',
  'holdout_points_insufficient',
  'mae_improvement_below_threshold',
  'daily_win_rate_below_threshold',
]
```

- [ ] **Step 4: Add rejection and insufficient-history tests**

Append:

```js
test('backtestDeclarationOptimizer rejects a model that misses holdout gates', async () => {
  const { backtestDeclarationOptimizer } = await optimizerModule();
  const rows = Array.from({ length: 20 }, (_, index) =>
    point(`2026-02-${String(index + 1).padStart(2, '0')}`, index >= 16 ? 30 : 10)
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
  assert.ok(result.promotion.reasons.includes('mae_improvement_below_threshold'));
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
```

- [ ] **Step 5: Run optimizer tests and verify GREEN**

Run:

```powershell
node --test test/declaration-optimizer.test.mjs
```

Expected: 3 tests pass with no warnings.

- [ ] **Step 6: Commit the optimizer backtest**

```powershell
git add -- lib/declaration-optimizer.mjs test/declaration-optimizer.test.mjs
git commit -m "feat: validate declaration optimizer on holdout data"
```

---

### Task 2: Target-date 96-point recommendations and safe fallback

**Files:**
- Modify: `lib/declaration-optimizer.mjs`
- Modify: `test/declaration-optimizer.test.mjs`

**Interfaces:**
- Consumes: `buildDeclarationRecommendation(featureStore, targetDate, validation, options)`.
- Produces: a recommendation with `status`, `operatingMode`, `coverage`, `rows`, `fallbackReasons`, and `costSavingsYuan`.

- [ ] **Step 1: Write failing tests for ready, stale, and missing-baseline recommendations**

Append tests using two point positions and `expectedPointsPerDay: 2`:

```js
test('buildDeclarationRecommendation emits bounded point recommendations from earlier actuals', async () => {
  const { buildDeclarationRecommendation } = await optimizerModule();
  const rows = [];
  for (let day = 1; day <= 7; day += 1) {
    const date = `2026-04-${String(day).padStart(2, '0')}`;
    rows.push(point(date, 10), { ...point(date, 20), pointIndex: 2 });
  }
  rows.push(
    { date: '2026-04-08', pointIndex: 1, timePoint: '00:15', defaultDeclarationPower: 14 },
    { date: '2026-04-08', pointIndex: 2, timePoint: '00:30', defaultDeclarationPower: 24 }
  );
  const validation = {
    status: 'validated',
    selectedModel: { id: 'same_slot_mean_w7_a1', windowDays: 7, weight: 1, minHistoryPerPoint: 7 },
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
  assert.equal(result.rows.every((row) => row.recommendedPowerMw >= 0), true);
  assert.equal(result.costSavingsYuan, null);
});

test('buildDeclarationRecommendation blocks stale actual-load history', async () => {
  const { buildDeclarationRecommendation } = await optimizerModule();
  const result = buildDeclarationRecommendation(
    {
      rows: [
        point('2026-04-01', 10),
        { date: '2026-04-08', pointIndex: 1, defaultDeclarationPower: 14 },
      ],
    },
    '2026-04-08',
    {
      status: 'validated',
      selectedModel: { id: 'same_slot_mean_w7_a1', windowDays: 7, weight: 1, minHistoryPerPoint: 1 },
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
    { status: 'validated', selectedModel: { windowDays: 7, weight: 1, minHistoryPerPoint: 1 } },
    { expectedPointsPerDay: 1 }
  );

  assert.equal(result.status, 'missing_baseline');
  assert.ok(result.fallbackReasons.includes('target_default_declaration_incomplete'));
});
```

- [ ] **Step 2: Run the recommendation tests and verify RED**

Run:

```powershell
node --test test/declaration-optimizer.test.mjs
```

Expected: FAIL because `buildDeclarationRecommendation` is absent.

- [ ] **Step 3: Implement target recommendation gates**

Add `buildDeclarationRecommendation` that:

- Sorts the target date’s default-declaration points by `pointIndex`.
- Requires exactly `expectedPointsPerDay` unique points.
- Finds the latest earlier complete actual-load date.
- Computes age relative to target-date midnight; more than `maxActualAgeHours` returns `stale_inputs`.
- Uses only `row.date < targetDate`.
- Applies the validated model’s window and weight.
- Falls back per point to the target baseline when that point lacks the minimum history.
- Rejects negative or non-finite outputs.
- Returns no executable action and always leaves `costSavingsYuan: null`.

The ready row contract is:

```js
{
  date: targetDate,
  pointIndex,
  timePoint,
  baselinePowerMw,
  recommendedPowerMw,
  deltaPowerMw,
  sourceModel: validation.selectedModel.id,
  fallbackUsed: false,
}
```

- [ ] **Step 4: Run recommendation and backtest tests and verify GREEN**

Run:

```powershell
node --test test/declaration-optimizer.test.mjs
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit recommendation generation**

```powershell
git add -- lib/declaration-optimizer.mjs test/declaration-optimizer.test.mjs
git commit -m "feat: generate guarded declaration recommendations"
```

---

### Task 3: Separate operational declaration readiness from price and cost evidence

**Files:**
- Modify: `lib/backtest-engine.mjs:86-174`
- Modify: `test/backtest-engine.test.mjs:36-107`

**Interfaces:**
- Consumes: `options.declarationOptimizer`.
- Produces: `operatingMode`, `reviewRecommendationAllowed`, and `declarationOptimizer` in `buildStrategyValidation`.

- [ ] **Step 1: Write a failing strategy-validation test**

Add a validated optimizer fixture to the existing rejection test:

```js
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
}
```

Assert:

```js
assert.equal(result.operatingMode, 'validated_optimizer');
assert.equal(result.reviewRecommendationAllowed, true);
assert.equal(result.executionAllowed, false);
assert.equal(result.declarationOptimizer.status, 'validated');
assert.equal(result.declarationOptimizer.holdout.improvementPct, 9.64);
assert.ok(result.reasons.includes('candidate_not_better_than_baseline'));
assert.ok(result.reasons.includes('strategy_savings_unavailable'));
assert.equal(result.reasons.includes('declaration_optimizer_unavailable'), false);
```

Add a second test where `declarationOptimizer.status === 'rejected'` and assert `operatingMode === 'baseline_fallback'`, `reviewRecommendationAllowed === true`, and reason `declaration_optimizer_rejected`.

The production mutation these assertions catch is allowing an optional price model failure to disable the safe declaration baseline.

- [ ] **Step 2: Run the strategy test and verify RED**

Run:

```powershell
node --test test/backtest-engine.test.mjs
```

Expected: FAIL because the operational fields and optimizer reason mapping are absent.

- [ ] **Step 3: Integrate declaration-optimizer status**

Update `buildStrategyValidation`:

```js
const declarationOptimizer = options.declarationOptimizer || {
  status: 'insufficient_history',
  selectedModel: null,
  holdout: null,
  promotion: { eligible: false, reasons: ['optimizer_evidence_unavailable'] },
  costSavingsYuan: null,
};

const optimizerValidated = declarationOptimizer.status === 'validated';
const operatingMode = optimizerValidated
  ? 'validated_optimizer'
  : 'baseline_fallback';
```

Keep `executionAllowed: false` because this object never authorizes automatic submission. Set `reviewRecommendationAllowed: true` for the default baseline and validated optimizer. Preserve the independent price and cost evidence. Add only these optimizer reasons:

```js
if (declarationOptimizer.status === 'rejected') {
  reasons.push('declaration_optimizer_rejected');
}
if (declarationOptimizer.status === 'insufficient_history') {
  reasons.push('declaration_optimizer_unavailable');
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test test/backtest-engine.test.mjs test/declaration-replay.test.mjs test/declaration-optimizer.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit strategy validation integration**

```powershell
git add -- lib/backtest-engine.mjs test/backtest-engine.test.mjs
git commit -m "feat: keep declaration baseline operational"
```

---

### Task 4: Publish optimizer validation and recommendation APIs

**Files:**
- Modify: `server.mjs:33-64`
- Modify: `server.mjs:298-326`
- Modify: `server.mjs:483-501`
- Modify: `test/server-contract.test.mjs`

**Interfaces:**
- Produces: `GET /api/declaration-optimizer/validation`.
- Produces: `GET /api/declaration-optimizer/recommendation?date=YYYY-MM-DD`.
- Extends: `GET /api/strategy-validation`.

- [ ] **Step 1: Add failing server-contract requests and assertions**

In the existing local server test, fetch:

```js
const declarationOptimizerValidation = await fetch(
  `${server.baseUrl}/api/declaration-optimizer/validation`
).then((response) => response.json());
const declarationRecommendation = await fetch(
  `${server.baseUrl}/api/declaration-optimizer/recommendation?date=2026-07-29`
).then((response) => response.json());
const strategyValidation = await fetch(
  `${server.baseUrl}/api/strategy-validation`
).then((response) => response.json());
```

Assert literal production evidence:

```js
assert.equal(declarationOptimizerValidation.status, 'validated');
assert.equal(declarationOptimizerValidation.selectedModel.id, 'same_slot_mean_w42_a1');
assert.equal(declarationOptimizerValidation.holdout.pointCount, 4128);
assert.equal(declarationOptimizerValidation.holdout.improvementPct, 9.64);
assert.equal(declarationOptimizerValidation.holdout.dailyWinRatePct, 86.05);
assert.equal(declarationOptimizerValidation.costSavingsYuan, null);
assert.equal(declarationRecommendation.status, 'missing_baseline');
assert.equal(declarationRecommendation.operatingMode, 'baseline_fallback');
assert.equal(strategyValidation.operatingMode, 'validated_optimizer');
assert.equal(strategyValidation.executionAllowed, false);
```

- [ ] **Step 2: Run the server contract and verify RED**

Run:

```powershell
node --test test/server-contract.test.mjs
```

Expected: FAIL with 404 responses or missing optimizer fields.

- [ ] **Step 3: Add cached validation and recommendation loading**

Import:

```js
import {
  backtestDeclarationOptimizer,
  buildDeclarationRecommendation,
} from './lib/declaration-optimizer.mjs';
```

Replace the single validation cache with a context cache that computes once:

```js
let declarationOptimizerValidationCache = null;

async function loadDeclarationOptimizerValidation() {
  if (!declarationOptimizerValidationCache) {
    declarationOptimizerValidationCache = loadForecastContext('')
      .then((context) => backtestDeclarationOptimizer(context.allFeatureStore))
      .catch((error) => {
        declarationOptimizerValidationCache = null;
        throw error;
      });
  }
  return declarationOptimizerValidationCache;
}
```

Have `loadStrategyValidation()` await both forecast context and optimizer validation, then pass `declarationOptimizer` together with `declarationReplay`.

Implement routes:

```js
if (request.method === 'GET' && url.pathname === '/api/declaration-optimizer/validation') {
  sendJson(response, await loadDeclarationOptimizerValidation());
  return;
}

if (request.method === 'GET' && url.pathname === '/api/declaration-optimizer/recommendation') {
  const date = url.searchParams.get('date') || '';
  const [context, validation] = await Promise.all([
    loadForecastContext(date),
    loadDeclarationOptimizerValidation(),
  ]);
  sendJson(
    response,
    buildDeclarationRecommendation(context.allFeatureStore, date, validation)
  );
  return;
}
```

Clear both caches on the same refresh paths that currently clear `strategyValidationCache`.

- [ ] **Step 4: Run server contract and focused module tests**

Run:

```powershell
node --test test/server-contract.test.mjs test/backtest-engine.test.mjs test/declaration-optimizer.test.mjs
```

Expected: all tests pass and no endpoint returns 404.

- [ ] **Step 5: Commit API integration**

```powershell
git add -- server.mjs test/server-contract.test.mjs
git commit -m "feat: expose declaration optimizer APIs"
```

---

### Task 5: Show an operational optimizer and explicit fallback in the workbench

**Files:**
- Modify: `workbench.js:176-249`
- Modify: `workbench.js:732-748`
- Modify: `workbench.css:520-700`
- Modify: `test/workbench-ui.test.mjs`

**Interfaces:**
- Consumes: `payload.strategyValidation.declarationOptimizer`.
- Consumes: `payload.declarationRecommendation`.
- Produces: one accessible `申报优化策略` region.

- [ ] **Step 1: Add failing workbench markup assertions**

Extend `blockedPayload().strategyValidation`:

```js
operatingMode: 'validated_optimizer',
reviewRecommendationAllowed: true,
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
```

Add:

```js
declarationRecommendation: {
  status: 'missing_baseline',
  operatingMode: 'baseline_fallback',
  coverage: { baselinePointCount: 0, recommendedPointCount: 0, requiredPointCount: 96 },
  rows: [],
  fallbackReasons: ['target_default_declaration_incomplete'],
  costSavingsYuan: null,
},
```

Assert:

```js
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
```

- [ ] **Step 2: Run the UI unit test and verify RED**

Run:

```powershell
node --test test/workbench-ui.test.mjs
```

Expected: FAIL because the optimizer panel and recovery copy are absent.

- [ ] **Step 3: Render optimizer operating mode and evidence**

Add `declarationOptimizerPanel(payload)` with:

- Heading `申报优化策略`.
- State `已通过独立留出集` when validated; `默认申报基线运行` otherwise.
- Model label `42 日同点位均值`.
- Holdout cards for `+9.64%`, `86.05%`, and `4,128 个点 / 43 日`.
- Current recommendation status:
  - `ready`: `已生成 96 点复核建议`.
  - `stale_inputs`: `实际负荷过期，当前回退默认申报`.
  - `missing_baseline`: `补齐目标日 96 点默认申报`.
  - other: `当前回退默认申报`.
- Disclaimer `偏差改善不等于已实现人民币节省`.

Render this panel immediately after `strategyValidationPanel(payload)` in operation and review modes.

During `loadWorkbench`, fetch strategy validation and the target-date recommendation in parallel:

```js
const date = browserState.payload?.date || '';
const [strategyValidation, declarationRecommendation] = await Promise.all([
  fetch('/api/strategy-validation', { cache: 'no-store' }).then(responseJson),
  fetch(
    `/api/declaration-optimizer/recommendation?date=${encodeURIComponent(date)}`,
    { cache: 'no-store' }
  ).then(responseJson),
]);
browserState.payload.strategyValidation = strategyValidation;
browserState.payload.declarationRecommendation = declarationRecommendation;
```

- [ ] **Step 4: Add enterprise styling and responsive behavior**

Add `.declaration-optimizer-panel`, `.optimizer-evidence-grid`, `.optimizer-current-state`, and `.optimizer-disclaimer` rules using existing ink/teal/amber/red tokens. At widths below 1100px use two metric columns; below 720px use one column. Do not add horizontal scrolling or fixed pixel widths larger than the content column.

- [ ] **Step 5: Run the UI and server tests and verify GREEN**

Run:

```powershell
node --test test/workbench-ui.test.mjs test/server-contract.test.mjs
```

Expected: all tests pass.

- [ ] **Step 6: Commit the workbench optimizer**

```powershell
git add -- workbench.js workbench.css test/workbench-ui.test.mjs
git commit -m "feat: show operational declaration optimizer"
```

---

### Task 6: Document evidence, run full verification, and perform Playwright QA

**Files:**
- Modify: `docs/strategy-validation-2026-07-29.md`
- Modify: `design-qa.md`

**Interfaces:**
- Verifies all module, API, UI, responsive, and honesty requirements.

- [ ] **Step 1: Update the strategy report with independent holdout evidence**

Record:

- Selected model: 42-day same-slot mean, weight 1.00.
- Validation selection is isolated from the final holdout.
- Holdout: 43 days, 4,128 points.
- Baseline MAE: 1.638775 MWh.
- Optimizer MAE: 1.480843 MWh.
- Improvement: 9.64%.
- Daily win rate: 86.05%.
- Point win rate: 58.48%.
- Actual historical human declarations remain -6.41% versus default.
- Yuan savings remain unavailable until complete aligned settlement cost fields exist.

- [ ] **Step 2: Run the full automated suite**

Run:

```powershell
node --test test/*.test.mjs
```

Expected: exit code 0, zero failed tests. Record the final test count in `design-qa.md`.

- [ ] **Step 3: Verify formatting and live APIs**

Run:

```powershell
git diff --check
Invoke-RestMethod 'http://127.0.0.1:5177/api/declaration-optimizer/validation' |
  Select-Object status,selectedModel,holdout,promotion,costSavingsYuan |
  ConvertTo-Json -Depth 6
Invoke-RestMethod 'http://127.0.0.1:5177/api/declaration-optimizer/recommendation?date=2026-07-29' |
  Select-Object status,operatingMode,coverage,fallbackReasons,costSavingsYuan |
  ConvertTo-Json -Depth 6
```

Expected: validation is `validated`, recommendation safely reports missing/stale current inputs, and `costSavingsYuan` is null.

- [ ] **Step 4: Use Playwright Chromium for real and mock UI verification**

Using the in-app Browser Playwright runtime:

- Open `http://127.0.0.1:5177/`.
- Assert exactly one `申报优化策略` heading.
- Assert `已通过独立留出集`, `+9.64%`, `86.05%`, and `4,128 个点 / 43 日`.
- Assert the real current-day state shows fallback/recovery and no demo banner.
- Assert exactly one primary recovery action and no button named `自动提交` or `立即下单`.
- Open `/?demo=reviewable`; verify the demo banner and review transition.
- Open `/?demo=settled`; verify the demo banner, settled amount, and evidence action.
- Set 1024×768 viewport; verify `scrollWidth <= innerWidth` and the evidence drawer is closed.
- Inspect browser `warn` and `error` logs; require zero entries.
- Reset the viewport and finalize the real page as the deliverable tab.

- [ ] **Step 5: Commit evidence and QA documentation**

```powershell
git add -- docs/strategy-validation-2026-07-29.md design-qa.md
git commit -m "docs: record declaration optimizer verification"
```

- [ ] **Step 6: Final repository verification**

Run:

```powershell
git status --short
git log -6 --oneline
```

Expected: only pre-existing intentional work remains unstaged; optimizer commits are present and no generated timestamp-only diff remains.
