# 竞赛最终交付说明

## 最后到底提交什么

只上传 `/Users/r/Documents/electric/trading-ai-system/competition-delivery/upload/` 目录里的三个文件：

1. `traces.json`：静态业务任务、工具调用和记忆链路的 OTLP GenAI Trace。
2. `traces-dynamic.json`：官方 runner 实际发起的 C4/E3 三条动态请求 Trace。
3. `information.json`：业务意图、推理、过程证据、工具、记忆和本机 API 契约。

不要把 `qa/` 目录上传成官方材料。它是本地验收证据，用于证明这三个文件来自同一次真实执行且通过门禁。

## 当前验收结果

- 官方静态 Trace 校验：`valid=true`、`error_count=0`。
- 官方动态 Trace 校验：`valid=true`、`error_count=0`、`warning_count=0`。
- 官方 `information.json` 校验：`verdict=可提交`、`status=pass`、`error_count=0`、`notice_count=0`。
- 官方动态评测：3 条请求全部成功，`succeeded=3`、`failed=0`。
- Trace 对账：报告中的三个 Trace ID 与动态文件中的三个根 Trace 一一对应，无缺失、无多余。
- 正式目录：精确三个文件；敏感信息和占位符扫描通过；SHA-256 复核通过。

静态 Trace 的两个 warning 来自附件自身的规则版本差异：GenAI v8 registry 已正式列出 `create_memory` 和 `search_memory`，但附件的 evaluation convention 旧列表尚未同步。这两个操作保留是为了准确呈现真实记忆形成和使用证据，均为非阻断 warning，文件整体仍为 `valid=true`、`evaluation_compatible=true`。

## 诚实的数据边界

当前标准数据来自仓库样例 `data/standard-96.sample.json`。提交材料真实记录了软件运行、工具调用、记忆和异常处理，但不代表生产交易数据、可执行交易指令或已实现收益。所有输出都保持 `human_decision_only`、`auto_submit=false`、`executable=false`。

## 一键重建与复核

在 `/Users/r/Documents/electric/trading-ai-system` 执行：

```bash
npm run competition:build-delivery
npm run competition:verify-delivery
```

构建过程只监听 `127.0.0.1`，不需要 Token，不会自动申报或下单。重建会为三个正式文件生成一套新的 Trace ID；上一版会被保留在本次 `.competition-runtime/` 构建目录中，不会被强制删除。

## QA 文件

- `qa/execution-report.json`：官方动态 runner 的 3/3 执行报告。
- `qa/traces-validation.json`：官方静态 Trace 校验报告。
- `qa/traces-dynamic-validation.json`：官方动态 Trace 校验报告。
- `qa/information-validation.json`：官方信息材料校验报告。
- `qa/trace-reconciliation.json`：动态报告和动态 Trace 的一一对账。
- `qa/data-provenance.json`：数据来源和不可执行边界声明。
- `qa/build-manifest.json`：本次构建总门禁和文件哈希。
- `qa/SHA256SUMS.txt`：三个正式文件的 SHA-256。

## 当前最终文件 SHA-256（2026-08-31 04:24:44Z 构建）

```text
a81f1fa575e89665d5f8892d77d9c6b50e4f7119a4f444c2551d0efd801df31a  upload/information.json
7905a0a8717d7eb5ae5d31340236644d0f5b1646f4edccfcfc97f9251901866d  upload/traces-dynamic.json
97c5e30a191c1924d9f79c09916a694b06d6466920f6794677b2e59ee1031e5b  upload/traces.json
```
