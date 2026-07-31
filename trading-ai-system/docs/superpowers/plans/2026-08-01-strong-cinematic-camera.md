# 强电影感产品演示运镜 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一支具有 16–20 个明显多级运镜节拍、无“AI 解说”标签并完成真实播放验收的最终参赛视频。

**Architecture:** 摄影机配置由单目标升级为按时间执行的 beats。页面主体接受变换，字幕层保持固定，使用经 smoke 实测无灰边的 1920×1080 原生录制。

**Tech Stack:** Node.js、Playwright CLI、Chrome CDP、Web Animations API、FFmpeg、Qwen3-TTS。

## Global Constraints

- 原始视频必须经 ffprobe 证明为无灰边 1920×1080；出现信箱或灰边则停止制作。
- 摄影机缩放范围 1.0–1.9；全片 16–20 个节拍，至少 6 个节拍不低于 1.6。
- 字幕不得出现“AI 解说”，正文最终尺寸不小于 36px、最多两行。
- 不改变交易业务逻辑、旁白金额口径或四章 Serena 音频。
- 最终视频必须低于 5 分钟并完成真实播放验收。

---

### Task 1: 多节拍摄影机规格

**Files:**
- Modify: `recording/local/lib/cinematic-camera.mjs`
- Modify: `recording/lib/demo-plan.mjs`
- Test: `test/local-demo-video.test.mjs`
- Test: `test/demo-recording.test.mjs`

**Interfaces:**
- Consumes: `camera.beats[]`，字段为 `at`、`scale`、`focus`、`durationMs`、`motionBlur`。
- Produces: `normalizeCameraSpec(raw, label)` 返回排序后的 beats 与 `exit`。

- [x] **Step 1: 写失败测试**：断言 1.9 合法、1.91 失败、beats 时间递增且 shipped plan 有 16–20 个节拍和至少 6 个 1.6 倍特写。
- [x] **Step 2: 运行测试确认旧单目标结构失败**：`node --test test/local-demo-video.test.mjs test/demo-recording.test.mjs`。
- [x] **Step 3: 实现 beats 校验**：每步 1–3 个 beat，`at` 取 0–0.9，`durationMs` 取 600–1400，focus 必填，exit 为 connect/reset。
- [x] **Step 4: 运行测试并提交**：预期相关测试通过。

### Task 2: 源录制规格实验与连续镜头执行

**Files:**
- Modify: `recording/local/record-browser-video.mjs`
- Modify: `recording/local/lib/video-production.mjs`
- Modify: `recording/local/render-final.mjs`
- Test: `test/local-demo-video.test.mjs`

**Interfaces:**
- Consumes: 1920×1080 CSS 视口、camera beats。
- Produces: 无灰边 1920×1080 VP8 原始视频、逐 beat 的时间线证据、1920×1080 最终 MP4。

- [x] **Step 1: 写失败测试**：生成脚本必须包含 beat 调度和无灰边录制规格。
- [x] **Step 2: 运行测试确认失败**。
- [x] **Step 3: 实现 beat 循环**：按 `at * holdMs` 等待并执行变换，记录每次实际开始、结束和 transform。
- [x] **Step 4: 跑录制规格 smoke**：4K 实验发现右侧灰区后拒绝该方案，改回 1920×1080 原生录制。
- [x] **Step 5: 抽取 smoke 连续帧检查推拉和横移后提交**。

### Task 3: 正式分镜与无标签字幕

**Files:**
- Modify: `recording/demo-plan.json`
- Modify: `recording/local/record-browser-video.mjs`
- Test: `test/demo-recording.test.mjs`
- Test: `test/local-demo-video.test.mjs`

**Interfaces:**
- Consumes: 业务 DOM 定位器和旁白时长。
- Produces: 金额、曲线、建议、证据、人工复核与策略验证的 16–20 个 beats；无标签字幕层。

- [x] **Step 1: 写失败测试**：生成脚本与成片计划不得包含 `AI 解说`，字幕仍为 36px；镜头阈值满足全局约束。
- [x] **Step 2: 运行测试确认失败**。
- [x] **Step 3: 迁移全部镜头并删除标签 DOM**。
- [x] **Step 4: 运行定向测试和 smoke，修复定位、裁切或时间冲突后提交**。

### Task 4: 重录、播放验收与交付

**Files:**
- Replace: `output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`
- Modify: `output/video/timeline.json`
- Modify: `output/video/final-probe.json`
- Modify: `output/video/验收报告.md`
- Modify: `../STATUS.md`

**Interfaces:**
- Consumes: 1080p 原生录屏、四章 Serena WAV、最终镜头计划。
- Produces: 可直接审片的 1080p 最终 MP4 与中文验收证据。

- [x] **Step 1: 录制全片并复用四章旁白混音**。
- [x] **Step 2: 合成最终 H.264/AAC MP4，验证低于 5 分钟、1080p、30fps、48kHz 双声道**。
- [x] **Step 3: 每 4 秒密集抽帧并对关键镜头抽取连续帧，检查运动幅度、裁切、字幕和结尾**。
- [x] **Step 4: 用本机播放器完整播放，检查停顿、声线和页面节奏**。
- [x] **Step 5: 跑全仓 155 项回归并记录 2 项既存外部资产依赖失败，更新验收报告和 STATUS**。
- [x] **Step 6: 提交、合回 main，验证主路径 MP4 SHA-256 后交付**。
