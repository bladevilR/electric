# JSPEC 人工导出包（2026-05-13）

本目录只接收用户在普通 Chrome + 国信 CA/UKey 下手工查询、手工导出的业务文件。

文件内容要求：

- 页面导出的 Excel、CSV、PDF、截图或表格转录文件
- 文件名应能看出页面、日期和查询条件
- 每份文件在 manifest 中登记来源页面和查询条件
- 同一页面多次导出时保留批次号或时间戳

优先导出顺序：

1. `energy_block_trades`：能量块成交结果
2. `energy_block_limits`：能量块可买可卖量/限额
3. `position_curve`：持仓量查询
4. `contract_monthly_energy`：合同分月电量
5. `actual_daily_96`：用户实际 96 点日电量
6. `settlement_files`：结算/下载中心文件列表

每个子目录中的 `manifest.json` 需要随文件同步填写查询条件和导出备注。
