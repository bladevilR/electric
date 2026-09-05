# Strategy Foundation Evidence Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing data-source screen with a production-ready strategy foundation workbench that exposes truthful collection state, price/temperature/load forecast evidence, historical accuracy, a safe sensitivity sandbox, and progressively disclosed strategy derivation.

**Architecture:** Extend the existing six-view market cockpit instead of building a parallel shell. A pure view model will normalize real/demo data into one truthful UI contract; focused render components will produce charts, metrics, tooltips, provenance rail, and algorithm drawer; `workbench.js` will own ephemeral tab/drawer/sandbox state and will never persist simulation values or call trade APIs.

**Tech Stack:** Browser-native ES modules, Node.js `node:test`, existing SVG time-series helpers, CSS, Playwright Chromium for browser and accessibility verification.

**Spec:** `docs/superpowers/specs/2026-09-03-strategy-foundation-evidence-workbench-design.md`

## Global Constraints

- Use `trading-ai-system/design/strategy-foundation-evidence-target.png` as the visual target.
- Keep current-day real data, historical real data, and simulated values visibly distinct.
- Never invent a completed current trading day, forecast accuracy, savings amount, or executable strategy.
- Sandbox controls update browser-local simulation only; they do not mutate formal model state, create a proposal, or submit a trade.
- Price, temperature, and load series must use separate unit-aware charts.
- Evidence disclosures include source, cutoff, model version, constraint version, units, and applicable caveats.
- All disclosure controls are keyboard reachable; side panels close with Escape and restore focus.
- Preserve existing routes and server contracts unless a task explicitly adds a read-only field to `/api/workbench`.

---

### Task 1: Build the truthful foundation view model

**Files:**
- Create: `trading-ai-system/ui/view-models/strategy-foundation-model.js`
- Create: `trading-ai-system/test/ui-strategy-foundation-model.test.mjs`

**Interfaces:**
- Consumes: `{ mode, targetDate, now, workbench, ukeyStatus, forecastReport, accuracyReport, marketCockpit, strategyTrace }`.
- Produces: `buildStrategyFoundationModel(input)` returning `{ identity, collection, forecastTabs, accuracy, sandbox, derivation, explanations }`.
- Produces: `applyFoundationSandbox(model, controls)` returning a cloned simulation summary without changing the input model.

- [ ] **Step 1: Write failing model tests**

```js
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
      visibleHistory: { dates: ['2026-06-29'], rowCount: 79, generatedAt: '2026-06-29T07:55:02.693Z' },
    },
    workbench: { metrics: { marketPricePointCount: 0 }, readiness: { status: 'data_blocked' } },
  });

  assert.equal(model.identity.environment, '真实环境');
  assert.equal(model.collection.current.kind, 'current_real');
  assert.equal(model.collection.current.coverage, 0);
  assert.equal(model.collection.history.kind, 'historical_real');
  assert.equal(model.collection.history.coverage, 79);
  assert.equal(model.collection.simulation.kind, 'simulation');
  assert.equal(model.collection.strategyExecutable, false);
});

test('foundation model exposes price temperature and load forecast tabs with unit isolation', () => {
  const model = buildStrategyFoundationModel({ mode: 'real', targetDate: '2026-09-03' });
  assert.deepEqual(model.forecastTabs.map((tab) => tab.id), ['price', 'temperature', 'load']);
  assert.deepEqual(model.forecastTabs.map((tab) => tab.unit), ['元/MWh', '°C', 'MW']);
  assert.ok(model.forecastTabs.every((tab) => Array.isArray(tab.series)));
});

test('sandbox returns simulated output without mutating the formal recommendation', () => {
  const model = buildStrategyFoundationModel({
    mode: 'demo',
    targetDate: '2026-09-03',
    workbench: { recommendation: { rows: [{ pointIndex: 1, recommendedMw: 20 }] } },
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
  assert.ok(result.series.every((row) => Number.isFinite(row.adjustedMw)));
});
```

- [ ] **Step 2: Run the model tests and verify RED**

Run: `node --test test/ui-strategy-foundation-model.test.mjs`

Expected: FAIL because `strategy-foundation-model.js` does not exist.

- [ ] **Step 3: Implement the pure model and deterministic sandbox**

Implement these exported functions:

```js
const clamp01 = (value, fallback) => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : fallback));

export function buildStrategyFoundationModel(input = {}) {
  const history = input.ukeyStatus?.visibleHistory || {};
  const currentCoverage = Number(input.workbench?.metrics?.marketPricePointCount || 0);
  return {
    identity: { environment: input.mode === 'demo' ? '演示环境' : '真实环境', targetDate: input.targetDate || '' },
    collection: {
      current: { kind: 'current_real', coverage: currentCoverage },
      history: { kind: 'historical_real', coverage: Number(history.rowCount || 0), dates: history.dates || [] },
      simulation: { kind: 'simulation' },
      strategyExecutable: currentCoverage === 96 && input.workbench?.readiness?.status === 'ready',
    },
    forecastTabs: [
      { id: 'price', label: '价格预测', unit: '元/MWh', series: [] },
      { id: 'temperature', label: '温度预测', unit: '°C', series: [] },
      { id: 'load', label: '负荷预测', unit: 'MW', series: [] },
    ],
    accuracy: input.accuracyReport || {},
    sandbox: { formalRows: input.workbench?.recommendation?.rows || [] },
    derivation: input.strategyTrace?.stages || [],
    explanations: {},
  };
}

export function applyFoundationSandbox(model, controls = {}) {
  const normalized = {
    priceWeight: clamp01(controls.priceWeight, 0.7),
    temperatureWeight: clamp01(controls.temperatureWeight, 0.5),
    loadWeight: clamp01(controls.loadWeight, 0.6),
    riskProfile: ['conservative', 'balanced', 'active'].includes(controls.riskProfile)
      ? controls.riskProfile
      : 'balanced',
  };
  const signedAdjustment = (normalized.loadWeight - normalized.priceWeight) * 0.12;
  return {
    kind: 'simulation',
    persisted: false,
    submitAllowed: false,
    controls: normalized,
    series: (model.sandbox?.formalRows || []).map((row) => ({
      pointIndex: row.pointIndex,
      adjustedMw: Number(row.recommendedMw || 0) * (1 + signedAdjustment),
    })),
  };
}
```

The sandbox adjustment must be deterministic and bounded to ±12% of the existing recommendation or zero when no baseline exists. It must not compute or display realized savings when settlement evidence is absent.

- [ ] **Step 4: Run the model tests and verify GREEN**

Run: `node --test test/ui-strategy-foundation-model.test.mjs`

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Commit the model slice**

```powershell
git add trading-ai-system/ui/view-models/strategy-foundation-model.js trading-ai-system/test/ui-strategy-foundation-model.test.mjs
git commit -m "feat: model strategy foundation evidence"
```

### Task 2: Render the strategy foundation screen and evidence disclosures

**Files:**
- Create: `trading-ai-system/ui/components/foundation-forecast-chart.js`
- Create: `trading-ai-system/ui/components/foundation-explanation.js`
- Modify: `trading-ai-system/ui/views/data-sources-view.js`
- Create: `trading-ai-system/test/ui-strategy-foundation-view.test.mjs`

**Interfaces:**
- Consumes: the Task 1 `StrategyFoundationModel` object.
- Produces: `renderFoundationForecastChart(tab, options)` with unit-aware SVG and textual summary.
- Produces: `renderFoundationTooltip(explanation)` and `renderFoundationEvidenceDrawer(explanation)`.
- Produces: `renderDataSourcesView(state)` with stable `data-foundation-*` selectors.

- [ ] **Step 1: Write failing rendering tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDataSourcesView } from '../ui/views/data-sources-view.js';

const html = renderDataSourcesView({
  mode: 'real',
  targetDate: '2026-09-03',
  activeForecastTab: 'price',
  openExplanation: 'mape',
  foundationInput: {
    ukeyStatus: { collector: { state: 'stopped' }, visibleHistory: { dates: ['2026-06-29'], rowCount: 79 } },
    workbench: { metrics: { marketPricePointCount: 0 }, readiness: { status: 'data_blocked' } },
  },
});

test('foundation view presents three forecast tabs and truthful collection state', () => {
  ['价格预测', '温度预测', '负荷预测'].forEach((label) => assert.match(html, new RegExp(label)));
  assert.match(html, /今日数据未闭环/);
  assert.match(html, /采集器已停止/);
  assert.match(html, /历史真实数据/);
  assert.doesNotMatch(html, /数据已就绪/);
});

test('foundation view renders accessible contextual explanation and in-window drawer', () => {
  assert.match(html, /MAPE 平均绝对百分比误差/);
  assert.match(html, /aria-controls="foundationEvidenceDrawer"/);
  assert.match(html, /id="foundationEvidenceDrawer"/);
  assert.match(html, /核心公式/);
  assert.match(html, /数据血缘/);
});

test('foundation view labels tuning outputs as simulation and excludes trade submission', () => {
  assert.match(html, /策略微调沙盒/);
  assert.match(html, /仅模拟，不会提交交易/);
  assert.match(html, /模拟测算/);
  assert.doesNotMatch(html, /自动提交|确认交易|立即下单/);
});
```

- [ ] **Step 2: Run the view tests and verify RED**

Run: `node --test test/ui-strategy-foundation-view.test.mjs`

Expected: FAIL because the existing data-source view does not render the foundation workbench.

- [ ] **Step 3: Implement focused renderers and replace the data-source view**

Use semantic `button`, `nav`, `section`, `aside`, and `table` elements. Render charts from numeric arrays only; empty current-day arrays produce an annotated empty segment rather than fabricated points. Information buttons must use `aria-expanded`, `aria-controls`, and a visible label or accessible name.

- [ ] **Step 4: Run the view tests and verify GREEN**

Run: `node --test test/ui-strategy-foundation-view.test.mjs test/ui-data-sources.test.mjs`

Expected: all tests pass; update `ui-data-sources.test.mjs` only when its old five-group layout assertion conflicts with the approved design, while retaining its truthful-empty assertions.

- [ ] **Step 5: Commit the rendering slice**

```powershell
git add trading-ai-system/ui/components/foundation-forecast-chart.js trading-ai-system/ui/components/foundation-explanation.js trading-ai-system/ui/views/data-sources-view.js trading-ai-system/test/ui-strategy-foundation-view.test.mjs trading-ai-system/test/ui-data-sources.test.mjs
git commit -m "feat: render strategy foundation workbench"
```

### Task 3: Add browser-local tabs, drawers, tooltips, and sensitivity controls

**Files:**
- Modify: `trading-ai-system/workbench.js`
- Modify: `trading-ai-system/ui/app-state.js`
- Create: `trading-ai-system/test/ui-strategy-foundation-interactions.test.mjs`

**Interfaces:**
- Extends browser state with `{ activeForecastTab, foundationExplanation, provenanceOpen, sandboxControls }`.
- Consumes buttons with `data-foundation-action`, `data-forecast-tab`, and `data-sandbox-control`.
- Produces no server mutation; all sandbox changes remain in browser memory.

- [ ] **Step 1: Write failing interaction-state tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFoundationUiState,
  reduceFoundationUiState,
} from '../ui/app-state.js';

test('foundation UI switches tabs and keeps only one side disclosure open', () => {
  let state = createFoundationUiState();
  state = reduceFoundationUiState(state, { type: 'open_provenance' });
  assert.equal(state.provenanceOpen, true);
  state = reduceFoundationUiState(state, { type: 'open_explanation', id: 'optimizer' });
  assert.equal(state.provenanceOpen, false);
  assert.equal(state.explanation, 'optimizer');
  state = reduceFoundationUiState(state, { type: 'select_tab', id: 'load' });
  assert.equal(state.activeForecastTab, 'load');
});

test('foundation UI clamps sandbox controls and restores recommended defaults', () => {
  let state = createFoundationUiState();
  state = reduceFoundationUiState(state, { type: 'set_control', id: 'priceWeight', value: 9 });
  assert.equal(state.sandboxControls.priceWeight, 1);
  state = reduceFoundationUiState(state, { type: 'reset_controls' });
  assert.deepEqual(state.sandboxControls, createFoundationUiState().sandboxControls);
});
```

- [ ] **Step 2: Run the interaction tests and verify RED**

Run: `node --test test/ui-strategy-foundation-interactions.test.mjs`

Expected: FAIL because the reducer exports do not exist.

- [ ] **Step 3: Implement the reducer and DOM event wiring**

Add delegated click/input/keydown handling in `workbench.js`. Escape closes the active disclosure. Opening a disclosure records its trigger selector; closing restores focus. `apply_to_simulation` updates only the Task 1 sandbox result and never issues `fetch()`.

- [ ] **Step 4: Run interaction and existing workbench tests**

Run: `node --test test/ui-strategy-foundation-interactions.test.mjs test/workbench-ui.test.mjs test/ui-navigation.test.mjs`

Expected: all tests pass, with existing navigation and evidence behavior preserved.

- [ ] **Step 5: Commit the interaction slice**

```powershell
git add trading-ai-system/workbench.js trading-ai-system/ui/app-state.js trading-ai-system/test/ui-strategy-foundation-interactions.test.mjs
git commit -m "feat: add foundation evidence interactions"
```

### Task 4: Match the approved visual target responsively

**Files:**
- Create: `trading-ai-system/ui/strategy-foundation.css`
- Modify: `trading-ai-system/index.html`
- Modify: `trading-ai-system/workbench.css`
- Create: `trading-ai-system/test/strategy-foundation-browser.test.mjs`

**Interfaces:**
- Styles `.foundation-workbench` and descendants without changing unrelated dashboard stages.
- Browser test starts the existing local server with isolated temporary audit/history/ledger paths.

- [ ] **Step 1: Write the failing Playwright acceptance test**

```js
test('foundation workbench is responsive and disclosures are keyboard operable', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  await page.goto(`${server.url}/?demo=submission&view=data-sources`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '基础数据与预测依据' }).waitFor();
  await page.getByRole('tab', { name: '负荷预测' }).click();
  assert.equal(await page.getByRole('tab', { name: '负荷预测' }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: /申报优化器.*依据/ }).click();
  await page.getByRole('dialog', { name: /依据说明/ }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: /依据说明/ }).waitFor({ state: 'detached' });
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
});
```

Repeat the overflow and primary-interaction assertions at 1024×768 and 390×844. Capture 1440×1024 default, open-drawer, load-tab, and sandbox states. Collect `pageerror` and console `error` messages and require empty arrays.

- [ ] **Step 2: Run the browser test and verify RED**

Run: `node --test test/strategy-foundation-browser.test.mjs`

Expected: FAIL because the new screen selectors and styles are absent.

- [ ] **Step 3: Implement target-aligned CSS and stylesheet loading**

Match the target proportions: 224px desktop sidebar, compact 64px top status strip, 12-column content grid, restrained 8/12/16/24/32px spacing rhythm, 8–12px radii, navy `#12213b`, blue `#1769e8`, green `#16a36a`, amber `#dd7a00`, red `#d92d20`, and off-white `#f7f9fc`. At ≤1024px use overlay drawers; at ≤640px stack charts and make tables locally scrollable.

- [ ] **Step 4: Run browser, accessibility, and cockpit regression tests**

Run: `node --test test/strategy-foundation-browser.test.mjs test/workbench-accessibility.test.mjs test/workbench-cockpit-browser.test.mjs`

Expected: all tests pass at every viewport with no page overflow or console errors.

- [ ] **Step 5: Commit the visual slice**

```powershell
git add trading-ai-system/ui/strategy-foundation.css trading-ai-system/index.html trading-ai-system/workbench.css trading-ai-system/test/strategy-foundation-browser.test.mjs
git commit -m "style: align strategy foundation target"
```

### Task 5: Perform design QA and full regression verification

**Files:**
- Update: `trading-ai-system/design-qa.md`
- Create: `trading-ai-system/output/design-qa/strategy-foundation-default.png`
- Create: `trading-ai-system/output/design-qa/strategy-foundation-evidence-open.png`
- Create: `trading-ai-system/output/design-qa/strategy-foundation-mobile.png`

**Interfaces:**
- Source truth: `trading-ai-system/design/strategy-foundation-evidence-target.png`.
- Implementation route: `http://127.0.0.1:<safe-port>/?demo=submission&view=data-sources`.

- [ ] **Step 1: Install dependencies and launch an isolated verification server**

Run: `npm install` from `trading-ai-system`, then start `server.mjs` on an available non-excluded localhost port with temporary audit, visible-history, point-in-time, forecast-ledger, and outcome-ledger paths.

- [ ] **Step 2: Capture source-aligned implementation states with Playwright Chromium**

Capture the same 1440px desktop composition as the visual target, plus the right-drawer, tab switch, sandbox adjustment, 1024px, and 390px states. Save browser-rendered screenshots under `trading-ai-system/output/design-qa/`.

- [ ] **Step 3: Create a normalized side-by-side comparison and inspect it**

Place the source target and 1440px implementation capture on one comparison canvas at equal content width. Inspect full view plus focused crops for header/status, forecast chart/metrics, sandbox, derivation, and evidence drawer.

- [ ] **Step 4: Write the first `design-qa.md` findings and fix every P0/P1/P2 issue**

The report must cover typography, spacing/layout, colors/tokens, image/asset fidelity, copy/content, icons, interactions, responsiveness, and accessibility. Record each issue, correction, and post-fix screenshot. Repeat capture and comparison until only acceptable P3 differences remain.

- [ ] **Step 5: Run full verification**

Run:

```powershell
node --check workbench.js
node --check ui/views/data-sources-view.js
node --test test/ui-strategy-foundation-model.test.mjs test/ui-strategy-foundation-view.test.mjs test/ui-strategy-foundation-interactions.test.mjs test/strategy-foundation-browser.test.mjs
node --test test/*.test.mjs
git diff --check
```

Expected: syntax checks exit 0, all tests pass, and `git diff --check` reports no errors.

- [ ] **Step 6: Finalize the QA report and commit**

Set `final result: passed` only when source and implementation were compared at matching state/viewport and no actionable P0/P1/P2 issue remains.

```powershell
git add trading-ai-system/design-qa.md trading-ai-system/output/design-qa
git commit -m "test: verify strategy foundation redesign"
```
