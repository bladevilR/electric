# 全自动参赛成片实施计划

> 目标：在不需要用户操作任何录屏或剪辑软件的前提下，从本地演示系统生成一条少于 5 分钟、可直接参赛审片的 1080p MP4。

## 约束

- 所有实现位于隔离工作树，不覆盖主目录现有未提交内容。
- 浏览器只采集网页；地址栏、终端、桌面、菜单栏和 Dock 不得进入画面。
- 页面 DOM 不做最终摄影机缩放；全景、推近、横移和拉回统一在后期执行。
- Serena 旁白时长是排期唯一时间基准；最终输出必须小于 300 秒。
- 任何 smoke、场景录制或验收门禁失败都中止，不生成伪成功交付。

## Task 1：建立可测试的制作契约

**文件：**

- 修改：`trading-ai-system/lib/video-production.mjs`
- 修改：`trading-ai-system/test/local-demo-video.test.mjs`
- 修改：`trading-ai-system/recording/local/demo-plan.json`

1. 先为录制尺寸一致性、场景目标矩形、摄影机节拍数量和倍率、成片媒体要求写失败测试。
2. 执行 `node --test trading-ai-system/test/local-demo-video.test.mjs`，确认测试因缺少新接口失败。
3. 增加纯函数：规范化目标矩形、约束 crop、生成逐帧摄影机参数、校验场景清单和验收摘要。
4. 再次运行测试，确认纯函数边界用例通过。

## Task 2：实现页面级分场景采集

**文件：**

- 修改：`trading-ai-system/recording/local/record-browser-video.mjs`
- 新增：`trading-ai-system/recording/local/record-scene.mjs`
- 修改：`trading-ai-system/produce-video.mjs`
- 测试：`trading-ai-system/test/local-demo-video.test.mjs`

1. 写失败测试，要求录制期间不存在 `#workbenchRoot` 摄影机 transform，并要求 manifest 包含场景、素材、真实时长和焦点矩形。
2. 录制 10 秒 smoke：视口和视频尺寸一致，只含网页内容；用 ffprobe 和抽帧检测尺寸、画布占用与异常纯色帧。
3. 按场景独立启动和结束录制，等待明确 DOM 条件，记录目标 `getBoundingClientRect()`；目标为空或超界时保存截图并失败。
4. 支持根据 manifest 只重录缺失或失败场景。

## Task 3：旁白优先排期与程序化摄影机

**文件：**

- 修改：`trading-ai-system/lib/video-production.mjs`
- 新增：`trading-ai-system/render-camera.mjs`
- 修改：`trading-ai-system/render-final.mjs`
- 测试：`trading-ai-system/test/local-demo-video.test.mjs`

1. 写失败测试：16–22 个节拍、至少 6 个倍率不低于 1.5、最高不超过 1.85、连续特写不超过 2 个，所有 crop 必须落在源画面内。
2. 从四章 Serena 音频的 ffprobe 时长生成场景排期和字幕；复用条件由文案、模型、speaker、seed 和 instruct 哈希共同决定。
3. 将场景焦点和安全边距转换为确定性 crop 参数；使用平滑缓动生成 FFmpeg filter graph。
4. 先缩放画面，再合成字幕、演示标识和点击提示，保证覆盖层不随摄影机放大。

## Task 4：一键生产与自动门禁

**文件：**

- 修改：`trading-ai-system/package.json`
- 修改：`trading-ai-system/produce-video.mjs`
- 新增：`trading-ai-system/verify-final-video.mjs`
- 修改：`trading-ai-system/验收报告.md`
- 修改：`STATUS.md`

1. 增加一个正式制作命令，串联服务、smoke、分场景录制、配音准备、摄影机渲染、最终编码和验收。
2. 机器门禁验证：时长小于 300 秒、1920×1080、30fps、H.264、AAC 48kHz 双声道，并检测黑/白屏、长冻结、异常静音、字幕安全区和焦点裁切。
3. 每 2 秒抽帧，并对各摄影机节拍额外抽取前/中/后帧；人工视觉检查关键构图和连续性。
4. 完整播放最终 MP4，记录真实命令输出、截图和 SHA-256；只有全部门禁通过后才能将报告标记为通过。

## 完成条件

- `node --test trading-ai-system/test/local-demo-video.test.mjs trading-ai-system/test/demo-recording.test.mjs` 全部通过。
- 一键命令在本机真实环境从输入生成最终 MP4，没有用户交互步骤。
- 成片少于 5 分钟，包含有效双声道旁白，前 15 秒出现三档节约测算，画面无桌面污染、灰区、纯白或空构图。
- 中文验收报告列出媒体探测、自动检测、视觉检查、完整播放和哈希证据。
