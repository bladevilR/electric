## Context

`trading-ai-system` 是单进程 Node.js ESM HTTP 服务，现有领域能力以纯函数和只读 GET API 为主，安全边界是 `human_decision_only`。项目没有入站 OpenAI-compatible API 或 OTLP Trace 导出。附件规范要求最终提交静态 `traces.json`、动态 `traces-dynamic.json` 和 `information.json`；官方 runner 在参赛方环境内调用参赛 API。

当前默认真实 JSPEC 标准数据路径不存在，服务会回退到 `data/standard-96.sample.json`。因此交付物可以记录真实软件执行，但必须把数据源标记为仓库样例，不能声称为生产交易结果或已实现收益。

## Goals / Non-Goals

**Goals:**

- 在本机环回地址提供官方 runner 可调用的 OpenAI Chat Completions 契约。
- 用现有领域算法的实际输入和输出构建可评分的电力交易辅助 Agent，并对 C4/E3 动态扰动给出明确、安全、可解释的处理。
- 每次 Agent 请求都生成包含输入、输出、工具、记忆、状态和父子关系的标准 OTLP GenAI Trace。
- 从实际运行证据生成严格匹配 Trace ID/Span ID 的 `information.json`。
- 通过一条可重复命令生成正式上传目录和独立 QA 目录，并完成官方校验、动态 3/3 成功、Trace 对账、敏感信息扫描和哈希门禁。

**Non-Goals:**

- 不搭建公网托管、反向代理或长期在线评测服务。
- 不读取、写入或打包任何真实 Token、Cookie、UKey PIN、私钥或账号密码。
- 不自动申报、下单、启动 JSPEC 采集或绕过人工复核。
- 不把仓库样例数据、模拟交易金额或未验证策略写成生产证据。

## Decisions

### 1. 本机环回接口，无账密材料

新端点为 `POST /v1/chat/completions`，模型标识固定为 `electric-trading-copilot-v1`，支持 `stream: false` 的文本消息，限制 JSON body 大小并使用 OpenAI-compatible 错误结构。`information.json` 使用 `http://127.0.0.1:<port>/v1/chat/completions` 和 `authentication.method = none`。

选择这一方案是因为官方 runner 在参赛方环境内运行，环回地址不需要在材料中存放可复用密钥。备选的公网端点会引入凭证、TLS、访问控制和运维风险，不属于本次最终文件交付的必要条件。

### 2. 确定性领域 Agent，不依赖外部模型

Agent 将请求归一化后先应用不可覆盖的安全分类：模糊/不完整、相互冲突、不存在工具、自动交易/凭证请求。对完整的电力价格分析指令，复用 `buildStrategyAdvice`、`buildStrategySuggestions`、预测/回测状态和 `buildProductionReadiness` 输出。回答是稳定的中文 JSON 文本，包含 `status`、`summary`、`data_source`、`price_windows`、`data_gaps` 和 `human_review`。

这比调用现有出站模型客户端更可重复，不依赖未配置凭证，也避免接口自指递归。代价是自由问答广度不如通用大模型，但它对官方 C4/E3 扰动和参赛业务任务的证据更稳定。

### 3. 直接写入校验器接受的 OTLP JSON

`competition-trace-store` 使用 Node.js 生成标准 32/16 位十六进制 ID、纳秒时间戳、完整父子关系和 `status.code`。复杂 GenAI 字段按附件规则序列化到 OTLP `stringValue`。运行时每次请求以一行一个 OTLP document 追加到指定 NDJSON，导出器再合并为单个 `resourceSpans` 文档。

不引入 OpenTelemetry SDK，因为赛事附件明确允许手动构建符合契约的 OTLP，而当前 Node 项目不需要远程 collector 或后台 exporter。Trace 仍然必须由实际 Agent 请求路径自动产生，生成脚本不允许伪造已发生的执行。

### 4. 静态证据与动态证据隔离

编排器分两次启动本机服务：静态阶段执行一条完整电力分析任务和两条同会话记忆任务，导出 `traces.json`；动态阶段清空本会话拥有的 Trace 文件，由官方 runner 发起三条请求，导出 `traces-dynamic.json`。静态 Trace 中只有主电力任务的根 Span 使用 `invoke_agent`，记忆请求根 Span 使用 `chat`，保证 runner 稳定选中主指令。

### 5. 交付目录是最终质量边界

`competition-delivery/upload/` 只允许三个官方文件。`competition-delivery/qa/` 包含 `execution-report.json`、三个校验报告、Trace 对账报告、数据来源报告和 `SHA256SUMS.txt`。正式目录的每次重建都使用新的 Trace ID，所有材料由当次运行导出，不保留过期混合证据。

## Risks / Trade-offs

- [仓库样例数据被误解为真实交易数据] → 每个分析回答、Trace 和 QA 数据源报告都写入 `repository_sample`，`information.json` 的预期结果明确禁止生产/收益表述。
- [官方评测对未公开的证据语义有额外偏好] → 提交丰富的标准 GenAI 字段、真实工具参数/结果、记忆形成/使用和异常恢复证据，并以附件校验器为最低门禁。
- [服务异常中止导致 Trace 半写] → 一个请求的完整 OTLP document 在响应形成后一次追加，导出时严格解析每行，任何损坏都阻断交付。
- [现有 `server.mjs` 有用户未提交改动] → 仅增加 import、独立 handler 和最外层路由，不重写现有 API 或 MW/MWh 门禁区域。
- [动态 runner 三条请求虽 HTTP 成功但 Trace 无法关联] → 响应头 `traceparent` 和响应 JSON `trace_id` 同时返回，QA 门禁要求报告中三个 Trace ID 在动态文件中恰好各出现一次。

## Migration Plan

1. 先以纯函数测试引入 Agent 请求/回答和 Trace 文档构建器。
2. 在现有服务上增加独立竞赛路由，保留所有现有 API 契约。
3. 增加本机编排器，在隔离运行目录中完成静态/动态两阶段。
4. 只有全部门禁通过才替换 `competition-delivery/`；失败时保留当次隔离运行证据并不覆盖上一份完整交付。
5. 回滚时只移除新路由和新组件；现有业务 API、页面和数据文件无迁移。

## Open Questions

无。如赛事后续明确要求组委会从公网主动访问 endpoint，需要另起带 TLS、短期凭证、速率限制和安全验收的部署变更，不在本地交付物中暗中扩展。
