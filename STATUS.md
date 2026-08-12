# STATUS — electric / JSPEC 相关

更新时间：2026-08-01（5 分钟内参赛成片定版）

## 一句话目标

电力/JSPEC 相关工具与文档可维护；UKey 登录问题单独跟踪，不在聊天写私钥。

## 目标环境

- `/Users/r/Documents/electric`
- 子目录：`jspec-capture`、`trading-ai-system` 等

## WIP 上限

- 默认不占全局双主线名额，除非用户指定

## 当前主线

1. **AI 电力交易副驾驶参赛成片（已完成本机真实验收）**
   - 主线改为：AI 数据门禁 → 预测 → 96 点申报优化 → 成本证据 → 人工复核 → 结算回流
   - 金额口径：单日 2.4 万元、月度 52.8 万元、年度 633.6 万元（按演示规模测算，非生产收益承诺）
   - 正式术语：现行策略 / 候选优化策略 / 实时并行验证；策略版本镜头占比约 7.95%
   - 4K 页面级素材，22 个后期摄影机节拍，9 个不低于 1.5 倍，最大 1.85 倍；38 段高对比字幕
   - Qwen3-TTS Serena 固定 seed，四章连续旁白按真实时长排期；成片 3:48.68
   - 自动媒体门禁全绿、完整解码、每 2 秒密集抽帧和本机真实时长播放已执行
2. UKey/登录：仅测试环境策略，生产合规优先

## 最后真实验收证据

| 时间 | 内容 | 路径 |
|---|---|---|
| 2026-08-01 14:09 | 5 分钟内定版：页面级 4K 素材，22 个镜头节拍、9 个特写、38 段字幕；H.264/AAC 1920×1080、228.68 秒、29,686,456 字节；黑/白屏 0、最长静止 6.43 秒、最长静音 4.56 秒、完整解码通过 | `trading-ai-system/output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`；SHA-256 `c5daf840e2877a5a0cf904d048839f650194a66d5bf4724f15f92d35a8ff24a8`；报告 `trading-ai-system/output/video/验收报告.md` |
| 2026-08-01 01:51 | 强运镜参赛成片：19 个镜头节拍、9 个 1.6 倍以上特写、最大 1.9 倍；无“AI 解说”标签；四章统一 Serena TTS 切分对齐 16 个真实镜头；H.264/AAC 1920×1080、259.200 秒、56,755,886 字节；QuickTime 完整播放 | `trading-ai-system/output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`；SHA-256 `b7192377199a93e73c01536ce95d78e974d1e296399c982860120d360d440f5a`；报告 `trading-ai-system/output/video/验收报告.md` |
| 2026-08-01 01:05 | 电影感重制参赛版：10 次运镜、四章统一 Serena TTS、大字号动态字幕、正式策略验证术语；H.264/AAC 1920×1080、229.633 秒、44,720,800 字节；定向 49 项测试通过 | `trading-ai-system/output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`；SHA-256 `8cf0bccfb633d809e3c631db3fef7f532ce7cbdd742b7f20e3b0fc69d74aa0ce`；报告 `trading-ai-system/output/video/验收报告.md` |
| 2026-07-31 23:20 | AI 电力交易副驾驶参赛版：14 个业务镜头 + 开场/结尾、五章统一 Qwen TTS、H.264/AAC 1920×1080、236.00 秒、32,009,570 字节；定向 44 项测试通过 | `trading-ai-system/output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`；SHA-256 `d369ed2eb2ad192a90815fa7866bd125993c355f6275cc866f430a7ee9106d86`；报告 `trading-ai-system/output/video/验收报告.md` |
| 2026-07-31 21:47 | 策略自进化叙事成片：13 镜头（含进化中枢与人工审批）、Qwen3-TTS Serena 固定 seed、H.264/AAC 1920×1080、124.47 秒、15,638,006 字节；定向 38 项测试通过 | `trading-ai-system/output/video/电力交易AI-两分钟演示-最终版.mp4`；SHA-256 `0325fdd5e7b199fd13cb0c4078f5660dd88779dc965abdf2ee26c00f4b832944`；报告 `trading-ai-system/output/video/验收报告.md` |
| 2026-07-31 17:09 | 前端动效版本地模拟成片（前序） | 见历史 output/video 与当时验收报告 |
| 2026-07-31 16:18 | Windows 一键启动 + 无人值守录制合并包；钉钉送达王莹 | `dist/trading-ai-system-windows-auto-recording-20260731.zip` |

## 当前验收缺口

- 5 分钟内定版已完成本机技术与完整播放验收；仍待用户/评委主观审片打分。
- Windows 10/11 真实接收机解压双击 `启动系统.bat` / `录制比赛视频.bat` 仍未收到实机结果。
- 全仓 155 项测试中 153 项通过；`server-contract` 的历史夹具和 `settlement-reference` 的本地 Excel/导出引用在当前 worktree 缺失，与本轮成片无关，未伪造补绿。

## 完成门禁

- 涉及证书/私钥：只写操作步骤与路径，不落盘私钥内容到 git
- 宣称完成：真实环境证据（本轮 macOS 成片 + 定向测试已附）

## 密钥

- UKey 相关：**禁止**复制私钥进仓库或 agentmemory
