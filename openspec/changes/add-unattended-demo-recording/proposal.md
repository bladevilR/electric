## Why

比赛演示需要在插有 UKey 的王莹 Windows 电脑上录制，但前端仍在同步优化，人工逐步点击容易出现等待不足、误操作、鼠标抖动和片段不可复现。下午交付前需要把录制流程做成可随最终前端版本一起打包的一键工具，让接收方双击后即可自动启动、稳定演示、录制并保存可供 TTS 后期配音的无声素材。

## What Changes

- 新增 Windows 双击录制入口，自动检查 Node、Edge、FFmpeg、磁盘、分辨率和本地服务。
- 用 Edge DevTools 协议自动执行比赛演示分镜，按真实页面状态等待，不依赖屏幕坐标或固定延迟。
- 用 FFmpeg 录制 1080p/30fps MP4，并在失败时保留日志、截图和实际时间线。
- 注入平滑演示光标、点击波纹和章节提示，但不修改业务数据、不自动提交申报或交易。
- 新增中文 TTS 解说稿、分镜时间线和后期合成入口，使画面与旁白可独立返工。
- 将录制工具纳入最终便携包；当前阶段只实现和验证，不提前发送给王莹。

## Capabilities

### New Capabilities

- `unattended-demo-recording`: Windows 一键启动、状态驱动的页面自动演示、录屏、失败取证和录制产物检查。
- `tts-ready-demo-timeline`: 可复用的中文解说稿、分镜时间线与 TTS 音轨合成约定。

### Modified Capabilities

无。

## Impact

- 新增 `trading-ai-system/recording/` 下的 Windows PowerShell、批处理、分镜配置与说明文件。
- 新增无第三方 npm 依赖的 Edge CDP 自动演示工具与 Node 单元测试。
- 最终打包脚本需复制录制目录，并在外发包中携带经校验的 Windows `ffmpeg.exe`；不包含 UKey PIN、Cookie、证书私钥或登录态。
- 不修改当前正在并行重构的 `workbench.js`、`workbench.css` 和 `server.mjs`。
