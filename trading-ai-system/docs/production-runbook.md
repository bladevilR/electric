# 生产交易系统运行手册

## 当前状态

本仓库已具备本地辅助决策控制面：数据闭环台账、策略报告、提案草稿、人工复核提示和追加式审计日志。当前固定为 `human_decision_only`，系统不会自动写入交易平台。

## 启动

```powershell
.\run-system.ps1
```

默认地址：

```text
http://127.0.0.1:5177
```

## 必要配置

可从 `.env.production.example` 复制变量名，再由生产密钥管理或进程环境注入真实值。

进入提案预填和人工复核流程前建议配置：

```text
JSPEC_BASE_URL
JSPEC_USERNAME
CA_UKEY_PROVIDER
CA_UKEY_CERT_ID
TRADING_PLATFORM_URL
TRADING_OPERATOR_ID
TRADING_APPROVER_ID
EXECUTION_MODE=human_decision_only
```

系统只记录变量名是否配置，不返回密钥或密码值。

## 每日流程

1. 调用 `POST /api/refresh` 刷新标准 96 点数据和本地集成摘要。
2. 打开“数据质量”确认 P0 源覆盖、字段完整性和缺口清单。
3. 打开“提案工作台”确认 `/api/production/readiness` 的控制项和人工复核提示。
4. 如有预测负荷、持仓和限额，先填写 `data/business-inputs/forecast-load-96.csv`、`position-96.csv`、`trade-limits.json`。
5. 调用 `POST /api/execution/proposal?date=YYYY-MM-DD` 生成可编辑提案草稿。
6. 如果返回 `draft_ready`，由人工填写/修改电量、限价和交易平台字段后决定是否提交。
7. 通过 `POST /api/execution/review?...&decision=accepted|modified|rejected` 记录人工复核结论。
8. 审计日志通过 `GET /api/audit?limit=20` 查看，文件写入 `data/audit-log.ndjson`。

## 安全边界

- 提案草稿的 `proposalLines` 是可编辑建议，不是订单。
- `autoSubmit` 固定为 `false`，`orderLines` 固定为空。
- 人工复核结论只写审计日志，不触发平台提交。
- 系统不绕过 CA/UKey，不保存生产密码，不自动下单。
- 源返回空会作为真实阻塞项记录，不会用推测值补齐。
