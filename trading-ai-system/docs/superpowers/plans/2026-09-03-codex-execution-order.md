# Codex 分阶段执行总计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Codex 从 `main@e14dddce` 出发，按依赖顺序实现字段探索底座、时点数据、准确度复盘、天气/机组模型和六页驾驶舱，并在每阶段形成可独立评审和回滚的提交。

**Architecture:** 本总计划不重复各子计划的代码步骤，而是锁定阅读顺序、依赖、分支策略、阶段门禁和停止条件。四个实施计划分别负责数据底座、预测复盘、外生数据与模型、前端驾驶舱；后一阶段只能消费前一阶段已经测试通过的稳定接口。

**Tech Stack:** Git、Node.js ESM、原生 `node:test`、Playwright、Python 3.11+ 可选候选模型。

**Spec:** `trading-ai-system/docs/superpowers/specs/2026-09-03-point-in-time-forecast-cockpit-design.md`

## Global Constraints

- 基准分支为 `main`，本轮方案基准提交为 `e14dddceacefa78a251cca825f722f927982bde4`。
- 先比较方案分支，不直接把文档分支合并为功能实现。
- 功能开发使用新的实现分支或 worktree，不在本方案分支上堆代码。
- 现场未确认字段保持 `pending_field_confirmation`，不得为通过测试改成假确认。
- 真实模式不得使用 Mock 值；演示模式必须持续标识模拟输入。
- 不读取或保存 Cookie、Token、Authorization、UKey PIN、证书、私钥或密码。
- 不自动申报、不自动交易、不自动模型晋级。
- 每个阶段完成后必须运行该阶段的聚焦测试和全量回归，再进入下一阶段。

---

## 1. Codex 必读文件

按顺序阅读：

1. `trading-ai-system/docs/superpowers/specs/2026-09-03-point-in-time-forecast-cockpit-design.md`
2. `trading-ai-system/docs/data-source-field-dictionary-v1.md`
3. `trading-ai-system/docs/research-data-source-and-forecasting-evidence.md`
4. `trading-ai-system/docs/ukey现场字段探索任务单.md`
5. `trading-ai-system/docs/superpowers/plans/2026-09-03-data-catalog-and-point-in-time-store.md`
6. `trading-ai-system/docs/superpowers/plans/2026-09-03-forecast-ledger-and-accuracy-review.md`
7. `trading-ai-system/docs/superpowers/plans/2026-09-03-weather-generation-and-price-model.md`
8. `trading-ai-system/docs/superpowers/plans/2026-09-03-market-cockpit-and-strategy-explainability.md`
9. `STATUS.md`
10. `trading-ai-system/CURRENT_HANDOFF.md`

若 `main` 在执行时已前进，先比较最新 `main` 与 `e14dddce`，把已实现内容从计划中勾销或调整，不要机械重复实现。

## 2. 推荐分支和 PR 拆分

不要一次提交一个超大 PR。推荐：

| 顺序 | 分支/PR主题 | 对应计划 | 可独立验收结果 |
|---:|---|---|---|
| 1 | `feat/data-catalog-point-in-time` | 数据源目录、字段语义与时点数据仓 | P0-3语义修复、目录API、无泄漏特征快照 |
| 2 | `feat/forecast-ledger-accuracy` | 不可变预测账本与准确度复盘 | live/replay/outcome/经济复盘API |
| 3 | `feat/weather-supply-models` | 天气、机组供给与多因素模型 | 版本化外生数据、市场上下文、候选模型和治理门禁 |
| 4 | `feat/market-cockpit-ui` | 市场驾驶舱、逻辑链与前端复盘 | 六项导航、完整驾驶舱、证据抽屉和历史复盘 |

PR 2 基于 PR 1；PR 3 基于 PR 2；PR 4 基于稳定 API。每个 PR 合并后再把下一分支 rebase 到最新 `main`。

## 3. 阶段执行顺序

### Phase A：字段语义与时点数据底座

执行：`2026-09-03-data-catalog-and-point-in-time-store.md`

必须先完成：

- `data-sources.json` 和 `field-catalog.json`；
- P0-3 `dayAheadUserClearedPowerMw` 全链；
- 临时价、最终价、有效价分离；
- point-in-time fact store；
- feature snapshot 与 undated 时变数据泄漏修复；
- 数据源/字段/时点上下文 API。

阶段门禁：

```text
主动申报、缺省申报、用户日前出清电力、实际负荷互不回填
availableAt > decisionCutoffAt 的记录无法进入快照
真实来源状态不被“代码支持”冒充
现有全量测试无回归
```

### Phase B：预测账本与准确度复盘

执行：`2026-09-03-forecast-ledger-and-accuracy-review.md`

必须完成：

- forecast ledger；
- outcome ledger；
- point/quantile/event/regime 指标；
- rolling point-in-time backtest；
- 真实发布、时点重放、最终结算三套独立口径；
- 经济复盘未知值从 0 改为 null；
- 预测运行和准确度 API。

阶段门禁：

```text
同一forecastRunId不可覆盖
临时实际值不进入final评估
live_issued与point_in_time_replay不混算
缺少结算证据时节省金额为null
强季节性基线可独立运行
```

### Phase C：天气、供给与模型

执行：`2026-09-03-weather-generation-and-price-model.md`

必须完成：

- 天气快照版本合约；
- 小时/3小时数据到96点的语义对齐；
- 累计降水和辐射正确拆分；
- 机组/供给/网络字段的确认状态门禁；
- 净负荷、备用、爬坡、断面等衍生特征；
- 无泄漏模型数据集；
- ElasticNet和分位数GBDT候选；
- 消融和人工晋级门禁。

阶段门禁：

```text
没有forecastIssuedAt的天气预报不能进入历史回测
ERA5/实况不能冒充预报
未现场确认的JSPEC机组字段不能进入真实特征
Python不可用时回退真实基线而非Mock
天气/供给增量必须通过相同日期的消融回测
```

### Phase D：六页导航和驾驶舱

执行：`2026-09-03-market-cockpit-and-strategy-explainability.md`

必须完成：

- 数据源与质量；
- 市场驾驶舱；
- 价格预测；
- 申报策略；
- 历史复盘；
- 模型治理；
- 证据抽屉；
- 逐点和窗口策略逻辑链；
- 真实/演示模式隔离；
- 320～1440px 浏览器验收。

阶段门禁：

```text
每个关键值和曲线点可打开来源证据
五条申报/负荷曲线名称完整且单位不混用
真实缺失字段显示缺失而不是演示值
历史复盘三种运行类型不混算
页面级无横向溢出、无控制台错误、证据抽屉焦点闭环
```

## 4. 现场字段探索并行轨道

代码实施不应阻塞现场记录工具，但真实多因素上线必须等待现场证据。

现场继续按 `ukey现场字段探索任务单.md` 完成 P0-1～P0-8、P1-1～P1-3，并把结果回填到 `data-source-field-dictionary-v1.md` 及机器可读 catalog。机组和网络页面按江苏 2026 信息披露要求补充探索，但没有页面证据时不得写映射。

每个现场字段完成的定义：

```text
精确页面/菜单/脱敏路由
精确表头及顺序
两个日期或平台限制证据
三条脱敏样例
单位、类型、粒度、首末点
空值、临时/最终和修订规则
发布时间、更新延迟和历史深度
截图/导出/文字记录evidenceRef
解析fixture与测试
catalog状态升级
```

## 5. Codex 开工命令

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status -sb
git log -1 --oneline
```

工作区不干净时停止，不回滚用户改动。创建实现 worktree/分支后，先读取本总计划和对应子计划。

比较方案分支：

```bash
git diff --stat main...origin/plan/point-in-time-forecast-cockpit-20260903
git diff main...origin/plan/point-in-time-forecast-cockpit-20260903 -- trading-ai-system/docs
```

## 6. 每个任务的固定执行循环

```text
1. 写一个具体失败测试
2. 运行并确认失败原因正确
3. 实现最小可用代码
4. 运行聚焦测试
5. 运行受影响模块回归
6. 检查敏感字段、真实/Mock和单位语义
7. 提交一个可独立评审的commit
```

不要把多个计划任务压成一个未经中间验证的大提交。

## 7. 全量验收命令

Node：

```bash
cd trading-ai-system
node --test --test-concurrency=1 test/*.test.mjs
```

Python候选模型存在后：

```bash
python -m unittest discover -s python/forecasting -p 'test_*.py'
```

语法和差异：

```bash
node --check server.mjs workbench.js
node --check lib/*.mjs
node --check ui/*.js ui/views/*.js ui/view-models/*.js ui/components/*.js
git diff --check
```

浏览器：使用隔离运行时数据，分别验证真实完整、真实缺失天气/供给、演示三种模式；视口为 1440、1024、768、390、320 px。

## 8. 必须停止并回报的条件

遇到以下任一情况，不猜测、不静默降级，停止当前字段/来源的实现并在 PR 写明：

- JSPEC 页面表头、单位或字段含义与字段字典冲突；
- 页面只能通过写操作、交易确认或越权接口取得数据；
- 需要读取 Cookie、Token、UKey PIN、证书、私钥或密码；
- 天气来源没有历史预报批次或授权不清；
- 机组/断面字段只有演示文案，没有真实来源；
- 决策截止时间未确认；
- 结算公式或最终版本无法确认；
- 新模型只在训练/验证集改善、在holdout或关键场景退化；
- 现有业务Excel fixture缺失导致无法完成真实结算验收。

停止来源接入不等于整个系统停止：已验证强基线、数据缺口驾驶舱和人工复核仍可继续工作，但必须显示真实状态。

## 9. 完成定义

本轮整体完成不是“页面看起来完整”，而是同时满足：

- 字段来源和语义可复核；
- 历史预测没有未来信息；
- 真实发布预测不可变；
- 临时/最终实际值可分别回填；
- 天气/机组增量经过消融和滚动留出验证；
- 策略结论有完整证据链；
- 前端所有关键数值有来源、时点、版本和质量；
- 缺数据时真实显示缺口；
- 系统仍然只做人工决策辅助。
