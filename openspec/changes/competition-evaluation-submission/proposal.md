## Why

当前项目只有参赛演示页和校验工具，没有可供官方 dynamic runner 调用的 OpenAI-compatible 入站接口，也不会从真实请求导出可对账的 OTLP Trace。这使得项目无法交付赛事明确要求的 `traces.json`、`traces-dynamic.json` 和 `information.json`。

## What Changes

- 增加只读的 `POST /v1/chat/completions` 参赛接口，返回 OpenAI Chat Completions 结构和可对账 Trace ID。
- 增加独立的竞赛 Agent 编排层，复用现有电力价格、预测、策略和安全门禁结果，处理完整指令、模糊指令、相互冲突要求和不存在工具。
- 增加从每次实际 Agent 执行记录根 Span、领域工具 Span、记忆 Span 和异常处理证据的 OTLP 记录与导出能力。
- 增加可重复的静态证据生成、官方三条动态任务执行、动态 Trace 导出和 Trace ID 一一对账流程。
- 交付一个正式上传目录，其根目录只包含 `traces.json`、`traces-dynamic.json`、`information.json`；另建 QA 目录保存执行报告、校验报告、对账报告和 SHA-256 清单。
- 保留 `human_decision_only` 边界：新接口不启动采集、不生成或审批交易提案、不自动下单、不读取或回显凭证。
- 当运行数据来自仓库样例或真实数据不足时，Trace 和说明材料必须显式记录数据来源和阻断状态，不得声称为生产推荐或真实收益。

## Capabilities

### New Capabilities

- `competition-chat-api`: OpenAI Chat Completions 兼容入站接口、电力交易辅助 Agent 和安全异常处理契约。
- `competition-trace-evidence`: 实际 Agent 运行的 OTLP GenAI Trace 采集、存储、导出与 Trace ID 关联契约。
- `competition-submission-bundle`: 三个官方上传文件、质量证据、哈希和最终门禁的可重复交付契约。

### Modified Capabilities

无。

## Impact

- 修改 `trading-ai-system/server.mjs` 的 HTTP 路由，但不改变现有 `/api/*` 和静态页契约。
- 在 `trading-ai-system/lib/` 增加 Agent、请求契约和 Trace 记录组件，在 `tools/` 增加交付物编排器。
- 在 `trading-ai-system/test/` 增加纯函数、HTTP 契约、OTLP 格式和端到端对账测试。
- 新增的运行时 Trace 存储位于被 Git 忽略的本地目录；正式交付目录只保存可复核的最终成品和 QA 证据。
- 不新增外部模型或 OpenTelemetry SDK 强依赖；导出格式直接遵循附件校验器接受的 OTLP JSON 契约。
