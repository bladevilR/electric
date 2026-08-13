# 电力交易 AI · 两分钟本地模拟演示视频实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 按任务逐项实施；功能代码遵循测试先行；宣称完成前必须执行 `real-env-acceptance` 真实环境验收。

**目标：** 在当前 macOS 上用最新前端和本地演示数据生成一支可直接交付的 2 分钟以内 MP4，包含真实浏览器录屏、中文 TTS、烧录字幕和可复核的验收证据。

**方案：** 复用现有 `recording/demo-plan.json` 的定位器和安全演示路径，用 Playwright 的浏览器上下文录制页面级视频。录制脚本把开场、各演示步骤和结尾的实际时间写入时间线；后期脚本以实际时间线生成 `Tingting` 分段 TTS、SRT 字幕，并用 FFmpeg 合成 H.264/AAC 成片。所有生成物集中在 `output/video/`，失败时保留日志、截图和中间文件。

**技术栈：** Node.js ESM、Playwright/Chromium、macOS `say`、FFmpeg/ffprobe、Node 内置测试框架。

---

## 任务 1：建立可测试的成片时间线模型

**文件：**

- 新建：`recording/local/lib/video-production.mjs`
- 新建：`test/local-demo-video.test.mjs`

**步骤 1：先写失败测试**

测试以下行为：

- 开场、演示步骤、结尾的时间连续且总时长不超过 130 秒。
- 每段旁白都有对应字幕区间，字幕结束不晚于镜头结束。
- 输出文件名安全、稳定，成片与中间文件路径均位于 `output/video/`。
- 演示 URL 必须包含 `demo=reviewable`，禁止误用生产入口。

**步骤 2：运行测试确认失败**

运行：`node --test test/local-demo-video.test.mjs`

预期：因模块尚未实现而失败。

**步骤 3：实现最小时间线模块**

提供：

- 参数与演示计划校验。
- 开场/步骤/结尾片段构建。
- 实际录制时间线归一化。
- SRT 时间格式化与字幕文本生成。
- 输出路径解析。

**步骤 4：运行测试确认通过**

运行：`node --test test/local-demo-video.test.mjs`

预期：全部通过。

## 任务 2：实现真实浏览器录制

**文件：**

- 新建：`recording/local/record-browser-video.mjs`
- 新建：`recording/local/produce-video.mjs`
- 修改：`test/local-demo-video.test.mjs`

**步骤 1：补充失败测试**

覆盖命令行参数、录制分辨率、演示计划读取、错误产物目录和录制元数据。

**步骤 2：运行测试确认失败**

运行：`node --test test/local-demo-video.test.mjs`

**步骤 3：实现浏览器录制**

- 启动或复用本地服务，打开 `http://127.0.0.1:<port>/?demo=reviewable`。
- 以 1920×1080 viewport 创建 Playwright 录制上下文。
- 等待目标元素可见和页面稳定，再按现有定位器执行滚动、点击、展示动作。
- 注入开场、章节提示、演示光标和结尾卡片；页面保留演示状态标识。
- 每一步记录真实开始/结束时间；失败时保存步骤日志和截图并中止。
- 关闭上下文后保留原始 WebM 和时间线 JSON。

**步骤 4：运行单元测试**

运行：`node --test test/local-demo-video.test.mjs`

**步骤 5：运行短链路录制冒烟**

运行：`node recording/local/produce-video.mjs --stage record --smoke`

预期：生成短 WebM、实际时间线、截图和成功日志；画面为最新前端且演示标识可见。

## 任务 3：生成 TTS、字幕与最终 MP4

**文件：**

- 新建：`recording/local/render-narration.mjs`
- 新建：`recording/local/render-final.mjs`
- 修改：`recording/local/produce-video.mjs`
- 修改：`test/local-demo-video.test.mjs`

**步骤 1：补充失败测试**

覆盖：

- TTS 文本与片段一一对应。
- 音频延迟滤镜和混音输入按实际时间线生成。
- SRT 序号、时间戳、文本合法。
- FFmpeg 参数固定输出 H.264、AAC、30fps、`yuv420p`。

**步骤 2：运行测试确认失败**

运行：`node --test test/local-demo-video.test.mjs`

**步骤 3：实现 TTS 与字幕**

- 用 `say -v Tingting` 为每个时间线片段生成 AIFF。
- 用 ffprobe 测量真实语音时长；超出镜头时提高语速或报告失败，禁止截断。
- 按片段实际开始时间对齐并混合为 48kHz 旁白音轨。
- 生成与语音一致的 SRT。

**步骤 4：实现最终合成**

- 把原始 WebM 转为 1920×1080、30fps、H.264、`yuv420p`。
- 烧录中文字幕，使用底部安全区和半透明底板。
- 混入 AAC 48kHz 160kbps 旁白，不加背景音乐。
- 输出最终 MP4 和 ffmpeg 日志。

**步骤 5：运行测试确认通过**

运行：`node --test test/local-demo-video.test.mjs`

## 任务 4：生成正式成片

**文件：**

- 生成：`output/video/电力交易AI-两分钟演示-最终版.mp4`
- 生成：`output/video/raw/browser-recording.webm`
- 生成：`output/video/timeline.json`
- 生成：`output/video/subtitles.srt`
- 生成：`output/video/narration/`
- 生成：`output/video/production.log`

**步骤 1：执行完整制作**

运行：`node recording/local/produce-video.mjs --stage all`

预期：完整录制、TTS、字幕和成片流程无错误退出。

**步骤 2：技术验收**

使用 ffprobe 检查：

- MP4 容器。
- H.264 视频、AAC 音频。
- 1920×1080、30fps、`yuv420p`。
- 时长 110–125 秒，且绝不超过 130 秒。
- 文件小于 200MB。

**步骤 3：内容验收**

- 在 5 个时间点导出帧图并逐张检查：开场、指标、曲线、证据链/质量门禁、结尾。
- 检查演示状态标识、章节提示和字幕可见。
- 用音频检测确认旁白不是静音，且不存在明显削波或长空白。
- 检查浏览器控制台和制作日志无未处理错误。

**步骤 4：真实环境验收**

按 `real-env-acceptance` 技能执行，保存命令输出、5 张抽帧图和验收报告；只有全部通过后才能宣称完成。

## 任务 5：交付与可复现说明

**文件：**

- 新建：`output/video/验收报告.md`
- 修改：`STATUS.md`

**步骤 1：写验收报告**

记录：

- 成片绝对路径、大小、时长、编码参数。
- 制作命令和版本信息。
- 五个抽帧时间点。
- 演示数据边界与“不自动提交”说明。

**步骤 2：回写项目状态**

记录正式成片路径、验证证据和剩余限制；不改动无关工作树文件。

**步骤 3：定向交付**

先把最终 MP4 交给用户本地审看；仅在用户明确要求后，再通过钉钉发送给王莹。
