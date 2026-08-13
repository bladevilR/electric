# AI 申报优化比赛展示页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将决策模式首屏改造成与已选目标图一致、由真实申报优化数据驱动的 AI 申报优化比赛展示页。

**Architecture:** 新增一个无 DOM 依赖的首屏视图模型模块，集中处理真实指标、96 点曲线、调整窗口和状态文案；`workbench.js` 只负责语义化渲染和交互，`workbench.css` 负责目标图的构图、色场、材质和响应式。审计模式继续复用现有证据组件，关闭证据链时使用覆盖式抽屉而不是固定网格列。

**Tech Stack:** Node.js ESM、原生 HTML/CSS/JavaScript、SVG、Node test runner、Playwright CLI。

## Global Constraints

- 不修改申报优化算法、晋级门槛或交易安全边界。
- 不自动提交交易，不绕过人工复核。
- 不写死 `+9.64%`、`86.05%`、`4,128 点 / 43 日` 或 `92/100`。
- 不显示 API 未提供的预计实际负荷、人民币节省或虚构曲线。
- 不引入第三方 UI 或图表依赖。
- 目标视口为 1920×1080；1280×720 必须保持可用。
- 所有演示状态必须明确标注，不得冒充真实生产状态。

---

### Task 1: 构建真实数据驱动的首屏视图模型

**Files:**
- Create: `lib/declaration-dashboard-view.mjs`
- Create: `test/declaration-dashboard-view.test.mjs`

**Interfaces:**
- Consumes: `payload.strategyValidation.declarationOptimizer`、`payload.declarationRecommendation`、`payload.costStrategy`、`payload.execution`、`payload.dataEvidence`
- Produces: `buildDeclarationDashboardView(payload): DashboardView`
- Produces: `buildDeclarationCurveGeometry(rows, options): CurveGeometry`
- Produces: `summarizeAdjustmentWindows(rows, options): AdjustmentWindow[]`

- [ ] **Step 1: 写失败测试，固定真实指标与缺失降级**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeclarationDashboardView,
  buildDeclarationCurveGeometry,
  summarizeAdjustmentWindows,
} from '../lib/declaration-dashboard-view.mjs';

test('buildDeclarationDashboardView maps validated optimizer evidence without fixed demo values', () => {
  const view = buildDeclarationDashboardView({
    strategyValidation: {
      declarationOptimizer: {
        status: 'validated',
        holdout: {
          improvementPct: 9.64,
          dailyWinRatePct: 86.05,
          pointCount: 4128,
          dateCount: 43,
        },
        promotion: { eligible: true, reasons: [] },
      },
    },
    declarationRecommendation: {
      status: 'ready',
      coverage: {
        recommendedPointCount: 2,
        requiredPointCount: 2,
        optimizerPointCount: 2,
        fallbackPointCount: 0,
      },
      rows: [
        { pointIndex: 1, timePoint: '00:15', baselinePowerMw: 10, recommendedPowerMw: 12, deltaPowerMw: 2 },
        { pointIndex: 2, timePoint: '00:30', baselinePowerMw: 11, recommendedPowerMw: 9, deltaPowerMw: -2 },
      ],
    },
    costStrategy: { dataConfidence: { score: 88 } },
    execution: { dataReady: true, reviewed: false },
  });

  assert.equal(view.metrics.improvement.display, '+9.64%');
  assert.equal(view.metrics.winRate.display, '86.05%');
  assert.equal(view.metrics.coverage.display, '4,128 点 / 43 日');
  assert.equal(view.metrics.confidence.display, '88/100');
  assert.equal(view.recommendation.canReview, true);
  assert.equal(view.curve.rows.length, 2);
});

test('missing evidence remains explicit instead of becoming zero', () => {
  const view = buildDeclarationDashboardView({});
  assert.equal(view.metrics.improvement.display, '待验证');
  assert.equal(view.metrics.confidence.display, '待校验');
  assert.deepEqual(view.curve.rows, []);
});

test('summarizeAdjustmentWindows groups contiguous positive and negative points', () => {
  const windows = summarizeAdjustmentWindows([
    { pointIndex: 1, timePoint: '00:15', deltaPowerMw: 2 },
    { pointIndex: 2, timePoint: '00:30', deltaPowerMw: 1 },
    { pointIndex: 3, timePoint: '00:45', deltaPowerMw: -1 },
  ]);
  assert.deepEqual(windows.map((item) => item.direction), ['up', 'down']);
  assert.equal(windows[0].label, '00:15–00:30');
});

test('buildDeclarationCurveGeometry returns bounded SVG paths', () => {
  const geometry = buildDeclarationCurveGeometry([
    { pointIndex: 1, baselinePowerMw: 10, recommendedPowerMw: 12 },
    { pointIndex: 2, baselinePowerMw: 20, recommendedPowerMw: 18 },
  ], { width: 800, height: 300 });
  assert.match(geometry.baselinePath, /^M /);
  assert.match(geometry.recommendedPath, /^M /);
  assert.equal(geometry.points.length, 2);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/declaration-dashboard-view.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/declaration-dashboard-view.mjs`.

- [ ] **Step 3: 实现纯函数模块**

模块必须：

```js
export function buildDeclarationDashboardView(payload = {}) {
  const optimizer = payload.strategyValidation?.declarationOptimizer || {};
  const holdout = optimizer.holdout || {};
  const recommendation = payload.declarationRecommendation || {};
  const confidence = numberOrNull(payload.costStrategy?.dataConfidence?.score);
  const rows = normalizeRows(recommendation.rows);

  return {
    optimizerStatus: optimizer.status || 'not_validated',
    metrics: {
      improvement: metricPercent(holdout.improvementPct, '待验证'),
      winRate: metricPercent(holdout.dailyWinRatePct, '待验证', false),
      coverage: {
        display:
          numberOrNull(holdout.pointCount) === null
            ? '待验证'
            : `${formatInteger(holdout.pointCount)} 点 / ${formatInteger(holdout.dateCount)} 日`,
      },
      confidence: {
        display: confidence === null ? '待校验' : `${Math.round(confidence)}/100`,
      },
    },
    curve: {
      rows,
      geometry: buildDeclarationCurveGeometry(rows),
    },
    windows: summarizeAdjustmentWindows(rows),
    recommendation: {
      status: recommendation.status || 'unavailable',
      canReview: recommendation.status === 'ready' && Boolean(payload.execution?.dataReady),
      coverage: recommendation.coverage || {},
      fallbackReasons: recommendation.fallbackReasons || [],
    },
  };
}
```

所有数字先通过 `numberOrNull`；空字符串、`undefined`、`null` 和非有限数均返回 `null`。SVG 几何使用实际 min/max 加 8% padding，只有一条数据时使用中心线。

- [ ] **Step 4: 运行单测确认通过**

Run: `node --test test/declaration-dashboard-view.test.mjs`

Expected: 4 tests PASS.

- [ ] **Step 5: 提交**

```bash
git add lib/declaration-dashboard-view.mjs test/declaration-dashboard-view.test.mjs
git commit -m "feat: build declaration dashboard view model"
```

---

### Task 2: 将决策模式重构为目标图布局

**Files:**
- Modify: `workbench.js`
- Modify: `test/workbench-ui.test.mjs`

**Interfaces:**
- Consumes: `buildDeclarationDashboardView(payload)` from Task 1
- Produces: `renderDeclarationDashboard(payload, options): string`
- Produces: SVG elements with `data-curve-point="<index>"` and real accessible labels

- [ ] **Step 1: 写失败测试，固定首屏语义与安全边界**

在 `test/workbench-ui.test.mjs` 增加：

```js
test('decision mode renders the AI declaration dashboard as the primary theme', () => {
  const payload = blockedPayload();
  payload.declarationRecommendation = {
    status: 'ready',
    coverage: { recommendedPointCount: 2, requiredPointCount: 2, optimizerPointCount: 2, fallbackPointCount: 0 },
    rows: [
      { pointIndex: 1, timePoint: '00:15', baselinePowerMw: 10, recommendedPowerMw: 12, deltaPowerMw: 2 },
      { pointIndex: 2, timePoint: '00:30', baselinePowerMw: 11, recommendedPowerMw: 9, deltaPowerMw: -2 },
    ],
  };
  payload.costStrategy = { dataConfidence: { score: 88 } };
  payload.execution = { dataReady: true, reviewed: false, allowed: false };

  const html = renderWorkbenchMarkup(payload, { mode: 'operation', evidenceOpen: false });

  assert.match(html, /AI申报优化/);
  assert.match(html, /96 点申报曲线对比/);
  assert.match(html, /\+9\.64%/);
  assert.match(html, /88\/100/);
  assert.match(html, /进入人工复核/);
  assert.match(html, /data-curve-point="1"/);
  assert.doesNotMatch(html, /立即下单|自动提交/);
});

test('decision dashboard never invents savings or confidence', () => {
  const html = renderWorkbenchMarkup(blockedPayload(), { mode: 'operation', evidenceOpen: false });
  assert.match(html, /待校验/);
  assert.doesNotMatch(html, /92\/100|¥3,215,600/);
});
```

- [ ] **Step 2: 运行 UI 测试确认失败**

Run: `node --test test/workbench-ui.test.mjs`

Expected: new assertions FAIL because the existing renderer still emits stage panels.

- [ ] **Step 3: 在 `workbench.js` 添加目标图渲染单元**

添加并使用：

```js
import {
  buildDeclarationDashboardView,
} from './lib/declaration-dashboard-view.mjs';

export function renderDeclarationDashboard(payload, options = {}) {
  const view = buildDeclarationDashboardView(payload);
  return `
    <section class="declaration-dashboard" aria-labelledby="declarationDashboardTitle">
      ${renderDashboardHero(payload, view)}
      ${renderDashboardMetrics(view)}
      <div class="dashboard-primary-grid">
        ${renderDeclarationCurve(view)}
        ${renderRecommendationPanel(payload, view)}
      </div>
      ${renderOptimizationFlow(payload, view)}
    </section>
  `;
}
```

`renderWorkbenchMarkup` 规则：

- `mode === 'operation'` 时渲染 `renderDeclarationDashboard`；
- `mode === 'review'` 时继续渲染现有 `reviewPanel`；
- 左侧导航只使用真实 `data-dashboard-nav` 动作；
- 证据链使用 overlay drawer，不再作为第三列；
- 所有动态文案继续经 `escapeHtml`；
- 曲线无行时渲染 `role="status"` 空状态。

- [ ] **Step 4: 运行 UI 测试确认通过**

Run: `node --test test/workbench-ui.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: 提交**

```bash
git add workbench.js test/workbench-ui.test.mjs
git commit -m "feat: render focused AI declaration dashboard"
```

---

### Task 3: 实现目标图的色场、材质和响应式

**Files:**
- Modify: `workbench.css`

**Interfaces:**
- Consumes: Task 2 class names beginning with `declaration-`, `dashboard-`, `curve-`, `recommendation-`, `optimization-`
- Produces: 1920×1080 target layout and 1280×720 compact layout

- [ ] **Step 1: 建立设计令牌和三层页面栅格**

在 `:root` 增加目标图令牌：

```css
--air: #f4f8ff;
--air-warm: #fbfdff;
--resin: rgb(255 255 255 / 0.86);
--ink: #10213f;
--muted: #71809c;
--cobalt: #1f63f2;
--violet: #7a49ed;
--emerald: #06a66b;
--amber: #f59a35;
--line-soft: rgb(54 103 183 / 0.14);
--panel-shadow: 0 18px 50px rgb(52 93 154 / 0.12);
```

将 `.workbench-shell` 改为：

```css
.workbench-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  grid-template-rows: 1fr;
  background:
    radial-gradient(52rem 24rem at 66% -6%, rgb(123 160 255 / .18), transparent 72%),
    radial-gradient(38rem 22rem at 58% 100%, rgb(74 222 191 / .12), transparent 74%),
    linear-gradient(135deg, var(--air-warm), var(--air));
}
```

- [ ] **Step 2: 实现主内容构图和材质**

目标尺寸：

- 左栏 `208px`；
- 主内容 padding `28px 36px 30px`；
- KPI 横条最小高度 `124px`；
- 主栅格 `minmax(0, 1fr) 360px`；
- 主图最小高度 `420px`；
- 流程条最小高度 `122px`；
- 主按钮使用唯一蓝紫渐变。

面板统一使用乳白树脂底、1px 冷蓝边、浅接触阴影；只给指标图标添加低透明度色晕。

- [ ] **Step 3: 实现覆盖式审计抽屉**

```css
.evidence-drawer,
.evidence-closed {
  position: fixed;
  z-index: 60;
  top: 0;
  right: 0;
  width: min(420px, 92vw);
  height: 100vh;
}

.evidence-closed {
  width: auto;
  height: auto;
  top: auto;
  right: 24px;
  bottom: 24px;
}
```

关闭状态只保留浮动按钮，不占页面网格列。

- [ ] **Step 4: 实现 1280 与 1100 断点**

```css
@media (max-width: 1280px) {
  .workbench-shell { grid-template-columns: 76px minmax(0, 1fr); }
  .dashboard-sidebar .nav-label,
  .dashboard-sidebar .brand-copy { display: none; }
  .dashboard-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 1100px) {
  html, body { min-width: 0; }
  .dashboard-primary-grid { grid-template-columns: 1fr; }
  .recommendation-panel { min-height: auto; }
}
```

- [ ] **Step 5: 运行测试和静态检查**

Run: `node --test test/workbench-ui.test.mjs test/declaration-dashboard-view.test.mjs`

Expected: all tests PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 6: 提交**

```bash
git add workbench.css
git commit -m "style: match premium declaration dashboard target"
```

---

### Task 4: 接入真实置信度与交互

**Files:**
- Modify: `workbench.js`
- Modify: `test/workbench-ui.test.mjs`

**Interfaces:**
- Consumes: `/api/cost-strategy?date=<YYYY-MM-DD>`
- Produces: `browserState.payload.costStrategy`
- Produces: dashboard nav, curve point focus, audit drawer and existing primary action behavior

- [ ] **Step 1: 写失败测试，固定成本策略加载和导航属性**

```js
test('dashboard exposes only functional navigation actions', () => {
  const html = renderWorkbenchMarkup(blockedPayload(), { mode: 'operation', evidenceOpen: false });
  assert.match(html, /data-dashboard-nav="curve"/);
  assert.match(html, /data-dashboard-nav="validate"/);
  assert.match(html, /data-dashboard-nav="review"/);
  assert.match(html, /data-action="open-evidence"/);
  assert.doesNotMatch(html, /href="#"/);
});
```

- [ ] **Step 2: 更新并行加载**

在 `loadWorkbench` 的并行请求中加入：

```js
const [strategyValidation, declarationRecommendation, costStrategy] = await Promise.all([
  fetch('/api/strategy-validation', { cache: 'no-store' }).then(responseJson),
  fetch(`/api/declaration-optimizer/recommendation?date=${encodeURIComponent(selectedDate)}`, {
    cache: 'no-store',
  }).then(responseJson),
  fetch(`/api/cost-strategy?date=${encodeURIComponent(selectedDate)}`, {
    cache: 'no-store',
  }).then(responseJson),
]);
browserState.payload.strategyValidation = strategyValidation;
browserState.payload.declarationRecommendation = declarationRecommendation;
browserState.payload.costStrategy = costStrategy;
```

成本策略加载失败时只把置信度降级为“待校验”，不得让整个工作台进入 fatal state；使用独立 `.catch(() => null)`。

- [ ] **Step 3: 绑定真实导航和点位交互**

- `curve`：调用 `document.querySelector('#declarationCurveTitle')?.scrollIntoView({ block: 'center' })`；
- `validate`：设置 `browserState.activeStage = 'validate'` 并渲染现有校验内容或审计视图；
- `review`：设置 `browserState.mode = 'review'`；
- `open-evidence`：设置 `browserState.evidenceOpen = true`；
- 曲线点使用按钮或 `tabindex="0"`，在 focus/hover 时显示真实点位详情。

- [ ] **Step 4: 运行测试**

Run: `node --test test/workbench-ui.test.mjs test/declaration-dashboard-view.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: 提交**

```bash
git add workbench.js test/workbench-ui.test.mjs
git commit -m "feat: wire dashboard evidence and review interactions"
```

---

### Task 5: 回归与真实浏览器验收

**Files:**
- Modify only if verification exposes defects.
- Evidence: `output/playwright/redesign-1920x1080.png`
- Evidence: `output/playwright/redesign-1280x720.png`

**Interfaces:**
- Consumes: final local server and built-in demo state
- Produces: test evidence and target-vs-implementation screenshots

- [ ] **Step 1: 运行完整测试**

Run: `node --test`

Expected: all repository-contained tests PASS；若只剩既有外部 `standard-96.json` 或 Excel 缺失失败，记录为环境阻塞，不把它描述为通过。

- [ ] **Step 2: 启动真实本地服务**

Run: `node server.mjs --port 5177 --standard data/standard-96.sample.json`

Expected: when the packaged sample exists, `/api/health` 200 and `/api/workbench` 200. If `data/standard-96.sample.json` is absent, record the missing packaged sample as an environment blocker and do not claim full runtime acceptance.

- [ ] **Step 3: 使用 Playwright 验收 1920×1080**

检查：

- 标题与四指标无需滚动；
- 96 点主图是视觉焦点；
- AI 建议、人工复核和流程条可见；
- 证据关闭时无空白列；
- 控制台无新错误。

- [ ] **Step 4: 使用 Playwright 验收 1280×720**

检查左栏收缩、指标换行、主图与建议卡可读、无横向溢出。

- [ ] **Step 5: 对照目标图并修正最大三项差异**

按构图、字号、色场、面板边缘和主按钮排序，只修正影响最大的三项；不为像素匹配伪造业务数据。

- [ ] **Step 6: 运行最终回归并提交**

Run: `node --test test/declaration-dashboard-view.test.mjs test/workbench-ui.test.mjs`

Expected: PASS.

```bash
git add lib/declaration-dashboard-view.mjs workbench.js workbench.css test/declaration-dashboard-view.test.mjs test/workbench-ui.test.mjs
git commit -m "feat: deliver AI declaration competition dashboard"
```
