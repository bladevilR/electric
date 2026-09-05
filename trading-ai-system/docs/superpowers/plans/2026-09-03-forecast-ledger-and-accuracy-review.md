# 不可变预测账本与准确度复盘实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保存每次真实发布和历史重放预测的原始版本，按临时/最终实际值回填，建立无泄漏、可分场景、可复核的预测与经济效果复盘。

**Architecture:** `forecast-ledger` 只追加预测运行和 96 点结果，`outcome-ledger` 只追加实际价格/负荷/结算修订，`forecast-evaluation` 以明确的预测运行、实际值版本和评估配置计算指标。`backtest-engine` 改为消费 point-in-time 特征快照，真实发布、历史重放和结算复盘三套口径永不混合。

**Tech Stack:** Node.js ESM、原生 `node:test`、JSON Lines/JSON 原子持久化、现有预测和结算模块；不新增 Node 运行时依赖。

**Spec:** `trading-ai-system/docs/superpowers/specs/2026-09-03-point-in-time-forecast-cockpit-design.md`

## Global Constraints

- 预测记录和实际结果记录只追加，不覆盖历史版本。
- `live_issued`、`point_in_time_replay`、`settlement_replay` 指标必须分开。
- 预测生成时固化 `decisionCutoffAt`、`featureSnapshotId`、模型/特征/代码版本和训练窗口。
- 最终价不得用临时价填充；临时价、最终价可分别计算指标。
- 回测不得读取 `availableAt > decisionCutoffAt` 的事实。
- 未知经济结果必须为 `null`，不得以 0 代替。
- 不保存任何 Cookie、Token、Authorization、UKey PIN、证书、私钥或密码。
- 不自动申报、不自动交易、不自动晋级模型。

---

### Task 1: 不可变预测账本

**Files:**
- Create: `trading-ai-system/lib/forecast-ledger.mjs`
- Create: `trading-ai-system/test/forecast-ledger.test.mjs`
- Modify: `trading-ai-system/server.mjs`
- Modify: `trading-ai-system/start-system.ps1`
- Modify: `trading-ai-system/test/server-contract.test.mjs`
- Modify: `trading-ai-system/test/windows-launcher.test.mjs`

**Interfaces:**
- Produces: `createForecastRun(input) -> forecastRun`
- Produces: `appendForecastRun(ledger, run) -> ledger`
- Produces: `findForecastRuns(ledger, filter) -> forecastRun[]`
- Produces: `readForecastLedger(filePath) -> Promise<ledger>`
- Produces: `writeForecastLedgerAtomic(filePath, ledger) -> Promise<void>`
- Consumes feature snapshots produced by `buildFeatureSnapshot()`.

- [ ] **Step 1: Write the immutable-run tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createForecastRun,
  appendForecastRun,
  findForecastRuns,
} from '../lib/forecast-ledger.mjs';

const input = {
  forecastRunId: 'run-20260824-da-1000',
  forecastRunType: 'live_issued',
  targetField: 'dayAheadUserPriceFinalYuanPerMwh',
  targetTradingDate: '2026-08-24',
  forecastGeneratedAt: '2026-08-23T09:58:00+08:00',
  decisionCutoffAt: '2026-08-23T10:00:00+08:00',
  featureSnapshotId: 'snapshot-1',
  featureVersion: 'features-v1',
  modelId: 'rolling_same_slot_median',
  modelVersion: '1.0.0',
  codeCommitSha: 'e14dddceacefa78a251cca825f722f927982bde4',
  trainingStartDate: '2026-08-01',
  trainingEndDate: '2026-08-22',
  backtestSplitLabel: 'live',
  rows: [{ pointIndex: 1, pointForecast: 318.5, p10: 300, p50: 318.5, p90: 340 }],
};

test('forecast run is append-only and duplicate ids are rejected', () => {
  const run = createForecastRun(input);
  const ledger = appendForecastRun({ version: 1, runs: [] }, run);
  assert.equal(ledger.runs.length, 1);
  assert.throws(() => appendForecastRun(ledger, run), /forecast_run_already_exists/);
});

test('live and replay runs are filtered independently', () => {
  const live = createForecastRun(input);
  const replay = createForecastRun({ ...input, forecastRunId: 'replay-1', forecastRunType: 'point_in_time_replay' });
  const ledger = appendForecastRun(appendForecastRun({ version: 1, runs: [] }, live), replay);
  assert.deepEqual(findForecastRuns(ledger, { forecastRunType: 'live_issued' }).map((run) => run.forecastRunId), ['run-20260824-da-1000']);
});
```

- [ ] **Step 2: Write validation tests for required provenance**

```js
test('forecast run without cutoff or snapshot is rejected', () => {
  assert.throws(() => createForecastRun({ ...input, decisionCutoffAt: '' }), /decision_cutoff_required/);
  assert.throws(() => createForecastRun({ ...input, featureSnapshotId: '' }), /feature_snapshot_required/);
});

test('forecast run rejects credential-like keys recursively', () => {
  assert.throws(() => createForecastRun({ ...input, metadata: { accessToken: 'x' } }), /sensitive_key_rejected/);
});
```

- [ ] **Step 3: Run tests and confirm missing-module failure**

Run:

```bash
cd trading-ai-system
node --test test/forecast-ledger.test.mjs
```

Expected: FAIL because `lib/forecast-ledger.mjs` does not exist.

- [ ] **Step 4: Implement canonical run creation**

Require exactly these run-level fields:

```js
const REQUIRED_RUN_FIELDS = [
  'forecastRunId',
  'forecastRunType',
  'targetField',
  'targetTradingDate',
  'forecastGeneratedAt',
  'decisionCutoffAt',
  'featureSnapshotId',
  'featureVersion',
  'modelId',
  'modelVersion',
  'codeCommitSha',
  'trainingStartDate',
  'trainingEndDate',
  'backtestSplitLabel',
];
```

Accept only `live_issued` and `point_in_time_replay` as forecast run types. Validate point indices 1–96, quantile monotonicity `p10 <= p50 <= p90`, and ensure every row carries `inputCompletenessPct` or inherits it from run metadata.

- [ ] **Step 5: Implement append-only atomic persistence**

Use a deterministic sort by `forecastGeneratedAt`, `targetTradingDate`, `forecastRunId`. Write a sibling temporary file and rename it. Never update an existing run ID, even when a model is re-run; generate a new ID.

- [ ] **Step 6: Add server and Windows paths**

Add:

```text
--forecast-ledger
TRADING_FORECAST_LEDGER_PATH
%LOCALAPPDATA%\ElectricTradingAI\data\forecast-ledger.json
```

The server must fail startup with an actionable Chinese error when the directory cannot be created; it must not fall back to the package directory.

- [ ] **Step 7: Run focused tests**

```bash
node --test test/forecast-ledger.test.mjs test/server-contract.test.mjs test/windows-launcher.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/lib/forecast-ledger.mjs trading-ai-system/test/forecast-ledger.test.mjs trading-ai-system/server.mjs trading-ai-system/start-system.ps1 trading-ai-system/test/server-contract.test.mjs trading-ai-system/test/windows-launcher.test.mjs
git commit -m "feat: add immutable forecast ledger"
```

### Task 2: 临时、最终实际值与结算结果账本

**Files:**
- Create: `trading-ai-system/lib/outcome-ledger.mjs`
- Create: `trading-ai-system/test/outcome-ledger.test.mjs`
- Modify: `trading-ai-system/lib/settlement-reference.mjs`
- Modify: `trading-ai-system/test/settlement-reference.test.mjs`
- Modify: `trading-ai-system/server.mjs`
- Modify: `trading-ai-system/test/server-contract.test.mjs`

**Interfaces:**
- Produces: `appendOutcomeRevision(ledger, outcome) -> ledger`
- Produces: `selectOutcomeForEvaluation(ledger, query) -> outcome | null`
- Produces: `linkSettlementReference(reference, metadata) -> outcome[]`
- Outcome key: `targetField + businessDate + pointIndex + actualLabelVersion + sourceRevision`.

- [ ] **Step 1: Write temporary/final revision tests**

```js
import {
  appendOutcomeRevision,
  selectOutcomeForEvaluation,
} from '../lib/outcome-ledger.mjs';

test('temporary and final outcomes coexist', () => {
  const temporary = {
    targetField: 'dayAheadUserPriceFinalYuanPerMwh',
    businessDate: '2026-08-24', pointIndex: 1,
    actualValue: 318.5, actualLabelVersion: 'temporary',
    sourceId: 'JSPEC-P0-3', sourceRevision: 'temp-r1',
    publishedAt: '2026-08-23T10:05:00+08:00', actualBackfilledAt: '2026-08-23T10:06:00+08:00'
  };
  const final = { ...temporary, actualValue: 319.8, actualLabelVersion: 'final', sourceRevision: 'final-r1', publishedAt: '2026-08-25T09:00:00+08:00' };
  const ledger = appendOutcomeRevision(appendOutcomeRevision({ version: 1, outcomes: [] }, temporary), final);
  assert.equal(ledger.outcomes.length, 2);
  assert.equal(selectOutcomeForEvaluation(ledger, { businessDate: '2026-08-24', pointIndex: 1, targetField: temporary.targetField, actualLabelVersion: 'final' }).actualValue, 319.8);
});
```

- [ ] **Step 2: Write no-fallback-to-final-field test**

```js
test('temporary value is never returned as final', () => {
  const ledger = appendOutcomeRevision({ version: 1, outcomes: [] }, temporaryOutcome);
  assert.equal(selectOutcomeForEvaluation(ledger, { ...key, actualLabelVersion: 'final' }), null);
});
```

- [ ] **Step 3: Run tests and confirm failure**

```bash
node --test test/outcome-ledger.test.mjs test/settlement-reference.test.mjs
```

Expected: FAIL because the outcome ledger does not exist.

- [ ] **Step 4: Implement append-only outcome revisions**

Allowed label versions:

```text
temporary
current
final
settlement_initial
settlement_final
settlement_adjusted
```

Require source ID, source revision, `publishedAt`, and `actualBackfilledAt`. Unknown final status remains absent; never synthesize a final record.

- [ ] **Step 5: Link formal settlement files with provenance**

For every parsed settlement row attach:

```text
sourceFileName
sourceFileSha256
sourceSheetName
parserVersion
parsedAt
settlementRevision
```

Do not expose absolute local paths through APIs.

- [ ] **Step 6: Add atomic persistence and server path**

Add:

```text
--outcome-ledger
TRADING_OUTCOME_LEDGER_PATH
%LOCALAPPDATA%\ElectricTradingAI\data\outcome-ledger.json
```

- [ ] **Step 7: Run focused tests**

```bash
node --test test/outcome-ledger.test.mjs test/settlement-reference.test.mjs test/server-contract.test.mjs test/windows-launcher.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/lib/outcome-ledger.mjs trading-ai-system/test/outcome-ledger.test.mjs trading-ai-system/lib/settlement-reference.mjs trading-ai-system/test/settlement-reference.test.mjs trading-ai-system/server.mjs trading-ai-system/start-system.ps1 trading-ai-system/test/server-contract.test.mjs trading-ai-system/test/windows-launcher.test.mjs
git commit -m "feat: add versioned outcome ledger"
```

### Task 3: 预测准确度指标库

**Files:**
- Create: `trading-ai-system/lib/forecast-evaluation.mjs`
- Create: `trading-ai-system/test/forecast-evaluation.test.mjs`
- Modify: `trading-ai-system/lib/backtest-engine.mjs`
- Modify: `trading-ai-system/test/backtest-engine.test.mjs`

**Interfaces:**
- Produces: `evaluatePointForecast(pairs, options) -> metrics`
- Produces: `evaluateQuantiles(pairs, quantiles) -> metrics`
- Produces: `evaluateEventProbability(pairs) -> metrics`
- Produces: `groupEvaluationPairs(pairs, dimensions) -> groupedMetrics`
- Produces: `buildAccuracyReport({runs, outcomes, config}) -> report`

- [ ] **Step 1: Write deterministic point-metric tests**

```js
import {
  evaluatePointForecast,
  evaluateQuantiles,
  evaluateEventProbability,
} from '../lib/forecast-evaluation.mjs';

test('point metrics include MAE RMSE bias MASE and baseline skill', () => {
  const result = evaluatePointForecast([
    { forecast: 10, actual: 12, baseline: 15, naiveScale: 4 },
    { forecast: 20, actual: 18, baseline: 16, naiveScale: 4 },
  ]);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.mae, 2);
  assert.equal(result.rmse, 2);
  assert.equal(result.bias, 0);
  assert.equal(result.mase, 0.5);
  assert.equal(result.skillVsBaseline, 0.2);
});
```

- [ ] **Step 2: Write quantile and interval tests**

```js
test('quantile evaluation measures pinball and 80 percent coverage', () => {
  const result = evaluateQuantiles([
    { actual: 20, p10: 10, p50: 18, p90: 30 },
    { actual: 40, p10: 15, p50: 25, p90: 35 },
  ], [0.1, 0.5, 0.9]);
  assert.equal(result.interval80.sampleCount, 2);
  assert.equal(result.interval80.coveragePct, 50);
  assert.equal(result.interval80.meanWidth, 20);
});
```

- [ ] **Step 3: Write event-probability tests**

```js
test('event metrics include brier precision recall and confusion counts', () => {
  const result = evaluateEventProbability([
    { probability: 0.8, actualLabel: 1 },
    { probability: 0.7, actualLabel: 0 },
    { probability: 0.2, actualLabel: 0 },
  ], { threshold: 0.5 });
  assert.equal(result.truePositive, 1);
  assert.equal(result.falsePositive, 1);
  assert.equal(result.trueNegative, 1);
  assert.equal(result.falseNegative, 0);
  assert.equal(result.recall, 1);
});
```

- [ ] **Step 4: Run tests and confirm missing-module failure**

```bash
node --test test/forecast-evaluation.test.mjs test/backtest-engine.test.mjs
```

Expected: FAIL.

- [ ] **Step 5: Implement metrics with explicit null behavior**

Return `null`, not `0`, when no comparable pairs exist. Error direction is always `forecast - actual`. MAPE is not a required metric and must not be used as the primary score.

Pinball loss for quantile `q`:

```js
function pinball(actual, forecast, q) {
  const error = actual - forecast;
  return Math.max(q * error, (q - 1) * error);
}
```

Brier score:

```js
mean((probability - actualLabel) ** 2)
```

- [ ] **Step 6: Add scenario grouping**

Support dimensions:

```text
pointIndex
peakClass
weekdayClass
season
heatRegime
outageRegime
congestionRegime
renewableErrorRegime
```

A missing regime remains `unknown`; it must not be merged into `normal`.

- [ ] **Step 7: Keep old metric exports compatible**

`computeRegressionMetrics()` may delegate to `evaluatePointForecast()` and continue returning `sampleCount`, `mae`, `rmse`, and `bias` for current callers.

- [ ] **Step 8: Run focused tests**

Run the Step 4 command. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add trading-ai-system/lib/forecast-evaluation.mjs trading-ai-system/test/forecast-evaluation.test.mjs trading-ai-system/lib/backtest-engine.mjs trading-ai-system/test/backtest-engine.test.mjs
git commit -m "feat: add calibrated forecast evaluation metrics"
```

### Task 4: Point-in-time rolling backtest and split isolation

**Files:**
- Modify: `trading-ai-system/lib/backtest-engine.mjs`
- Modify: `trading-ai-system/lib/forecast-models.mjs`
- Modify: `trading-ai-system/test/backtest-engine.test.mjs`
- Modify: `trading-ai-system/test/forecast-models.test.mjs`
- Create: `trading-ai-system/config/model-governance.json`

**Interfaces:**
- Produces: `runPointInTimeBacktest({dates, buildSnapshot, forecast, outcomes, config}) -> report`
- Produces: `validateBacktestSplit(split) -> {ok, errors}`
- Consumes `buildFeatureSnapshot()`, forecast ledger schema, outcome ledger and evaluation library.

- [ ] **Step 1: Write future-revision leakage test**

```js
test('rolling backtest never consumes a post-cutoff final revision', async () => {
  const usedFactIds = [];
  const report = await runPointInTimeBacktest({
    dates: ['2026-08-24'],
    buildSnapshot: async ({ decisionCutoffAt }) => {
      const snapshot = fixtureSnapshotAt(decisionCutoffAt);
      usedFactIds.push(...snapshot.factIds);
      return snapshot;
    },
    forecast: fixtureForecast,
    outcomes: finalOutcomes,
    config: fixtureConfig,
  });
  assert.equal(usedFactIds.includes('future-final-price-fact'), false);
  assert.equal(report.runType, 'point_in_time_replay');
});
```

- [ ] **Step 2: Write split-overlap tests**

```js
test('training validation holdout and live dates cannot overlap', () => {
  const result = validateBacktestSplit({
    trainingDates: ['2026-01-01'],
    validationDates: ['2026-01-02'],
    holdoutDates: ['2026-01-02'],
    liveDates: [],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('split_dates_overlap'));
});
```

- [ ] **Step 3: Run tests and confirm failures**

```bash
node --test test/backtest-engine.test.mjs test/forecast-models.test.mjs
```

Expected: FAIL on missing point-in-time backtest APIs.

- [ ] **Step 4: Define decision-cutoff configuration**

`config/model-governance.json` must contain explicit market-task cutoffs, initially disabled until onsite confirmation:

```json
{
  "version": 1,
  "tasks": {
    "dayAheadPrice": {
      "decisionCutoffLocalTime": null,
      "cutoffStatus": "pending_field_confirmation"
    },
    "realTimeSpread": {
      "decisionLeadMinutes": null,
      "cutoffStatus": "pending_field_confirmation"
    }
  }
}
```

A null cutoff blocks production replay and returns `decision_cutoff_unconfirmed`; tests may supply an explicit fixture cutoff.

- [ ] **Step 5: Implement rolling-origin execution**

For each evaluation date:

1. resolve the confirmed decision cutoff;
2. build a point-in-time snapshot at that cutoff;
3. train only on dates strictly before the evaluation date;
4. generate a new `point_in_time_replay` run ID;
5. pair with the requested outcome version;
6. append results to the report without mutating ledgers.

- [ ] **Step 6: Add strong seasonal baselines**

Keep existing models and add:

```text
naive_previous_day_same_slot
naive_previous_week_same_slot
seasonal_same_slot_median_weekday_class
rolling_same_slot_median_7
rolling_same_slot_median_28
```

Model comparison must use the strongest available baseline, not only previous-day.

- [ ] **Step 7: Replace “any improvement means validated”**

Read all thresholds from `model-governance.json`. Return:

```text
baseline_only
insufficient_history
candidate_rejected
shadow_eligible
champion_review_eligible
```

No candidate becomes Champion automatically.

- [ ] **Step 8: Run focused tests**

Run Step 3 command. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add trading-ai-system/lib/backtest-engine.mjs trading-ai-system/lib/forecast-models.mjs trading-ai-system/test/backtest-engine.test.mjs trading-ai-system/test/forecast-models.test.mjs trading-ai-system/config/model-governance.json
git commit -m "feat: add point-in-time rolling backtests"
```

### Task 5: 结算经济复盘

**Files:**
- Create: `trading-ai-system/lib/economic-replay.mjs`
- Create: `trading-ai-system/test/economic-replay.test.mjs`
- Modify: `trading-ai-system/lib/cost-optimizer.mjs`
- Modify: `trading-ai-system/lib/declaration-replay.mjs`
- Modify: `trading-ai-system/test/cost-optimizer.test.mjs`
- Modify: `trading-ai-system/test/declaration-replay.test.mjs`

**Interfaces:**
- Produces: `replaySettlementEconomics({forecastRun, strategyTrace, settlementFacts, tariffVersion}) -> report`
- Produces report fields: `status`, `baselineCostYuan`, `strategyCostYuan`, `actualOperatorCostYuan`, `perfectInformationLowerBoundYuan`, `savingVsDefaultYuan`, `economicRegretYuan`, `warnings`.

- [ ] **Step 1: Write unknown-result tests**

```js
test('economic replay returns null instead of zero when settlement evidence is incomplete', () => {
  const result = replaySettlementEconomics({ forecastRun, strategyTrace, settlementFacts: [], tariffVersion: null });
  assert.equal(result.status, 'insufficient_settlement_evidence');
  assert.equal(result.strategyCostYuan, null);
  assert.equal(result.savingVsDefaultYuan, null);
});
```

- [ ] **Step 2: Write baseline separation test**

```js
test('default, strategy and actual operator decisions are evaluated separately', () => {
  const result = replaySettlementEconomics(completeFixture);
  assert.notEqual(result.baselineCostYuan, result.actualOperatorCostYuan);
  assert.equal(result.savingVsDefaultYuan, result.baselineCostYuan - result.strategyCostYuan);
});
```

- [ ] **Step 3: Run tests and confirm failures**

```bash
node --test test/economic-replay.test.mjs test/cost-optimizer.test.mjs test/declaration-replay.test.mjs
```

- [ ] **Step 4: Implement evidence gates**

Require aligned target date, point indices, final settlement version, tariff/formula version, executed strategy rows, actual load and all price components needed by the settlement formula. Report every missing component explicitly.

- [ ] **Step 5: Remove placeholder zero savings**

Any existing path that returns `estimatedSavings: 0` solely because computation is unimplemented must return `null` with `savings_unavailable` or a more specific warning.

- [ ] **Step 6: Run focused tests**

Run Step 3 command. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add trading-ai-system/lib/economic-replay.mjs trading-ai-system/test/economic-replay.test.mjs trading-ai-system/lib/cost-optimizer.mjs trading-ai-system/lib/declaration-replay.mjs trading-ai-system/test/cost-optimizer.test.mjs trading-ai-system/test/declaration-replay.test.mjs
git commit -m "feat: add settlement-grounded economic replay"
```

### Task 6: 预测运行与准确度 API

**Files:**
- Modify: `trading-ai-system/server.mjs`
- Modify: `trading-ai-system/test/server-contract.test.mjs`
- Modify: `trading-ai-system/lib/production-readiness.mjs`
- Modify: `trading-ai-system/test/production-readiness.test.mjs`

**Interfaces:**
- Produces:
  - `GET /api/forecast/runs?date=&runType=&modelId=`
  - `GET /api/forecast/run/:id`
  - `GET /api/forecast/accuracy?from=&to=&runType=&modelId=&actualLabelVersion=&regime=`
  - `GET /api/forecast/outcome-coverage?from=&to=&targetField=`
- Consumes forecast ledger, outcome ledger, evaluation and economic replay modules.

- [ ] **Step 1: Add API isolation tests**

```js
test('accuracy API never mixes live and replay runs', async () => {
  const response = await fetch(`${server.baseUrl}/api/forecast/accuracy?runType=live_issued&actualLabelVersion=final`);
  const body = await response.json();
  assert.equal(body.filter.runType, 'live_issued');
  assert.equal(body.runTypes.length, 1);
  assert.equal(body.runTypes[0], 'live_issued');
});
```

Assert invalid run type, invalid date range, unsupported outcome version and missing cutoff configuration return `400` with stable error codes.

- [ ] **Step 2: Run contract tests and confirm 404 failures**

Run: `node --test test/server-contract.test.mjs test/production-readiness.test.mjs`

- [ ] **Step 3: Implement paginated read-only endpoints**

Use `limit` and opaque cursor for runs; default `limit=50`, maximum `200`. Return `Cache-Control: no-store`. Do not expose local file paths or raw sensitive evidence.

- [ ] **Step 4: Add evaluation provenance to every report**

```json
{
  "evaluationRunId": "...",
  "evaluationAsOf": "...",
  "evaluationConfigVersion": "...",
  "forecastRunType": "live_issued",
  "actualLabelVersion": "final",
  "sampleCoverage": {},
  "metrics": {},
  "groupedMetrics": {},
  "warnings": []
}
```

- [ ] **Step 5: Extend readiness gates**

Add:

```text
forecast_ledger_writable
outcome_ledger_writable
final_outcome_coverage
point_in_time_backtest_enabled
economic_replay_evidence_complete
```

Readiness must distinguish “feature available” from “model validated”.

- [ ] **Step 6: Run focused tests**

```bash
node --test test/forecast-ledger.test.mjs test/outcome-ledger.test.mjs test/forecast-evaluation.test.mjs test/backtest-engine.test.mjs test/economic-replay.test.mjs test/server-contract.test.mjs test/production-readiness.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add trading-ai-system/server.mjs trading-ai-system/test/server-contract.test.mjs trading-ai-system/lib/production-readiness.mjs trading-ai-system/test/production-readiness.test.mjs
git commit -m "feat: expose forecast accuracy and replay APIs"
```

### Task 7: Full verification and migration evidence

**Files:**
- Modify: `trading-ai-system/README.md`
- Modify: `trading-ai-system/docs/production-runbook.md`
- Modify: `trading-ai-system/test/server-contract.test.mjs`

**Interfaces:**
- Produces operational documentation for ledger paths, backup, migration, and replay semantics.

- [ ] **Step 1: Document the three accuracy views**

Use these exact Chinese labels:

```text
真实发布预测
历史时点重放
最终结算复盘
```

Explain that re-running a newer model on old data is not the same as the forecast actually issued at that time.

- [ ] **Step 2: Add backup and migration instructions**

Document LocalAppData files, atomic-write behavior, versioned migration, backup before upgrade, and the prohibition on copying user ledgers into public delivery packages.

- [ ] **Step 3: Add package exclusion assertions**

Assert packaging excludes:

```text
forecast-ledger.json
outcome-ledger.json
point-in-time-facts.json
feature-snapshots/
```

- [ ] **Step 4: Run full automated verification**

```bash
cd trading-ai-system
node --test --test-concurrency=1 test/*.test.mjs
node --check server.mjs lib/forecast-ledger.mjs lib/outcome-ledger.mjs lib/forecast-evaluation.mjs lib/economic-replay.mjs
git diff --check
```

Expected: all configured tests pass; an existing ignored real-business-Excel test may remain explicitly skipped when its external fixture is unavailable.

- [ ] **Step 5: Run real service smoke tests with isolated ledgers**

Start the server on an unused port with temporary paths and verify:

```text
empty ledger -> no fabricated accuracy
one live run + temporary outcome -> temporary metrics only
same run + final outcome -> final metrics added without replacing temporary metrics
replay run -> never appears in live-issued report
incomplete settlement -> economic values remain null
```

- [ ] **Step 6: Commit**

```bash
git add trading-ai-system/README.md trading-ai-system/docs/production-runbook.md trading-ai-system/test/server-contract.test.mjs trading-ai-system/tools/package-one-minute.mjs
git commit -m "docs: operationalize immutable forecast review"
```
