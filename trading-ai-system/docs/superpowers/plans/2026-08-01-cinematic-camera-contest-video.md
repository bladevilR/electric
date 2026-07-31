# AI 电力交易副驾驶电影感运镜成片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一支 195–210 秒、具有局部推近和连续横移运镜、字幕醒目、旁白无莫名空停、策略验证表述正式且结尾不重复年化金额的参赛成片。

**Architecture:** 保留真实 Playwright 页面操作、Qwen3-TTS 和 FFmpeg 合成链路；新增独立摄影机数学模块，把变换只施加到 `#workbenchRoot`，字幕和录制标识留在固定叠加层。制作顺序改为先生成四段连续旁白、根据真实音频时长计算镜头预算，再录制页面和混音，避免旁白提前结束。

**Tech Stack:** Node.js ESM、原生 `node:test`、Playwright、CSS/Web Animations API、Qwen3-TTS 1.7B CustomVoice、FFmpeg/ffprobe。

## Global Constraints

- 最终成片 195–210 秒，绝不超过比赛 5 分钟上限。
- 页面真实入口保持 `/?demo=settled`；本地演示数据不得冒充生产收益。
- 相机缩放范围 1–1.26；推近 750–1100ms，连续横移 900–1200ms。
- 相机定位失败必须终止录制，不得静默退回固定全屏。
- 字幕正文字号至少 34px、最多两行、最大宽度 1440px，字幕层不得随相机缩放。
- 统一使用“策略版本验证中心、现行策略、候选优化策略、实时并行验证”；不单独显示 Champion/Challenger 或“影子运行”。
- 实时并行验证必须明确“使用同一交易日数据同步计算，只做结果对比，不参与真实申报”。
- 633.6 万元只在价值章节出现一次；结尾不重复年化金额。
- Qwen3-TTS 固定 Serena、seed `20260731`、同一 instruct；任一速度适配不得超过 1.15。
- 不点击真实提交按钮，不自动启用策略，不自动发送钉钉。
- 保留工作区现有未提交 `README.md`、`deploy/`、`data/standard-96.sample.json` 等其他工作，不得混入本轮提交。

---

### Task 1: 正规化策略验证页面和叙事

**Files:**
- Modify: `workbench.js`
- Modify: `recording/demo-plan.json`
- Test: `test/workbench-ui.test.mjs`
- Test: `test/demo-recording.test.mjs`

**Interfaces:**
- Consumes: 现有 `strategyEvolutionView(payload)` 和 `recording/demo-plan.json`。
- Produces: 正式术语页面；四个连续 `narrationChapter`；只出现一次的年化金额；14–18 秒策略验证段。

- [ ] **Step 1: 写术语和叙事失败测试**

在 `test/workbench-ui.test.mjs` 断言策略页面包含：

```js
assert.match(html, /策略版本验证中心/);
assert.match(html, /现行策略/);
assert.match(html, /候选优化策略/);
assert.match(html, /实时并行验证/);
assert.match(html, /不参与真实申报/);
assert.doesNotMatch(html, /CHAMPION|CHALLENGER|影子运行/i);
```

在 `test/demo-recording.test.mjs` 断言：

```js
const allNarration = [
  plan.intro.narration,
  ...plan.steps.map((step) => step.narration),
  plan.outro.narration,
].join('');
assert.equal((allNarration.match(/633\.6/g) || []).length, 1);
assert.match(allNarration, /历史回测.*实时并行验证.*人工审批/s);
assert.doesNotMatch(allNarration, /影子运行|Champion|Challenger/i);
assert.doesNotMatch(plan.outro.narration, /633\.6|6,336,000/);
```

- [ ] **Step 2: 运行测试确认旧术语失败**

Run: `node --test test/workbench-ui.test.mjs test/demo-recording.test.mjs`

Expected: FAIL，旧页面仍显示 Champion/Challenger，旧结尾仍重复 633.6 万元。

- [ ] **Step 3: 修改页面和旁白**

将页面标题和卡片改为：

```text
策略版本验证中心
现行策略 · 当前审批启用版本
候选优化策略 · 待验证版本
历史回测 → 实时并行验证 → 指标对比 → 人工审批
实时并行验证使用同一交易日数据同步计算，只做结果对比，不参与真实申报。
```

把旁白合并为四章：`chapter-value`、`chapter-data`、`chapter-decision`、`chapter-close`。策略验证旁白必须解释现行策略与候选策略的关系，结尾改为：

```text
AI负责计算与解释，交易员负责最终决策。让每次申报都可执行、可复核、可追溯。
```

- [ ] **Step 4: 运行测试并提交**

Run: `node --test test/workbench-ui.test.mjs test/demo-recording.test.mjs`

Expected: PASS。

Commit:

```bash
git add workbench.js recording/demo-plan.json test/workbench-ui.test.mjs test/demo-recording.test.mjs
git commit -m "feat: clarify candidate strategy validation"
```

---

### Task 2: 增加可测试的电影感摄影机数学模块

**Files:**
- Create: `recording/local/lib/cinematic-camera.mjs`
- Modify: `recording/lib/demo-plan.mjs`
- Test: `test/local-demo-video.test.mjs`
- Test: `test/demo-recording.test.mjs`

**Interfaces:**
- Consumes: 分镜 `camera` 配置、1920×1080 视口和目标 DOM 矩形。
- Produces: `normalizeCameraSpec(raw, label)`；`computeCameraTransform(input)`；`cameraTransformCss(transform)`。

- [ ] **Step 1: 写摄影机配置和边界失败测试**

```js
const camera = normalizeCameraSpec({
  scale: 1.18,
  focus: [{ type: 'css', value: '.savings-projection-grid' }],
  enterMs: 900,
  exit: 'connect',
  motionBlur: 0.16,
}, 'savings.camera');
assert.equal(camera.scale, 1.18);
assert.throws(() => normalizeCameraSpec({ scale: 1.3, focus: [] }, 'bad.camera'));

const transform = computeCameraTransform({
  viewportWidth: 1920,
  viewportHeight: 1080,
  focusRect: { x: 1200, y: 240, width: 400, height: 260 },
  scale: 1.2,
});
assert.equal(transform.scale, 1.2);
assert.ok(transform.x <= 0 && transform.y <= 0);
assert.match(cameraTransformCss(transform), /translate3d\(.+\) scale\(1\.2\)/);
```

- [ ] **Step 2: 运行测试确认模块不存在**

Run: `node --test test/local-demo-video.test.mjs test/demo-recording.test.mjs`

Expected: FAIL，缺少摄影机模块且计划校验会丢弃 `camera` 字段。

- [ ] **Step 3: 实现纯函数模块并保留 MIT 来源**

`cinematic-camera.mjs` 文件头注明算法设计参考 OpenScreen MIT。实现：

```js
export const MAX_CAMERA_SCALE = 1.26;

export function computeCameraTransform({
  viewportWidth,
  viewportHeight,
  focusRect,
  scale,
}) {
  const focusX = focusRect.x + focusRect.width / 2;
  const focusY = focusRect.y + focusRect.height / 2;
  const rawX = viewportWidth / 2 - focusX * scale;
  const rawY = viewportHeight / 2 - focusY * scale;
  return {
    scale,
    x: Math.min(0, Math.max(viewportWidth - viewportWidth * scale, rawX)),
    y: Math.min(0, Math.max(viewportHeight - viewportHeight * scale, rawY)),
  };
}
```

`normalizeCameraSpec` 只接受 `scale` 1–1.26、`enterMs` 750–1100、`exit` 为 `connect|reset`、`motionBlur` 0–0.25，并复用计划定位器校验。

- [ ] **Step 4: 把 camera 字段纳入计划校验**

`normalizeStep` 返回：

```js
camera: normalizeCameraSpec(step.camera, `${id}.camera`)
```

每个非纯标题步骤必须提供 camera；缺失、空定位器或越界缩放立即报错。

- [ ] **Step 5: 运行测试并提交**

Run: `node --test test/local-demo-video.test.mjs test/demo-recording.test.mjs`

Expected: PASS。

Commit: `git add recording/local/lib/cinematic-camera.mjs recording/lib/demo-plan.mjs test && git commit -m "feat: add deterministic cinematic camera model"`

---

### Task 3: 重做醒目字幕的拆句和视觉主题

**Files:**
- Modify: `recording/local/lib/video-production.mjs`
- Modify: `recording/local/record-browser-video.mjs`
- Test: `test/local-demo-video.test.mjs`

**Interfaces:**
- Consumes: 每个 segment 的旁白和镜头时长。
- Produces: `splitCaptionCues(text, options)`；`buildTimedCaptionCues(segment)`；`buildRunCodeForTest(segment, step)`；固定字幕层 CSS。

- [ ] **Step 1: 写字幕拆句和主题失败测试**

```js
const cues = splitCaptionCues(longChineseText, {
  maxCharsPerLine: 24,
  maxLines: 2,
});
assert.ok(cues.length >= 2);
assert.ok(cues.every((cue) => cue.lines.length <= 2));
assert.ok(cues.every((cue) => cue.lines.every((line) => [...line].length <= 24)));

const source = browserRecording.buildRunCodeForTest(segment, step);
assert.match(source, /font:\s*650 36px\/1\.42/);
assert.match(source, /max-width:\s*1440px/);
assert.match(source, /#workbenchRoot/);
assert.match(source, /local-demo-caption-keyword/);
```

- [ ] **Step 2: 运行测试确认旧整段小字幕失败**

Run: `node --test test/local-demo-video.test.mjs`

Expected: FAIL，旧字幕一次展示整段旁白且字号小于 34px。

- [ ] **Step 3: 实现短句字幕分配**

`splitCaptionCues` 优先按 `。！？；` 拆句，再按 `，、：` 拆分超长句；每个 cue 最多 48 个汉字并带 `lines`。`buildTimedCaptionCues` 按字符权重分配 segment 可用时长，每条至少 1200ms。

- [ ] **Step 4: 重写字幕 DOM 和 CSS**

固定字幕层使用：

```css
width: min(1440px, calc(100vw - 240px));
bottom: 50px;
padding: 24px 34px 25px;
background: rgba(7, 25, 48, .92);
backdrop-filter: blur(24px) saturate(1.15);
border: 1px solid rgba(112, 196, 255, .28);
border-radius: 18px;
box-shadow: 0 24px 70px rgba(0, 18, 42, .34);
font: 650 36px/1.42 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
```

对金额、`96 点`、`人工审批`、`实时并行验证`生成安全的 `<span class="local-demo-caption-keyword">`，只允许预定义关键词，其他文本继续使用 `textContent` 防止 HTML 注入。

导出只用于测试的 `buildRunCodeForTest(segment, step)`，直接调用内部 `buildRunCode(segment, step)`，让测试能够检查生成给 Playwright 的真实脚本，而不是复制一份样式字符串。

- [ ] **Step 5: 运行测试并提交**

Run: `node --test test/local-demo-video.test.mjs`

Expected: PASS。

Commit:

```bash
git add recording/local/lib/video-production.mjs recording/local/record-browser-video.mjs test/local-demo-video.test.mjs
git commit -m "feat: add cinematic readable captions"
```

---

### Task 4: 在真实 Playwright 录制中执行连续运镜

**Files:**
- Modify: `recording/local/record-browser-video.mjs`
- Modify: `recording/demo-plan.json`
- Test: `test/local-demo-video.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 camera spec、运行时目标矩形、Task 3 的 timed caption cues。
- Produces: 相机变换写入 `timeline.json` 的 `camera` 证据；10–14 次可见运镜。

- [ ] **Step 1: 写连续运镜和失败行为测试**

断言生成的浏览器脚本：

```js
assert.match(source, /camera target not found/i);
assert.match(source, /workbenchRoot\.animate/);
assert.match(source, /transformOrigin = ['"]0 0['"]/);
assert.match(source, /exit === ['"]connect['"]/);
```

并断言 shipped plan 的 camera scale 全部 `<=1.26`、运镜步骤为 10–14 个、连续局部镜头不超过 2 个。

- [ ] **Step 2: 运行测试确认旧录制器没有相机**

Run: `node --test test/local-demo-video.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现页面主体相机动画**

在 `ensureOverlay` 中初始化 `window.__localDemoVideo.camera`。ready 元素出现后解析 camera focus 定位器，读取 `boundingBox()`，计算 transform，并通过 Web Animations API 对 `#workbenchRoot` 执行动画。字幕、徽标和章节标签均不在 `#workbenchRoot` 内。

使用 `cubic-bezier(.16,1,.3,1)` 作为推近曲线；`connect` 从上一 transform 直接横移，`reset` 回到 `{scale:1,x:0,y:0}`。目标不存在、不可见、矩形为空或根节点缺失时抛错终止。

- [ ] **Step 4: 为 10–14 个镜头配置焦点**

至少覆盖金额卡、数据门禁、预测证据、96 点曲线、AI 建议、成本公式、人工复核、结算金额、现行策略、候选优化策略、验证路径。intro/outro 强制 reset。

- [ ] **Step 5: 运行 smoke 并抽帧检查**

Run: `node recording/local/produce-video.mjs --smoke`

Expected: 所有镜头定位成功；smoke 时间线的每个业务镜头记录 camera scale/focus；无固定全屏静默降级。

- [ ] **Step 6: 提交**

Commit:

```bash
git add recording/local/record-browser-video.mjs recording/demo-plan.json test/local-demo-video.test.mjs
git commit -m "feat: record connected cinematic camera moves"
```

---

### Task 5: 用真实 TTS 时长反推镜头预算

**Files:**
- Modify: `recording/local/lib/video-production.mjs`
- Modify: `recording/local/render-narration.mjs`
- Modify: `recording/local/produce-video.mjs`
- Test: `test/local-demo-video.test.mjs`

**Interfaces:**
- Consumes: 四章 Qwen WAV 真实 `durationMs` 和每章源 segment 文本权重。
- Produces: `pacePlanFromSpeech(plan, speech, options)`；先 TTS、后录制、再混音的 `all` 阶段。

- [ ] **Step 1: 写音频优先节奏失败测试**

```js
const paced = pacePlanFromSpeech(plan, [
  { id: 'chapter-value', durationMs: 42000 },
  { id: 'chapter-data', durationMs: 39000 },
  { id: 'chapter-decision', durationMs: 66000 },
  { id: 'chapter-close', durationMs: 42000 },
], { breathMsPerSegment: 550 });
assert.ok(paced.durationMs >= 195000 && paced.durationMs <= 210000);
assert.ok(paced.chapters.every((chapter) => chapter.trailingSilenceMs <= 1200));
```

断言 `buildProductionStages('all')` 的顺序为 `['speech','record','mix','final']`。

- [ ] **Step 2: 运行测试确认旧流程先录制后 TTS**

Run: `node --test test/local-demo-video.test.mjs`

Expected: FAIL，旧顺序是 `record,tts,final`，且没有 `pacePlanFromSpeech`。

- [ ] **Step 3: 拆分旁白生成与混音**

从 `renderNarration` 提取：

```js
export async function generateNarrationSpeech({ projectRoot, timeline, paths, log, fitToTimeline = false })
export async function mixNarration({ projectRoot, timeline, paths, speech, log })
```

`speech` 阶段只生成四个 WAV 和探测时长，不按旧镜头强制提速；`mix` 阶段复用同一 WAV，生成字幕和 48kHz 双声道音轨。

- [ ] **Step 4: 实现 pacePlanFromSpeech**

按每章源 segment 字符权重分配音频时长，每个业务镜头增加 550ms 呼吸时间；动作最短镜头 6500ms。intro/outro 也由各自文本权重得到预算。返回 paced plan、introMs、outroMs、总时长和每章 trailing silence；任一 trailing silence 超过 1200ms 或总时长不在 195–210 秒时明确失败。

- [ ] **Step 5: 重排 all 制作阶段**

制作顺序固定为：

```text
speech → pace plan → record → mix → final
```

`--stage record` 若找不到有效 TTS metadata，必须提示先运行 `--stage speech`，不能回退静态 holdMs。

- [ ] **Step 6: 运行测试并提交**

Run: `node --test test/local-demo-video.test.mjs test/demo-recording.test.mjs`

Expected: PASS。

Commit:

```bash
git add recording/local/lib/video-production.mjs recording/local/render-narration.mjs recording/local/produce-video.mjs test/local-demo-video.test.mjs test/demo-recording.test.mjs
git commit -m "feat: pace contest recording from real narration"
```

---

### Task 6: 完整生产、真实验收和交付

**Files:**
- Modify: `output/video/timeline.json`
- Modify: `output/video/subtitles.srt`
- Modify: `output/video/narration/qwen-manifest.json`
- Modify: `output/video/narration/metadata.json`
- Modify: `output/video/final-probe.json`
- Modify: `output/video/验收报告.md`
- Modify: `../STATUS.md`
- Replace: `output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`

**Interfaces:**
- Consumes: 前五项全部通过的录制和旁白管线。
- Produces: 可直接审片的最终 MP4、关键帧、媒体证据和中文验收报告。

- [ ] **Step 1: 生成全新四章 TTS 和成片**

Run: `node recording/local/produce-video.mjs`

Expected: 先生成四章 Serena WAV，再按真实时长录制，最终输出新 MP4。

- [ ] **Step 2: 验证媒体规格和音频**

Run:

```bash
ffprobe -v error -show_entries \
  format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels \
  -of json 'output/video/电力交易AI-智能交易副驾驶-参赛版.mp4'
```

Expected: 195–210 秒、1920×1080、30fps、H.264、AAC、48kHz 双声道。

使用 `ffmpeg -af ebur128=peak=true` 验证综合响度和 True Peak，无削波。

- [ ] **Step 3: 抽帧验收运镜和字幕**

从金额、数据、预测、曲线、证据、人工复核、结算、现行策略、候选策略、验证路径和结尾各抽至少一帧。生成 contact sheet，并用图像检查：

- 字幕正文字号醒目、最多两行、重点词有高亮。
- 字幕没有随页面放大，也没有遮住金额、公式或审批状态。
- 局部镜头无裁切越界、白屏、跳变或模糊残留。
- 策略页面用正式中文术语并完整显示验证链路。
- 结尾没有 633.6 万元。

- [ ] **Step 4: 验证节奏和文案约束**

读取 timeline 和 TTS metadata，断言 10–14 次运镜、最大 scale `<=1.26`、四章尾部静音均 `<=1200ms`、策略验证段 14–18 秒、字幕和旁白中 633.6 只出现一次、无 Champion/Challenger/影子运行。

- [ ] **Step 5: 跑回归**

Run:

```bash
node --test \
  test/workbench-ui.test.mjs \
  test/savings-workbench.test.mjs \
  test/demo-recording.test.mjs \
  test/local-demo-video.test.mjs
```

Expected: PASS。另跑 `test/server-contract.test.mjs`；若仍仅因既存外部历史夹具缺失失败，验收报告必须如实记录。

- [ ] **Step 6: 按真实环境验收规范更新报告和 STATUS**

使用 `/Users/r/.codex/skills/real-env-acceptance/SKILL.md`，报告分为 ✅通过项、❌未通过项、⚠️未验证项，并附 ffprobe、测试输出、关键帧和 SHA-256。

- [ ] **Step 7: 提交最终成片**

只暂存本轮文件，确认未包含 `README.md`、`deploy/`、`.codegraph/` 等旁支改动后提交：

```bash
git commit -m "feat: deliver cinematic AI electricity trading film"
```
