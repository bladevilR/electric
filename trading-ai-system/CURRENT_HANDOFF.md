# 当前项目交接

更新时间：2026-08-30（Asia/Shanghai）

## 0. 本轮最终交付（材料与演示优先）

- 最终评审总包：`/Users/r/Documents/electric/dist/电力交易AI-v10-评审提交包-20260830.zip`。
- 总包 SHA-256：`bcf9db7f58eb8e2a53e6c9a1a9a1989ecad6b2dd4f3afdff6121b64abbdb7eda`。
- 最终视频：`output/video/电力交易AI-智能交易副驾驶-v10-最终提交版.mp4`，197.47 秒，1080P，有声并带烧录字幕。
- Windows 演示包：`/Users/r/Documents/electric/dist/trading-ai-system-one-minute.zip`，manifest 显示 `includesNodeRuntime: true`；启动脚本直接打开 `?demo=submission&v=20260830-workstation-v10`。
- 总包内含 4 张 v10 桌面/手机材料截图、现场讲解顺序和答辩口径；内置 `SHA256SUMS.txt` 已在全新解压目录逐项校验通过。
- 从最终演示 ZIP 全新解压后，已用系统 Chrome 实测完整推导、价格预测、人工复核和证据链，控制台 0 错误。Windows 双击行为因当前验收机为 macOS，未在真实 Windows 硬件执行；启动脚本、内置 Windows Node 运行时与本地服务核心流程已分别验证。

## 1. 仓库与目标

- 仓库目录：`/Users/r/Documents/electric/trading-ai-system`
- GitHub：`https://github.com/bladevilR/electric`
- 仓库可见性：`PUBLIC`
- 当前分支：`main`
- 当前 `HEAD`：`db33b49`；本轮 v10 修复仍在工作区，尚未擅自提交。
- 功能基线的 `HEAD` 与 `origin/main` 已在交接前只读复核，一致。
- 目标页面：`http://127.0.0.1:5177/?demo=submission&v=20260830-workstation-v10`
- 系统安全边界：`human_decision_only`；不得自动申报、自动下单或绕过人工复核。

## 2. 用户已确认的页面要求

- 页面是业务工作台，不使用“今天为什么这样申报”“这套建议是怎么得出的”“为什么这样做”等问句式标题。
- 首页业务标题为“申报优化”；推导摘要标题为“申报策略形成依据”。
- 详细推导必须有独立页面，且每个变量、上下标、单位、算子和回测指标必须就地解释。
- 演示入口必须持续显示“演示环境 · 样例输入”；同时不得把缺失的训练系数、场景样本或实际收益伪造成真实证据。
- 当前页面区分三种口径：历史留出集指标、因素联合场景方案、测算日成本改善。
- 前端视觉方向使用过内置生图目标稿，最终实现保持扁平白底、蓝色主操作、绿色验证状态和移动端单列布局。

## 3. 已完成修改

### 工作区 v10：策略证据、限额与可用性收口

- submission 页面不再把 42 日同点位历史模型的 `9.64% / 86.05%` 误归给多因素候选；候选单独标为“尚未独立回测”。
- `¥24,000` 仅保留为“样例测算日成本改善”，默认真实入口不显示演示金额或演示标签。
- 申报推荐新增可选的 `minDeclarationPowerMw / maxDeclarationPowerMw`：只接受 MW 功率边界，不误用 MWh 交易量上限；候选越界回退基线，非法边界或基线越界时阻断。
- 修复 320–1440 px 响应式布局、价格预测宽表局部滚动、导航/日期/模式语义、96 点曲线冗余 Tab 焦点、证据对话框焦点陷阱与 Escape 返回焦点。
- 异步主操作增加跨重渲染防重入门禁，错误 toast 使用警报语义。
- README、`一分钟上手.html` 与 `docs/quick-start.html` 已统一到当前导航、启动脚本和模型口径。
- `index.html` 资源缓存版本已更新为 `workstation-v10`。

### 提交 `3dd90ee`：完整推导页

- 首页将原半宽说明框改为全宽三步推导链：历史基线、多因素修正、场景风险求解。
- 增加“查看完整推导”按钮和独立推导页。
- 完整页包含：输入口径、同点位基线、拟合与选模、因素修正、联合场景、目标函数、CVaR 约束、独立留出集回测。
- 增加进入和返回的页面内导航；主导航仍为申报优化、价格预测、策略进化、复盘回顾。

### 提交 `c6d4835`：公式与文案审校

- 删除当前页面及旧模板中的问句式标题。
- 将错误的“预计日成本 ¥24,000”修正为“测算日成本改善 ¥24,000”。
- 将 `+9.64%` 明确标为“历史留出集偏差改善”。
- 将侧栏状态明确为“历史模型状态 / 留出集通过”，避免暗示因素层系数已经完成验证。
- 增加 6 项单位/算子说明和 38 项就地符号说明，覆盖：
  - `MW`、`MWh`、`P10/P50/P90`、`元/MWh`、`CVaR 95%`；
  - `Σ`、`mean`、`min`、`arg min`；
  - `q⁰ₜ`、`q₍d,t₎`、`H`、`d`、`t`、`α`、`H*`、`α*`；
  - `βᵀ/βᴸ/βˢ`、`ΔTₜ`、`P50ₜ`、`Spreadₜ`；
  - `Ω`、`ωᵢ`、`N`、`C(q,ω)`、`Lₜ,ω`、`πᴰᴬₜ`、`πᴿᵀₜ,ω`、`Eω`、`λ`、`η`、`ξω`；
  - `MAE`、偏差改善率、交易日胜率、点位胜率。
- 明确数据边界：42 日同点位模型及留出集指标可按现有验证载荷复核；因素层的 `β` 系数、训练损失轨迹和场景样本未提供，不得声称已重新估计。

### 相关文件

- `workbench.js`：页面结构、推导内容、符号解释和交互。
- `workbench.css`：首页推导链、完整推导页、符号说明和响应式样式。
- `index.html`：资源缓存版本为 `workstation-v9`。
- `test/workbench-ui.test.mjs`：问句标题、指标口径、符号解释、留出集门禁和安全文案测试。
- `design-qa.md`：目标图、实现截图和验收记录。

## 4. 新鲜验证证据

### 页面专项测试

执行：

```bash
node --test test/declaration-optimizer.test.mjs test/execution-governance.test.mjs test/savings-workbench.test.mjs test/workbench-accessibility.test.mjs test/workbench-ui.test.mjs
```

结果：策略、页面与端到端门禁专项 54 项通过，0 项失败。

### 全量测试

执行：

```bash
XDG_CACHE_HOME=/tmp/electric-pwsh-cache-v10.biOwwT node --test --test-concurrency=1 test/*.test.mjs
```

结果：211 项；210 项通过，0 项失败，1 项跳过。跳过项是本机未提供被 Git 忽略的业务 Excel，不使用虚构文件替代。

### 浏览器验收

- 使用系统 Chrome：`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。
- 响应式视口：1440、1024、768、390、320 px。
- 已验证：
  - 无横向溢出；
  - 无浏览器控制台错误；
  - 默认真实入口无演示标签、无 `¥24,000` 样例金额；
  - 演示入口持续显示样例身份与“尚未独立回测”；
  - 手机可进入完整推导页且无横向溢出；
  - 证据对话框可聚焦、锁定 Tab、Escape 关闭并返回触发按钮；
  - 价格预测宽表只在表格区域横向滚动。
  - 真实截图复看后，将手机价格预测 96 行长页收敛为可上下/左右滚动的局部结果区；页面高度由约 5300 px 降至约 1280 px。
  - 手机完整推导页使用吸顶横向步骤索引；点击章节后高亮当前项，并保留 74 px 锚点避让，章节标题不会被目录遮挡。
- 四个主导航实测标题：
  - 申报优化 → “申报优化”
  - 价格预测 → “价格预测”
  - 策略进化 → “策略版本验证中心”
  - 复盘回顾 → “策略绩效与审计证据”

### 截图证据（均被 `.gitignore` 的 `*.png` 规则忽略）

- `output/design/目标图-推导依据-首页审计式-v1.png`
- `output/design/目标图-推导依据-完整页面-v1.png`
- `output/design/实现图-推导依据-首页-v1.png`
- `output/design/实现图-推导依据-完整页面-v2.png`
- `output/design/实现图-推导依据-完整页面-移动端-v2.png`
- `output/design/审校-移动端-基线与符号-v2.png`
- `output/design/审校-移动端-目标函数与符号-v2.png`
- `output/design/审校-移动端-回测口径-v2.png`

## 5. 当前运行状态

交接前于 2026-08-30 新鲜复核：

- `127.0.0.1:5177`：交付前已停止本轮验收服务，无监听；接手时仍须重新检查，不能继承本文运行状态。
- `127.0.0.1:5178`：无监听，HTTP 检查为 `000`。
- `localhost.run` SSH 穿透：无进程。
- 之前发出的 `*.lhr.life` 公网链接均已失效，不得继续交付旧链接。
- 当前没有本会话仍在运行的后台服务、穿透、automation、worktree 或额外分支。
- 本会话测试临时缓存 `/tmp/electric-pwsh-cache-v10.biOwwT` 与视觉临时目录已移入系统废纸篓，可恢复。

## 6. 启动与重新穿透

### 本地服务

Windows 项目入口：

```powershell
.\run-system.ps1
```

macOS/Linux 可在仓库根目录运行：

```bash
node server.mjs --port 5177
```

验收：

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:5177/?demo=submission&v=20260830-workstation-v10'
```

期望输出：`200`。

### 公网穿透

- 只有用户再次明确要求公网链接时才启动。
- 不得把 `5177` 的完整本地 API 直接暴露到公网。
- 之前使用 `5178` 作为只读安全网关：仅放行 `GET/HEAD` 静态页面并拒绝 `/api/*`，然后把 `localhost.run` 指向 `5178`。
- 安全网关是会话内临时进程，未作为仓库文件保存；重建时必须重新验证 `/api/*` 被拒绝后才能发链接。
- `localhost.run` 匿名域名会因空闲超时失效；每次都必须从真实公网入口重新打开并点击“查看完整推导”后才能交付新链接。

## 7. 凭证与环境

- 当前本地演示和页面验收未使用或写入任何真实凭证。
- 生产配置变量名见 `.env.production.example` 和 `docs/production-runbook.md`；真实值只能由环境变量或目标 secret store 注入，不得写入源码、交接或聊天。
- 不要读取、记录或回显 Cookie、Token、UKey PIN、证书私钥或生产账号密码。

## 8. 已验证的失败方式与禁止操作

- 直接运行全量测试时，本机 PowerShell 可能因 `/Users/r/.cache/powershell` 不存在而失败；使用上文独立 `XDG_CACHE_HOME` 后全量测试通过。该失败不是页面逻辑失败。
- 全量测试并发运行时，`launcher replaces an existing trading assistant process` 曾在 10 秒门槛超时；该项隔离复测通过，串行全量测试 191 通过、0 失败、1 跳过。交付门禁以串行结果为准。
- Playwright 自带 Chromium 在本机未安装；需要使用系统 Chrome 的 `executablePath`，或先按项目规范安装浏览器运行时。
- 匿名 `localhost.run` 会因 inactivity timeout 断开；旧链接不可复用。
- `output/design/*.png` 被 Git 忽略；不要为“commit all”擅自强制加入大型截图，除非用户明确要求。
- 不得把因素层公式结构写成已经完成真实系数拟合；当前载荷不含 `β`、训练损失和场景样本。
- 不得把 `¥24,000` 写成实际成本或已实现收益；当前口径是“测算日成本改善”。
- 不得让留出集参与拟合或选模；当前真实流程是按时间 60% / 20% / 20% 切分，验证集选模，最后 20% 留出集只做最终门禁。
- 不得回退问句式标题，不得恢复旧的半宽说明框。
- 不得自动提交交易、自动上线挑战者或绕过人工复核。

## 9. 未完成项与验收标准

当前代码修改与本地验收已经完成，但工作区尚未提交。若用户继续要求运行、提交或外发：

1. **恢复本地服务**：5177 监听、目标 URL 返回 200、浏览器能进入完整推导页。
2. **恢复公网链接**：先建立只读 5178 安全网关，验证 `/api/*` 被拒绝，再建立穿透并从公网真实入口完成一次页面往返。
3. **后续文案修改**：必须同时更新 `test/workbench-ui.test.mjs`，运行页面专项测试及与修改风险相称的浏览器验收。

接手者应先读取本文件和 `README.md`，再复核 Git 提交、当前端口状态和目标页面，不要直接继承本交接中的运行状态。

## 10. 现有分支与 worktree 边界

- 主工作区：`/Users/r/Documents/electric`，分支 `main`。
- 另有预先存在的 worktree：`/Users/r/Documents/electric/.worktrees/cinematic-contest-film`，分支 `codex/cinematic-contest-film`；该分支已合并到 `main`，但不属于本次会话，未删除。
- 历史 `archive/*`、`backup/*`、`rescue/*` 分支均为接手前已有资源；本次不删除、不强制合并、不改写历史。
