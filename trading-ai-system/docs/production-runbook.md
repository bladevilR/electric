# 生产交易系统运行手册

## 当前状态

本仓库具备本地辅助决策控制面：数据闭环台账、策略报告、提案草稿、人工复核提示、追加式审计日志、数据资产、预测实验室、回测结果和省钱策略面板。当前固定为 `human_decision_only`，系统不会自动写入交易平台。

## 启动

```powershell
.\run-system.ps1
```

默认地址：

```text
http://127.0.0.1:5177
```

## 必要配置

可从 `.env.production.example` 复制变量名，再由生产密钥管理或进程环境注入真实值。进入提案预填和人工复核流程前建议配置：

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

1. 启动本地服务。
2. 打开 UKey 登录态浏览器。
3. 先看“数据资产”“结算参考”和“预测实验室”，确认 raw captures、Excel 参考文件、模型状态和缺口。
4. 如果有缺口，只按 `/api/backfill/plan?date=YYYY-MM-DD` 或 UI 的“补采队列”慢速补采，默认最多 4 个目标。
5. 查看“省钱策略”三档建议，确认 `modelMode`、置信度、低价窗口、高价暴露和不可执行原因。
6. 调用 `POST /api/strategy-report?date=YYYY-MM-DD` 生成报告，人工复核。
7. 调用 `POST /api/execution/proposal?date=YYYY-MM-DD` 生成可编辑提案草稿。
8. 如果返回 `draft_ready`，由人工填写或修改电量、限价和交易平台字段后决定是否提交。
9. 通过 `POST /api/execution/review?...&decision=accepted|modified|rejected` 记录人工复核结论。
10. 审计日志通过 `GET /api/audit?limit=20` 查看，文件写入 `data/audit-log.ndjson`。

## 停止条件

出现任一情况立即停止补采或巡扫：

- JSPEC 返回 API 访问频率警告。
- 页面跳回登录页或 UKey 会话失效。
- 页面没有业务表格，只有空白、报错或无关内容。
- 连续目标都返回空列表。
- 当前补采计划的 4 个目标已经执行完毕。

## 定向补采纪律

补采只补最能提升策略可信度的数据：实时均价、用户实际负荷、日结算、日前公开出清、用户日前出清、缺省申报、短期系统负荷预测、合同分页、交易序列。补采目标之间至少等待 20 秒；不要连续扫站，不要扩大成全站巡扫。

## 安全边界

- 提案草稿的 `proposalLines` 是可编辑建议，不是订单。
- `autoSubmit` 固定为 `false`，`orderLines` 固定为空数组。
- 缺实际负荷、结算、持仓或交易限额时，不预填可执行电量。
- 人工复核结论只写审计日志，不触发平台提交。
- 系统不绕过 CA/UKey，不保存生产密码，不自动下单。
- 源返回空会作为真实阻塞项记录，不会用推测值补齐。
- 缺目标日实际负荷或目标日结算时，系统只能做价格预测误差回测，不能声明当天真实节省金额。
- `/api/settlement/reference` 和“结算参考”面板会登记历史核对单、交易计算表、月度表和 manifest。历史核对单可以补历史实际负荷/结算标签；在目标日实际负荷、目标日结算和持仓曲线为空时，不能用历史参考文件预填可执行电量或当天结算金额。
