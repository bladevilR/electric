# JSPEC CA 后续工作执行计划（2026-05-12 v2）

> 建议仓库路径：`docs/jspec-ca-next-work-plan-2026-05-12-v2.md`
> 依据文档：`docs/jspec-ca-capture-status-2026-05-12.md`
> 适用项目：`bladevilR/electric` / 智能电力交易决策
> 本计划面向后续数据工程实现：盘点已有数据、修正标准化字段、补齐人工导出样本、建设事实表和决策输入层。

---

## 0. 一句话结论

从 2026-05-12 这轮状态看，项目下一步应把重点放到可交付的数据工程闭环：

```text
盘点已有本地数据
-> 修正 96 点标准化字段
-> 人工导出补齐能量块/限额/持仓
-> 建三张关键事实表
-> 输出交易决策输入层 v0
```

当前最重要的判断是：

1. **已有数据足够支撑工程化第一步。** 本轮有 155 个本地响应、标准化 96 点数据、合同/结算/市场环境/公告等入口数据，先把这些变成稳定数据资产。
2. **真正缺口集中在三类交易边界数据。** 优先补能量块成交结果、能量块可买可卖限额、持仓量查询。补齐后才能讨论可买、可卖、调仓空间和策略建议。
3. **浏览器侧能力需要继续验证。** 插件模块可加载，但运行时初始化曾超时；后续可把可见表格读取、字段映射和导出文件 ingest 做成统一入口。

---

## 1. 当前状态复盘

### 1.1 当前登录与数据状态

已确认：

- 用户已确认 JSPEC 当前可以重新登录。
- 自动开页、抓包监听、能量块路由尝试进程已经停止。
- 最后一次本地抓包会话更新时间为 `2026-05-12 10:24:15`。
- 当前不再对 JSPEC 发起自动请求。
- 本次状态文档只记录页面、时间、数据类型和结果口径。

需要继续补齐的工程信息：

- 关键页面的可导出文件格式。
- 能量块成交、限额、持仓三类页面的查询条件。
- 导出文件字段名、单位和日期语义。
- 能进入 parser 的最小样本。

### 1.2 风控异常结论

异常触发链路：

```text
自动打开多个 JSPEC SPA 路由
-> 切到 pxf-trade-auction-extranet 能量块应用
-> 本地抓包出现 /px-common-authority/user/login2
-> 请求记录 isCfcaLogin: false
-> 返回 4016 / API访问黑名单
```

结论：

- 这段历史说明能量块入口已经被定位过，但还缺有效明细。
- 后续最有价值的产物不是更多入口名，而是能解析的导出样本和稳定字段映射。
- 该记录可作为 parser 设计时的页面/接口线索。

### 1.3 已有数据资产

本地抓取目录：

```text
E:\electric\jspec-capture\output\session-20260512-101623
```

标准化输出：

```text
E:\electric\jspec-capture\output\session-20260512-101623\standard\standard-96.csv
E:\electric\jspec-capture\output\session-20260512-101623\standard\standard-96.json
E:\electric\jspec-capture\output\session-20260512-101623\standard\dataset-summary.json
E:\electric\jspec-capture\output\session-20260512-101623\standard\quality-report.md
E:\electric\jspec-capture\output\session-20260512-101623\inspection-summary.md
```

已到手数据类别：

| 类别 | 当前价值 | 下一步处理 |
| --- | --- | --- |
| 日前主动申报 `user_bid_96` | 可用于还原用户日前报价/申报曲线 | 修正字段映射，确认日期、点位、功率/价格含义 |
| 日前缺省申报 `user_default_bid_96` | 可作为默认申报基线 | 与主动申报、出清结果做差异分析 |
| 日前用户侧出清 | 可作为用户实际日前成交/出清依据 | 标准化为 96 点出清事实表 |
| 日前公开出清 | 可作为市场公开日前价格/出清上下文 | 修正价格字段映射 |
| 实时公开出清 | 可作为实时市场价格上下文 | 修正价格字段映射 |
| 实时均价 | 已有 57 个非空点 | 检查缺失点是未出清、字段问题还是时间问题 |
| 合同数据 | 可做合同台账、合同类型、合同电量/均价基础 | 建合同标准表 |
| 结算入口数据 | 有入口和查询条件，但结果不完整 | 先做文件索引和查询条件记录，不强抓 |
| 市场环境 96 点数据 | 可做负荷预测/实际负荷上下文 | 并入市场环境曲线表 |
| 交易公告/挂牌入口 | 可用于交易批次、序列、类型识别 | 标准化公告与交易序列表 |

### 1.4 关键缺口

优先级最高的缺口只有三类：

| 优先级 | 缺口 | 需要的字段 | 采集方式 |
| --- | --- | --- | --- |
| P0 | 能量块成交结果 | 成交方向、执行日、小时、成交量、成交价、交易序列 | 用户人工进页面、人工查询、优先导出 Excel/CSV/PDF |
| P0 | 能量块可买可卖量/限额 | 可买量、可卖量、限额、批次、日期 | 用户人工查询、人工导出 |
| P0 | 持仓量查询 | 小时/96 点持仓、已成交、可调仓边界 | 用户人工查询、人工导出 |
| P1 | 合同分月电量 | 年月、主体、合同类型、分月电量/均价 | 人工查询/导出后解析 |
| P1 | 用户实际 96 点日电量 | 日期、用户、96 点电量 | 人工查询/导出后解析 |
| P2 | 日结算/月结算 | 账期、主体、结算项、金额/电量 | 确认可查账期后人工导出 |
| P2 | 下载中心文件 | 文件名、月份、类型、下载结果 | 人工搜索、人工下载 |

---

## 2. 本次计划相对上一版的修正

上一版计划偏“建设 capture runner”。基于本次状态文档，需要调整为：

| 事项 | 旧方向 | 新方向 |
| --- | --- | --- |
| JSPEC 数据获取 | 尝试建设自动 capture 闭环 | 停止 JSPEC 自动请求，只做人工导出 + 离线分析 |
| 浏览器工具 | 期待 `@浏览器` 慢速可见自动挖掘 | 先验证可见表格读取、字段映射和快照落盘 |
| 接口探索 | 通过页面路由/抓包寻找更多接口 | 不再路由探测；只记录人工页面和导出文件 |
| 近期编码重点 | runner/client/auth | inventory/parser/schema/quality/manual-export-ingest |
| 策略目标 | 直接对接交易决策 | 先形成可靠数据契约，再做建议和复核口径 |

因此，后续代码主线应从“抓取模块”改成“离线数据工程模块”。

---

## 3. 总体路线图

```text
阶段 A：安全冻结与资料归档
阶段 B：本地 session 数据资产盘点
阶段 C：96 点标准化字段修正
阶段 D：合同/公告/市场环境标准表建设
阶段 E：人工导出补齐能量块、限额、持仓
阶段 F：决策输入层 v0
阶段 G：策略评估与人工复核
```

每个阶段都要产出可检查的工程结果：

1. 输入文件或来源目录明确。
2. 输出文件、schema、quality report 和测试命令明确。

---

## 4. 具体执行计划

### 阶段 A：资料归档与交接

目标：把 2026-05-12 上午的尝试变成可追溯记录，供后续实现 parser 和事实表时引用。

建议新增/确认文件：

```text
docs/jspec-ca-capture-status-2026-05-12.md
docs/jspec-ca-next-work-plan-2026-05-12-v2.md
docs/jspec-safe-manual-export-protocol.md
```

建议新增 `.gitignore` 数据文件规则：

```gitignore
# JSPEC local capture / credentials / browser runtime
jspec-capture/output/
data/jspec/raw/
data/jspec/manual-exports/**/*.cookie
data/jspec/manual-exports/**/*.har
data/jspec/manual-exports/**/*.headers
data/jspec/manual-exports/**/*ticket*
data/jspec/manual-exports/**/*authorization*
*.p12
*.pfx
*.key
*.pem
*.crt
*.cer
*.der
```

验收标准：

- 状态文档已提交。
- 本计划已提交。
- 已知入口、已有本地数据、仍缺样本三类信息能在文档中找到。
- 下一步实现者能按 PR 拆分继续写 parser、schema 和 quality report。

---

### 阶段 B：本地 session 数据资产盘点

目标：先把 `session-20260512-101623` 内已有文件吃透，而不是继续访问 JSPEC。

建议建设脚本：

```text
scripts/jspec_offline/index_session.py
scripts/jspec_offline/summarize_raw_responses.py
scripts/jspec_offline/build_data_inventory.py
```

这些脚本只允许读取本地文件：

```text
E:\electric\jspec-capture\output\session-20260512-101623
```

建议输出：

```text
data/jspec/inventory/session-20260512-101623/raw-response-index.csv
data/jspec/inventory/session-20260512-101623/raw-response-index.json
data/jspec/inventory/session-20260512-101623/source-endpoint-summary.md
data/jspec/inventory/session-20260512-101623/standard-output-check.md
```

`raw-response-index` 建议字段：

| 字段 | 说明 |
| --- | --- |
| `session_id` | `session-20260512-101623` |
| `source_file` | 原始响应文件路径或文件名 |
| `endpoint_path` | 去除域名后的接口路径，不能包含凭据 |
| `business_area` | bid / clearing / contract / settlement / load / notice / listed / unknown |
| `captured_at` | 文件时间或响应记录时间 |
| `status_code` | HTTP 状态或业务状态 |
| `record_count_guess` | 初步识别的业务数组长度 |
| `has_sensitive_headers` | 是否疑似包含敏感头，必须为 false 才能入库 |
| `standardized_table` | 已映射到的标准表名 |
| `notes` | 异常说明 |

重点检查项：

- 原文称本轮本地落盘 JSPEC 响应共 155 个，需要确认索引数是否一致。
- 原文称标准化 96 点数据集覆盖 `2026-05-12`、`2026-05-13`，需要确认日期分布。
- 原文称标准表行数 192 行，但各数据源表中存在 288、96 等行数描述，需要解释这些行数口径：是原始点数、标准表行数、长表行数还是多日期合计。
- 所有原始文件都要过敏感字段扫描后再进入仓库。

验收标准：

- 可以生成完整 session inventory。
- 每个原始响应都能归类或标记 unknown。
- 能解释 `192 行` 与各数据源行数之间的口径差异。
- 不新增任何 JSPEC 请求。

---

### 阶段 C：96 点标准化字段修正

目标：把已有 96 点数据变成后续策略模块可信的数据底座。

当前已知问题：

- `date`、`pointIndex`、`timePoint` 完整。
- `defaultDeclarationPower` 有 96 行非空。
- `realTimeAvgPrice` 有 57 行非空。
- 多个日前/实时价格字段在当前标准化映射中仍为 0 行，需要校验字段名映射。

建议建设文件：

```text
src/electric/jspec/schemas/standard_96.schema.json
src/electric/jspec/parsers/standardize_96.py
src/electric/jspec/quality/check_standard_96.py
tests/fixtures/jspec/session-20260512-101623/sample_raw/
tests/test_jspec_standard_96.py
```

建议统一为长表结构，避免每次新增字段都改宽表：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `session_id` | `session-20260512-101623` | 数据来源 session |
| `source_type` | `dayahead_public_clearing` | 数据源类型 |
| `trade_date` | `2026-05-12` | 交易日/查询日，按页面语义确认 |
| `delivery_date` | `2026-05-13` | 执行日/用电日，如有 |
| `point_index` | `1` - `96` | 96 点序号 |
| `time_point` | `00:15` | 点位时间 |
| `metric` | `price_yuan_per_mwh` / `power_mw` | 指标名 |
| `value` | 数值 | 指标值 |
| `unit` | `MWh` / `MW` / `元/MWh` | 单位 |
| `raw_field` | 原始字段名 | 用于追溯字段映射 |
| `source_file` | 文件名 | 来源 |
| `captured_at` | 时间 | 本地捕获时间 |

字段映射修正步骤：

1. 对所有 96 点原始响应做字段名扫描，输出 `raw-field-candidates.md`。
2. 对字段名按中文含义/接口来源/点位长度归类。
3. 将当前 0 行的价格字段逐一映射到原始字段。
4. 对 `queryTableXrdOnlyJiesuan` 区分日前公开出清和实时公开出清的上下文。
5. 对 `queryRealTimeMarAvePricePublic` 的 57 个非空点做缺失原因分类：未到时间、字段为空、解析失败、页面未返回。
6. 生成 `quality-report.md`，包括非空率、点位连续性、日期完整性、单位一致性。

验收标准：

- 每个标准字段都有 `raw_field` 追溯。
- 对所有 0 行字段给出结论：字段不存在、字段名映射错误、当前账号/日期无数据、接口返回为空。
- 96 点点位不重复、不缺号，或能明确解释缺点原因。
- 标准化脚本输入为已落盘的 raw/standard 文件。

---

### 阶段 D：非能量块数据标准表建设

目标：把合同、结算入口、市场环境、公告数据先整理成可用维表/事实表。

#### D1. 合同标准表

来源线索：

```text
/px-contract-extranet/contractApi/getContractListById
/px-contract-extranet/contractApi/getContractListByIdTime
/px-contract-extranet/contractApi/getContractAllType
/px-contract-extranet/baseInfo/Calculation
/px-trade-extranet/noticeFeignAll/queryAllTrSeRoute
```

建议表：`contract_ledger`

| 字段 | 说明 |
| --- | --- |
| `contract_id` | 合同编号或平台内 ID |
| `contract_name` | 合同名称 |
| `counterparty` | 对手方，如有 |
| `contract_type` | 合同类型 |
| `start_date` | 开始日期 |
| `end_date` | 结束日期 |
| `volume_mwh` | 合同电量 |
| `avg_price_yuan_per_mwh` | 均价 |
| `status` | 当前/历史/其他 |
| `source_file` | 来源文件 |
| `captured_at` | 捕获时间 |

#### D2. 市场环境曲线表

来源线索：

```text
/px-spotgoods-province/glbecoParamvalue/getCurve
/px-spotgoods-province/glbecoParamvalue/getGlbtraLfExtPubBo
/px-spotgoods-province/afterDiscloseInformation/queryTableActualSystemLoad
```

建议表：`market_environment_curve`

| 字段 | 说明 |
| --- | --- |
| `date` | 日期 |
| `point_index` | 96 点序号 |
| `time_point` | 时间点 |
| `metric` | forecast_load / actual_load / ext_forecast 等 |
| `value` | 数值 |
| `unit` | MW 等 |
| `source_file` | 来源 |

#### D3. 交易公告与序列表

来源线索：

```text
/px-trade-extranet/tradeNotice/queryTradeInfoListByTypeAndUser
/px-trade-extranet/tradeNotice/queryTradeInfoByTypeAndUser
/px-js-outer-listed-new/Tradeseq/listedTradingList
/px-js-outer-listed-new/Tradeseq/listedTradingListLimit
```

建议表：`trade_notice`

| 字段 | 说明 |
| --- | --- |
| `notice_id` | 公告 ID |
| `title` | 标题 |
| `trade_type` | 交易类型 |
| `sequence_id` | 交易序列/批次 |
| `publish_time` | 发布时间 |
| `effective_date` | 有效日期 |
| `content_summary` | 内容摘要 |
| `source_file` | 来源 |

#### D4. 结算入口与下载中心索引

来源线索：

```text
/px-js-outer-settlespot/rptProcessInfo/selectScroll
/px-js-outer-settlespot/rptProcessInfo/selectConsName
/px-js-outer-settlespot/rptProcessInfo/selectControversy
/px-settlement-extnetpublish/dictionary/getMenuDictItemsByTypeCode
/px-js-outer-settlecal/fileDown/queryFileList
```

当前默认查询为空或标准化 0 行，因此不要急着建结算金额事实表。先建索引表：`settlement_query_inventory`。

| 字段 | 说明 |
| --- | --- |
| `query_page` | 页面或入口 |
| `query_condition` | 已知查询条件，不含凭据 |
| `response_status` | 有数据/空/参数不足/未知 |
| `account_or_subject_available` | 是否拿到主体下拉 |
| `month_or_date_required` | 是否需要账期 |
| `sign_required_guess` | 是否疑似需要 sign 参数 |
| `next_manual_action` | 下一步人工动作 |

验收标准：

- 合同、市场环境、公告至少形成 schema + parser + quality report。
- 结算先形成“可查条件与空结果原因”索引，不强行标准化 0 行。
- 所有表都有 `source_file`，能回到原始响应或人工导出文件。

---

### 阶段 E：人工导出补齐三类关键缺口

目标：用最低风险方式补齐策略所需的交易边界数据。

建议按以下流程取样和落盘：

```text
用户普通 Chrome + CA 登录 JSPEC
-> 用户手动进入目标页面
-> 用户手动选择查询条件
-> 用户手动点击查询
-> 如有导出，用户手动导出 Excel/CSV/PDF
-> 文件放入本地 manual-exports 目录
-> 项目脚本离线解析导出文件
```

本阶段需要记录：

- 页面名称。
- 查询条件。
- 导出文件名。
- 文件类型。
- 字段列名。
- 行数和单位。

#### E1. 能量块成交结果

页面/入口线索：

```text
/pxf-trade-auction-extranet/myTransaction/TradeResult
```

人工操作目标：

- 进入“能量块结果查询”或等价页面。
- 选择执行日、交易序列/批次。
- 查询后优先导出文件。
- 记录页面名称、查询条件、导出时间和文件名。

建议事实表：`energy_block_trades`

| 字段 | 说明 |
| --- | --- |
| `trade_date` | 交易日 |
| `execution_date` | 执行日 |
| `trade_hour` | 小时，如 1-24 |
| `time_point` | 如页面到 96 点则填 96 点，否则为空 |
| `direction` | 买/卖 |
| `quantity_mwh` | 成交量 |
| `price_yuan_per_mwh` | 成交价 |
| `batch_id` | 批次 |
| `sequence_id` | 交易序列 |
| `source_file` | 人工导出文件 |
| `captured_at` | 导出/解析时间 |

#### E2. 能量块限额/可买可卖量

页面/入口线索：

```text
/pxf-trade-auction-extranet/myTransaction/QuotaQuery
```

建议事实表：`energy_block_limits`

| 字段 | 说明 |
| --- | --- |
| `trade_date` | 交易日 |
| `execution_date` | 执行日 |
| `trade_hour` | 小时 |
| `available_buy_mwh` | 可买量 |
| `available_sell_mwh` | 可卖量 |
| `limit_mwh` | 限额，如页面有 |
| `batch_id` | 批次 |
| `sequence_id` | 交易序列 |
| `source_file` | 人工导出文件 |
| `captured_at` | 导出/解析时间 |

#### E3. 持仓量查询

页面/入口线索：

```text
/pxf-js-outer-planmod/fsjyccl
```

建议事实表：`position_curve`

| 字段 | 说明 |
| --- | --- |
| `month` | 月份，如页面按月查询 |
| `trade_date` | 日期，如页面返回 |
| `execution_date` | 执行日 |
| `trade_hour` | 小时 |
| `point_index` | 96 点序号，如页面有 |
| `position_mwh` | 当前持仓 |
| `traded_mwh` | 已成交量 |
| `adjustable_buy_mwh` | 可增加买入边界 |
| `adjustable_sell_mwh` | 可增加卖出边界 |
| `product_type` | 交易品种 |
| `source_file` | 人工导出文件 |
| `captured_at` | 导出/解析时间 |

#### E4. 人工导出文件落盘规范

建议目录：

```text
data/jspec/manual-exports/
  2026-05-12/
    energy_block_trades/
      README.md
      manifest.json
      files/
    energy_block_limits/
      README.md
      manifest.json
      files/
    position_curve/
      README.md
      manifest.json
      files/
```

`manifest.json` 示例：

```json
{
  "export_date": "2026-05-12",
  "operator": "manual",
  "source_system": "JSPEC",
  "page_name": "能量块结果查询",
  "query_conditions": {
    "execution_date": "2026-05-13",
    "sequence_id": "手工填写",
    "batch_id": "手工填写"
  },
  "files": [
    {
      "file_name": "example.xlsx",
      "file_type": "xlsx",
      "contains_credentials": false,
      "notes": "用户手工导出"
    }
  ],
  "run_notes": [
    "普通 Chrome + CA 手工登录",
    "页面查询后导出",
    "导出文件已放入 files 目录"
  ]
}
```

验收标准：

- 三类缺口至少各拿到一份人工导出样本，或明确页面无导出时的截图/表格转录规范。
- 每份导出文件都有 manifest。
- parser 能离线解析为标准事实表。
- 解析结果有质量报告：行数、日期、小时/点位完整性、数值范围、单位。

---

### 阶段 F：决策输入层 v0

目标：先做统一分析输入层，把数据是否足够、可买可卖边界、持仓敞口和复核候选统一输出。

当阶段 C/D/E 完成后，形成一个统一输入视图：`decision_input_v0`。

建议输入：

| 数据 | 用途 |
| --- | --- |
| 日前主动申报 | 识别用户原始申报策略 |
| 日前缺省申报 | 识别默认基线和偏差 |
| 日前用户侧出清 | 识别实际日前成交/出清 |
| 日前公开出清 | 识别市场日前价格环境 |
| 实时公开出清/实时均价 | 识别实时价格环境 |
| 系统负荷预测/实际负荷 | 解释价格波动和负荷背景 |
| 合同台账 | 识别合同覆盖量、合同均价和敞口 |
| 能量块成交结果 | 识别已成交调仓动作 |
| 能量块限额 | 识别可买可卖边界 |
| 持仓量 | 识别当前仓位与可调空间 |

v0 输出建议：

| 输出 | 说明 |
| --- | --- |
| `data_gap_report` | 哪些日期/小时/点位缺数据 |
| `position_exposure_report` | 持仓、合同、日前/实时敞口 |
| `price_context_report` | 日前/实时/均价/负荷上下文 |
| `trade_boundary_report` | 可买可卖、限额、不可操作区间 |
| `manual_review_suggestions` | 需要人工复核的候选机会 |

输出应包含：

- 缺口说明。
- 数据来源。
- 可计算边界。
- 需要复核的小时或点位。
- 当前样本无法支撑的结论。

---

## 5. PR 拆分建议

### PR-0：状态文档和交接口径

内容：

- 提交 `docs/jspec-ca-capture-status-2026-05-12.md`。
- 提交本计划。
- 增加 `.gitignore` 数据文件规则。
- README 中说明离线工具、inventory、manual-export ingest 和输出目录。

验收：

- 文档能说明已有数据、缺口数据、实现顺序和验收口径。
- 新接手的人能直接定位下一步 parser 工作。

### PR-1：session inventory 离线索引

内容：

- 新增本地 session 文件索引脚本。
- 输出 155 个响应的分类、来源、业务区域。
- 增加敏感字段扫描。

验收：

- 输入为本地目录。
- 输出 `raw-response-index.csv/json`。
- 能解释标准表 192 行与各来源计数口径。

### PR-2：96 点 schema 与质量检查

内容：

- 新增 96 点标准 schema。
- 修复价格字段 0 行问题。
- 输出 96 点质量报告。

验收：

- 每个字段有 `raw_field` 追溯。
- 日期、点位、时间完整性可验证。
- 对 57 个实时均价非空点的缺失原因给出结论。

### PR-3：合同/公告/市场环境标准表

内容：

- 合同台账 parser。
- 市场环境曲线 parser。
- 交易公告/序列表 parser。
- 结算查询条件 inventory。

验收：

- 每张表都有 schema、parser、quality report。
- 所有输出有 `source_file`。

### PR-4：人工导出 ingest

内容：

- 建 manual-exports 目录规范。
- 支持 xlsx/csv/pdf 至少一种解析路径。
- 新增 `energy_block_trades`、`energy_block_limits`、`position_curve` 三张事实表 schema。

验收：

- 不访问 JSPEC。
- 能解析人工导出样本。
- 每份样本有 manifest。
- 输出质量报告。

### PR-5：decision input v0

内容：

- 汇总 96 点价格/申报/出清/负荷/合同/能量块/持仓数据。
- 输出数据缺口、价格上下文和复核建议报告。
- 标出缺口和人工复核项。

验收：

- 对每个建议给出数据来源和缺口说明。
- 缺少能量块/持仓时，报告标记为“数据不足”，并说明缺少哪张事实表。

### PR-6：`@浏览器` 非 JSPEC 诊断（可选）

内容：

- 只在本地 HTML 或空白页验证 `@浏览器` 能否打开、点击、等待。
- 不访问 JSPEC。
- 输出诊断记录。

验收：

- `setupAtlasRuntime` 不再超时才可考虑下一步。
- 恢复后优先验证本地页面、可见表格读取和快照质量。
- 通过诊断后再评估是否接入业务页面读取。

---

## 6. GitHub Issue 建议

### P0

1. `docs: freeze JSPEC CA capture status and safe workflow`
2. `data: build offline inventory for session-20260512-101623`
3. `schema: define standard 96-point curve schema`
4. `parser: fix zero-row day-ahead/realtime price field mappings`
5. `quality: explain standard row count and source row count mismatch`
6. `manual-export: define energy block trade/limit/position manifest format`

### P1

7. `parser: standardize contract ledger from captured contract responses`
8. `parser: standardize market load and forecast curves`
9. `parser: standardize trade notices and sequence metadata`
10. `manual-export: ingest energy block trade result xlsx/csv`
11. `manual-export: ingest energy block quota xlsx/csv`
12. `manual-export: ingest position curve xlsx/csv`

### P2

13. `settlement: index settlement query conditions and downloadable file metadata`
14. `decision: build decision_input_v0 read-only dataset`
15. `report: generate data gap and exposure reports`
16. `browser: diagnose @browser runtime on non-JSPEC local page only`

---

## 7. 推荐目录结构

```text
.
├── docs/
│   ├── jspec-ca-capture-status-2026-05-12.md
│   ├── jspec-ca-next-work-plan-2026-05-12-v2.md
│   └── jspec-safe-manual-export-protocol.md
├── data/
│   └── jspec/
│       ├── inventory/
│       │   └── session-20260512-101623/
│       ├── manual-exports/
│       │   └── 2026-05-12/
│       │       ├── energy_block_trades/
│       │       ├── energy_block_limits/
│       │       └── position_curve/
│       └── standardized/
│           ├── standard_96_curve/
│           ├── contract_ledger/
│           ├── market_environment_curve/
│           ├── trade_notice/
│           ├── settlement_query_inventory/
│           ├── energy_block_trades/
│           ├── energy_block_limits/
│           └── position_curve/
├── scripts/
│   └── jspec_offline/
│       ├── index_session.py
│       ├── summarize_raw_responses.py
│       ├── standardize_96.py
│       ├── parse_contracts.py
│       ├── parse_market_environment.py
│       ├── parse_trade_notices.py
│       ├── ingest_manual_export.py
│       └── quality_report.py
├── src/
│   └── electric/
│       └── jspec/
│           ├── schemas/
│           ├── parsers/
│           ├── quality/
│           └── decision_input/
└── tests/
    ├── fixtures/
    │   └── jspec/
    └── test_jspec_*.py
```

说明：

- `data/jspec/manual-exports` 可以不进 git，或者只提交脱敏样本。
- `tests/fixtures` 只能放脱敏、最小样本。
- 原始 session 如包含敏感信息，不能直接提交仓库。

---

## 8. 数据质量规则

### 8.1 通用规则

每张表都必须具备：

- `source_file`
- `captured_at` 或 `exported_at`
- `parsed_at`
- `parser_version`
- `contains_credentials = false` 的检查结果

### 8.2 96 点曲线规则

- `point_index` 范围必须是 1-96。
- 同一 `date + source_type + metric` 下不应重复点位。
- `time_point` 必须能和 `point_index` 对齐。
- 价格字段单位统一为 `元/MWh`。
- 电量字段单位统一为 `MWh`，功率字段单位统一为 `MW`，不能混用。
- 缺失点必须标注原因。

### 8.3 能量块/持仓规则

- 小时级数据必须确认小时编号含义：1-24、0-23 或页面原始小时。
- 如果页面返回 96 点，则必须记录 `point_index`；如果只返回小时，则不要强行扩展成 96 点，除非规则明确。
- 可买可卖量出现负值时，标记异常并保留原始值供复核。
- 成交价为 0 或空时必须区分：真实 0、未成交、解析失败。
- 持仓和限额带查询日期/月份/批次时，再进入策略判断口径。

### 8.4 报告规则

每次解析输出：

```text
row_count
non_null_rate_by_field
missing_points
duplicate_keys
unit_check
source_file_list
safety_scan_result
known_limitations
```

---

## 9. 决策模块接入原则

### 9.1 可以先做的分析

在现有数据前提下，可以先做：

- 日前主动申报 vs 缺省申报差异。
- 日前出清 vs 实时均价差异。
- 负荷预测/实际负荷对价格曲线的解释。
- 合同均价 vs 市场价格上下文。
- 有能量块数据后，计算已成交、可买、可卖、剩余边界。
- 有持仓数据后，计算仓位敞口和可调空间。

### 9.2 依赖补数后再做的分析

在缺少能量块/限额/持仓前，不应输出：

- “可以买多少”的确定结论。
- “可以卖多少”的确定结论。
- 自动申报价格或申报量。
- 自动下单/撤单/确认建议。

可以输出的说法应是：

```text
根据现有日前/实时/合同/负荷数据，某些小时存在价格差异；但由于缺少能量块限额和持仓边界，不能判断可交易量，需要人工补齐 energy_block_limits 和 position_curve 后再复核。
```

---

## 10. 手工页面操作记录模板

每次人工进入 JSPEC 查询页，都建议在 `docs/manual-run-log/` 或 manifest 里记录：

```text
日期时间：
操作人：
登录方式：普通 Chrome + CA 手工登录
页面名称：
页面入口：
查询条件：
等待时间：每步 >= 10 秒
是否点击交易动作：否
是否导出文件：是/否
导出文件名：
是否出现异常提示：否/是，具体提示
是否停止：是/否
备注：
```

遇到以下任何情况立即停止并记录：

- API访问黑名单。
- 认证失败。
- 请重新登录。
- 暂无权限。
- 风险提示。
- 页面要求重新 CA 认证。
- 弹出需要提交、签章、确认类动作。

---

## 11. 近期执行顺序

最推荐的实际顺序：

1. 提交状态文档和本计划，明确数据缺口和工程拆分。
2. 写 `index_session.py`，对 155 个本地响应做索引。
3. 写敏感字段扫描，确保原始文件不会带凭据入仓。
4. 校验 `standard-96.csv/json` 的 192 行口径。
5. 扫描原始 96 点字段，修正日前/实时价格 0 行问题。
6. 把市场负荷预测、实际负荷并入 `market_environment_curve`。
7. 把合同列表/历史合同/合同类型做成 `contract_ledger`。
8. 把交易公告做成 `trade_notice` 和 `trade_sequence`。
9. 编写 `manual-exports` 规范和 manifest 模板。
10. 由用户人工导出能量块成交结果、能量块限额、持仓量。
11. 写离线 parser 解析三类人工导出文件。
12. 汇总成 `decision_input_v0`。
13. 输出数据缺口、价格上下文、仓位敞口报告。

---

## 12. 完成标准

本阶段完成的标准不是“自动抓到了更多接口”，而是：

- 已有 155 个响应被完整盘点。
- 96 点标准表字段映射清楚，0 行字段有解释。
- 合同、市场环境、公告至少形成可追溯标准表。
- 能量块成交结果、限额、持仓三类关键缺口有人工导出样本或明确不可得结论。
- 三张关键事实表 `energy_block_trades`、`energy_block_limits`、`position_curve` schema 已落地。
- `decision_input_v0` 能告诉用户：哪些数据足够、哪些数据缺失、哪些小时需要人工复核。
- 全流程能说明数据来源、解析口径、缺口原因和复核项。

---

## 13. 最小可交付版本定义

若只做一个最小版本，范围如下：

```text
PR-0 文档冻结
PR-1 session inventory
PR-2 96 点字段修正 + quality report
PR-4 三类人工导出 ingest schema
```

最小版本交付物：

```text
docs/jspec-ca-capture-status-2026-05-12.md
docs/jspec-ca-next-work-plan-2026-05-12-v2.md
data/jspec/inventory/session-20260512-101623/raw-response-index.csv
data/jspec/standardized/standard_96_curve/standard_96_curve.csv
data/jspec/standardized/standard_96_curve/quality-report.md
src/electric/jspec/schemas/energy_block_trades.schema.json
src/electric/jspec/schemas/energy_block_limits.schema.json
src/electric/jspec/schemas/position_curve.schema.json
```

做到这里，项目就从“临时抓包尝试”转为“安全、可追溯、可继续建设的数据工程项目”。
