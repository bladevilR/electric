# 市场驾驶舱、策略逻辑链与前端复盘实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将真实数据来源、96 点数值、预测分布、供需风险、申报策略逻辑和历史准确度组织成清晰导航与驾驶舱，并使每个数值和结论都能打开证据链。

**Architecture:** `workbench.js` 收敛为应用壳和导航状态，各页面使用独立 ESM 视图模块；统一 `value-envelope` 负责值、单位、来源、发布时间、版本和质量状态，统一 `evidence-drawer` 展示证据。后端新增 `market-cockpit` 与 `strategy-explanation` 聚合服务，前端不自行拼业务语义，也不在真实模式回退到 Mock。

**Tech Stack:** 浏览器原生 ESM、HTML/CSS、原生 SVG、Node.js ESM、原生 `node:test`、现有 Playwright；不新增前端框架或图表运行时依赖。

**Spec:** `trading-ai-system/docs/superpowers/specs/2026-09-03-point-in-time-forecast-cockpit-design.md`

## Global Constraints

- 一级导航固定为：数据源与质量、市场驾驶舱、价格预测、申报策略、历史复盘、模型治理。
- 真实模式只显示真实/公开/授权数据；缺失显示缺失、待确认或阻断，不显示模拟数值。
- 演示模式的每个页面、卡片、曲线、指标和金额持续标明“演示环境 · 模拟输入”。
- 主动申报、缺省申报、用户日前出清电力、实际负荷/电量、推荐申报必须独立命名。
- MW、MWh、kWh、元/MWh、元不得在同一纵轴上无提示混画。
- 任意关键数值、曲线点、事件和策略结论都能追溯到来源、原始表头/字段、原始值、标准值、发布时间、目标时刻、采集时间、修订和质量标记。
- 前端不得把相关性或特征贡献描述成因果。
- 不自动申报、不自动交易、不自动模型晋级；人工复核是唯一执行出口。
- 320–1440 px 不出现页面级横向溢出；宽表和图表仅在自己的容器内滚动。

---

### Task 1: 统一前端数据包络与API客户端

**Files:**
- Create: `trading-ai-system/ui/api-client.js`
- Create: `trading-ai-system/ui/value-envelope.js`
- Create: `trading-ai-system/ui/app-state.js`
- Create: `trading-ai-system/test/ui-value-envelope.test.mjs`
- Create: `trading-ai-system/test/ui-api-client.test.mjs`
- Modify: `trading-ai-system/workbench.js`

**Interfaces:**
- Produces: `apiGet(path, query, options) -> Promise<object>`
- Produces: `normalizeValueEnvelope(input) -> ValueEnvelope`
- Produces: `formatValueEnvelope(envelope, options) -> {primary, unit, status, provenanceSummary}`
- Produces: `createAppState(initial)`, `subscribeAppState(listener)`, `updateAppState(patch)`.

- [ ] **Step 1: Write value-envelope tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeValueEnvelope, formatValueEnvelope } from '../ui/value-envelope.js';

test('zero is shown as a real value while null is missing', () => {
  const zero = formatValueEnvelope(normalizeValueEnvelope({ value: 0, unit: 'MW', qualityStatus: 'confirmed' }));
  const missing = formatValueEnvelope(normalizeValueEnvelope({ value: null, unit: 'MW', qualityStatus: 'missing' }));
  assert.equal(zero.primary, '0');
  assert.equal(missing.primary, '—');
  assert.equal(missing.status, 'missing');
});

test('real value requires provenance fields', () => {
  assert.throws(() => normalizeValueEnvelope({ value: 100, unit: 'MW', mode: 'real' }), /real_value_provenance_required/);
});
```

- [ ] **Step 2: Write API mode-isolation tests**

```js
test('real API response containing mock-only data is rejected', async () => {
  await assert.rejects(
    apiGet('/api/market/cockpit', { date: '2026-08-24', mode: 'real' }, { fetchImpl: mockFetchMockOnly }),
    /mock_data_in_real_mode/
  );
});
```

- [ ] **Step 3: Run tests and confirm missing-module failures**

```bash
cd trading-ai-system
node --test test/ui-value-envelope.test.mjs test/ui-api-client.test.mjs
```

Expected: FAIL.

- [ ] **Step 4: Implement the value envelope contract**

Canonical input:

```js
{
  value: 123.45,
  unit: 'MW',
  mode: 'real',
  sourceId: 'JSPEC-P0-2',
  fieldId: 'defaultDeclaredPowerMw',
  eventTime: '2026-08-24T00:15:00+08:00',
  publishedAt: '2026-08-23T09:30:00+08:00',
  availableAt: '2026-08-23T09:30:00+08:00',
  capturedAt: '2026-08-23T09:31:00+08:00',
  revision: 'r1',
  qualityStatus: 'confirmed',
  evidenceRef: 'evidence:...'
}
```

Values with `mode:'real'` and non-null `value` require source, field, availability, revision and evidence. Missing values may omit evidence but must include a stable missing reason.

- [ ] **Step 5: Implement API client safeguards**

Use `cache:'no-store'`, `AbortController`, a default 15-second timeout, stable Chinese error messages and response-mode validation. Query construction must use `URLSearchParams`; do not concatenate unescaped timestamps.

- [ ] **Step 6: Move global browser state behind a small store**

State fields:

```text
activeNav
targetDate
asOf
mode
dataSources
fieldCatalog
marketCockpit
forecastReport
strategyReport
accuracyReport
governanceReport
selectedEvidence
loadingByView
errorByView
```

Do not move rendering in this task; only introduce compatibility getters so current screens remain functional.

- [ ] **Step 7: Run focused tests**

```bash
node --test test/ui-value-envelope.test.mjs test/ui-api-client.test.mjs test/workbench-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/ui/api-client.js trading-ai-system/ui/value-envelope.js trading-ai-system/ui/app-state.js trading-ai-system/test/ui-value-envelope.test.mjs trading-ai-system/test/ui-api-client.test.mjs trading-ai-system/workbench.js
git commit -m "refactor: add provenance-aware UI data contracts"
```

### Task 2: 六项导航壳与页面模块边界

**Files:**
- Create: `trading-ai-system/ui/navigation.js`
- Create: `trading-ai-system/ui/views/data-sources-view.js`
- Create: `trading-ai-system/ui/views/market-cockpit-view.js`
- Create: `trading-ai-system/ui/views/price-forecast-view.js`
- Create: `trading-ai-system/ui/views/declaration-strategy-view.js`
- Create: `trading-ai-system/ui/views/history-review-view.js`
- Create: `trading-ai-system/ui/views/model-governance-view.js`
- Create: `trading-ai-system/test/ui-navigation.test.mjs`
- Modify: `trading-ai-system/workbench.js`
- Modify: `trading-ai-system/workbench.css`
- Modify: `trading-ai-system/test/workbench-ui.test.mjs`

**Interfaces:**
- Produces: `NAV_ITEMS`
- Produces: `renderNavigation(state) -> string`
- Each view produces: `render<ViewName>(state) -> string`
- `workbench.js` remains responsible for mounting, event delegation and shared dialogs.

- [ ] **Step 1: Write navigation order tests**

```js
import { NAV_ITEMS } from '../ui/navigation.js';

test('navigation follows decision workflow', () => {
  assert.deepEqual(NAV_ITEMS.map((item) => item.id), [
    'data-sources',
    'market-cockpit',
    'price-forecast',
    'declaration-strategy',
    'history-review',
    'model-governance',
  ]);
});
```

- [ ] **Step 2: Write real/demo identity tests**

Assert every view header contains mode identity. In demo mode the exact label is `演示环境 · 模拟输入`; in real mode no Mock readiness wording or hard-coded sample values may appear.

- [ ] **Step 3: Run tests and confirm failures**

```bash
node --test test/ui-navigation.test.mjs test/workbench-ui.test.mjs
```

Expected: FAIL because the six-page module structure does not exist.

- [ ] **Step 4: Implement NAV_ITEMS**

```js
export const NAV_ITEMS = [
  { id: 'data-sources', label: '数据源与质量', description: '来源、字段、时效与证据' },
  { id: 'market-cockpit', label: '市场驾驶舱', description: '供需、天气、机组与风险' },
  { id: 'price-forecast', label: '价格预测', description: '96点分布、基线与候选' },
  { id: 'declaration-strategy', label: '申报策略', description: '逻辑链、约束与人工复核' },
  { id: 'history-review', label: '历史复盘', description: '真实发布、重放与结算' },
  { id: 'model-governance', label: '模型治理', description: '版本、门槛、审批与回滚' },
];
```

Use buttons with `aria-current="page"`; preserve keyboard navigation and URL query state.

- [ ] **Step 5: Create page shells with empty-state contracts**

Each view accepts data or a structured missing state. Do not embed sample metrics in the module. Demo fixtures remain supplied from explicit demo payloads.

- [ ] **Step 6: Migrate one screen at a time**

Move existing relevant markup into the matching view module without changing business behavior. After each move, run `workbench-ui` and accessibility tests before moving the next screen.

- [ ] **Step 7: Run focused tests**

```bash
node --test test/ui-navigation.test.mjs test/workbench-ui.test.mjs test/workbench-accessibility.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/ui/navigation.js trading-ai-system/ui/views trading-ai-system/test/ui-navigation.test.mjs trading-ai-system/workbench.js trading-ai-system/workbench.css trading-ai-system/test/workbench-ui.test.mjs
git commit -m "refactor: split workbench into six auditable views"
```

### Task 3: 数据源与质量页面

**Files:**
- Create: `trading-ai-system/ui/view-models/data-sources-model.js`
- Create: `trading-ai-system/ui/components/status-badge.js`
- Create: `trading-ai-system/ui/components/field-catalog-table.js`
- Create: `trading-ai-system/test/ui-data-sources.test.mjs`
- Modify: `trading-ai-system/ui/views/data-sources-view.js`
- Modify: `trading-ai-system/workbench.css`
- Modify: `trading-ai-system/workbench.js`

**Interfaces:**
- Produces: `buildDataSourcesModel({registry, catalog, coverage, filters}) -> model`
- Produces: `renderFieldCatalogTable(model) -> string`
- Consumes `GET /api/data-sources`, `GET /api/field-catalog` and source coverage.

- [ ] **Step 1: Write P0/P1 coverage tests**

```js
test('data source view contains all P0 and P1 groups', () => {
  const model = buildDataSourcesModel(fixture);
  assert.deepEqual(model.groups.map((group) => group.id), ['P0', 'P1', 'weather', 'supply-network', 'forecast-audit']);
  assert.equal(model.groups.find((group) => group.id === 'P0').items.length, 8);
  assert.equal(model.groups.find((group) => group.id === 'P1').items.length, 3);
});
```

- [ ] **Step 2: Write field-column contract test**

Assert the table renders these columns:

```text
数据域
来源页面/接口
页面原始表头
程序字段
业务含义
单位
数据类型
粒度
主键/关联键
必填性
空值规则
更新时间/延迟
历史深度
当前确认状态
证据与待办
```

- [ ] **Step 3: Write status truthfulness test**

```js
test('code-supported is not displayed as real nonempty data', () => {
  const html = renderDataSourcesView(stateWithCodeSupportedButEmpty);
  assert.match(html, /代码已支持，尚无非空实值/);
  assert.doesNotMatch(html, /数据已就绪/);
});
```

- [ ] **Step 4: Run tests and confirm failures**

Run: `node --test test/ui-data-sources.test.mjs`

- [ ] **Step 5: Implement source cards and filters**

Each source card shows:

```text
source status
captured row count
non-null point count
date coverage
native granularity
latest publishedAt
latest capturedAt
observed latency
history depth
authorization state
open todo count
```

Filters: priority/domain/status/search. Keep filter state in URL query parameters.

- [ ] **Step 6: Implement a locally scrollable field table**

Use semantic `<table>`, sticky first two columns on desktop only, no sticky columns below 768 px, and a separate compact card representation below 390 px if necessary. Expand a row to show raw samples, conversion and evidence references; do not load raw sensitive export data into the page.

- [ ] **Step 7: Add data-source detail drawer**

Display route hints with sensitive query parameters removed. Show precise distinction among `confirmed_visible`, `code_supported`, `captured_nonempty`, `captured_empty`, `pending_field_confirmation`, `pending_authorization`, and `mock_only`.

- [ ] **Step 8: Run focused tests**

```bash
node --test test/ui-data-sources.test.mjs test/workbench-ui.test.mjs test/workbench-accessibility.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add trading-ai-system/ui/view-models/data-sources-model.js trading-ai-system/ui/components/status-badge.js trading-ai-system/ui/components/field-catalog-table.js trading-ai-system/test/ui-data-sources.test.mjs trading-ai-system/ui/views/data-sources-view.js trading-ai-system/workbench.css trading-ai-system/workbench.js
git commit -m "feat: add source and field quality navigator"
```

### Task 4: 后端市场驾驶舱聚合

**Files:**
- Create: `trading-ai-system/lib/market-cockpit.mjs`
- Create: `trading-ai-system/test/market-cockpit.test.mjs`
- Modify: `trading-ai-system/server.mjs`
- Modify: `trading-ai-system/test/server-contract.test.mjs`

**Interfaces:**
- Produces: `buildMarketCockpit({snapshot, marketContext, forecasts, events, mode}) -> cockpit`
- Produces: `GET /api/market/cockpit?date=&asOf=&mode=`
- Every metric is a value envelope; every series has series-level provenance plus point-level overrides.

- [ ] **Step 1: Write complete cockpit contract test**

```js
test('cockpit separates all required business series', () => {
  const cockpit = buildMarketCockpit(fixture);
  assert.ok(cockpit.series.userDeclaredPowerMw);
  assert.ok(cockpit.series.defaultDeclaredPowerMw);
  assert.ok(cockpit.series.dayAheadUserClearedPowerMw);
  assert.ok(cockpit.series.actualAverageLoadMw);
  assert.ok(cockpit.series.dayAheadUserPriceTemporaryYuanPerMwh);
  assert.ok(cockpit.series.dayAheadUserPriceFinalYuanPerMwh);
  assert.ok(cockpit.series.realTimePriceCurrentYuanPerMwh);
  assert.ok(cockpit.series.realTimePriceFinalYuanPerMwh);
});
```

- [ ] **Step 2: Write missing-supply truthfulness test**

```js
test('missing generation data remains null with an actionable gap', () => {
  const cockpit = buildMarketCockpit(fixtureWithoutSupply);
  assert.equal(cockpit.metrics.availableCapacityMw.value, null);
  assert.equal(cockpit.metrics.availableCapacityMw.missingReason, 'source_not_confirmed');
  assert.ok(cockpit.gaps.some((gap) => gap.fieldId === 'availableCapacityMw'));
});
```

- [ ] **Step 3: Write mode-isolation test**

Real payloads must not contain values whose evidence source status is `mock_only`. Demo payloads must have `mode:'demo'` on the root and every simulated series.

- [ ] **Step 4: Run tests and confirm failures**

```bash
node --test test/market-cockpit.test.mjs test/server-contract.test.mjs
```

- [ ] **Step 5: Implement cockpit sections**

Root sections:

```text
identity: targetDate, asOf, marketStage, mode
quality: completeness, freshness, confirmedSourceCount, gaps
demand: user load and system load
weather: temperature, humidity, wind, precipitation, cloud, radiation
supply: capacity, outages, reserve, ramp, renewables, interchange
network: sections, limits, utilization, congestion
price: day-ahead and real-time vintages, forecast distribution
position: user clearing, energy blocks, limits, positions
events: outage, maintenance, adjustment, congestion, weather alerts
```

- [ ] **Step 6: Implement per-point provenance compression**

For a series whose metadata is constant, return common metadata once and point records containing `pointIndex`, `value`, `qualityStatus`, and optional `provenanceOverride`. If revisions differ by point, include the override. Never discard point-level missing reasons.

- [ ] **Step 7: Add endpoint validation**

Require date and `asOf` in real/replay mode. Demo mode accepts the existing explicit demo entry only. Invalid future or malformed cutoffs return `400`.

- [ ] **Step 8: Run focused tests**

Run Step 4 command. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add trading-ai-system/lib/market-cockpit.mjs trading-ai-system/test/market-cockpit.test.mjs trading-ai-system/server.mjs trading-ai-system/test/server-contract.test.mjs
git commit -m "feat: aggregate provenance-rich market cockpit"
```

### Task 5: 市场驾驶舱页面与证据抽屉

**Files:**
- Create: `trading-ai-system/ui/view-models/market-cockpit-model.js`
- Create: `trading-ai-system/ui/components/svg-timeseries.js`
- Create: `trading-ai-system/ui/components/event-lane.js`
- Create: `trading-ai-system/ui/components/evidence-drawer.js`
- Create: `trading-ai-system/test/ui-market-cockpit.test.mjs`
- Modify: `trading-ai-system/ui/views/market-cockpit-view.js`
- Modify: `trading-ai-system/workbench.js`
- Modify: `trading-ai-system/workbench.css`

**Interfaces:**
- Produces: `buildMarketCockpitModel(payload) -> model`
- Produces: `renderSvgTimeseries(config) -> string`
- Produces: `renderEvidenceDrawer(evidence) -> string`
- Consumes `/api/market/cockpit`.

- [ ] **Step 1: Write cockpit card tests**

Assert cards exist for:

```text
用户负荷P50/P90
系统负荷/净负荷
可用容量/停机容量/备用率/爬坡压力
风电/光伏预测
跨区受入
重要断面利用率/阻塞
日前临时/最终价
实时当前/最终价
数据缺失和高风险事件
```

Cards with missing values show `—` and their missing reason, not 0.

- [ ] **Step 2: Write chart unit-isolation test**

```js
test('MW and yuan per MWh series are not placed on the same unlabelled axis', () => {
  const model = buildMarketCockpitModel(fixture);
  model.charts.forEach((chart) => {
    assert.equal(new Set(chart.series.map((series) => series.unitGroup)).size, 1);
  });
});
```

- [ ] **Step 3: Write evidence drawer test**

```js
test('clickable value exposes full provenance', () => {
  const html = renderEvidenceDrawer(provenanceFixture);
  ['来源','原始表头','原始值','标准值','单位转换','发布时间','目标时刻','采集时间','数据版本','质量状态'].forEach((label) => assert.match(html, new RegExp(label)));
});
```

- [ ] **Step 4: Run tests and confirm failures**

Run: `node --test test/ui-market-cockpit.test.mjs`

- [ ] **Step 5: Implement the cockpit visual hierarchy**

Top fixed context bar:

```text
目标交易日 | 截止时点 as of | 市场阶段 | 真实/演示模式 | 数据完整度
```

Then: alert strip → key cards → price/load charts → supply/network charts → weather chart → event lane → source gaps.

- [ ] **Step 6: Implement accessible SVG charts**

Each chart includes a title, unit, visible legend, summary text, keyboard-focusable point controls only for selected/exception points, and a separate 96-row accessible data table toggled by “查看96点明细”. Do not create 96 redundant Tab stops by default.

- [ ] **Step 7: Implement evidence interaction**

Cards, chart points, event bars and gap items carry `data-evidence-ref`. Event delegation loads or selects evidence and opens a focus-trapped drawer/dialog; Escape closes it and restores focus.

- [ ] **Step 8: Remove real-mode hard-coded weather and unit metrics**

Tests must assert real output does not contain known demo-only values such as `186 MW`, `3/3 在线`, `±18 MW`, `28.6°C`, unless those exact values arrive through a real provenance envelope fixture.

- [ ] **Step 9: Run focused tests**

```bash
node --test test/ui-market-cockpit.test.mjs test/workbench-ui.test.mjs test/workbench-accessibility.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add trading-ai-system/ui/view-models/market-cockpit-model.js trading-ai-system/ui/components/svg-timeseries.js trading-ai-system/ui/components/event-lane.js trading-ai-system/ui/components/evidence-drawer.js trading-ai-system/test/ui-market-cockpit.test.mjs trading-ai-system/ui/views/market-cockpit-view.js trading-ai-system/workbench.js trading-ai-system/workbench.css
git commit -m "feat: render auditable market cockpit"
```

### Task 6: 价格预测页面

**Files:**
- Create: `trading-ai-system/ui/view-models/price-forecast-model.js`
- Create: `trading-ai-system/test/ui-price-forecast.test.mjs`
- Modify: `trading-ai-system/ui/views/price-forecast-view.js`
- Modify: `trading-ai-system/workbench.js`
- Modify: `trading-ai-system/workbench.css`

**Interfaces:**
- Produces: `buildPriceForecastModel({forecastRuns, outcomes, accuracy, targetDate}) -> model`
- Consumes forecast-run and accuracy APIs.

- [ ] **Step 1: Write model-comparison tests**

```js
test('forecast view distinguishes baseline champion challenger and actual', () => {
  const model = buildPriceForecastModel(fixture);
  assert.deepEqual(model.series.map((series) => series.role), ['baseline','champion','challenger','actual']);
});
```

- [ ] **Step 2: Write price-vintage identity tests**

The page must show the exact target field and label state:

```text
用户日前临时价
用户日前最终价
实时当前价
实时最终价
```

No generic “实际价格” label is allowed without a target-field subtitle.

- [ ] **Step 3: Write uncertainty tests**

Assert each probabilistic point renders P10/P50/P90, interval width, calibration status, spike probability when present, model version and feature snapshot ID. Empirical seven-day intervals display `未校准基线区间`.

- [ ] **Step 4: Run tests and confirm failures**

Run: `node --test test/ui-price-forecast.test.mjs`

- [ ] **Step 5: Implement forecast summary**

Show:

```text
forecast origin
decision cutoff
target date/field
model and feature versions
training window
source completeness
run type
actual outcome version
```

- [ ] **Step 6: Implement comparison chart and 96-point table**

Chart: selected baseline, Champion, optional Challenger, P10–P90 band, actual outcome. Table: point/time, baseline, P10/P50/P90, actual, absolute error, spike probability, input quality, evidence action.

- [ ] **Step 7: Implement feature-contribution language guard**

Use “模型贡献/关联” rather than “导致/造成”. Contributions must reference the model output; absent explainability data yields `该模型未提供可复核贡献分解`.

- [ ] **Step 8: Run focused tests**

```bash
node --test test/ui-price-forecast.test.mjs test/workbench-ui.test.mjs test/workbench-accessibility.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add trading-ai-system/ui/view-models/price-forecast-model.js trading-ai-system/test/ui-price-forecast.test.mjs trading-ai-system/ui/views/price-forecast-view.js trading-ai-system/workbench.js trading-ai-system/workbench.css
git commit -m "feat: compare forecast vintages and uncertainty"
```

### Task 7: 结构化策略逻辑链后端

**Files:**
- Create: `trading-ai-system/lib/strategy-explanation.mjs`
- Create: `trading-ai-system/test/strategy-explanation.test.mjs`
- Modify: `trading-ai-system/lib/declaration-optimizer.mjs`
- Modify: `trading-ai-system/lib/declaration-dashboard-view.mjs`
- Modify: `trading-ai-system/test/declaration-optimizer.test.mjs`
- Modify: `trading-ai-system/test/declaration-dashboard-view.test.mjs`
- Modify: `trading-ai-system/server.mjs`
- Modify: `trading-ai-system/test/server-contract.test.mjs`

**Interfaces:**
- Produces: `buildStrategyTrace({snapshot, loadForecast, priceForecast, marketContext, positions, limits, recommendation, constraints}) -> trace`
- Produces: `GET /api/strategy/trace?date=&pointIndex=&asOf=`
- Trace stages: `evidence`, `load`, `price`, `supplyNetwork`, `positionLimits`, `objectiveConstraints`, `recommendation`.

- [ ] **Step 1: Write seven-stage trace test**

```js
test('strategy trace follows the complete business chain', () => {
  const trace = buildStrategyTrace(fixture);
  assert.deepEqual(trace.stages.map((stage) => stage.id), [
    'evidence','load','price','supplyNetwork','positionLimits','objectiveConstraints','recommendation'
  ]);
});
```

- [ ] **Step 2: Write terminology isolation test**

```js
test('trace never substitutes cleared power for declaration', () => {
  const trace = buildStrategyTrace(fixture);
  const recommendation = trace.stages.find((stage) => stage.id === 'recommendation');
  assert.equal(recommendation.inputs.dayAheadUserClearedPowerMw.fieldId, 'dayAheadUserClearedPowerMw');
  assert.notEqual(recommendation.inputs.dayAheadUserClearedPowerMw.fieldId, 'userDeclaredPowerMw');
});
```

- [ ] **Step 3: Write missing-evidence degradation test**

When weather/supply/network sources are missing, the trace must mark those stages `unavailable` or `degraded`, list missing fields, and show whether baseline recommendation is still allowed. It must not invent factors or coefficients.

- [ ] **Step 4: Run tests and confirm failures**

```bash
node --test test/strategy-explanation.test.mjs test/declaration-optimizer.test.mjs test/declaration-dashboard-view.test.mjs test/server-contract.test.mjs
```

- [ ] **Step 5: Implement evidence references**

Every numerical input is a value envelope. Every conclusion includes:

```text
conclusionId
summary
status
inputRefs
featureSnapshotId
forecastRunIds
modelVersions
formulaVersion
constraintRefs
warnings
```

- [ ] **Step 6: Separate hard constraints from model suggestions**

Hard constraints include confirmed MW declaration bounds, P1 MWh trade limits, position limits, completeness blocks and human-review status. The optimizer must not reuse an MWh field as an MW constraint.

- [ ] **Step 7: Emit point traces and window summaries**

Generate 96 point traces plus contiguous windows where recommendation direction/reason is stable. Window summary references its member point trace IDs; it does not replace point evidence.

- [ ] **Step 8: Run focused tests**

Run Step 4 command. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add trading-ai-system/lib/strategy-explanation.mjs trading-ai-system/test/strategy-explanation.test.mjs trading-ai-system/lib/declaration-optimizer.mjs trading-ai-system/lib/declaration-dashboard-view.mjs trading-ai-system/test/declaration-optimizer.test.mjs trading-ai-system/test/declaration-dashboard-view.test.mjs trading-ai-system/server.mjs trading-ai-system/test/server-contract.test.mjs
git commit -m "feat: build evidence-linked strategy traces"
```

### Task 8: 申报策略页面

**Files:**
- Create: `trading-ai-system/ui/view-models/declaration-strategy-model.js`
- Create: `trading-ai-system/ui/components/strategy-chain.js`
- Create: `trading-ai-system/test/ui-declaration-strategy.test.mjs`
- Modify: `trading-ai-system/ui/views/declaration-strategy-view.js`
- Modify: `trading-ai-system/workbench.js`
- Modify: `trading-ai-system/workbench.css`

**Interfaces:**
- Produces: `buildDeclarationStrategyModel({cockpit, recommendation, trace, review}) -> model`
- Produces: `renderStrategyChain(trace) -> string`

- [ ] **Step 1: Write five-series terminology test**

```js
test('strategy page names all five business curves explicitly', () => {
  const html = renderDeclarationStrategyView(fixtureState);
  ['主动申报','缺省申报','用户日前出清电力','实际平均负荷','推荐申报'].forEach((label) => assert.match(html, new RegExp(label)));
});
```

- [ ] **Step 2: Write price-version test**

Assert the strategy page displays the exact price versions used by the objective, including whether final or temporary/current values were selected. It must not display a generic “日前价” with no source/version.

- [ ] **Step 3: Write constraint distinction test**

```js
test('MW declaration bounds and MWh trade limits are separate panels', () => {
  const model = buildDeclarationStrategyModel(fixture);
  assert.equal(model.constraints.declarationPower.unit, 'MW');
  assert.equal(model.constraints.energyBlockLimit.unit, 'MWh');
});
```

- [ ] **Step 4: Run tests and confirm failures**

Run: `node --test test/ui-declaration-strategy.test.mjs`

- [ ] **Step 5: Implement the page structure**

Order:

```text
identity and review status
recommendation summary and confidence
five-series power/load chart
price distribution chart
key adjustment windows
seven-stage strategy chain
hard constraints and blocked/degraded reasons
96-point table
human review actions
```

Human actions may approve/reject a draft for record; they must not submit to JSPEC or place a trade.

- [ ] **Step 6: Implement point/window trace interaction**

Selecting a chart point or window scrolls/highlights the corresponding strategy-chain inputs and opens evidence on demand. Do not make all 96 points separate default Tab stops.

- [ ] **Step 7: Run focused tests**

```bash
node --test test/ui-declaration-strategy.test.mjs test/workbench-ui.test.mjs test/workbench-accessibility.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/ui/view-models/declaration-strategy-model.js trading-ai-system/ui/components/strategy-chain.js trading-ai-system/test/ui-declaration-strategy.test.mjs trading-ai-system/ui/views/declaration-strategy-view.js trading-ai-system/workbench.js trading-ai-system/workbench.css
git commit -m "feat: render complete declaration decision chain"
```

### Task 9: 历史复盘与模型治理页面

**Files:**
- Create: `trading-ai-system/ui/view-models/history-review-model.js`
- Create: `trading-ai-system/ui/view-models/model-governance-model.js`
- Create: `trading-ai-system/ui/components/reliability-chart.js`
- Create: `trading-ai-system/test/ui-history-review.test.mjs`
- Create: `trading-ai-system/test/ui-model-governance.test.mjs`
- Modify: `trading-ai-system/ui/views/history-review-view.js`
- Modify: `trading-ai-system/ui/views/model-governance-view.js`
- Modify: `trading-ai-system/workbench.js`
- Modify: `trading-ai-system/workbench.css`

**Interfaces:**
- Produces: `buildHistoryReviewModel({accuracy, runs, outcomeCoverage, replay}) -> model`
- Produces: `buildModelGovernanceModel({versions, thresholds, approvals, ablations}) -> model`

- [ ] **Step 1: Write three-view isolation test**

```js
test('history review separates live replay and settlement views', () => {
  const model = buildHistoryReviewModel(fixture);
  assert.deepEqual(model.tabs.map((tab) => tab.id), ['live-issued','point-in-time-replay','settlement-replay']);
  assert.equal(model.tabs.some((tab) => tab.metricsFromAnotherRunType), false);
});
```

- [ ] **Step 2: Write outcome-coverage test**

The page must show temporary/current and final outcome coverage separately and label metrics calculated on each version. No final metric is shown when final coverage is zero.

- [ ] **Step 3: Write metric and regime test**

Assert display of:

```text
MAE/RMSE/Bias/MASE/skill
P10/P50/P90 pinball loss
80% interval coverage and width
spike precision/recall/Brier
point/peak class/weekday/season/heat/outage/congestion regimes
economic replay status and values
```

Null values render `证据不足`, not zero.

- [ ] **Step 4: Write governance-gate test**

A candidate with `champion_review_eligible` displays “可申请人工评审”, never “已自动上线”. A rejected candidate displays exact failed thresholds and links to the corresponding evaluation report.

- [ ] **Step 5: Run tests and confirm failures**

```bash
node --test test/ui-history-review.test.mjs test/ui-model-governance.test.mjs
```

- [ ] **Step 6: Implement history review**

Top: run-type tab, date range, target, model, actual version, regime filter. Main: coverage, headline metrics, actual-vs-forecast chart, reliability/coverage chart, grouped metrics table, run list, single-run replay.

Single-run replay loads the exact feature snapshot, forecast run, strategy trace and outcome revisions. It must not silently substitute current source values.

- [ ] **Step 7: Implement model governance**

Show version tree, active Champion, Challengers, feature lists, training windows, model artifact hashes, validation gates, ablation results, approvals, rollback history and code commit. Approval controls record an audit decision only; active-model change remains protected by existing explicit human governance.

- [ ] **Step 8: Run focused tests**

```bash
node --test test/ui-history-review.test.mjs test/ui-model-governance.test.mjs test/workbench-ui.test.mjs test/workbench-accessibility.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add trading-ai-system/ui/view-models/history-review-model.js trading-ai-system/ui/view-models/model-governance-model.js trading-ai-system/ui/components/reliability-chart.js trading-ai-system/test/ui-history-review.test.mjs trading-ai-system/test/ui-model-governance.test.mjs trading-ai-system/ui/views/history-review-view.js trading-ai-system/ui/views/model-governance-view.js trading-ai-system/workbench.js trading-ai-system/workbench.css
git commit -m "feat: add forecast review and governance cockpit"
```

### Task 10: 响应式、可访问性、真实性与浏览器验收

**Files:**
- Modify: `trading-ai-system/test/workbench-accessibility.test.mjs`
- Modify: `trading-ai-system/test/workbench-ui.test.mjs`
- Create: `trading-ai-system/test/workbench-cockpit-browser.test.mjs`
- Modify: `trading-ai-system/workbench.css`
- Modify: `trading-ai-system/index.html`
- Modify: `trading-ai-system/README.md`
- Modify: `trading-ai-system/docs/quick-start.html`
- Modify: `trading-ai-system/一分钟上手.html`

**Interfaces:**
- Produces browser acceptance for all six views at 1440, 1024, 768, 390 and 320 px.

- [ ] **Step 1: Add browser fixture modes**

Test three isolated states:

```text
real_complete_fixture
real_missing_weather_supply_fixture
demo_fixture
```

The real fixtures use provenance envelopes; the demo fixture uses explicit `mode:'demo'`.

- [ ] **Step 2: Write page-overflow and local-scroll tests**

For every viewport and view assert:

```js
expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
```

Wide tables and charts may have local `scrollWidth > clientWidth`, but their parent must carry an accessible label and local overflow.

- [ ] **Step 3: Write evidence focus-cycle tests**

Verify card/point activation opens evidence, focus enters the drawer, Tab stays inside, Escape closes it, and focus returns to the triggering control.

- [ ] **Step 4: Write truthfulness tests**

Real missing-source fixture must show missing/待确认 text and no Mock values. Demo fixture must show the demo identity in every view. Search rendered HTML and API payloads for known sample metrics and reject them outside demo mode.

- [ ] **Step 5: Write terminology and unit tests**

Search all rendered views for forbidden ambiguous labels:

```text
“申报量” without active/default context
“出清量” without user/public context
“实际值” without target field/version
“日前价” without source/version
```

Allow them only when an adjacent accessible description supplies the full context.

- [ ] **Step 6: Run focused browser tests**

```bash
node --test test/workbench-cockpit-browser.test.mjs test/workbench-accessibility.test.mjs test/workbench-ui.test.mjs
```

Expected: PASS with zero console errors.

- [ ] **Step 7: Update guides**

Document the six-view workflow:

```text
先核数据源与质量
再看市场驾驶舱
再看价格预测
再核申报策略逻辑链
事后进入历史复盘
模型变更进入模型治理
```

Make clear that absent weather/unit data stays absent and that the system never submits declarations/trades.

- [ ] **Step 8: Run full verification**

```bash
cd trading-ai-system
node --test --test-concurrency=1 test/*.test.mjs
node --check workbench.js server.mjs ui/api-client.js ui/value-envelope.js ui/navigation.js ui/views/*.js ui/view-models/*.js ui/components/*.js
git diff --check
```

Then start a service with isolated runtime files and inspect all six views in system Chrome at 1440, 1024, 768, 390 and 320 px. Expected: no page-level overflow, no console errors, no unlabeled chart units, no real-mode Mock values, evidence drawer focus loop works.

- [ ] **Step 9: Commit**

```bash
git add trading-ai-system/test/workbench-cockpit-browser.test.mjs trading-ai-system/test/workbench-accessibility.test.mjs trading-ai-system/test/workbench-ui.test.mjs trading-ai-system/workbench.css trading-ai-system/index.html trading-ai-system/README.md trading-ai-system/docs/quick-start.html trading-ai-system/一分钟上手.html
git commit -m "test: verify cockpit truthfulness and accessibility"
```
