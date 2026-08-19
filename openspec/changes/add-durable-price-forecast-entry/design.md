## Context

当前 `index.html` 加载的是新版 `workbench.js`，其侧栏只有申报、曲线、进化与复盘入口；旧 `app.js` 虽然仍实现了价格预测页面，但不再是启动首页。《一分钟上手》仍按旧页面写，形成入口错配。服务端已有 `/api/forecast/model`，但 `server.mjs` 只把最近一次接受的 UKey 快照写入 `data/ukey-visible-snapshot.json`，新采集会覆盖旧交易日。

Windows 包会被解压到任意目录，因此运行期历史不能继续依赖包目录。系统仍必须保持本地运行、安全字段拒收、人工复核和不自动提交交易的边界。

## Goals / Non-Goals

**Goals:**

- 在当前新版工作台提供一个明确、真实、可用的“价格预测”导航入口。
- 按日期和 96 点位幂等累计已验证的可见业务行，并在包升级后保留。
- 显示有效历史交易日进度；满 5 个历史交易日且目标日存在时自动返回并展示预测。
- 保持现有 `/api/forecast/model` 合约兼容，并为工作台增加所需的轻量状态。
- 让 Windows 一键启动、旧快照迁移、文档和实际页面一致。

**Non-Goals:**

- 不引入外部黑盒 AI 服务或声称预测精度已达到生产模型水平。
- 不从 JSPEC 读取 Cookie、Token、UKey PIN、证书或未显示数据。
- 不自动提交申报或交易。
- 不尝试恢复已经被旧版覆盖且磁盘上不存在的历史日期。

## Decisions

1. 新增 `lib/visible-history.mjs`，集中负责历史文档规范化、按 `${date}:${pointIndex}` 幂等合并、日期摘要和原子写入。服务端仍沿用现有敏感字段校验，只有 `accepted` 快照进入历史。
2. Windows 启动器设置 `TRADING_VISIBLE_HISTORY_PATH=%LOCALAPPDATA%\ElectricTradingAI\data\ukey-visible-history.json`。首次没有历史文件时，服务端把 `--visible-snapshot` 指向的旧快照纳入历史；非 Windows 和测试环境可通过命令行显式指定路径。
3. 历史文件保存规范化后的业务行与 `generatedAt/source` 元数据，不保存浏览器登录信息。写入采用同目录临时文件加 rename，避免中断造成半文件。
4. 有效历史交易日按至少一个可比较的 `realTimeAvgPrice` 点计算；预测仍由现有 rolling same-slot median 基线生成。满足 5 个早于目标日的有效日期、目标日有行且存在可比点位时，状态自动变为 `baseline_ready`。
5. 新版工作台侧栏新增独立 `forecast` stage。点击后按所选日期懒加载 `/api/forecast/model`，展示累计进度、状态、96 点预测摘要与区间；不把旧 `app.js` 重新设为首页。
6. 文档只引用真实入口；“用了 5 天”明确为成功采集并保存了 5 个有效交易日，而不是仅打开程序 5 天。

## Risks / Trade-offs

- [旧版已覆盖的日期无法恢复] → 首次启动只迁移仍存在的最后快照，并在发包说明中如实说明。
- [同日重复采集可能含更完整字段] → 采用非空字段覆盖和键级 upsert，同日重采补齐而不重复。
- [本地用户目录不可写] → 启动失败时保留明确日志，不退回包内路径假装持久化成功。
- [5 天样本仅支持基线而非高精度模型] → 页面明确标注“历史同点位中位数基线”和证据数量，不声称实际节省。
- [旧测试依赖包内快照路径] → 通过 `--visible-history` 和临时目录保持测试隔离。

## Migration Plan

1. 合并现有 `main` 与 `origin/main` 的等价文件树历史。
2. 发布包首次启动时创建 LocalAppData 历史目录。
3. 若持久历史不存在且包目录内有已接受的旧快照，自动迁移该快照。
4. 后续每次接受采集结果都更新持久历史；包内旧快照只作一次迁移来源。
5. 回滚旧版不会删除 LocalAppData 历史；重新安装新版可继续读取。

## Open Questions

无。当前阈值沿用现有 5 个历史交易日基线门禁。
