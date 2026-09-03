# 数据源与字段字典 v1

机器可读的完整目录以 `config/data-sources.json` 和 `config/field-catalog.json` 为准；本文记录必须人工评审的核心语义。

## 状态

`confirmed_visible`、`confirmed_export`、`code_supported`、`captured_nonempty`、
`captured_empty`、`page_visible_code_missing`、`pending_field_confirmation`、
`pending_authorization`、`mock_only`、`derived` 和 `unavailable` 是允许状态。
`code_supported` 只表示代码存在候选映射，不代表真实生产数据已就绪。

## 核心字段隔离

| 字段 | 含义 | 替代规则 |
|---|---|---|
| `userDeclaredPowerMw` | 用户主动申报功率 | 禁止由其他曲线回填 |
| `defaultDeclaredPowerMw` | 平台缺省申报功率 | 禁止由主动申报或出清回填 |
| `dayAheadUserClearedPowerMw` | 用户日前实际出清电力 | 禁止回填申报或实际负荷 |
| `actualIntervalEnergyKwh` | 15 分钟实际区间电量候选 | 单位未确认前禁止换算 |
| `actualAverageLoadMw` | 确认区间后的平均负荷 | 仅按有版本公式派生 |

日前价格按临时价、最终价、有效价分别保存：
`dayAheadUserPriceTemporaryYuanPerMwh`、`dayAheadUserPriceFinalYuanPerMwh`、
`dayAheadUserPriceEffectiveYuanPerMwh`。有效价只在查询时按最终价优先派生，并同时返回来源。

## 时点规则

事实保存 `businessDate`、`pointIndex`、`publishedAt`、`availableAt`、`capturedAt` 和
`sourceRevision`。历史预测和重放只允许使用 `availableAt <= decisionCutoffAt` 的事实；
抓取时间不能单独证明来源当时已经发布。

## 现场确认流程

只处理平台允许的只读页面可见数据。现场截图/允许导出/脱敏记录
→ 更新来源状态和原始表头
→ 添加脱敏 fixture 与解析测试
→ 提升字段目录版本
→ 运行全量测试
→ 人工评审。原始敏感业务导出不得提交到公开仓库。
