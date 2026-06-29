# JSPEC 安全人工导出协议

本文档定义 JSPEC 后续数据补齐的安全边界。项目代码只处理本地文件，不负责登录、认证、点击交易动作或重放接口请求。

## 允许流程

```text
用户使用普通 Chrome + CA 手工登录 JSPEC
-> 用户手动进入目标查询页面
-> 用户手动选择查询条件
-> 用户手动点击查询
-> 用户手动导出 Excel/CSV/PDF，或按规范转录页面表格
-> 将文件放入本地 data/jspec/manual-exports/
-> 项目脚本离线解析导出文件并生成质量报告
```

## 禁止事项

- 不自动登录 JSPEC。
- 不读取、不保存、不传递 CA PIN。
- 不导出 CA 私钥或证书私钥。
- 不保存 Cookie、x-ticket、Authorization、临时票据或未脱敏请求头。
- 不批量打开 JSPEC SPA 路由。
- 不使用 CDP 调试窗口、后台脚本或请求重放探测页面。
- 不自动点击“提交、保存、申报、撤销、确认、签章”等交易动作。
- 不自动调用能量块、持仓、限额或结算接口。
- 遇到认证失败、黑名单、暂无权限、请重新登录、风险提示，立即停止并记录。

## 人工导出落盘结构

```text
data/jspec/manual-exports/
  YYYY-MM-DD/
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

`files/` 下的原始导出文件默认不进入 git；如需提交测试样本，只能提交脱敏、最小化样本。

## manifest 模板

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
  "safety_notes": [
    "普通 Chrome + CA 手工登录",
    "未自动输入 PIN",
    "未点击提交/保存/申报/撤销/确认/签章"
  ]
}
```

## 每次人工操作记录

建议在 manifest 或 `docs/manual-run-log/` 中记录：

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

## 离线解析要求

每个 parser 输出必须带：

- `source_file`
- `exported_at` 或 `captured_at`
- `parsed_at`
- `parser_version`
- `contains_credentials: false`
- 行数、缺失点、重复键、单位检查、已知限制
