# JSPEC CA 抓取状态整理（2026-05-12）

本文档整理 2026-05-12 上午 JSPEC/国信 CA 登录、抓取、风控恢复、数据可用性与后续挖掘边界。本文档不包含 CA PIN、Cookie、x-ticket、Authorization 等登录凭据。

## 一、当前安全状态

- 用户已确认：JSPEC 现在可以重新登录。
- 已停止所有自动开页、抓包监听和能量块路由尝试进程。
- 最后一次本地抓包会话更新时间：2026-05-12 10:24:15。
- 当前不再对 JSPEC 发起任何自动请求。
- `@浏览器` 插件文件可加载，但浏览器运行时初始化超时，当前不可用于 JSPEC 自动挖掘。

本地抓取目录：

- `E:\electric\jspec-capture\output\session-20260512-101623`

标准化输出：

- `E:\electric\jspec-capture\output\session-20260512-101623\standard\standard-96.csv`
- `E:\electric\jspec-capture\output\session-20260512-101623\standard\standard-96.json`
- `E:\electric\jspec-capture\output\session-20260512-101623\standard\dataset-summary.json`
- `E:\electric\jspec-capture\output\session-20260512-101623\standard\quality-report.md`
- `E:\electric\jspec-capture\output\session-20260512-101623\inspection-summary.md`

## 二、CA/UKey 环境确认

本机已识别到江苏数科/国信 CA 相关环境：

- 已安装：江苏数科 CA 证书助手 `1.0.2026.0123`
- 安装路径：`D:\SKClient`
- 运行进程曾包括：`SKClient.exe`、`ClientServer.exe`、`gxSer.exe`
- 证书库中存在 JSGXCA_SM2 企业证书
- 证书主体：苏州市轨道交通集团有限公司
- 证书有效期：至 2027-01-08
- 加密提供程序：HaiTai Cryptographic Service Provider 20575

注意：检查过程中未导出私钥，未读取 PIN。

## 三、异常与恢复记录

问题触发点：

- 曾在自动打开 JSPEC 多个 SPA 路由时切到 `pxf-trade-auction-extranet` 能量块应用。
- 随后本地抓包记录中出现一次 `/px-common-authority/user/login2` 请求。
- 该请求记录显示 `isCfcaLogin: false`。
- 返回状态为 `4016`，返回信息为“API访问黑名单”。

影响判断：

- 当时接口层被 JSPEC 风控拦截。
- 用户随后确认已经可以重新登录，说明限制不是持续锁死状态。
- 后续不得再用批量路由跳转、CDP 调试窗口或后台脚本方式试探 JSPEC。

## 四、本轮已经到手的数据

本轮本地落盘 JSPEC 响应共 155 个，标准化 96 点数据集覆盖：

- 标准表行数：192 行
- 日期：2026-05-12、2026-05-13

### 4.1 日前/实时 96 点数据

已抓到并可作为后续产品数据源：

| 数据源 | 原始响应数 | 标准行数 | 说明 |
| --- | ---: | ---: | --- |
| 日前主动申报 `user_bid_96` | 3 | 288 | `getMosEnergyBidInfoUser` |
| 日前缺省申报 `user_default_bid_96` | 3 | 288 | `getMosEnergyBidInfoUserDefault` |
| 日前用户侧出清 `dayahead_user_clearing` | 1 | 96 | `queryDd2jyRqClearing` |
| 日前公开出清 `dayahead_public_clearing` | 1 | 96 | `queryTableXrdOnlyJiesuan` |
| 实时公开出清 `realtime_public_clearing` | 1 | 96 | `queryTableXrdOnlyJiesuan` |
| 实时均价 `realtime_average_price` | 1 | 96 | `queryRealTimeMarAvePricePublic` |

字段完整性要点：

- `date`、`pointIndex`、`timePoint`：192 行完整。
- `defaultDeclarationPower`：96 行非空。
- `realTimeAvgPrice`：57 行非空。
- 多个日前/实时价格字段在当前标准化映射中仍为 0 行，需要后续校验字段名映射。

### 4.2 合同数据

已抓到当前合同、历史合同及相关字典/路由类接口：

- 当前合同列表：`/px-contract-extranet/contractApi/getContractListById`
- 历史合同列表：`/px-contract-extranet/contractApi/getContractListByIdTime`
- 合同类型：`/px-contract-extranet/contractApi/getContractAllType`
- 合同汇总：`/px-contract-extranet/baseInfo/Calculation`
- 交易路径/路由：`/px-trade-extranet/noticeFeignAll/queryAllTrSeRoute`

这些数据可用于补合同台账、合同类型、合同电量/均价等基础信息，但尚未形成项目标准表。

### 4.3 结算相关

已抓到部分结算入口和查询条件：

- 现货结算单及争议：`/px-js-outer-settlespot/rptProcessInfo/selectScroll`
- 用户/主体下拉：`/px-js-outer-settlespot/rptProcessInfo/selectConsName`
- 争议类型菜单：`/px-js-outer-settlespot/rptProcessInfo/selectControversy`
- 结算单确认字典：`/px-settlement-extnetpublish/dictionary/getMenuDictItemsByTypeCode`
- 下载中心：`/px-js-outer-settlecal/fileDown/queryFileList`

当前限制：

- 下载中心默认查询结果为空。
- 日结算/月结算接口有响应，但标准化结果为 0 行，疑似查询月份、主体、日期或 `sign` 参数不满足返回条件。

### 4.4 市场环境数据

已抓到 96 点类市场环境数据：

- 短期系统负荷预测：`/px-spotgoods-province/glbecoParamvalue/getCurve`
- 短期系统负荷预测扩展数据：`/px-spotgoods-province/glbecoParamvalue/getGlbtraLfExtPubBo`
- 实际系统负荷：`/px-spotgoods-province/afterDiscloseInformation/queryTableActualSystemLoad`

这些数据可用于价格/负荷上下文分析，但尚未并入现有标准 96 点产品表。

### 4.5 交易公告/挂牌相关

已抓到部分交易公告和挂牌入口响应：

- 交易公告列表：`/px-trade-extranet/tradeNotice/queryTradeInfoListByTypeAndUser`
- 交易公告单页：`/px-trade-extranet/tradeNotice/queryTradeInfoByTypeAndUser`
- 挂牌列表：`/px-js-outer-listed-new/Tradeseq/listedTradingList`
- 挂牌限额：`/px-js-outer-listed-new/Tradeseq/listedTradingListLimit`

当前限制：

- 交易公告列表有较多记录，可用于了解批次、交易序列、交易类型。
- 挂牌列表/限额接口当前返回的是状态/提示结构，不是可直接使用的交易明细表。

## 五、仍未知或尚未到手的数据

以下数据目前仍属于“知道入口存在，但未确认账号能否查到有效明细，或未确认必要查询条件”的状态。

| 数据项 | JSPEC 入口/接口线索 | 当前状态 | 后续需要 |
| --- | --- | --- | --- |
| 能量块成交结果 | `/pxf-trade-auction-extranet/myTransaction/TradeResult` | 未拿到明细 | 人工进入页面，选择执行日/交易序列后查询 |
| 能量块可买可卖量/限额 | `/pxf-trade-auction-extranet/myTransaction/QuotaQuery` | 未拿到明细 | 人工进入页面，选择批次/日期后查询 |
| 能量块交易申报盘面 | `/pxf-trade-auction-extranet/tradeDemoSx/rollMatchTrade` | 只确认入口 | 只读观察，不得提交申报 |
| 合同分月电量 | `/pxf-js-outer-planmod/contractMonthlyEng` | 未返回有效业务表 | 需要人工选择年份/月份/主体 |
| 持仓量查询 | `/pxf-js-outer-planmod/fsjyccl` | 未返回有效业务表 | 需要人工选择月份/交易品种 |
| 用户分时电量 | `/pxf-js-outer-settlespot/sellerUserEnergyInfo/UserInfo` | 未返回有效业务表 | 需要人工选择用户/月份/日期 |
| 用户实际 96 点日电量 | `/pxf-js-outer-deferrableload/dayElectricity` | 只抓到 member type，未抓到 `queryDailyElectricity` | 需要人工选择日期并查询 |
| 日结算/月结算 | `settleDay` / `settleMonth` | 接口返回 0 行 | 需要确认可查询月份、主体、sign 参数 |
| 下载中心文件 | `/pxf-js-outer-settlecal/fileDownCenter` | 默认查询为空 | 需要按文件名/月份/类型搜索 |

## 六、`@浏览器` 当前可用性

用户希望改用 `@浏览器` 实现“可见、慢速、每步 10 秒”的自动挖掘。

本轮只做了本地功能诊断，没有访问 JSPEC：

- `browser-use` 插件模块可加载。
- `setupAtlasRuntime` 初始化浏览器运行时超时。
- 未成功接管 in-app browser。
- 未打开网页、未点击页面、未发起 JSPEC 请求。

结论：

- 当前不能依赖 `@浏览器` 自动挖 JSPEC。
- 在 `@浏览器` 恢复前，不应回退到 CDP/脚本批量路由方式。
- 若要继续，应先在非 JSPEC 页面验证 `@浏览器` 能稳定打开本地页/空白页。

## 七、后续安全挖掘原则

必须遵守：

1. 不自动登录，不碰 CA PIN，不触发认证入口。
2. 不使用批量路由跳转、不用 CDP 调试窗口、不后台连续打开页面。
3. 不点击“提交、保存、申报、撤销、确认、签章”等交易动作按钮。
4. 每个操作之间真实等待至少 10 秒。
5. 每一步记录本地日志：时间、页面、动作、等待时长、结果。
6. 遇到“认证失败、黑名单、暂无权限、请重新登录、风险提示”立即停止。
7. 优先导出 Excel/CSV/PDF 后离线分析。

推荐流程：

1. 用户用普通 Chrome + CA 正常登录 JSPEC。
2. 用户手动进入一个目标页面，例如“能量块结果查询”。
3. 用户手动选择查询条件并点击查询。
4. 若页面支持导出，用户手动导出文件。
5. Codex 只分析导出文件或本地落盘数据。
6. 若未来 `@浏览器` 恢复，只允许做可见辅助和只读查询，不允许自动交易操作。

## 八、下一步最小闭环

优先补齐以下三类数据：

1. 能量块结果查询：成交方向、执行日、小时、成交量、成交价。
2. 能量块限额查询：可买量、可卖量、交易限额。
3. 持仓量查询：小时/96 点持仓、已成交、可调仓边界。

拿到上述数据后，再把它们标准化为独立事实表：

- `energy_block_trades`
- `energy_block_limits`
- `position_curve`

建议字段：

- `trade_date`
- `execution_date`
- `trade_hour`
- `time_point`
- `direction`
- `quantity_mwh`
- `price_yuan_per_mwh`
- `available_buy_mwh`
- `available_sell_mwh`
- `batch_id`
- `sequence_id`
- `source_file`
- `captured_at`
