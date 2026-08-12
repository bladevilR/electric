# 比赛演示动效系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 申报优化仪表盘加入离线可用、数据驱动、可降级的比赛演示动效，并在真实 Chrome 与 1920×1080 录屏视口完成验收。

**Architecture:** 新建独立 `workbench-motion.js` 管理 GSAP 时间线和清理生命周期，`workbench.js` 只在 DOM 渲染完成后调用幂等入口。GSAP core 以本地 vendor 文件加载，CSS 负责材质、交互终态和减少动态效果降级，业务数据与动画状态保持分离。

**Tech Stack:** 浏览器原生 ES modules、GSAP core、SVG、CSS animations、Node `node:test`、真实 Chrome。

## Global Constraints

- 首屏时间线不超过 3 秒，持续动效最多两处且振幅极低。
- 运行时不得访问 CDN 或其他远程动效资源。
- 数字和曲线必须来自现有 DOM 与真实载荷，禁止写死指标。
- 动效失败或 `prefers-reduced-motion: reduce` 时直接呈现完整终态。
- 不自动滚动、点击、提交或改变人工复核安全边界。
- 保持 96 个曲线交互点、13 个常驻锚点和宽屏曲线覆盖率。

---

### Task 1: 离线 GSAP 与幂等动效生命周期

**Files:**
- Create: `vendor/gsap.min.js`
- Create: `workbench-motion.js`
- Create: `test/workbench-motion.test.mjs`
- Modify: `index.html`

**Interfaces:**
- Consumes: `HTMLElement root`、可注入的 `gsap` 对象、`matchMedia('(prefers-reduced-motion: reduce)')`。
- Produces: `startWorkbenchMotion(root, options): { kill(): void, reduced: boolean }` 与 `stopWorkbenchMotion(): void`。

- [ ] **Step 1: 写离线加载和幂等生命周期失败测试**

```javascript
test('index loads local gsap before the workbench module', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\.\/vendor\/gsap\.min\.js"><\/script>/);
  assert.ok(html.indexOf('vendor/gsap.min.js') < html.indexOf('workbench.js'));
  assert.doesNotMatch(html, /https?:\/\/[^"']*gsap/i);
});

test('starting motion twice kills the previous timeline', () => {
  const fakeGsap = createFakeGsap();
  const root = createMotionRoot();
  const first = startWorkbenchMotion(root, { gsap: fakeGsap, reducedMotion: false });
  startWorkbenchMotion(root, { gsap: fakeGsap, reducedMotion: false });
  assert.equal(first.timeline.killed, true);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/workbench-motion.test.mjs`

Expected: FAIL，原因是 `workbench-motion.js`、本地 GSAP 引用和生命周期函数尚不存在。

- [ ] **Step 3: 下载并固定官方 GSAP core，创建最小生命周期模块**

```javascript
let activeMotion = null;

export function stopWorkbenchMotion() {
  activeMotion?.kill();
  activeMotion = null;
}

export function startWorkbenchMotion(root, options = {}) {
  stopWorkbenchMotion();
  const gsap = options.gsap || globalThis.gsap;
  const reduced = options.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!root || !gsap || reduced) {
    root?.classList.add('motion-ready');
    return { kill() {}, reduced: Boolean(reduced) };
  }
  const timeline = gsap.timeline();
  activeMotion = timeline;
  return { timeline, reduced: false, kill: () => timeline.kill() };
}
```

在 `index.html` 中将 `<script src="./vendor/gsap.min.js"></script>` 放在 `workbench.js` 模块脚本之前。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/workbench-motion.test.mjs test/server-static-mime.test.mjs`

Expected: PASS，本地 GSAP 可由现有静态服务器返回，且重复启动会清理旧时间线。

- [ ] **Step 5: 提交**

```bash
git add vendor/gsap.min.js workbench-motion.js index.html test/workbench-motion.test.mjs
git commit -m "feat: add offline motion runtime"
```

### Task 2: 数据驱动首屏、指标和曲线时间线

**Files:**
- Modify: `workbench-motion.js`
- Modify: `workbench.js`
- Modify: `test/workbench-motion.test.mjs`
- Modify: `test/workbench-ui.test.mjs`

**Interfaces:**
- Consumes: `.dashboard-hero`、`.dashboard-metric strong`、`.curve-baseline`、`.curve-recommended`、`.curve-dot`、`.recommendation-panel`、`.recommendation-windows i b`、`.optimization-flow li`。
- Produces: `parseMetricText(text)`、`createMetricFormatter(parts)`、完整 `startWorkbenchMotion()` 时间线和 `scheduleWorkbenchMotion(root)` 集成调用。

- [ ] **Step 1: 写指标解析、曲线路径和集成失败测试**

```javascript
test('metric parser preserves prefix decimals and suffix', () => {
  assert.deepEqual(parseMetricText('+9.64%'), {
    prefix: '+', value: 9.64, decimals: 2, suffix: '%'
  });
  assert.deepEqual(parseMetricText('4,128 点 / 43 日'), {
    prefix: '', value: 4128, decimals: 0, suffix: ' 点 / 43 日'
  });
});

test('workbench schedules motion only after dashboard markup is rendered', async () => {
  const source = await readFile(new URL('../workbench.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ scheduleWorkbenchMotion \} from '\.\/workbench-motion\.js'/);
  assert.match(source, /root\.innerHTML =[\s\S]*scheduleWorkbenchMotion\(root\)/);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test --test-name-pattern="metric parser|schedules motion" test/workbench-motion.test.mjs test/workbench-ui.test.mjs`

Expected: FAIL，原因是指标解析器和渲染后调度尚未实现。

- [ ] **Step 3: 实现三秒内完成的主时间线**

```javascript
timeline
  .from('.dashboard-sidebar', { x: -18, opacity: 0, duration: 0.45 })
  .from('.dashboard-hero-copy > *', { y: 18, opacity: 0, stagger: 0.08 }, '-=0.2')
  .from('.dashboard-progress li', { x: 12, opacity: 0, stagger: 0.08 }, '<')
  .from('.dashboard-metric', { y: 20, opacity: 0, stagger: 0.08 }, '-=0.15')
  .from('.declaration-curve-panel', { y: 18, opacity: 0 }, '-=0.2')
  .from('.recommendation-panel', { x: 18, opacity: 0 }, '<+0.08')
  .from('.optimization-flow li', { y: 10, opacity: 0, stagger: 0.06 }, '-=0.15');
```

对两条 SVG 路径读取 `getTotalLength()`，设置 `strokeDasharray` 与 `strokeDashoffset` 后归零；对指标文本用 `parseMetricText()` 保留前缀、小数位和后缀，不写死任何数值。`scheduleWorkbenchMotion(root)` 使用 `requestAnimationFrame`，首次完整播放，后续同页重渲染使用 350ms 的局部过渡。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/workbench-motion.test.mjs test/workbench-ui.test.mjs test/declaration-dashboard-view.test.mjs`

Expected: PASS，指标格式保持不变，曲线动画钩子存在，现有工作台测试无回归。

- [ ] **Step 5: 提交**

```bash
git add workbench-motion.js workbench.js test/workbench-motion.test.mjs test/workbench-ui.test.mjs
git commit -m "feat: animate dashboard evidence sequence"
```

### Task 3: 高级材质、微交互和减少动态效果

**Files:**
- Modify: `workbench.css`
- Modify: `test/workbench-motion.test.mjs`

**Interfaces:**
- Consumes: `.motion-ready`、`.motion-settled`、`.is-motion-running` 与现有 dashboard 类名。
- Produces: 高光扫过、指标悬停、主按钮能量边缘、流程脉冲、`prefers-reduced-motion` 完整降级。

- [ ] **Step 1: 写材质与降级失败测试**

```javascript
test('motion css includes reduced-motion final-state fallback', async () => {
  const css = await readFile(new URL('../workbench.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-duration:\s*0\.01ms/);
  assert.match(css, /\.recommendation-panel::after/);
  assert.match(css, /\.dashboard-metric:hover/);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test --test-name-pattern="motion css" test/workbench-motion.test.mjs`

Expected: FAIL，原因是动效材质和降级规则不存在。

- [ ] **Step 3: 实现克制的视觉反馈**

```css
.recommendation-panel::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  transform: translateX(-120%);
  background: linear-gradient(105deg, transparent 36%, rgb(255 255 255 / 0.72) 50%, transparent 64%);
}

.dashboard-metric:hover {
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

主按钮只在 `.motion-settled` 后启用低振幅边缘高光；流程连线只播放一次。所有可点击元素保留 `:focus-visible`，动效不改变内容顺序和点击区域。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/workbench-motion.test.mjs test/workbench-ui.test.mjs test/declaration-dashboard-view.test.mjs test/server-static-mime.test.mjs`

Expected: PASS，CSS 降级和原有功能同时成立。

- [ ] **Step 5: 提交**

```bash
git add workbench.css test/workbench-motion.test.mjs
git commit -m "feat: polish dashboard motion interactions"
```

### Task 4: 真实 Chrome 验收与 main 交付

**Files:**
- Modify: `STATUS.md` only if this repository's status policy requires recording evidence.

**Interfaces:**
- Consumes: `http://127.0.0.1:5177/?demo=reviewable`、用户当前 Chrome、1920×1080 验收视口。
- Produces: 真实页面尺寸、动效状态、交互结果、控制台日志与 Git 推送证据。

- [ ] **Step 1: 运行完整相关测试和静态检查**

Run: `node --test test/workbench-motion.test.mjs test/workbench-ui.test.mjs test/declaration-dashboard-view.test.mjs test/server-static-mime.test.mjs && git diff --check`

Expected: 全部 PASS，`git diff --check` 无错误。

- [ ] **Step 2: 在真实 Chrome 完整验收**

刷新 `/?demo=reviewable`，验证：首次进入 3 秒内稳定；曲线覆盖率不低于 90%；96 点与 13 锚点仍存在；右侧按钮可见；导航、人工复核、审计切换和曲线聚焦可用；连续刷新三次无时间线叠加；控制台 0 错误。

- [ ] **Step 3: 验证减少动态效果**

在 1920×1080 临时启用 `prefers-reduced-motion: reduce`，确认页面直接呈现终态且内容、按钮、曲线均可见；验收后恢复默认视口与动态设置。

- [ ] **Step 4: 合并并推送 main**

```bash
git status --short
git branch --show-current
git push origin main
git ls-remote --heads origin main
```

Expected: 当前分支为 `main`，远端 `main` 指向最终提交，用户已有无关改动未被暂存或覆盖。
