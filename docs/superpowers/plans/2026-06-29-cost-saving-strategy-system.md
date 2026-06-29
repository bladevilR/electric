# 基于现有数据可直接执行的省钱策略系统计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Summary

- 目标：用当前已经收集到的 JSPEC 数据和本地核对单/交易计算表先做一个可运行的“省钱策略 / 预测实验室 / 数据资产 / 定向补采”闭环；目标日实际负荷、目标日结算和业务约束以后补齐后，系统自动从 `heuristic_fallback` 升级到更强模型。
- 当前不承诺训练模型已经最好，因为目标日实际用户负荷、目标日结算金额、连续同日价格历史、持仓和交易限额仍缺失；但历史核对单和交易计算表标准化 CSV 已经可以补一批历史 `actualKwh` / `settleAmount` / `declarationPower` 标签，要把数据管道、特征库、基线预测、回测、策略输出、UI 和报告一次性搭好。
- 实现原则：先用 raw captures 修复标准化不足，现有 CDP 页面只慢速单目标补采，任何策略都只做人工决策支持，不自动提交 JSPEC。
- 执行方式：先建分支，按任务逐步提交；每个任务都要先写测试、确认失败、实现、确认通过、提交。

## Current Facts To Encode

- 当前 CDP：
  - `127.0.0.1:9224` 可用。
  - 当前页面是 `实时市场加权均价（公开）`。
  - 今天 `2026-06-29` 可见实时均价约 84 点；已有快照 `trading-ai-system/data/ukey-visible-snapshot.json` 是 79 点。
  - 已经触发过 JSPEC API 访问频率警告；执行时不要连续扫站。
- 本地 raw captures 已可用：
  - 实时均价：约 480 行。
  - 日前公开出清：约 1152 行。
  - 用户日前出清：约 480 行。
  - 实时公开出清：约 480 行。
  - 主动申报：约 1056 行。
  - 缺省申报：约 1152 行。
  - 短期系统负荷预测：约 384 点。
  - 实际系统负荷：约 192 点。
  - 当前合同接口显示 `total: 176`，但本地只有第一页 10 行。
  - 历史合同接口显示 `total: 88`，但本地只有第一页 10 行。
  - 交易序列：421 行。
- 本地历史参考已可用：
  - 根目录 Excel 工作簿：14 个，其中现货核对单 8 个、交易计算表 `.xls` 5 个、月度结算概览 1 个。
  - 历史现货核对单可解析 211 天 * 96 点 = 20256 行历史 `actualKwh` / `settleAmount` 标签。
  - `data/jspec/standardized/transaction_calculation/customer_usage_96.csv` 有 6240 行，其中 480 行汇总实际用电可补历史 `actualKwh`。
  - `data/jspec/standardized/transaction_calculation/submission_power_96.csv` 有 480 行，可补历史 `declarationPower`。
  - `data/jspec/standardized/transaction_calculation/hourly_summary_rows.csv` 有 720 行，其中小时持仓参考 240 行、操作量参考 240 行。
  - `data/jspec/standardized/transaction_calculation/hourly_transaction.csv` 有 3000 行小时交易测算参考。
- 当前缺失：
  - 目标日用户实际负荷 `actualKwh`：`queryDailyElectricity` 只有 96 点表头，`list.total = 0`。
  - 目标日结算金额/结算明细：`settle_day`、`settle_month`、`fileDown/queryFileList` 都是 0。
  - 业务约束：`forecast-load-96.csv`、`position-96.csv` 只有表头，`trade-limits.json` 关键字段为 null。
  - 连续目标日同口径价格历史和业务约束不足，不足以声明训练模型优于规则。

## Implementation Tasks

### Task 1: Raw JSPEC 数据资产层

- 新增 `trading-ai-system/lib/data-assets.mjs` 和 `trading-ai-system/test/data-assets.test.mjs`。
- 导出 `buildDataAssetInventory(captures)`, `readCaptureDirectory(directoryPath)`, `buildInventoryFromDirectories(directoryPaths)`。
- 识别实时均价、日前公开出清、用户日前出清、实时公开出清、主动申报、缺省申报、系统负荷预测、实际系统负荷、当前/历史合同、交易序列、空实际日电量和空结算证据。
- 合同统计必须区分接口 `total` 和本地实际抓到的 `list.length`。
- `queryDailyElectricity` 只有表头时不能当作有效 `actualKwh`。

### Task 2: Raw 响应到 96 点特征库

- 新增 `trading-ai-system/lib/forecast-feature-store.mjs` 和 `trading-ai-system/test/forecast-feature-store.test.mjs`。
- 导出 `buildForecastFeatureStore(dataset, options)`, `normalizeAssetRows(inventory)`, `buildPointKey(date, pointIndex)`。
- 生成 96 点特征：日期、点位、时段、实时均价、日前公开价、用户日前价、实时节点价、主动/缺省申报、系统负荷预测、实际系统负荷、用户实际负荷、结算、价差、高价标签、来源、缺失字段。
- raw 数据优先，现有标准化 dataset 作为补充。
- 历史核对单和交易计算表标准化 CSV 作为历史标签/历史业务约束参考补充；不能把历史标签、小时持仓或操作量当作目标日实测值或可执行限额。
- `priceSpread = realTimeAvgPrice - dayAheadPublicPrice`；任一缺失时为 `null`。
- 不能把系统实际负荷当作用户实际负荷。

### Task 3: 基线预测模型

- 新增 `trading-ai-system/lib/forecast-models.mjs` 和 `trading-ai-system/test/forecast-models.test.mjs`。
- 导出 `buildForecastModelReport`, `forecastNaiveSameSlot`, `forecastRollingSameSlot`, `summarizeForecastReadiness`。
- 支持 `realTimeAvgPrice`, `priceSpread`, `highPriceRiskLabel` 三个目标。
- 状态为 `heuristic_fallback`, `insufficient_history`, `baseline_ready`；当前不引入训练依赖或深度学习。
- 预测目标日时不能用目标日真实值作为历史。

### Task 4: Walk-forward 回测

- 新增 `trading-ai-system/lib/backtest-engine.mjs` 和 `trading-ai-system/test/backtest-engine.test.mjs`。
- 导出 `runForecastBacktest`, `computeRegressionMetrics`, `computeStrategyBacktest`。
- 按日期 walk-forward；默认至少 5 个历史交易日。
- 历史不足返回 `insufficient_history`。
- 目标日缺 `actualKwh` / `settleAmount` 时只做价格预测误差和历史标签回测，不伪造当天真实节省金额。

### Task 5: 省钱策略优化器

- 新增 `trading-ai-system/lib/cost-optimizer.mjs` 和 `trading-ai-system/test/cost-optimizer.test.mjs`。
- 修改 `strategy-engine.mjs`，在 `buildStrategyAdvice()` 返回 `costStrategy`，保持现有字段稳定。
- 输出低价窗口、高价暴露、数据置信度、`conservative` / `neutral` / `aggressive` 三档策略。
- 当前缺目标日实际负荷、目标日结算和业务约束时，所有策略都必须 `executable: false`，且 aggressive disabled。

### Task 6: 定向补采计划

- 修改 `trading-ai-system/lib/ukey-browser-collector.mjs` 和测试。
- 导出 `buildBackfillPlan(dataset, options)`。
- 默认最多 4 个目标，每个目标 `delayMs >= 20000`。
- 优先级：实时均价、实际负荷、日结算、日前公开价、用户日前出清、缺省申报、系统负荷预测、合同分页、交易序列。
- 出现频率警告时返回 `rateLimited: true` 并建议等待，不连续扫站。

### Task 7: Server API

- 修改 `server.mjs` 和 `server-contract.test.mjs`。
- 新增：
  - `GET /api/data-assets`
  - `GET /api/forecast/features?date=YYYY-MM-DD`
  - `GET /api/forecast/model?date=YYYY-MM-DD`
  - `GET /api/backtest`
  - `GET /api/cost-strategy?date=YYYY-MM-DD`
  - `GET /api/backfill/plan?date=YYYY-MM-DD`

### Task 8: UI 面板

- 修改 `app.js`, `styles.css`, `server-contract.test.mjs`。
- 新增状态和 loader：`costStrategy`, `dataAssets`, `forecastLab`, `backtestReport`, `backfillPlan`。
- 新增模块：`省钱策略`, `数据资产`, `预测实验室`, `回测结果`。
- 展示模型状态、数据资产、回测状态、三档策略、置信度、补采队列。

### Task 9: 报告与执行提案

- 修改 `strategy-report.mjs`, `execution-governance.mjs` 和对应测试。
- 报告新增 `forecastSummary`, `backtestSummary`, `costStrategy`, `savingsFocus`。
- 提案新增 `proposal.costStrategy` 和人工复核 warning。
- `autoSubmit` 保持 false，`orderLines` 保持空数组。

### Task 10: 文档

- 更新 `README.md`, `docs/production-runbook.md`, `docs/quick-start.html`。
- 新增 `docs/cost-strategy-research.md`。
- 写清每日流程、停止条件、为什么当前是 `heuristic_fallback`、以后补数据后如何升级模型。

### Task 11: Full Verification

- 运行：
  ```powershell
  node --test trading-ai-system\test\*.mjs jspec-capture\lib\*.test.mjs
  ```
- 重启 5177 本地服务并验证所有新增 endpoint。
- UI 应显示 `省钱策略`、`数据资产`、`预测实验室`、`回测结果`。

## Acceptance Criteria

- `/api/data-assets` 能展示 raw captures 中的可用数据和缺失证据。
- `/api/forecast/features` 能把 raw 价格、申报、系统负荷、合同/交易上下文转成 96 点特征。
- `/api/forecast/model` 在当前数据不足时明确返回 `insufficient_history` 或 `heuristic_fallback`。
- `/api/backtest` 不使用未来数据；历史不足时不伪造模型效果。
- `/api/cost-strategy` 返回三档策略、模型状态、置信度和缺口。
- `/api/backfill/plan` 最多 4 个目标，每个目标间隔不低于 20 秒。
- UI 展示数据资产、预测实验室、回测结果、省钱策略和补采队列。
- 报告和执行提案包含省钱策略，但 `autoSubmit === false`。
- 全量测试 `fail 0`。
- 当前缺目标日实际负荷/结算/业务约束时，系统不会输出具体可执行电量。

## Defaults And Assumptions

- 新代码用正常 UTF-8 中文；不批量修复旧乱码。
- 当前版本不下载开源仓库作为依赖；成熟项目经验写入文档即可。
- 当前版本不训练深度学习；先做 baseline、回测和框架。
- 用户以后补充目标日实际负荷、目标日结算、持仓和交易限额后，再进入训练模型升级阶段。
- CDP 页面不做连续扫站；只按 backfill plan 慢速单目标采集。
- 所有 JSPEC 操作都是只读；系统不读 cookie、不拦截网络、不自动提交交易。
