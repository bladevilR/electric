# AI 电力交易副驾驶参赛视频重制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一支约 3 分 40 秒、以“AI 帮助企业降低电力交易成本”为主线、金额可核算且 TTS 声线统一的 1920×1080 参赛成片。

**Architecture:** 保留现有 Playwright 真实页面录制和 FFmpeg 合成管线，先修正结算演示数据并把单日/月度/年度成本优化额做成可展开的视觉高潮；再将录制计划改成七章业务叙事，并把逐镜头 TTS 改成五个连续章节。所有演示金额都带口径标签，字幕和时间线从最终章节音频重新生成。

**Tech Stack:** Node.js ESM、原生 `node:test`、Playwright、Qwen3-TTS 1.7B CustomVoice、Python/PyTorch、FFmpeg/ffprobe、HTML/CSS。

## Global Constraints

- 成片目标时长 3:35–3:55，绝不超过比赛规定的 5 分钟。
- 主角是帮助企业省钱的 AI 电力交易副驾驶；策略 Champion/Challenger 镜头不超过总时长 10%。
- 演示金额必须标注“按当前演示交易规模等比例测算”，不得冒充生产收益。
- 单日公式固定为 `1,302,400 - 1,258,520 - 8,520 - 10,800 - 560 = 24,000` 元。
- 月度测算为 `24,000 × 22 = 528,000` 元；年度测算为 `24,000 × 264 = 6,336,000` 元。
- TTS 使用同一模型、Serena speaker、同一随机种子、同一风格指令，按五个连续章节生成。
- 不通过超过 1.15 倍的明显提速强塞旁白；优先增加镜头停留或精简文案。
- 录制规格固定为 1920×1080、30 fps；最终音频为 AAC 48 kHz。
- 不新增假按钮，不自动提交申报，不自动外发钉钉。

---

### Task 1: 修正并可视化成本优化金额

**Files:**
- Modify: `workbench.js`
- Modify: `workbench.css`
- Test: `test/workbench-ui.test.mjs`

**Interfaces:**
- Consumes: `buildDemoWorkbenchScenario(payload, scenario)` 的 `settled` 演示场景。
- Produces: `buildSavingsProjection(dailyYuan, { monthlyTradingDays, annualTradingDays })`，返回 `{ dailyYuan, monthlyYuan, annualYuan, monthlyTradingDays, annualTradingDays }`；`savingsHero(payload)` 展示三个金额和演示口径。

- [x] **Step 1: 写金额公式和展示的失败测试**

在 `test/workbench-ui.test.mjs` 增加断言：

```js
const settled = module.buildDemoWorkbenchScenario(
  module.buildStandaloneDemoWorkbenchPayload(),
  'settled'
);
const costs = settled.savings.costs;
const recomputed =
  costs.baselineCostYuan -
  costs.actualSettlementCostYuan -
  costs.transactionFeesYuan -
  costs.deviationCostYuan -
  costs.systemOperatingCostYuan;
assert.equal(recomputed, 24_000);
assert.equal(settled.savings.realizedNetYuan, recomputed);
assert.deepEqual(settled.savings.projection, {
  dailyYuan: 24_000,
  monthlyYuan: 528_000,
  annualYuan: 6_336_000,
  monthlyTradingDays: 22,
  annualTradingDays: 264,
});
const html = module.renderWorkbenchMarkup(settled, {
  mode: 'operation',
  activeStage: 'settle',
  evidenceOpen: false,
});
assert.match(html, /¥24,000/);
assert.match(html, /¥528,000/);
assert.match(html, /¥6,336,000/);
assert.match(html, /演示交易规模等比例测算/);
```

- [x] **Step 2: 运行测试确认旧明细失败**

Run: `node --test test/workbench-ui.test.mjs`

Expected: FAIL，旧场景五项明细复算为 14,000 元，且没有月度/年度 projection。

- [x] **Step 3: 实现金额投影和自洽演示数据**

在 `workbench.js` 导出：

```js
export function buildSavingsProjection(
  dailyYuan,
  { monthlyTradingDays = 22, annualTradingDays = 264 } = {}
) {
  const daily = Number(dailyYuan);
  if (!Number.isFinite(daily)) return null;
  return {
    dailyYuan: daily,
    monthlyYuan: daily * monthlyTradingDays,
    annualYuan: daily * annualTradingDays,
    monthlyTradingDays,
    annualTradingDays,
  };
}
```

将 `settled` 场景的 `actualSettlementCostYuan` 改为 `1_258_520`，由五项明细复算 `realizedNetYuan`，并写入 `savings.projection`。在 `savingsHero` 中加入单日、月度、年度三项视觉层级和“演示交易规模等比例测算，非已实现生产收益”标签；在证据链保留五项公式。

- [x] **Step 4: 增加聚焦成本结果的样式**

在 `workbench.css` 增加 `.savings-projection-grid`、`.savings-projection-item`、`.savings-scope-note`，确保 1920×1080 录制时三项金额同屏且不被底部字幕遮挡。

- [x] **Step 5: 运行测试并提交**

Run: `node --test test/workbench-ui.test.mjs test/savings-workbench.test.mjs`

Expected: PASS。

Commit: `git commit -am "fix: make contest savings evidence mathematically consistent"`

---

### Task 2: 将录制管线升级为五分钟上限和新成片名称

**Files:**
- Modify: `recording/local/lib/video-production.mjs`
- Modify: `recording/local/render-final.mjs`
- Modify: `recording/local/produce-video.mjs`
- Test: `test/local-demo-video.test.mjs`

**Interfaces:**
- Consumes: 最终时间线的真实 `durationMs`。
- Produces: `buildFfmpegArgs(..., maxDurationSeconds: 300)`；新成片路径 `output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`。

- [x] **Step 1: 写时长和输出路径失败测试**

将测试期望更新为：

```js
assert.equal(
  paths.finalVideo,
  '/tmp/electric/output/video/电力交易AI-智能交易副驾驶-参赛版.mp4'
);
const capped = buildFfmpegArgs({
  rawVideo: '/tmp/raw.webm',
  narrationAudio: '/tmp/narration.wav',
  finalVideo: '/tmp/final.mp4',
  durationSeconds: 360,
  maxDurationSeconds: 300,
});
assert.deepEqual(
  capped.slice(capped.indexOf('-t'), capped.indexOf('-t') + 2),
  ['-t', '300.000']
);
```

- [x] **Step 2: 运行测试确认旧 130 秒上限失败**

Run: `node --test test/local-demo-video.test.mjs`

Expected: FAIL，旧输出名仍含“两分钟”，旧上限仍为 130 秒。

- [x] **Step 3: 更新输出和合成上限**

在 `buildOutputPaths` 使用新文件名；`renderFinalVideo` 明确传入 `maxDurationSeconds: 300`；`produce-video.mjs` 将非 smoke 计划校验改为：

```js
if (!args.smoke && (skeleton.durationMs < 215_000 || skeleton.durationMs > 235_000)) {
  throw new Error(`计划时长必须在 3:35–3:55：${skeleton.durationMs}ms`);
}
```

- [x] **Step 4: 运行测试并提交**

Run: `node --test test/local-demo-video.test.mjs`

Expected: PASS。

Commit: `git commit -am "feat: support award-length contest video output"`

---

### Task 3: 将逐镜头 TTS 改成五个连续章节

**Files:**
- Modify: `recording/local/lib/video-production.mjs`
- Modify: `recording/local/render-narration.mjs`
- Modify: `recording/local/qwen-tts-render.py`
- Test: `test/local-demo-video.test.mjs`

**Interfaces:**
- Consumes: 时间线 segment 的 `narrationChapter`、`narration`、`startMs`、`endMs`。
- Produces: `buildNarrationChapters(timeline)`，每章包含 `{ id, text, sourceSegments, startMs, endMs }`；Qwen manifest 恰好五个输出 WAV；字幕按章内句子字符权重分配时间。

- [x] **Step 1: 写五章清单和字幕时间失败测试**

构造含五个 `narrationChapter` 的时间线并断言：

```js
const chapters = buildNarrationChapters(timeline);
assert.equal(chapters.length, 5);
assert.deepEqual(chapters[0].sourceSegmentIds, ['intro', 'opening']);
const manifest = buildQwenTtsManifest(timeline, '/tmp/narration');
assert.equal(manifest.segments.length, 5);
assert.equal(manifest.segments[0].output, '/tmp/narration/chapter-cost.wav');
```

增加 `buildChapterCaptionSegments(chapter, durationMs)` 断言：字幕首尾不越过章节音频，并保留原句顺序。

- [x] **Step 2: 运行测试确认旧逐镜头 manifest 失败**

Run: `node --test test/local-demo-video.test.mjs`

Expected: FAIL，旧 manifest 仍按每个 segment 输出 WAV。

- [x] **Step 3: 实现章节分组、混音和字幕**

`buildNarrationChapters` 按连续的 `narrationChapter` 分组；同章文本使用中文句号连接。`renderNarration` 只生成和混入五个章节 WAV，并使用章节实际时长生成章内字幕。每章音频安全区覆盖该章首个镜头开始到末个镜头结束。

- [x] **Step 4: 限制提速并记录质量元数据**

将允许提速上限从 `1.45` 降为 `1.15`。`metadata.json` 为每章记录 `seed`、`speaker`、`durationMs`、`speedFactor`、`sourceSegmentIds`；未提速时 `speedFactor` 为 `1`。

- [x] **Step 5: 运行测试并提交**

Run: `node --test test/local-demo-video.test.mjs`

Expected: PASS，manifest 恰好五章，所有字幕位于对应章的音频时间内。

Commit: `git commit -am "feat: render narration as five consistent chapters"`

---

### Task 4: 重写完整文案与自动录制分镜

**Files:**
- Modify: `recording/demo-plan.json`
- Modify: `recording/local/lib/video-production.mjs`
- Modify: `recording/local/produce-video.mjs`
- Modify: `test/demo-recording.test.mjs`
- Modify: `test/local-demo-video.test.mjs`

**Interfaces:**
- Consumes: 现有可观察 DOM 定位器和 `/?demo=reviewable`、`/?demo=settled` 演示入口。
- Produces: 七章业务分镜、五个 `narrationChapter`、总展示预算 215–235 秒。

- [ ] **Step 1: 写 shipped plan 的失败断言**

断言计划：

```js
assert.match(plan.title, /智能交易副驾驶/);
assert.ok(plan.totalHoldMs >= 190_000);
assert.ok(plan.totalHoldMs <= 210_000);
assert.equal(new Set(plan.steps.map((step) => step.narrationChapter)).size, 5);
assert.ok(plan.steps.some((step) => /24,000|2\.4 万/.test(step.narration)));
assert.ok(plan.steps.some((step) => /6,336,000|633\.6 万/.test(step.narration)));
const evolutionHoldMs = plan.steps
  .filter((step) => step.id.includes('evolution'))
  .reduce((sum, step) => sum + step.holdMs, 0);
assert.ok(evolutionHoldMs / plan.totalHoldMs <= 0.1);
```

- [ ] **Step 2: 运行测试确认旧策略中心叙事失败**

Run: `node --test test/demo-recording.test.mjs test/local-demo-video.test.mjs`

Expected: FAIL，旧计划仅 64.7 秒展示预算且策略进化占比过高。

- [ ] **Step 3: 重写七章镜头和旁白**

将计划改为以下镜头序列，所有动作继续使用可观察 `ready` 条件：

1. 成本问题与年度节约潜力。
2. 数据接入和质量门禁。
3. 负荷、价格预测及关键时段。
4. 96 点申报优化和成本改善。
5. 成本证据链与人工复核。
6. 结算已核验、单日/月度/年度金额和审计。
7. 不超过 20 秒的策略持续迭代与价值收束。

删除 `produce-video.mjs` 中覆盖 JSON 文案的 `LOCAL_NARRATION`，保证文案只有 `demo-plan.json` 一个来源。开场和结尾文案由 `buildTimelineSkeleton` 从计划的 `intro`、`outro` 字段读取，不再硬编码旧“策略自进化”文案。

- [ ] **Step 4: 验证计划安全性和时长**

Run: `node recording/run-demo-tour.mjs --validate-only --plan recording/demo-plan.json`

Expected: `ok: true`，展示预算 190–210 秒，所有步骤都有可观察 ready 条件，且不存在自动申报定位器。

- [ ] **Step 5: 运行测试并提交**

Run: `node --test test/demo-recording.test.mjs test/local-demo-video.test.mjs test/workbench-ui.test.mjs`

Expected: PASS。

Commit: `git commit -am "feat: rewrite contest tour around measurable cost savings"`

---

### Task 5: 录制、合成与真实验收

**Files:**
- Modify: `output/video/timeline.json`
- Modify: `output/video/subtitles.srt`
- Modify: `output/video/narration/qwen-manifest.json`
- Modify: `output/video/narration/metadata.json`
- Create: `output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`
- Modify: `output/video/验收报告.md`
- Modify: `../STATUS.md`

**Interfaces:**
- Consumes: 通过测试的页面、分镜和五章 TTS 管线。
- Produces: 可播放成片、媒体探测数据、关键帧证据、验收报告和 STATUS 证据。

- [ ] **Step 1: 运行录制 smoke**

Run: `node recording/local/produce-video.mjs --smoke`

Expected: 浏览器镜头可录制、五章 manifest 可生成、smoke 成片成功，不出现定位器超时。

- [ ] **Step 2: 运行完整成片生产**

Run: `node recording/local/produce-video.mjs`

Expected: 生成 `output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`、字幕、五章 WAV、时间线和 `final-probe.json`。

- [ ] **Step 3: 媒体参数和时长验收**

Run:

```bash
ffprobe -v error \
  -show_entries format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels \
  -of json 'output/video/电力交易AI-智能交易副驾驶-参赛版.mp4'
```

Expected: 215–235 秒、1920×1080、30 fps、H.264、AAC、48 kHz。

- [ ] **Step 4: 抽取关键帧并检查章节覆盖**

按时间线从七章各抽取至少一张截图，生成 contact sheet；确认开头无白屏、金额卡显示 24,000/528,000/6,336,000、证据公式完整、策略进化不喧宾夺主、结尾未裁切。

- [ ] **Step 5: 检查音频一致性和字幕**

检查 `metadata.json` 恰好五章、speaker/seed/instruct 一致、任一 `speedFactor <= 1.15`；完整播放旁白，确认无明显换人、爆音、吞字和字幕错位。

- [ ] **Step 6: 跑回归测试**

Run:

```bash
node --test \
  test/workbench-ui.test.mjs \
  test/savings-workbench.test.mjs \
  test/demo-recording.test.mjs \
  test/local-demo-video.test.mjs \
  test/server-contract.test.mjs
```

Expected: PASS。

- [ ] **Step 7: 写入验收证据并提交**

在 `output/video/验收报告.md` 记录命令、参数、时长、章节截图、TTS 元数据和 SHA-256；在 `../STATUS.md` 更新最新成片路径和仍存在的 Windows 实机验收缺口。

Commit: `git add trading-ai-system/output/video trading-ai-system/recording trading-ai-system/test trading-ai-system/workbench.js trading-ai-system/workbench.css STATUS.md && git commit -m "feat: deliver AI electricity trading contest film"`
