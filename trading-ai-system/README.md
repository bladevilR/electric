# 苏州地铁电力交易 AI 辅助策略系统

这是一个面向苏州地铁电力采购与现货交易业务的本地工程原型。目标是逐步做成可运行、可解释、可复盘的决策辅助系统，而不是单页静态看板。

## 运行

推荐通过本地 API 服务启动：

```powershell
.\run-system.ps1
```

默认地址：

```text
http://127.0.0.1:5177
```

可指定端口：

```powershell
.\run-system.ps1 -Port 5188
```

## 数据链路

服务默认读取：

```text
E:\electric\jspec-capture\output\session-20260507-101645\standard\standard-96.json
```

核心接口：

- `GET /api/health`：服务状态。
- `GET /api/dataset`：前端使用的压缩 96 点数据。
- `GET /api/summary`：数据质量与 P0 数据源覆盖。
- `GET /api/strategy?date=2026-05-07`：确定性 baseline 策略建议。
- `POST /api/refresh`：从标准 JSON 重新生成浏览器降级数据文件。

## 当前模块

- 运营报告
- 收益明细
- 运营商管理
- 自动结算
- 复盘对标
- 公共数据
- 私有数据
- AI 策略工作台

## 验证

```powershell
node --test
```

当前阶段重点是 P0 闭环：本地服务、JSPEC 标准数据读取、数据质量透明展示、规则 baseline 策略建议，以及人工确认边界。系统不自动登录 JSPEC，不自动下单，不绕过 CA/UKey。
