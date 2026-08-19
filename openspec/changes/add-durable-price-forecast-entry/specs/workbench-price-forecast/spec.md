## ADDED Requirements

### Requirement: Current workbench exposes price forecast
当前 `index.html` 加载的新版工作台 SHALL 在主侧栏提供可点击的“价格预测”入口。

#### Scenario: User opens price forecast
- **WHEN** 用户点击侧栏“价格预测”
- **THEN** 工作台加载所选交易日的预测状态并显示进度或预测结果

### Requirement: Forecast readiness is visible and automatic
系统 SHALL 显示早于目标日的有效历史交易日数量，并 SHALL 在至少 5 个历史交易日、目标日有业务行且存在可比较点位时自动启用现有基线预测。

#### Scenario: Fewer than five historical dates exist
- **WHEN** 目标日前只有 0 至 4 个有效历史交易日
- **THEN** 页面显示“累计 N/5 个历史交易日”及不足原因且不展示伪造预测

#### Scenario: Fifth historical date and target date exist
- **WHEN** 目标日前至少有 5 个有效历史交易日且目标日存在可比较业务点
- **THEN** `/api/forecast/model` 返回 `baseline_ready` 且页面展示价格预测

### Requirement: Guidance matches real navigation
《一分钟上手》和 README SHALL 只指导用户点击当前工作台真实存在的入口，并 SHALL 说明有效交易日的累计口径。

#### Scenario: User follows the guide
- **WHEN** 用户按指南启动并查找价格预测
- **THEN** 指南中的入口名称与当前侧栏文字一致
