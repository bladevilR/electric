# 数据源与字段字典 v1

更新时间：2026-09-03  
代码基线：`main@e14dddceacefa78a251cca825f722f927982bde4`  
用途：现场字段探索、采集器映射、时点数据仓、预测准确度、策略逻辑链和前端驾驶舱的统一契约。

> 本文中的“待现场确认”是明确状态，不是猜测。当前电脑没有可探索的 JSPEC 页面；除 P0-3 已有截图证据外，JSPEC 页面原始表头、单位、可查历史和更新延迟均不得视为已确认。

## 1. 状态定义

| 状态 | 含义 |
|---|---|
| `confirmed_visible` | 已通过页面截图/现场记录确认可见字段 |
| `confirmed_export` | 已通过平台允许导出或正式文件确认 |
| `code_supported` | 代码存在候选映射，但真实值和页面口径未完全确认 |
| `captured_nonempty` | 仓库证据中已采到非空真实业务值 |
| `captured_empty` | 已捕获来源但结果为空或未提取出标准值 |
| `page_visible_code_missing` | 页面真实存在，代码端到端遗漏 |
| `pending_field_confirmation` | 页面、表头、单位、空值或历史范围待现场确认 |
| `pending_authorization` | 来源存在，但账号权限、合同或许可待确认 |
| `mock_only` | 仅演示数据，不得进入真实模型和准确度统计 |
| `derived` | 由已确认字段计算，必须保存公式版本与输入快照 |

## 2. 数据源目录

| 来源ID | 数据域 | 来源页面/平台 | 合规边界 | 原生粒度 | 发布/更新 | 历史深度 | 当前状态 | 主要用途 | 准确度注意事项 |
|---|---|---|---|---|---|---|---|---|---|
| `JSPEC-P0-1` | 主动申报 | 用户侧96点主动申报；当前路由线索 `/pxf-spotgoods-province-extranet/userBid96/index` | 只读当前账号可见页面/允许导出 | 候选15分钟 | 待现场确认 | 待现场确认 | `pending_field_confirmation` | 历史主动申报 | 不能由缺省或出清值替代 |
| `JSPEC-P0-2` | 缺省申报 | 用户侧96点缺省申报；`/pxf-spotgoods-province-extranet/userDefaultBid96/index` | 同上 | 候选15分钟 | 待现场确认 | 待现场确认 | `code_supported` | 目标日安全基线 | 目标日版本必须保留，不得被后续修订覆盖 |
| `JSPEC-P0-3` | 用户日前出清 | `/pxf-spotgoods-province-extranet/Dd2jyUserClearingResult/Dd2jyRqClearing` | 同上 | 15分钟，已见96行 | 出清后；具体延迟待确认 | 至少已见 `2026-08-24` | `confirmed_visible` + `page_visible_code_missing` | 出清电力、临时价、最终价 | 临时与最终必须分开，最终回填不能改写历史预测输入 |
| `JSPEC-P0-4` | 日前公开出清 | 当前路由线索 `/afterDiscloseInformation/.../DayClearingResult` | 同上 | 候选15分钟 | 待现场确认 | 待现场确认 | `code_supported` | 日前公开价格、节点/区域价格 | 用户日前价与公开价不得互换 |
| `JSPEC-P0-5` | 实时公开出清 | 当前路由线索 `/afterDiscloseInformation/.../CurClearingResult` | 同上 | 候选15分钟 | 实时/事后修订待确认 | 待现场确认 | `code_supported` | 实时节点/区域价格 | 当前值、历史值、最终值需版本化 |
| `JSPEC-P0-6` | 实时加权均价 | `/realTimeClearingRelease/RealTimeMarAvePricePublic` | 同上 | 候选15分钟 | 持续更新规则待确认 | 待现场确认 | `captured_nonempty`（仓库仅57点） | 实时市场加权均价 | 不等同节点价；当前/最终分开 |
| `JSPEC-P0-7` | 实际负荷/电量 | `/pxf-js-outer-deferrableload/dayElectricity` | 同上 | 候选15分钟 | 待现场确认 | 待现场确认 | `captured_empty` | 用户实际电量/负荷 | 先确认功率、区间电量或累计电量，才允许换算 |
| `JSPEC-P0-8` | 日结算 | `/pxf-js-outer-deferrableload/settleDay` | 同上 | 日或明细 | 待现场确认 | 待现场确认 | `captured_empty` | 日结算与策略复盘 | 初算/终算/调整版本必须保留 |
| `JSPEC-P1-1` | 能量块成交 | `/pxf-trade-auction-extranet/myTransaction/TradeResult` | 只读，遇到交易确认立即停止 | 小时/能量块待确认 | 待现场确认 | 待现场确认 | `pending_field_confirmation`，仓库有手工导出 schema | 成交方向、量、价、状态 | 不得当成96点申报功率 |
| `JSPEC-P1-2` | 交易限额 | `/pxf-trade-auction-extranet/myTransaction/QuotaQuery` | 同上 | 小时/交易周期待确认 | 待现场确认 | 待现场确认 | `pending_field_confirmation`，仓库有 schema | 可买/可卖量、限额 | MWh 限额不得误作 MW 申报上下限 |
| `JSPEC-P1-3` | 持仓 | `/pxf-js-outer-planmod/fsjyccl` | 同上 | 小时或96点待确认 | 待现场确认 | 待现场确认 | `pending_field_confirmation`，仓库有 schema | 市场持仓和可调整量 | 方向、产品、执行日必须入主键 |
| `JSPEC-DISCLOSURE-2026` | 供给/网络 | 江苏市场信息披露平台；具体菜单/路由待现场定位 | 只读公开/授权页面 | 日、月、96点混合 | 以页面披露时点为准 | 待现场确认 | `pending_field_confirmation` | 断面、检修、必开必停、价格分量、调整事件 | 监管要求存在不代表当前账号已可见，禁止猜接口 |
| `METRO-INTERNAL-LOAD` | 用户负荷 | 苏州轨道授权计量/能源系统或正式导出 | 仅正式授权，脱敏存储 | 15分钟优先 | 接口/文件时延待确认 | 建议至少2年 | `pending_authorization` | 负荷预测和结果标签 | 与JSPEC日电量交叉核验，口径冲突不得静默覆盖 |
| `METRO-OPS-CALENDAR` | 运营特征 | 运营日历、客流、加开、线路/设备状态 | 仅正式授权 | 日/小时/15分钟 | 待确认 | 建议至少2年 | `pending_authorization` | 用户负荷预测 | 仅使用决策截止前已知计划，事后客流不能进入日前回测 |
| `CMA-AUTH-WEATHER` | 气象 | CMA/国家气象信息中心或企业采购服务 | 按账号、合同和许可使用 | 站点小时/更细待合同确认 | 预报批次和时延待确认 | 实况与历史预报分别确认 | `pending_authorization` | 生产天气首选 | 必须保留预报发布时间，实况不能代替历史预报版本 |
| `CMA-HOURLY-ACTUAL` | 气象实况 | 中国气象数据网逐小时地面观测或正式服务 | 按共享级别和许可 | 小时 | 近实时/归档延迟待产品确认 | 产品元数据为准 | `pending_authorization` | 天气结果、校准和气候基线 | 仅作为实际值或背景 |
| `ECMWF-OPEN` | 气象预报 | ECMWF Open Data IFS/AIFS | CC BY 4.0及条款；不保存凭证 | 模型原生步长，当前AIFS公开为6小时 | 每日4次运行；公开入口仅保留最近约12次运行 | 若不自存仅约2–3天 | `pending_authorization`（开放源配置待实现） | 开发、交叉核验、自建预报历史 | 必须从上线起按运行批次自存；不能用今天下载的数据重构过去发布版本 |
| `ECMWF-ARCHIVE` | 气象历史预报 | ECMWF Operational Archive/MARS | 注册、授权或服务协议 | 依产品 | 依档案 | 可提供历史运行，具体范围依权限 | `pending_authorization` | 无泄漏历史天气预报回测 | 模型版本变化需进入特征版本 |
| `ERA5-LAND` | 气象再分析 | Copernicus ERA5/ERA5-Land | CC BY/产品条款 | 小时 | 近实时后延迟更新 | 1950年至近实时（产品说明） | `pending_authorization` | 实际天气、缺测补全、气候常态 | 是再分析，不是当时预报，不可直接作为日前特征回测 |
| `NOAA-GFS-ARCHIVE` | 气象历史预报 | NOAA NCEI/NOMADS GFS历史档案 | 开放数据条款 | 3小时/产品版本依档案 | 每日4次运行 | 历史档案依产品 | `pending_authorization` | 研究备用与交叉验证 | 网格、版本、国内访问和偏差需单独评估 |
| `SETTLEMENT-XLSX` | 结算 | 已有正式现货核对单和交易结算一览表 | 本地受控目录，禁止公开原始敏感文件 | 日/96点/月 | 文件到达时 | 仓库摘要显示2025-06、09～12及2026-01～02等 | `confirmed_export`（解析能力已有） | 最终经济复盘 | 文件修订、工作表和解析器版本必须保留 |
| `INTERNAL-FORECAST-LEDGER` | 预测记录 | 本系统新增不可变账本 | 本地受控、无凭证 | 每次运行×96点 | 预测生成即写入 | 永久或按审计策略 | `derived` | 真实预测准确度 | 只追加，不覆盖 |

## 3. 统一主键、关联键和时间字段

| 字段 | 含义 | 类型/单位 | 规则 |
|---|---|---|---|
| `sourceId` | 数据源实例 | string | 对应数据源目录，不能用页面名称临时拼接 |
| `fieldId` | 规范字段ID | string | 对应机器可读字段目录 |
| `businessDate` | 交易/执行日 | `YYYY-MM-DD` | 与查询日、发布日分别保存 |
| `pointIndex` | 96点索引 | integer 1..96 | 候选约定1=00:15、96=24:00；逐页现场确认 |
| `intervalStart` / `intervalEnd` | 业务区间 | ISO datetime | 明确点值还是区间值 |
| `eventTime` | 目标时刻 | ISO datetime | 价格、天气、出力等目标时刻 |
| `forecastIssuedAt` | 外部预报发布时间 | ISO datetime | 天气/负荷/新能源预报必填 |
| `publishedAt` | 业务来源发布时间 | ISO datetime | 页面无字段时可空，但必须标缺失原因 |
| `availableAt` | 可用于模型的最早时刻 | ISO datetime | 回测门禁使用，默认不能简单等同抓取时间 |
| `capturedAt` | 本系统采集时间 | ISO datetime | 采集器生成 |
| `sourceRevision` | 来源修订 | string | 页面无版本号时使用受控抓取序号/内容哈希 |
| `evidenceRef` | 证据引用 | string | 指向脱敏截图、导出清单或本地证据索引，不含凭证 |
| `featureSnapshotId` | 特征快照 | UUID/string | 固定一次预测实际使用的全部输入 |
| `forecastRunId` | 预测运行 | UUID/string | 一次目标日/截止时点/模型运行 |

## 4. P0/P1 字段字典

### 4.1 主动申报与缺省申报

| 数据域 | 来源页面/接口 | 页面原始表头/原始字段 | 程序字段 | 业务含义 | 单位 | 类型 | 粒度 | 主键/关联键 | 必填性 | 空值规则 | 更新时间/延迟 | 历史深度 | 当前确认状态 | 证据与待办 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P0-1主动申报 | `JSPEC-P0-1` | 时间表头待确认；代码候选 `timeSlot/timePoint` | `timePoint` | 申报曲线时刻 | HH:mm | string | 15分钟候选 | `businessDate+pointIndex` | 是 | 无法解析则整行无效 | 待现场确认 | 待现场确认 | `code_supported` | 核对首末点、24:00、分页和虚拟滚动 |
| P0-1主动申报 | `JSPEC-P0-1` | 申报功率表头待确认；代码候选 `power` | `userDeclaredPowerMw`（兼容旧`declarationPower`） | 用户主动申报功率 | MW待确认 | number | 15分钟候选 | 同上 | 条件必填 | `-`/空白/null=>null；0保留 | 待现场确认 | 待现场确认 | `code_supported`但仓库标准值为0点 | 现场确认单位和是功率还是电量 |
| P0-1主动申报 | `JSPEC-P0-1` | 上限待确认；代码候选 `powerUpper` | `userDeclaredPowerUpperMw` | 页面给出的申报上界 | MW待确认 | number | 15分钟候选 | 同上 | 可选 | 空值不自动推导 | 待现场确认 | 待现场确认 | `code_supported` | 不与能量块MWh限额混用 |
| P0-1主动申报 | `JSPEC-P0-1` | 下限待确认；代码候选 `powerLower` | `userDeclaredPowerLowerMw` | 页面给出的申报下界 | MW待确认 | number | 15分钟候选 | 同上 | 可选 | 空值不自动推导 | 待现场确认 | 待现场确认 | `code_supported` | 同上 |
| P0-1主动申报 | `JSPEC-P0-1` | 启停/百分比表头待确认；代码候选 `startStopState/percent` | `userDeclarationState` / `userDeclarationPercent` | 申报附加状态 | text / % | string/number | 15分钟候选 | 同上 | 可选 | 原样保留并另做规范映射 | 待现场确认 | 待现场确认 | `code_supported` | 记录枚举和值域 |
| P0-2缺省申报 | `JSPEC-P0-2` | 时间待确认 | `timePoint` | 缺省申报时刻 | HH:mm | string | 15分钟候选 | `businessDate+pointIndex` | 是 | 同P0-1 | 待现场确认 | 待现场确认 | `code_supported` | 核对日期和96点 |
| P0-2缺省申报 | `JSPEC-P0-2` | 缺省功率表头待确认；代码候选 `power` | `defaultDeclaredPowerMw`（兼容旧`defaultDeclarationPower`） | 平台缺省申报基线 | MW待确认 | number | 15分钟候选 | 同上 | 是（策略基线） | null不允许用主动申报/出清/负荷补齐 | 待现场确认 | 待现场确认 | `captured_nonempty`，仓库摘要96点 | 核对目标日版本和后续修订 |
| P0-2缺省申报 | `JSPEC-P0-2` | 上限/下限待确认 | `defaultDeclaredPowerUpperMw` / `defaultDeclaredPowerLowerMw` | 缺省申报边界 | MW待确认 | number | 15分钟候选 | 同上 | 可选 | 缺失不自动生成 | 待现场确认 | 待现场确认 | `code_supported`但无非空证据 | 现场确认与P0-1边界关系 |

### 4.2 用户日前出清

| 数据域 | 来源页面/接口 | 页面原始表头/原始字段 | 程序字段 | 业务含义 | 单位 | 类型 | 粒度 | 主键/关联键 | 必填性 | 空值规则 | 更新时间/延迟 | 历史深度 | 当前确认状态 | 证据与待办 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P0-3用户日前出清 | `JSPEC-P0-3` | `时间` | `timePoint` | 96点时刻 | 待确认 | string | 已见96行，15分钟候选 | `businessDate+pointIndex` | 是 | 无法解析则行无效 | 出清后，延迟待确认 | 至少已见2026-08-24 | `confirmed_visible` | 核对00:15/24:00与两个日期 |
| P0-3用户日前出清 | `JSPEC-P0-3` | `出清电力`；后端候选 `clearingPower` | `dayAheadUserClearedPowerMw` | 用户日前实际出清电力，独立于申报 | MW待确认 | number | 15分钟候选 | 同上 | 是 | 空值保留，不得回填主动/缺省申报 | 同上 | 同上 | `page_visible_code_missing` | 端到端新增字段；确认是否MW及正负方向 |
| P0-3用户日前出清 | `JSPEC-P0-3` | `统一结算点电价临时结果` | `dayAheadUserPriceTemporaryYuanPerMwh` | 日前临时价 | 元/MWh待确认 | number | 15分钟候选 | 同上 | 条件必填 | `-`/`--`/空白/null=>null；0保留 | 同上 | 同上 | `confirmed_visible`但程序未独立保存 | 核对原始DOM/导出字段名与发布时间 |
| P0-3用户日前出清 | `JSPEC-P0-3` | `统一结算点电价最终结果` | `dayAheadUserPriceFinalYuanPerMwh` | 日前最终价 | 元/MWh待确认 | number | 15分钟候选 | 同上 | 条件必填 | `-`/`--`/空白/null=>null；不得写临时值 | 最终发布后回填 | 同上 | `confirmed_visible`但程序未独立保存 | 核对最终价何时出现、临时价是否保留 |
| P0-3用户日前出清 | 派生 | 无 | `dayAheadUserPriceEffectiveYuanPerMwh` | 当前业务有效价 | 元/MWh | number | 15分钟 | 同上+`asOf` | 条件必填 | `final`非空优先，否则经规则确认后用`temporary` | 每次查询视图计算 | 与原始价相同 | `derived` | 同时输出`effectiveSource`，不改写原始字段 |

### 4.3 日前/实时公开价格

| 数据域 | 来源页面/接口 | 页面原始表头/原始字段 | 程序字段 | 业务含义 | 单位 | 类型 | 粒度 | 主键/关联键 | 必填性 | 空值规则 | 更新时间/延迟 | 历史深度 | 当前确认状态 | 证据与待办 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P0-4日前公开 | `JSPEC-P0-4` | 时间待确认 | `timePoint` | 日前公开点位 | HH:mm | string | 15分钟候选 | `businessDate+pointIndex+priceZone` | 是 | 无法解析则行无效 | 待现场确认 | 待现场确认 | `code_supported` | 确认日期、区域、节点和结算点口径 |
| P0-4日前公开 | `JSPEC-P0-4` | 出清电力表头待确认；代码候选 `clearingPower` | `dayAheadPublicClearedPowerMw` | 市场公开出清电力 | MW待确认 | number | 15分钟候选 | 同上 | 可选 | 空值保留 | 待现场确认 | 待现场确认 | `code_supported`但无非空仓库证据 | 不与用户出清电力混用 |
| P0-4日前公开 | `JSPEC-P0-4` | 统一/结算点价格表头待确认；代码候选 `unitPrice` | `dayAheadPublicPriceYuanPerMwh` | 日前公开价格 | 元/MWh待确认 | number | 15分钟候选 | 同上 | 是（日前公开预测标签） | 空值不回退用户日前价 | 待现场确认 | 待现场确认 | `code_supported`但无非空仓库证据 | 记录临时/最终状态（若页面存在） |
| P0-4日前公开 | `JSPEC-P0-4` | 南/北区及节点表头待确认；代码候选 `southPrice/northPrice/southJdPrice/northJdPrice` | `dayAheadSouthPriceYuanPerMwh`等 | 区域/节点价格 | 元/MWh待确认 | number | 15分钟候选 | `businessDate+pointIndex+nodeOrZoneId` | 可选 | 各列独立为空 | 待现场确认 | 待现场确认 | `code_supported` | 现场记录精确表头和区域含义 |
| P0-5实时公开 | `JSPEC-P0-5` | 时间待确认 | `timePoint` | 实时公开点位 | HH:mm | string | 15分钟候选 | `businessDate+pointIndex+nodeOrZoneId+revision` | 是 | 无法解析则行无效 | 持续/事后更新待确认 | 待现场确认 | `code_supported` | 核对当前、历史、最终状态 |
| P0-5实时公开 | `JSPEC-P0-5` | 南/北区及节点价格表头待确认 | `realTimeSouthPriceYuanPerMwh`等 | 实时区域/节点价 | 元/MWh待确认 | number | 15分钟候选 | 同上 | 条件必填 | 空值保留 | 待现场确认 | 待现场确认 | `code_supported` | 记录发布类型字段和值域 |
| P0-5实时公开 | `JSPEC-P0-5` | 发布类型待确认；代码候选 `southFabuType/northFabuType` | `realTimeReleaseType` | 当前/最终/调整等发布类型 | enum待确认 | string | 15分钟候选 | 同上 | 条件必填 | 原样保存，未知枚举不得猜 | 待现场确认 | 待现场确认 | `code_supported` | 形成版本选择规则 |
| P0-6实时均价 | `JSPEC-P0-6` | 加权均价表头待确认；代码候选 `avgPrice` | `realTimeWeightedAveragePriceYuanPerMwh` | 实时市场加权均价 | 元/MWh待确认 | number | 15分钟候选 | `businessDate+pointIndex+revision` | 是（当前价格基线标签） | 空值保留 | 持续更新待确认 | 待现场确认 | `captured_nonempty`但仅57点 | 核对缺点原因和是否支持历史日期 |
| P0-6实时均价 | `JSPEC-P0-6` | 当前均价/点价候选 `avgPriceCurrent/pointPriceCurrent` | `realTimeAvgPriceCurrentYuanPerMwh` / `realTimePointPriceCurrentYuanPerMwh` | 当前实时价 | 元/MWh待确认 | number | 15分钟候选 | 同上 | 可选 | 空值保留 | 待现场确认 | 待现场确认 | `code_supported` | 页面精确表头待确认 |
| P0-6实时均价 | `JSPEC-P0-6` | 最终均价/点价候选 `avgPriceFinal/pointPriceFinal` | `realTimeAvgPriceFinalYuanPerMwh` / `realTimePointPriceFinalYuanPerMwh` | 最终实时价 | 元/MWh待确认 | number | 15分钟候选 | 同上 | 条件必填 | 不得用当前值写入最终字段 | 最终发布后 | 待现场确认 | `code_supported` | 核对空值与优先级 |

### 4.4 实际负荷、电量和结算

| 数据域 | 来源页面/接口 | 页面原始表头/原始字段 | 程序字段 | 业务含义 | 单位 | 类型 | 粒度 | 主键/关联键 | 必填性 | 空值规则 | 更新时间/延迟 | 历史深度 | 当前确认状态 | 证据与待办 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P0-7实际电量 | `JSPEC-P0-7` | 日期/用户/96点表头待确认；代码目前读取`listTableHead`与动态列 | `actualIntervalEnergyKwh` | 15分钟实际区间电量候选 | kWh待确认 | number | 15分钟候选 | `meterOrParticipantId+businessDate+pointIndex` | 是（负荷结果） | 空值保留；0为真实值 | 待现场确认 | 待现场确认 | `captured_empty` | 确认是区间量、累计量还是功率；记录动态列头 |
| P0-7实际负荷 | 派生 | 无 | `actualAverageLoadMw` | 15分钟平均负荷 | MW | number | 15分钟 | 同上 | 条件必填 | 仅在区间kWh确认时=`kWh/250`；否则不计算 | 入库后 | 同原始 | `derived` | 保存`conversionFormulaVersion` |
| 系统负荷预测 | JSPEC市场上下文候选 `glbecoParamvalue/...` | 页面/字段待确认；代码候选 `value/pointValue/realTimeMarketEnergy/dayBeforeEnergy` | `systemLoadForecastMw` | 系统负荷预测 | MW待确认 | number | 15分钟/小时待确认 | `forecastIssuedAt+targetTime+region` | 条件必填 | 不允许无日期复制到全部历史日 | 待现场确认 | 待现场确认 | `code_supported` | 补发布时间和预测批次 |
| 系统实际负荷 | JSPEC市场上下文候选 `queryTableActualSystemLoad` | 页面/字段待确认；代码候选`value1..value96` | `actualSystemLoadMw` | 系统实际负荷 | MW待确认 | number | 15分钟候选 | `businessDate+pointIndex+region+revision` | 可选 | 空值保留 | 待现场确认 | 待现场确认 | `code_supported` | 仅作结果/实时特征，不能进入日前截止前历史 |
| P0-8日结算 | `JSPEC-P0-8` | 日期、金额、状态、明细表头待确认 | `dailySettlementAmountYuan` | 日结算金额 | 元待确认 | number | 日或明细 | `participantId+settlementDate+settlementVersion+lineId` | 是（经济复盘） | 空值保留；0为真实金额 | 初算/终算/调整待确认 | 待现场确认 | `captured_empty` | 确认一日一行或96点/多科目明细 |
| P0-8日结算 | `JSPEC-P0-8` | 状态/版本待确认 | `settlementStatus` / `settlementRevision` | 初算、终算、调整、确认状态 | enum/string | 日或明细 | 同上 | 条件必填 | 未知枚举原样保存 | 同上 | 同上 | `pending_field_confirmation` | 最终经济指标只用明确最终版本 |
| 结算核对单 | `SETTLEMENT-XLSX` | 工作表原始列名由现有解析器记录 | `settlementPriceYuanPerMwh`、`totalTradeFeeYuan`、`totalTradeSavingYuan`等 | 正式核对结果 | 元/MWh、元、MWh | number | 日/96点/月 | `fileHash+sheet+date+pointIndex` | 条件必填 | 保留源空值和解析告警 | 文件到达时 | 已有多月 | `confirmed_export` | 将文件hash、解析器版本和回填时间接入结果账本 |

### 4.5 能量块、限额和持仓

| 数据域 | 来源页面/接口 | 页面原始表头/原始字段 | 程序字段 | 业务含义 | 单位 | 类型 | 粒度 | 主键/关联键 | 必填性 | 空值规则 | 更新时间/延迟 | 历史深度 | 当前确认状态 | 证据与待办 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1-1能量块成交 | `JSPEC-P1-1` | 交易日待确认；schema `trade_date` | `tradeDate` | 成交发生日 | date | string | 每笔/批次 | `tradeDate+executionDate+batchId+sequenceId` | 是 | 不可空 | 待现场确认 | 待现场确认 | `code_supported`（手工schema） | 核对页面精确表头 |
| P1-1能量块成交 | `JSPEC-P1-1` | 执行日/时段待确认；schema `execution_date/trade_hour/time_point` | `executionDate` / `tradeHour` / `timePoint` | 电量交割时段 | date/hour/time | mixed | 小时/块 | 同上 | 是 | 时段至少一种必填 | 待现场确认 | 待现场确认 | `code_supported` | 核对能量块边界 |
| P1-1能量块成交 | `JSPEC-P1-1` | 方向待确认；schema `direction` | `energyBlockDirection` | 买/卖方向 | enum | string | 每笔 | 同上 | 是 | 未确认映射时=`unknown`并告警 | 待现场确认 | 待现场确认 | `code_supported` | 记录页面枚举原文 |
| P1-1能量块成交 | `JSPEC-P1-1` | 成交电量待确认；schema `quantity_mwh` | `energyBlockQuantityMwh` | 成交电量 | MWh待确认 | number | 每笔 | 同上 | 是 | null保留，负值规则待确认 | 待现场确认 | 待现场确认 | `code_supported` | 不与MW申报混用 |
| P1-1能量块成交 | `JSPEC-P1-1` | 成交价待确认；schema `price_yuan_per_mwh` | `energyBlockPriceYuanPerMwh` | 成交价格 | 元/MWh待确认 | number | 每笔 | 同上 | 是 | null保留 | 待现场确认 | 待现场确认 | `code_supported` | 核对含税/含损耗口径 |
| P1-2交易限额 | `JSPEC-P1-2` | 可买/可卖量待确认；schema `available_buy_mwh/available_sell_mwh` | `availableBuyMwh` / `availableSellMwh` | 当期可交易限额 | MWh待确认 | number | 小时/周期 | `tradeDate+executionDate+tradeHour+revision` | 是 | null保留；0为禁止交易 | 待现场确认 | 待现场确认 | `code_supported` | 核对适用日、产品和计算时点 |
| P1-2交易限额 | `JSPEC-P1-2` | 总限额待确认；schema `limit_mwh` | `tradeLimitMwh` | 总交易量限制 | MWh待确认 | number | 小时/周期 | 同上 | 可选 | 不用其填MW申报上下限 | 待现场确认 | 待现场确认 | `code_supported` | 与现有`min/maxDeclarationPowerMw`严格分离 |
| P1-3持仓 | `JSPEC-P1-3` | 持仓待确认；schema `position_mwh` | `positionMwh` | 目标执行日/时段持仓 | MWh待确认 | number | 小时或96点 | `executionDate+productType+hourOrPoint+revision` | 是 | 可正负；方向语义待确认 | 待现场确认 | 待现场确认 | `code_supported` | 核对正负方向和汇总层级 |
| P1-3持仓 | `JSPEC-P1-3` | 已成交/可调整量待确认；schema `traded_mwh/adjustable_buy_mwh/adjustable_sell_mwh` | `tradedMwh` / `adjustableBuyMwh` / `adjustableSellMwh` | 持仓组成与可调整空间 | MWh待确认 | number | 同上 | 同上 | 可选 | 空值不推导 | 待现场确认 | 待现场确认 | `code_supported` | 核对重复汇总和产品类型 |

## 5. 天气字段字典

| 数据域 | 来源页面/接口 | 页面原始表头/原始字段 | 程序字段 | 业务含义 | 单位 | 类型 | 粒度 | 主键/关联键 | 必填性 | 空值规则 | 更新时间/延迟 | 历史深度 | 当前确认状态 | 证据与待办 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 天气维度 | `CMA-AUTH-WEATHER`/ECMWF | 站点/网格ID | `weatherLocationId` | 气象位置 | string | string | 站点/网格 | `provider+model+issuedAt+targetTime+locationId` | 是 | 不可空 | 随预报批次 | 依来源 | `pending_authorization` | 定义苏州负荷与江苏市场两套位置集合 |
| 天气维度 | 同上 | 纬度/经度 | `latitude` / `longitude` | 网格或站点坐标 | degree | number | 静态版本 | `locationId+metadataVersion` | 是 | 不可空 | 元数据变更时 | 依来源 | `pending_authorization` | WGS84等坐标系待确认 |
| 天气版本 | 同上 | 预报发布时间/ECMWF run time | `forecastIssuedAt` | 预报批次发布时间 | ISO datetime | string | 每批次 | 天气主键 | 是 | 不可用抓取时间替代；缺失则禁止进入无泄漏回测 | 每日多次 | 依来源 | `pending_authorization` | 必须早于决策截止 |
| 天气版本 | 同上 | 目标时刻/valid time | `weatherTargetTime` | 气象值对应时刻 | ISO datetime | string | 小时/更细 | 天气主键 | 是 | 不可空 | 随批次 | 依来源 | `pending_authorization` | 转Asia/Shanghai并保留UTC |
| 天气 | CMA字段待合同确认；ECMWF `2t` | `2 metre temperature` | `temperatureC` | 2米气温 | °C | number | 原生小时/6小时等 | 天气主键 | 是 | null保留 | 依来源 | 依来源 | `pending_authorization` | Kelvin转°C时保存转换版本 |
| 天气 | CMA字段待确认；ECMWF `2d` | `2 metre dewpoint temperature` | `dewPointC` | 露点温度 | °C | number | 同上 | 同上 | 可选 | null保留 | 依来源 | 依来源 | `pending_authorization` | 可与温度推导湿度，需公式版本 |
| 天气 | 供应商直接字段或派生 | 体感温度字段待确认 | `feelsLikeC` | 体感温度 | °C | number | 同上 | 同上 | 可选 | 无直接值时仅用已批准公式派生 | 依来源 | 依来源 | `pending_authorization`/`derived` | 记录算法与适用温度范围 |
| 天气 | CMA/供应商或由温度露点派生 | 相对湿度字段待确认 | `relativeHumidityPct` | 相对湿度 | % | number | 同上 | 同上 | 是（负荷模型候选） | 限0..100；超界告警 | 依来源 | 依来源 | `pending_authorization` | 直接值优先，派生值另标来源 |
| 天气 | ECMWF `10u/10v`或供应商字段 | 10m风分量 | `windU10Mps` / `windV10Mps` | 10米风矢量 | m/s | number | 同上 | 同上 | 可选 | 分量各自可空 | 依来源 | 依来源 | `pending_authorization` | 推导风速风向时保存公式版本 |
| 天气 | 派生/供应商 | 风速 | `windSpeed10Mps` | 10米风速 | m/s | number | 同上 | 同上 | 是（风电/体感候选） | 非负；null保留 | 依来源 | 依来源 | `derived`/待确认 | 不混用100米风速 |
| 天气 | 派生/供应商 | 风向 | `windDirection10Deg` | 10米风向 | degree | number | 同上 | 同上 | 可选 | 0..360；静风另标 | 依来源 | 依来源 | `derived`/待确认 | 前端同时显示角度和方位 |
| 天气 | 供应商字段 | 阵风 | `windGustMps` | 阵风速度 | m/s | number | 同上 | 同上 | 可选 | 非负 | 依来源 | 依来源 | `pending_authorization` | ECMWF开放字段可得性按实际产品确认 |
| 天气 | ECMWF `tp`/供应商 | 累计降水 | `precipitationAmountMm` | 指定累计窗口降水 | mm | number | 累积窗口 | `issuedAt+accumulationStart+End+location` | 是（降水候选） | 不得把小时累计复制四次 | 依来源 | 依来源 | `pending_authorization` | 保存累计起止和拆分方法 |
| 天气 | 供应商字段 | 降水概率 | `precipitationProbabilityPct` | 目标窗口降水概率 | % | number | 小时/区间 | 天气主键 | 可选 | 0..100 | 依来源 | 依来源 | `pending_authorization` | ECMWF确定性产品不强行生成概率 |
| 天气 | ECMWF `tcc`/供应商 | 总云量 | `totalCloudCoverPct` | 总云量 | % | number | 同上 | 天气主键 | 是（光伏候选） | 0..100；0保留 | 依来源 | 依来源 | `pending_authorization` | ECMWF若为0..1需转换并记录 |
| 天气 | ECMWF `ssrd` | 下行短波辐射累计 | `surfaceSolarRadiationJm2` | 累积太阳辐射能量 | J/m² | number | 累积窗口 | 同累计主键 | 是（光伏候选） | 不得直接当W/m² | 依来源 | 依来源 | `pending_authorization` | 明确step累计语义 |
| 天气 | 派生 | 无 | `solarIrradianceWm2` | 区间平均短波辐照度 | W/m² | number | 15分钟/小时 | 天气主键+公式版本 | 可选 | 仅由明确累计窗口转换 | 入库后 | 同原始 | `derived` | `J/m² / 秒数`，处理累计差分 |
| 天气 | 供应商 | 天气现象代码 | `weatherConditionCode` | 晴雨雪雷等类别 | enum/string | string | 小时/区间 | 天气主键 | 可选 | 原始码和标准码并存 | 依来源 | 依来源 | `pending_authorization` | 建立供应商映射表 |
| 天气质量 | 本系统 | 无 | `weatherAlignmentMethod` | 小时到15分钟对齐方法 | enum | string | 每字段/点 | `fieldId+recordId` | 是（非15分钟原生时） | 不可空 | 对齐时 | 永久 | `derived` | `native/interpolate/accumulation_split/nearest/forward_fill` |
| 天气聚合 | 本系统 | 无 | `weatherSpatialWeightVersion` | 苏州负荷或江苏市场区域权重版本 | string | string | 每快照 | `featureSnapshotId` | 是 | 无权重时等权实验版并告警 | 配置变更时 | 永久 | `derived` | 两套权重不可互用 |

## 6. 机组、供给、跨区和网络字段字典

> 以下字段的业务价值明确，但当前 JSPEC 页面、精确表头和当前账号真实可得性没有现场证据，统一标为 `pending_field_confirmation`。监管披露要求只能证明“应增加披露”，不能替代页面验收。

| 数据域 | 来源页面/接口 | 页面原始表头/原始字段 | 程序字段 | 业务含义 | 单位 | 类型 | 粒度 | 主键/关联键 | 必填性 | 空值规则 | 更新时间/延迟 | 历史深度 | 当前确认状态 | 证据与待办 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 机组维度 | `JSPEC-DISCLOSURE-2026`或正式授权源 | 待现场确认 | `unitId` / `plantId` | 机组和场站标识 | string | string | 静态/有效期 | `sourceId+unitId+effectiveFrom` | 是（机组级数据） | 不可空；公开页面可使用稳定脱敏键 | 待确认 | 待确认 | `pending_field_confirmation` | 定位菜单并确认是否可见机组级标识 |
| 机组维度 | 同上 | 待现场确认 | `generationType` | 煤电、燃机、核电、风、光等 | enum | string | 静态/有效期 | 同上 | 是 | 未知保留原文 | 待确认 | 待确认 | 同上 | 建立枚举映射 |
| 机组容量 | 同上 | 待现场确认 | `ratedCapacityMw` | 额定装机 | MW | number | 静态/有效期 | 同上 | 是 | 非负；空值不推导 | 待确认 | 待确认 | 同上 | 区域月度总量不能冒充单机额定值 |
| 机组容量 | 同上 | 待现场确认 | `availableCapacityMw` | 指定时点可用容量 | MW | number | 15分钟/小时/日待确认 | `unitOrRegion+eventTime+revision` | 是（供需紧张度） | 空值保留 | 待确认 | 待确认 | 同上 | 确认可用容量定义是否扣除检修/故障 |
| 停运 | 同上 | 待现场确认 | `plannedOutageCapacityMw` | 计划停运容量 | MW | number | 事件/15分钟 | `unit+outageId+revision` | 条件必填 | 0保留；未知不等于0 | 月竞前/调整后待页面确认 | 待确认 | 同上 | 对应发输变电检修计划 |
| 停运 | 同上 | 待现场确认 | `unplannedOutageCapacityMw` | 非计划停运/故障容量 | MW | number | 事件/15分钟 | 同上 | 条件必填 | 未披露时为unknown，不写0 | 待确认 | 待确认 | 同上 | 合规来源不足时仅做缺口告警 |
| 检修 | 同上 | 待现场确认 | `maintenanceStartAt` / `maintenanceEndAt` | 检修窗口 | datetime | string | 事件 | `unitOrAsset+maintenanceId+revision` | 条件必填 | 起止均需明确 | 月竞前及调整后 | 待确认 | 同上 | 计划变更追加版本 |
| 启停 | 同上 | 待现场确认 | `unitOperatingState` | 开机、停机、启动、停运等 | enum | string | 15分钟/事件待确认 | `unit+eventTime+revision` | 可选 | 原文保留；未知不推断 | 待确认 | 待确认 | 同上 | 当前页面 Mock 的“3/3在线”不得迁入真实模式 |
| 必开必停 | 同上 | 待现场确认 | `mustRunFlag` / `mustStopFlag` | 必开/必停约束 | boolean | boolean | 日/事件 | `unit+businessDate+revision` | 可选 | 未披露为null | 日 | 待确认 | 同上 | 对应监管披露项 |
| 开停约束 | 同上 | 待现场确认 | `minUpMinutes` / `minDownMinutes` | 最小开停时间 | minute | number | 有效期 | `unit+effectiveFrom` | 可选 | 非负 | 待确认 | 待确认 | 同上 | “不满最小约束时间名单”与参数值区分 |
| 出力 | 同上 | 待现场确认 | `scheduledOutputMw` | 日前/实时计划出力 | MW | number | 15分钟候选 | `unitOrRegion+scheduleType+targetTime+revision` | 条件必填 | 空值保留 | 日/调整后 | 待确认 | 同上 | 区分原计划与修改计划 |
| 出力 | 同上 | 待现场确认 | `actualOutputMw` | 实际出力 | MW | number | 15分钟候选 | `unitOrRegion+targetTime+revision` | 可选 | 空值保留 | 待确认 | 待确认 | 同上 | 只能在实际可用后作为实时/结果数据 |
| 爬坡 | 同上/辅助服务正式源 | 待现场确认 | `rampUpMwPer15m` / `rampDownMwPer15m` | 可用爬坡能力 | MW/15min | number | 15分钟/有效期 | `unitOrRegion+targetTime+revision` | 可选 | 未知不写页面Mock值 | 待确认 | 待确认 | 同上 | 若只得技术参数与当时可用能力需分字段 |
| 备用 | 正式授权源 | 待确认 | `availableReserveMw` | 可用备用容量 | MW | number | 15分钟/小时 | `region+targetTime+revision` | 可选 | unknown与0分开 | 待确认 | 待确认 | `pending_authorization` | 无公开证据时不进入真实模型 |
| 新能源预测 | 正式披露/授权源 | 待确认 | `windForecastMw` / `solarForecastMw` | 风光预测出力 | MW | number | 15分钟/小时 | `issuedAt+targetTime+region+type` | 是（多因素价格模型） | 空值保留 | 预报批次待确认 | 待确认 | `pending_field_confirmation` | 保留发布时间和预测模型版本 |
| 新能源实际 | 正式披露/授权源 | 待确认 | `windActualMw` / `solarActualMw` | 风光实际出力 | MW | number | 15分钟/小时 | `targetTime+region+type+revision` | 条件必填（误差复盘） | 空值保留 | 待确认 | 待确认 | 同上 | 计算预测误差，不回填历史特征 |
| 跨区电力 | 正式披露/授权源 | 待确认 | `interchangeScheduledMw` | 外来/外送计划 | MW | number | 15分钟候选 | `direction+interface+targetTime+revision` | 可选 | 正负方向明确 | 日/调整后 | 待确认 | `pending_field_confirmation` | 保存原计划和调整版本 |
| 跨区电力 | 同上 | 待确认 | `interchangeActualMw` | 实际交换 | MW | number | 15分钟候选 | 同上 | 可选 | 空值保留 | 待确认 | 待确认 | 同上 | 只用于实时/结果 |
| 断面 | `JSPEC-DISCLOSURE-2026` | 待现场确认 | `sectionId` / `sectionName` | 重要断面/过江通道 | string | string | 静态/有效期 | `sectionId+effectiveFrom` | 是（断面数据） | 不可空 | 配置变化时 | 待确认 | `pending_field_confirmation` | 定位公开页面和稳定标识 |
| 断面 | 同上 | 待现场确认 | `sectionFlowMw` | 96点潮流 | MW | number | 15分钟 | `sectionId+businessDate+pointIndex+revision` | 是 | 空值保留 | 日 | 待确认 | 同上 | 对应监管披露96点潮流 |
| 断面 | 同上 | 待现场确认 | `sectionLimitMw` | 断面约束/限额 | MW | number | 15分钟/事件 | 同上 | 是 | unknown不写0 | 日/调整后 | 待确认 | 同上 | 保存预设约束调整版本 |
| 断面 | 派生 | 无 | `sectionUtilizationPct` | 潮流/限额利用率 | % | number | 15分钟 | 同上+公式版本 | 条件必填 | 限额>0才计算 | 入库后 | 同原始 | `derived` | 方向/双向限额需现场确认 |
| 断面 | 同上 | 待现场确认 | `congestionStatus` | 阻塞状态 | enum/boolean | string | 15分钟 | 同上 | 条件必填 | unknown与false分开 | 日/调整后 | 待确认 | `pending_field_confirmation` | 保留页面原始状态 |
| 节点价格分量 | 同上 | 待现场确认 | `energyPriceComponentYuanPerMwh` | 节点电价电能量分量 | 元/MWh | number | 15分钟 | `nodeId+businessDate+pointIndex+revision` | 可选 | 空值保留 | 日 | 待确认 | `pending_field_confirmation` | 对应监管披露项 |
| 节点价格分量 | 同上 | 待现场确认 | `congestionPriceComponentYuanPerMwh` | 节点电价阻塞分量 | 元/MWh | number | 15分钟 | 同上 | 可选 | 空值保留 | 日 | 待确认 | 同上 | 与总节点价进行恒等校验 |
| 调整事件 | 同上 | 待现场确认 | `marketAdjustmentType` / `marketAdjustmentAt` | 修改机组出力、外来电、出清参数、约束、检修或结果 | enum/datetime | mixed | 事件 | `adjustmentId+revision` | 可选 | 原文保留 | 调整后及时披露 | 待确认 | `pending_field_confirmation` | 作为价格异常事件带和回测可用性特征 |

## 7. 预测、实际结果与准确度字段字典

| 数据域 | 来源页面/接口 | 页面原始表头/原始字段 | 程序字段 | 业务含义 | 单位 | 类型 | 粒度 | 主键/关联键 | 必填性 | 空值规则 | 更新时间/延迟 | 历史深度 | 当前确认状态 | 证据与待办 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 预测运行 | `INTERNAL-FORECAST-LEDGER` | 无 | `forecastRunId` | 一次不可变预测运行ID | UUID | string | 每次运行 | 主键 | 是 | 不可空 | 生成即写 | 永久/审计策略 | `derived`待实现 | 禁止同ID覆盖 |
| 预测运行 | 同上 | 无 | `forecastRunType` | `live_issued/point_in_time_replay` | enum | string | 每次运行 | `forecastRunId` | 是 | 不可空 | 生成即写 | 同上 | `derived`待实现 | 真实发布和历史重放分开 |
| 预测运行 | 同上 | 无 | `forecastGeneratedAt` | 本系统生成时间 | datetime | string | 每次运行 | 同上 | 是 | 不可空 | 即时 | 同上 | 当前模型已有`generatedAt`，账本待实现 | 统一UTC+本地时区 |
| 预测运行 | 同上 | 无 | `decisionCutoffAt` | 本次决策允许使用数据的截止时刻 | datetime | string | 每次运行 | 同上 | 是 | 不可空 | 配置/市场日历 | 同上 | 待实现 | 所有输入必须`availableAt<=cutoff` |
| 预测运行 | 同上 | 无 | `targetTradingDate` | 目标交易日 | date | string | 每次运行 | 同上 | 是 | 不可空 | 生成时 | 同上 | 当前已有`targetDate` | 统一命名迁移 |
| 预测点 | 同上 | 无 | `pointIndex` | 目标96点 | 1..96 | integer | 15分钟 | `forecastRunId+pointIndex+targetField` | 是 | 不可空 | 生成时 | 同上 | 当前已有 | 保留目标字段 |
| 预测运行 | 同上 | 无 | `modelId` / `modelVersion` | 模型和版本 | string | string | 每次运行 | `forecastRunId` | 是 | 不可空 | 模型发布时 | 同上 | 当前只有模型ID | 版本不可用运行时间替代 |
| 预测运行 | 同上 | 无 | `featureVersion` / `featureSnapshotId` | 特征定义及实际输入快照 | string | string | 每次运行 | 同上 | 是 | 不可空 | 生成时 | 同上 | 待实现 | 保存hash和完整性 |
| 预测运行 | 同上 | 无 | `codeCommitSha` | 生成预测的代码提交 | SHA | string | 每次运行 | 同上 | 是 | 不可空 | 生成时 | 同上 | 待实现 | 本地脏工作区另标`dirty=true` |
| 预测运行 | 同上 | 无 | `trainingStartDate` / `trainingEndDate` | 训练数据窗口 | date | string | 每次运行 | 同上 | 条件必填 | 基线也记录证据窗口 | 生成时 | 同上 | 当前仅`evidenceRows` | 防止训练窗漂移不可复核 |
| 预测运行 | 同上 | 无 | `backtestSplitLabel` | train/validation/holdout/shadow/live | enum | string | 每次运行/样本 | 同上 | 是（评估时） | 不可空 | 评估配置 | 同上 | 待实现 | 避免训练样本混入准确度 |
| 预测点 | 同上 | 无 | `pointForecastYuanPerMwh` | 点预测 | 元/MWh | number | 15分钟 | 预测点主键 | 条件必填 | 概率模型可用P50作为点预测但标来源 | 生成时 | 同上 | 当前已有`pointForecast` | 目标价格口径必须随记录保存 |
| 预测点 | 同上 | 无 | `p10YuanPerMwh` / `p50YuanPerMwh` / `p90YuanPerMwh` | 分位数预测 | 元/MWh | number | 15分钟 | 同上 | 概率模型必填 | 分位数必须单调；缺失不伪造 | 生成时 | 同上 | 当前由7日经验分位数生成 | 现阶段标`uncalibrated_baseline`，后续校准 |
| 预测点 | 同上 | 无 | `spikeProbability` | 业务阈值尖峰概率 | 0..1 | number | 15分钟 | 同上 | 可选 | 阈值定义和版本必填 | 生成时 | 同上 | 当前`highPriceRiskLabel`不是正式概率 | 改为预测前可定义阈值 |
| 预测质量 | 同上 | 无 | `inputCompletenessPct` / `fallbackReasons` | 输入完整性和降级原因 | %/array | mixed | 每次运行/点 | 同上 | 是 | 0保留；原因不可空当有降级 | 生成时 | 同上 | 部分状态已有 | 真实模式不回退Mock |
| 实际结果 | `JSPEC-P0-3/P0-4/P0-5/P0-6` | 临时/当前价 | `actualPriceTemporaryYuanPerMwh` | 首次可用实际价格 | 元/MWh | number | 15分钟 | `target+date+point+revision` | 条件必填 | 空值保留 | 来源发布后 | 依来源 | 待独立账本 | 与预测记录关联但不修改预测 |
| 实际结果 | 同上 | 最终价 | `actualPriceFinalYuanPerMwh` | 最终评估标签 | 元/MWh | number | 15分钟 | 同上 | 条件必填 | 不得用临时价填入 | 最终发布后 | 依来源 | 待独立账本 | 保存最终修订 |
| 实际结果 | 同上 | 无 | `actualLabelVersion` / `actualSourceRevision` | temporary/final和来源版本 | enum/string | string | 15分钟 | 同上 | 是 | 不可空 | 回填时 | 永久 | 待实现 | 准确度页面显示回填进度 |
| 实际结果 | 同上 | 无 | `actualBackfilledAt` | 实际值进入系统时间 | datetime | string | 每次回填 | 同上 | 是 | 不可空 | 回填时 | 永久 | 待实现 | 不等同来源发布时间 |
| 误差 | 本系统 | 无 | `forecastError` / `absoluteError` / `squaredError` | 点预测误差 | 元/MWh等 | number | 15分钟 | `forecastRunId+pointIndex+actualRevision` | 条件必填 | 无实际最终值时不算最终误差 | 回填后 | 永久 | `derived`待实现 | 误差方向统一=`forecast-actual` |
| 概率误差 | 本系统 | 无 | `pinballLossP10/P50/P90` | 分位数损失 | 元/MWh | number | 15分钟 | 同上 | 概率预测必填 | 分位数缺失则不算 | 回填后 | 永久 | `derived`待实现 | 计算公式单测 |
| 区间校准 | 本系统 | 无 | `interval80Covered` / `interval80Width` | P10-P90覆盖和宽度 | boolean/元/MWh | mixed | 15分钟 | 同上 | 概率预测必填 | 边界包含规则固定 | 回填后 | 永久 | `derived`待实现 | 按点位和场景统计 |
| 事件误差 | 本系统 | 无 | `spikeThresholdVersion` / `actualSpikeLabel` / `brierScore` | 尖峰定义、实际事件和概率误差 | mixed | mixed | 15分钟 | 同上 | 事件模型必填 | 阈值必须在预测前定义 | 回填后 | 永久 | `derived`待实现 | 不用当日事后P80定义预测标签 |
| 经济复盘 | 结算账本 | 无 | `baselineCostYuan` / `strategyCostYuan` / `actualOperatorCostYuan` | 缺省、模型和人工实际成本 | 元 | number | 日/点 | `forecastRunId+settlementVersion` | 条件必填 | 结算证据不全则null | 最终结算后 | 永久 | `derived`待实现 | 真实结算公式和版本必填 |
| 经济复盘 | 同上 | 无 | `economicRegretYuan` / `savingVsDefaultYuan` | 相对最优/缺省的经济结果 | 元 | number | 日/月 | 同上 | 条件必填 | 不以0代替未知 | 结算后 | 永久 | `derived`待实现 | 与价格MAE并列，不能互相替代 |
| 评估元数据 | 本系统 | 无 | `evaluationRunId` / `evaluationAsOf` / `evaluationConfigVersion` | 一次准确度计算版本 | string/datetime | mixed | 每次评估 | 主键 | 是 | 不可空 | 每次重算 | 永久 | `derived`待实现 | 指标重算不覆盖历史报告 |

## 8. 核心派生字段

| 字段 | 公式/定义 | 输入要求 | 状态 |
|---|---|---|---|
| `dayAheadUserPriceEffectiveYuanPerMwh` | 最终价非空优先，否则按已确认规则使用临时价 | 临时/最终价分列，发布时间与状态已知 | 待现场确认规则后实现 |
| `realTimePriceEffectiveYuanPerMwh` | 最终价非空优先，否则使用当前价 | 当前/最终分列 | 待现场确认规则后实现 |
| `actualAverageLoadMw` | `actualIntervalEnergyKwh / 250` | 必须确认值为15分钟区间kWh | 条件派生 |
| `netLoadForecastMw` | 系统负荷预测 - 风电预测 - 光伏预测 - 计划受入（方向按配置） | 各来源同一目标时刻且发布时间合规 | 待数据源确认 |
| `supplyTightnessRatio` | 净负荷 / 可调度可用容量 | 可用容量定义确认且>0 | 待数据源确认 |
| `reserveMarginPct` | `(availableCapacity - netLoad) / netLoad * 100` | 同上 | 待数据源确认 |
| `rampPressureRatio` | 相邻点净负荷变化 / 可用爬坡能力 | 爬坡口径确认 | 待数据源确认 |
| `sectionUtilizationPct` | `abs(flow) / directionalLimit * 100` | 方向限额规则确认 | 待现场确认 |
| `realTimeSpreadYuanPerMwh` | 实时有效价 - 日前有效价 | 两个价格口径明确 | 可实现 |
| `weatherTemperatureAnomalyC` | 目标温度 - 历史同地区同季节常态 | 权重与气候窗版本化 | 待天气接入 |

## 9. 现有代码与目标差异

### 9.1 已经采集/支持的内容

| 优先级 | 当前能力 | 证据/现状 | 结论 |
|---|---|---|---|
| 已有 | P0-1～P0-8目标清单和路由线索 | `jspec-targets.mjs` | 页面定位骨架可保留 |
| 已有 | 同源iframe/frame与开放Shadow DOM可见表格采集 | main包含`4d08954` | 适合现场字段探索 |
| 已有 | 96点标准列和部分原始字段候选映射 | `standard-96.mjs` | 映射只是候选，不代表页面已确认 |
| 已有 | 价格/申报/负荷/结算特征存储骨架 | `forecast-feature-store.mjs` | 缺时点版本和大量字段 |
| 已有 | 前一日同点、7日同点中位数、P10/P50/P90经验分位 | `forecast-models.mjs` | 作为强基线保留，不能称多因素生产模型 |
| 已有 | MAE/RMSE/Bias和滚动日期回测 | `backtest-engine.mjs` | 缺不可变预测账本、最终价版本和概率校准 |
| 已有 | P1能量块、限额、持仓手工导出schema | `src/electric/jspec/schemas` | 页面表头和真实导出仍待确认 |
| 已有真实摘要 | 缺省申报96点、实时均价57点；其余大量字段0点 | `dataset-summary.json`/`integration-summary.json` | 当前仓库数据不足训练/验证多因素价格模型 |
| 已有 | 多月结算核对单解析摘要 | `integration-summary.json` | 可作为最终经济结果来源，需版本化接账本 |

### 9.2 页面真实存在但代码遗漏/端到端未贯通

| 优先级 | 缺口 | 当前问题 | 必须修改 |
|---|---|---|---|
| P0 | P0-3 `出清电力` | 页面已确认，但当前业务特征链未独立保留 | 可见表头映射→标准字段→feature store→API→前端全链新增`dayAheadUserClearedPowerMw` |
| P0 | 日前临时价/最终价 | 当前feature store主要折叠成单一`dayAheadUserPrice` | 原始两列、有效价、选择来源和发布时间分开 |
| P0 | 实时当前价/最终价 | 标准列有候选，但预测目标主要使用单一`realTimeAvgPrice` | 建立当前/最终/有效三层及标签版本 |
| P0 | 主动/缺省/出清/实际的严格隔离 | 多处字段名缺少业务对象，前端曲线易混淆 | 规范字段、语义校验和UI固定文案 |
| P0 | `forecast-feature-store`无日期行复制到所有日期 | 对时变预测/状态可能造成历史泄漏 | 仅静态且带有效期字段允许展开；其他无日期记录阻断 |
| P0 | 来源发布时间和修订 | 当前主要保存文件/endpoint/生成时间 | 增加`publishedAt/availableAt/sourceRevision/evidenceRef` |

### 9.3 为天气、机组、准确度和驾驶舱必须新增

| 优先级 | 新增项 | 交付结果 |
|---|---|---|
| P0 | 数据源注册表、机器可读字段目录、字段状态与证据索引 | 现场结果可直接驱动采集器和前端，不再散落在文档 |
| P0 | point-in-time事实仓和feature snapshot | 任意历史预测可证明只用截止时点前信息 |
| P0 | 不可变forecast/outcome ledger | 真实发布、历史重放、最终回填分别复核 |
| P0 | 准确度评估服务 | 点预测、概率、尖峰、分场景和经济指标 |
| P1 | 天气适配器、自存预报批次、小时到15分钟语义对齐 | 温度、湿度、风、降水、云量、辐射可追溯 |
| P1 | JSPEC供给/网络现场探索与适配器 | 机组、检修、必开必停、出力、断面、跨区、新能源字段按真实可得性接入 |
| P1 | 市场驾驶舱与证据抽屉 | 所有数值可查看来源、发布时间、目标时刻、版本和质量 |
| P1 | 结构化策略逻辑链 | 数据→负荷→价格→供给/网络→持仓/限额→约束→结果逐点复核 |
| P2 | LEAR/ElasticNet、分位数GBDT和集成模型 | 在强基线之上做可解释、多因素、概率化预测 |
| P2 | Champion/Challenger人工治理 | 只在滚动留出、校准和经济门槛通过后申请晋级 |

## 10. 执行优先级

1. **P0-A 字段语义修复**：P0-3出清电力、临时/最终价、实际负荷单位门禁。
2. **P0-B 现场字段探索**：完成P0-1～P0-8，再完成P1-1～P1-3；每个字段更新本文状态和证据。
3. **P0-C 时点数据与账本**：source registry、field catalog、point-in-time store、feature snapshot、forecast/outcome ledger。
4. **P0-D 准确度复盘**：真实发布/历史重放/结算复盘三套口径和API。
5. **P1-A 天气接入**：优先确定生产授权源，同时接开放源做开发和交叉核验；从第一天自存预报批次。
6. **P1-B 供给与网络接入**：按真实页面可见性逐项接入，缺失显示缺口，不做伪值。
7. **P1-C 前端驾驶舱**：消费真实API，展示数据、逻辑链、结果和证据抽屉。
8. **P2 模型升级**：强基线→稀疏线性→分位数树→集成；通过滚动时点回测和影子运行后再申请人工晋级。

## 11. 现场回填规则

- 现场人员只更新“页面原始表头、单位、样例类型、粒度、空值、更新时间、历史深度、状态和证据”；不得自行改程序字段语义。
- 页面原始表头必须逐字记录，包括括号、空格、换行和“临时/最终”。
- 若页面值和接口/导出字段不一致，两者分行记录，不静默选一个。
- 若字段无法取得，状态改为`unavailable`或`pending_authorization`并写明证据；不删除字段，也不填模拟值。
- 任何来源出现修订，追加`sourceRevision`，不覆盖原版本。
- 字段目录的每次更新必须经过代码评审，并同步相应解析测试、质量规则和前端文案测试。
