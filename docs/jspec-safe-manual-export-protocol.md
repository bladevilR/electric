# JSPEC 人工导出落盘规范

本文档定义后续补齐业务数据时的文件摆放、manifest 字段、操作记录和 parser 输出要求。目标是让能量块、限额、持仓、实际负荷和结算数据能够被稳定解析进本地事实表。

## 推荐流程

```text
用户使用普通 Chrome + CA 手工登录 JSPEC
-> 用户手动进入目标查询页面
-> 用户手动选择查询条件
-> 用户手动点击查询
-> 用户手动导出 Excel/CSV/PDF，或按规范转录页面表格
-> 将文件放入本地 data/jspec/manual-exports/
-> 项目脚本离线解析导出文件并生成质量报告
```

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

`files/` 下放原始导出文件。需要提交测试样本时，另放一份最小化样本，避免把大文件和无关页面内容混进代码仓库。

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
  "run_notes": [
    "普通 Chrome + CA 手工登录",
    "页面查询后导出",
    "导出文件已放入 files 目录"
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
- 行数、缺失点、重复键、单位检查、已知限制
