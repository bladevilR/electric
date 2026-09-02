# STATUS — electric / trading-ai-system

更新时间：2026-08-30（v10 评审材料与现场演示包收口）

## 一句话目标

提供可复核、不会误导为自动交易或真实收益承诺的电力申报辅助工作台；真实策略、候选方法、样例测算和缺失数据必须明确分层。

## 当前主线

1. `trading-ai-system` v10 已完成代码修改、本机真实入口验收和评审交付包封装，改动仍在工作区，未擅自 commit/push。
2. 真实默认入口当前数据不足：策略验证为 `not_validated / insufficient_history`，目标日推荐为 `missing_baseline`；系统按设计不生成虚假推荐或收益。
3. UKey/JSPEC 真实采集与 Windows 接收机双击启动仍属于目标环境验收项；禁止在仓库或聊天中保存凭证、PIN、Cookie、Token 或私钥。

## 本轮结果

- 拆分 42 日同点位历史模型证据与未独立回测的多因素候选，消除 `9.64% / 86.05%` 误归属。
- 演示入口持续显示“演示环境 · 样例输入”；`¥24,000` 只作为样例测算，默认真实入口不出现。
- 新增明确的 MW 申报功率上下限；缺失/非法边界或基线越界时阻断，候选越界时标记安全回退，不误用 MWh 交易量限额。
- 修复移动端横向溢出、宽表局部滚动、导航/日期/模式语义、曲线键盘冗余焦点和证据对话框焦点管理；新增可展开的 96 点明细表。
- 异步主操作增加防重复提交门禁；README、两份上手页和交接文档已同步。

## 新鲜验收证据

- 全量：`XDG_CACHE_HOME=<本轮独立临时目录> node --test --test-concurrency=1 test/*.test.mjs`
  - 216 项：215 通过、0 失败、1 跳过。
  - 跳过项为本机未提供被 Git 忽略的真实业务 Excel，不伪造数据补绿。
- 语法/差异：`node --check workbench.js server.mjs lib/declaration-optimizer.mjs` 与 `git diff --check`。
- 系统 Chrome 真实入口：1440、768、390、320 px 无横向溢出、无控制台错误；默认入口无演示标签/样例金额；390 px 完整推导页无溢出并显示“尚未独立回测”。
- 自动化浏览器专项另覆盖 1024 px、证据对话框焦点闭环和价格预测局部滚动。
- 从最终 ZIP 干净解压后，以系统 Chrome 实测 v10 submission 入口、完整推导、价格预测、人工复核和证据链；控制台 0 错误。
- 最终视频：197.47 秒，1920×1080、30fps、H.264 High + AAC LC 48kHz 双声道；全片解码通过，无黑屏段，无 ≥3 秒静音段。

## 评审交付物

- 总包：`dist/电力交易AI-v10-评审提交包-20260830.zip`（67,957,047 bytes；SHA-256 `bcf9db7f58eb8e2a53e6c9a1a9a1989ecad6b2dd4f3afdff6121b64abbdb7eda`）。
- 成片：`trading-ai-system/output/video/电力交易AI-智能交易副驾驶-v10-最终提交版.mp4`。
- Windows 演示包：`dist/trading-ai-system-one-minute.zip`，内置 Node.js；双击入口直接打开 v10 submission 页面。
- 说明：`trading-ai-system/现场演示与提交说明.md`。

## 完成边界

- 本轮完成的是本地代码、文案和浏览器行为验收，不等于生产交易有效性或真实收益验证。
- 多因素联合场景策略仍是候选方法，缺少独立回测、真实 β 系数和场景样本，不得描述为已验证模型。
- 42 日模型证据衡量的是负荷偏差 MAE，不等同于结算成本或人民币收益。
- 生产使用仍须补齐真实日数据、MW 申报边界、结算证据，并由人工复核；系统不会自动申报或下单。

## 接手入口

- 先读 `trading-ai-system/CURRENT_HANDOFF.md` 与 `trading-ai-system/README.md`。
- 本地启动：在 `trading-ai-system` 运行 `node server.mjs --port 5177`。
- 页面：`http://127.0.0.1:5177/?demo=submission&v=20260830-workstation-v10`。
