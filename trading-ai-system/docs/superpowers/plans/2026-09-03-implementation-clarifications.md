# 实施计划统一澄清

> **For agentic workers:** 本文件是四份实施计划的规范性补充；若示例措辞或命令与本文件冲突，以本文件为准。

更新时间：2026-09-03

## 1. ElasticNet 选择方式

禁止使用随机折叠的 `ElasticNetCV` 直接选择参数。采用时间安全的显式候选网格：

```text
alpha: [0.001, 0.01, 0.1, 1.0, 10.0]
l1_ratio: [0.1, 0.5, 0.9, 1.0]
```

对每组参数：

1. 只在 `trainingDates` 拟合 `Pipeline(StandardScaler, ElasticNet)`；
2. 只在固定 `validationDates` 计算主指标；
3. 按验证集 MAE、再按模型稀疏度和参数稳定性排序；
4. 参数确定后可用 training + validation 重拟合一次；
5. `holdoutDates` 和 `shadowDates` 只预测、只评估，不参与参数选择。

GBDT 点模型和三个分位数模型也使用固定训练/验证日期，不使用随机 K-fold。所有候选的超参数网格、选择指标和随机种子写入模型 manifest。

## 2. Node 语法检查

`node --check` 每次只检查一个入口文件。所有计划中类似：

```bash
node --check server.mjs workbench.js lib/*.mjs
```

的示例统一替换为循环：

```bash
for file in server.mjs workbench.js lib/*.mjs ui/*.js ui/views/*.js ui/view-models/*.js ui/components/*.js; do
  [ -e "$file" ] || continue
  node --check "$file"
done
```

Windows PowerShell 等价命令：

```powershell
$files = @('server.mjs','workbench.js') +
  (Get-ChildItem lib -Filter *.mjs -ErrorAction SilentlyContinue).FullName +
  (Get-ChildItem ui -Recurse -Filter *.js -ErrorAction SilentlyContinue).FullName
foreach ($file in $files) { node --check $file; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

不得以只检查第一个文件的命令宣称全部语法通过。

## 3. `asOf` 和目标日期

- `targetDate` 可以是未来交易日。
- `asOf` 代表预测或复盘时的数据可见截止时间。
- 真实现场请求中，`asOf` 晚于服务器当前时间时返回 `400 as_of_in_future`。
- 测试和离线重放允许通过显式 `clock` 依赖或测试配置固定“当前时间”，不能直接读取真实系统时间造成不稳定测试。
- 历史重放必须使用目标任务当时确认的决策截止时间；未确认时返回 `decision_cutoff_unconfirmed`。

## 4. ECMWF 时间步长

- ECMWF IFS Open Data 当前中期确定性产品在 0～144 小时通常为 3 小时步长，随后为 6 小时步长；06/18 UTC 产品范围以当期官方目录为准。
- AIFS Single 当前为 6 小时步长。
- 两者都不是交易原生 15 分钟数据。任何到 96 点的插值/拆分都必须记录 `alignmentMethod`，并在模型消融中证明有增量。

## 5. P10/P50/P90 状态

- 当前 7 日同点位经验分位数继续作为 `uncalibrated_baseline`。
- 只有在独立留出样本上通过覆盖率和 pinball loss 验证后，候选区间才能标记 `calibrated`。
- 分位数交叉修正必须记录次数和比例，不能修正后隐藏原问题。

## 6. 前端与后端实施依赖

允许在 Phase A 后先搭建六页导航和空状态，但以下内容必须等待对应真实 API：

```text
市场驾驶舱真实数值 -> market cockpit / point-in-time API
预测准确度 -> forecast/outcome ledger与evaluation API
天气/机组卡片 -> weather/supply真实来源和market-context API
策略逻辑链 -> strategyTrace后端
```

前端不得为了等待 API 而把 Mock 固化成真实字段默认值。

## 7. 完成声明

每个任务只能依据本轮新执行的测试、语法检查、差异检查和浏览器验收声明完成。历史交接文档中的旧测试结果不能代替当前分支验证。外部真实业务 Excel、Windows 硬件或 JSPEC 现场页面不可用时，必须明确报告对应验收未执行，不能用模拟输入补绿。
