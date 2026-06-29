# JSPEC 人工导出包（2026-05-13）

本目录只接收用户在普通 Chrome + 国信 CA/UKey 下手工查询、手工导出的业务文件。

禁止放入：

- Cookie、x-ticket、Authorization、headers、HAR
- CA PIN、证书私钥、UKey 私钥
- Chrome profile、Local Storage、Session Storage、登录态缓存
- 自动化脚本重放得到的接口响应

优先导出顺序：

1. `energy_block_trades`：能量块成交结果
2. `energy_block_limits`：能量块可买可卖量/限额
3. `position_curve`：持仓量查询
4. `contract_monthly_energy`：合同分月电量
5. `actual_daily_96`：用户实际 96 点日电量
6. `settlement_files`：结算/下载中心文件列表

每个子目录中的 `manifest.json` 需要随文件同步填写查询条件和安全说明。
