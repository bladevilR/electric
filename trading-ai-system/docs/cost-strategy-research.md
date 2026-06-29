# 省钱策略研究说明

## 目标

本系统的目标不是“看起来用了最复杂模型”，而是让省钱策略可以被解释、被回测、被人工复核，并且在数据补齐后自然升级。当前版本优先完成数据资产、96 点特征、基线预测、walk-forward 回测、策略输出、UI 和报告闭环。

## 成熟项目经验

- 时间序列验证必须保持时间顺序。scikit-learn `TimeSeriesSplit` 的设计就是让训练集只来自测试集之前，避免把未来信息泄漏进模型：[TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)。
- 成熟预测工具会把 backtesting / historical forecasts 作为核心能力，而不是只训练一次模型。Darts 同时提供 baseline models 和 backtesting 能力：[Darts baseline models](https://unit8co.github.io/darts/generated_api/darts.models.forecasting.baselines.html)、[Darts project docs](https://unit8co.github.io/darts/)。
- Nixtla StatsForecast / MLForecast / NeuralForecast 都强调用滑动窗口交叉验证评估模型在过去会如何表现：[StatsForecast cross validation](https://nixtlaverse.nixtla.io/statsforecast/docs/tutorials/crossvalidation.html)、[MLForecast cross validation](https://nixtlaverse.nixtla.io/mlforecast/docs/how-to-guides/cross_validation.html)、[NeuralForecast cross validation](https://nixtlaverse.nixtla.io/neuralforecast/docs/tutorials/cross_validation.html)。
- 电价预测领域已有专门 benchmark：EPF Toolbox 强调可复现、研究标准、标量指标和统计显著性检验，并提供 LEAR / DNN 两类代表模型接口：[EPF Toolbox GitHub](https://github.com/jeslago/epftoolbox)、[EPF Toolbox models](https://epftoolbox.readthedocs.io/en/latest/modules/models.html)、[Applied Energy 2021 review/benchmark](https://doi.org/10.1016/j.apenergy.2021.116983)。
- 电价预测文献长期强调短期电价预测的特殊性：价格尖峰、季节性、负荷、市场结构和外生变量都会影响结果。Weron 的综述和后续 EPF 综述都把严谨评估和合适误差指标作为重点：[Weron EPF review slides/PDF](https://www.wiwi.uni-due.de/fileadmin/fileupload/BWL-LEF/Seminarreihe/RWeron14_Essen.pdf)、[Recent advances in electricity price forecasting](https://scispace.com/pdf/recent-advances-in-electricity-price-forecasting-a-review-of-4h3q1ho3b5.pdf)。
- 面向交易优化时，单点预测不够，后续应升级到分位数/概率预测。MAPIE、sktime 等成熟工具都把 prediction interval / quantile forecast 作为时序预测能力公开出来：[MAPIE](https://scikit-learn-contrib.github.io/MAPIE/1.4.1/)、[sktime probabilistic forecasting](https://www.sktime.net/en/stable/examples/01b_forecasting_proba.html)。

这些经验对应到本项目，就是四条硬规则：先保留 same-slot baseline；任何模型必须 walk-forward；任何“省钱”必须和 `no_action` 以及真实结算对比；价格尖峰要输出风险区间，而不是只输出一个均值。

## 为什么现在不直接训练深度学习

当前缺少四类关键数据：

1. 用户实际负荷 `actualKwh`。
2. 日/月结算金额和明细。
3. 连续同日对齐历史。
4. 业务约束：预测负荷、持仓、交易限额。

没有这些数据，深度学习只能拟合市场价格片段，不能证明“省钱”。省钱策略的真实目标至少需要把价格预测、用户负荷、持仓约束和结算结果连在一起，否则模型分数提高也可能和实际收益无关。

## 当前为什么是 `heuristic_fallback`

当前 raw captures 已能支持价格、申报、系统负荷和部分合同/交易上下文，但不能支持真实收益闭环：

- 实际用户负荷为空，不能判断移峰或偏差对用户侧的影响。
- 结算接口为空，不能计算真实节省金额。
- 合同只抓到第一页，资产边界不完整。
- 历史同日样本不足，baseline 也不能稳定证明优于规则。
- 持仓和交易限额为空，不能输出可执行 MWh。

因此系统当前只输出人工决策支持：低价窗口、高价暴露、数据缺口、置信度和定向补采队列。

## 置信度怎么算，补什么能涨多少

省钱策略置信度当前按 100 分扣分。扣分不是模型自信度，而是“能否把建议变成可复核收益”的数据完整度评分。补齐某项数据后，对应扣分会消失：

| 缺口 | 当前扣分 | 补齐后提升 | 为什么重要 |
| --- | ---: | ---: | --- |
| 目标日用户实际 96 点负荷 | -25 | +25 | 没有用户侧实际用电，不能验证移峰或偏差影响。 |
| 目标日结算金额/明细 | -20 | +20 | 没有结算，不能核算真实节省金额。 |
| 合同分页未全量抓取 | -10 | +10 | 合同边界不完整，无法确认合约覆盖和敞口。 |
| 交易序列缺失或过旧 | -10 | +10 | 交易背景不足，无法判断当前可交易窗口。 |
| 系统负荷预测缺失 | -10 | +10 | 少了市场压力解释变量。 |
| 当日实时均价少于 48 点 | -10 | +10 | 价格窗口不完整，容易误判分位阈值。 |
| 连续历史不足 | -15 | +15 | 不能证明模型比规则更好。 |
| 回测不可用 | -15 | +15 | 没有过去样本验证，就不能声明策略有效。 |
| 业务约束为空 | -15 | +15 | 没有持仓、限额和预测负荷，不能输出可执行 MWh。 |

本地历史核对单已经显著提升“训练标签”和“历史复盘”的可用性，但目标日缺口仍然会保留扣分。也就是说，1 月现货核对单能让模型学习和回测更扎实，不能替代 2026-06-29 当天的实际负荷、结算和持仓。

## 讨要数据口径

可以直接向业务或结算侧要下面这段：

> 为了把省钱策略从“价格窗口提示”升级到“可回测、可复核的节省金额建议”，请提供同一主体、同一结算单元、同一交易日口径的数据：1. 目标日及最近至少 30 个连续交易日的用户实际 96 点日电量，字段包含日期、96 点时段、实际用电量；2. 对应交易日的日结算明细或结算核对单，字段包含 96 点电量、电价、电费、日前/实时偏差、交易节约费用；3. 目标日持仓曲线、可买可卖量、交易限额、最小交易单位和人工约束；4. 当天申报曲线、日前出清、实时均价、系统负荷预测。请保留原始 Excel/CSV，不要只给截图；如有多个结算单元，请标明主体、户号、结算单元和日期范围。

## 已接入的结算参考层

当前版本会通过 `/api/settlement/reference` 扫描本地根目录下的 Excel 工作簿，并登记手工导出清单 `data/jspec/manual-exports/*/*/manifest.json`。这一步能把现货核对单、交易计算表、月度交易电量电价表、实际负荷导出目标、结算文件导出目标和持仓曲线导出目标放进同一个证据视图。

这层的定位是“复核参考”和“升级钩子”。历史现货核对单中逐日 96 点的 `用电量` 和 `交易电费` 可以补历史 `actualKwh` / `settleAmount` 训练标签；交易计算表标准化 CSV 中的 `customer_usage_96.csv` 和 `submission_power_96.csv` 可以补部分月末历史 `actualKwh` / `declarationPower`，`hourly_summary_rows.csv` 和 `hourly_transaction.csv` 可以补小时级持仓、操作量、近三天用电均值和交易测算参考。但这些数据不能代表目标交易日已经有实际负荷、结算、持仓或交易限额。月度交易电量电价表只能做长期背景，不能当作日内点位结算；手工导出 manifest 如果 `files` 为空，只说明补采目标已经登记，不说明数据已经到位。

本轮重新盘点后，系统还显式接入了两类容易漏掉的本地信息：

- `2026年交易电量、电价、结算一览表.xlsx` 的 2026 年月度行，目前可解析 2026-01 和 2026-02 的实际结算电量、结算电价、国网代理价格、现货占比和节约金额。这些字段通过 `/api/settlement/reference` 的 `monthlyOverviewRows` 暴露，用于长期成本背景和人工复核。
- 同一个月度总表中的 `近三年情况` 也会解析为 `longTermOverviewRows`，包含 2023、2024、2025预计的年度交易规模，以及 2026 年双边、挂牌等年度成交背景。这些只能用于长期成本和年度交易背景，不参与目标日可执行电量计算。
- `4、2026年1月现货核对单 .xlsx` 的每日 96 点页不仅有 `用电量` 和 `交易电费`，还包含日前曲线预估、日前/实际比例、低于 95% 或高于 105% 电量、日前偏差、实时偏差、能量块结算和交易节约费用。系统现在把这些额外点位指标作为 `featureRows` 的参考字段带入 `/api/forecast/features`，但不把它们当成目标日可执行约束。

因此系统仍保持：
- 历史核对单可提供历史 `actualKwh` / `settleAmount` 候选行。
- 交易计算表标准化 CSV 可提供部分历史 `actualKwh` / `declarationPower` 候选行。
- 交易计算表小时级汇总可提供历史持仓和操作量参考，但只能用于建模特征探索和人工复核，不能预填目标日交易量。
- 目标日仍需从 JSPEC 或结算文件取得对应日期的实际负荷和结算。
- 省钱策略和执行提案只把结算参考作为证据说明，不用它预填可执行 MWh。

## 现阶段模型抽象

当前预测基于三个抽象：

1. 96 点特征行：每个交易日按 15 分钟点位对齐价格、申报、系统负荷、实际负荷、结算和来源证据。
2. same-slot baseline：用目标日前同一时点的历史值生成基线预测。
3. walk-forward 回测：按日期向前滚动，只用评估日前的数据预测评估日。

这不是最终模型，而是一个可验证底座。未来任何统计模型、树模型或神经网络都必须先赢过这些 baseline，并且不能使用未来数据。

## 后续升级路径

补齐数据后按以下顺序升级：

1. 收集至少 30 个连续交易日的 96 点价格、用户实际负荷、申报、系统负荷预测和结算。
2. 补齐 `forecast-load-96.csv`、`position-96.csv`、`trade-limits.json`。
3. 在现有 feature store 上增加天气、节假日、工作日、合同覆盖、交易序列、滞后价格、尖峰标签等特征。
4. 先加入统计和机器学习 baseline：季节 naive、滚动分位数、ElasticNet、LightGBM/XGBoost 类模型。
5. 再评估深度学习或概率预测模型：N-BEATS、TFT、DeepAR、Transformer 类模型。
6. 每次升级必须做 walk-forward 回测，并和 `no_action`、same-slot baseline 比较。
7. 只有同时具备实际负荷、结算和业务约束，才允许输出可执行电量建议；否则仍保持人工决策支持。

## 当前系统应该如何使用

当前最有价值的动作是定向补采和人工复核：

- 每天先看“数据资产”和“预测实验室”。
- 只补采最多 4 个目标，每个目标间隔不少于 20 秒。
- 看“省钱策略”里的三档建议和置信度扣分。
- 生成报告，把 `savingsFocus.dataNeeds` 当作下一轮数据收集清单。
- 不自动提交 JSPEC，不读取 cookie，不拦截网络，不输出可执行电量。
