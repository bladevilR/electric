## Why

当前 Windows 工作台隐藏了已经存在的价格预测能力，而《一分钟上手》仍引用旧版导航，导致使用者无法找到入口。同时 UKey 可见快照每天覆盖同一文件，多日使用不会形成模型需要的历史交易日，价格预测永远无法自动解锁。

## What Changes

- 在当前 AI 申报工作台提供真实可点击的“价格预测”入口，并展示历史累计进度、解锁条件、预测值和不足原因。
- 将已接受的 UKey 可见业务行按“交易日 + 点位”增量合并到持久历史，不再用当天快照覆盖过去日期。
- Windows 启动器把运行数据放到 `%LOCALAPPDATA%\ElectricTradingAI\data`，使后续覆盖升级不丢累计历史，并在首次运行时迁移当前包内已有快照。
- 明确规定：累计至少 5 个有效历史交易日后，在有目标日业务行的第 6 个交易日自动启用基线价格预测。
- 同步修正《一分钟上手》和 README，使入口名称与当前工作台一致。

## Capabilities

### New Capabilities

- `durable-visible-history`: 对经过敏感字段校验的可见业务数据做跨日、可升级保留的幂等累计。
- `workbench-price-forecast`: 在当前工作台提供价格预测入口、准备进度和自动解锁后的结果展示。

### Modified Capabilities


## Impact

- 服务端：`trading-ai-system/server.mjs`、UKey 历史持久化模块及相关 API 状态字段。
- 启动与打包：`start-system.ps1`、`tools/package-one-minute.mjs`。
- 前端：`workbench.js`、`workbench.css`、`一分钟上手.html`、`README.md`。
- 测试：服务契约、UKey 数据合并、Windows 启动器、工作台 UI 和打包验收。
- 不新增第三方运行时依赖，不读取 Cookie、Token、证书私钥或 UKey PIN，不自动提交交易。
