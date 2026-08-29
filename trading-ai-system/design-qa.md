# 申报优化工作台设计验收

**对照对象**

- 视觉基准：`/Users/r/Documents/electric/trading-ai-system/output/design/目标图-申报优化工作台-v2.png`
- 桌面实现：`/Users/r/Documents/electric/trading-ai-system/output/design/实现图-申报优化工作台-v2-1440.png`
- 手机实现：`/Users/r/Documents/electric/trading-ai-system/output/design/实现图-申报优化工作台-v2-mobile.png`
- 并排证据：`/Users/r/Documents/electric/trading-ai-system/output/design/对照-申报优化工作台-v2.png`
- 页面：`http://127.0.0.1:5177/?demo=submission&v=20260829-workstation-v9`
- 状态：96 点候选申报策略默认态，待人工复核。

**视口与归一化**

- 目标图：1586 × 992 px。
- 桌面实现：2115 × 1527 px；CSS 视口 1440 × 1000，完整页面高度 1023 CSS px。
- 手机实现：500 × 2521 px；CSS 视口 358 × 1000。
- 并排图将目标图和桌面实现统一到 1586 px 宽后比较，排除截图密度差异。

**Findings**

- 无待处理 P0 / P1 / P2 问题。
- [P3] 左侧导航仍沿用仓库既有的混合字符图标。
  - 影响：与目标图的统一图标风格存在轻微差异，不影响当前任务识别和操作。
  - 后续：全站视觉治理时统一为同一套图标库。

**五项保真检查**

- 字体与层级：页面唯一主标题为“申报优化”；状态、指标、曲线标题、策略摘要形成清晰层级，不再使用问句或讲义式标题。
- 间距与布局：桌面首屏呈现标题、4 项指标、96 点曲线、策略对比和复核按钮；手机为单列，无横向溢出。
- 色彩与令牌：白/浅灰工作区、深色正文、蓝色主操作、绿色候选与验证状态，符合目标图。
- 图像与资产：页面是数据工作台，不依赖照片或插画；曲线为可访问的真实 SVG/DOM 内容。目标视觉由内置生图生成。
- 文案与内容：去除“今天为什么这样申报”和 1/2/3 讲义式章节；首页只保留可扫读的三步推导链，详细论证进入独立页面。

**交互与运行证据**

- 主操作：点击“进入人工复核”后进入复核态，并显示“策略草稿已生成并进入人工复核”。
- 桌面：1440 CSS px 宽，页面 `scrollWidth` 与 `clientWidth` 一致，无横向溢出。
- 手机：358 CSS px 宽，扫描工作台全部后代元素，未发现越过视口左右边界的元素。
- 缓存：入口资源使用 `workstation-v9` 版本参数，静态响应为 `cache-control: no-store`。

**推导依据重做**

- 首页目标图：`/Users/r/Documents/electric/trading-ai-system/output/design/目标图-推导依据-首页审计式-v1.png`
- 推导页目标图：`/Users/r/Documents/electric/trading-ai-system/output/design/目标图-推导依据-完整页面-v1.png`
- 首页实现图：`/Users/r/Documents/electric/trading-ai-system/output/design/实现图-推导依据-首页-v1.png`
- 推导页实现图：`/Users/r/Documents/electric/trading-ai-system/output/design/实现图-推导依据-完整页面-v1.png`
- 手机实现图：`/Users/r/Documents/electric/trading-ai-system/output/design/实现图-推导依据-移动端-v1.png`
- 完整符号审校图：`/Users/r/Documents/electric/trading-ai-system/output/design/实现图-推导依据-完整页面-v2.png`
- 手机符号审校图：`/Users/r/Documents/electric/trading-ai-system/output/design/实现图-推导依据-完整页面-移动端-v2.png`
- 首页取消半宽双折叠框，改为全宽三步计算链与五项本次依据。
- 独立推导页覆盖输入口径、同点位基线、因素修正、联合场景、目标函数、CVaR 约束和留出集验证。
- 拟合过程按真实实现补充：60% / 20% / 20% 时间切分、6 个历史窗口、3 个融合权重、验证集 MAE 选模和四项独立留出门禁。
- 未提供的单因素系数、训练损失轨迹和场景样本明确标注解释边界，不在界面中伪造数值；留出集不参与拟合或选模。
- 公式审校覆盖 6 项单位/算子定义与 38 项就地符号定义；桌面 1920 px 与手机 390 px 均无横向溢出、未定义文本或控制台错误。
- 文案区分历史留出集结果、场景风险结果和测算成本改善，不再把改善额写成“预计日成本”，也不再使用问句式标题。

**对照迭代记录**

1. [P1] 旧版用“今天为什么这样申报”作为首页标题，呈现为答辩材料。修复：改为业务模块标题“申报优化”，状态压缩为同行徽标。
2. [P1] 旧版按“输入依据—优化怎么做—输出与验证”纵向讲故事，首屏没有工作台感。修复：重构为 KPI、主曲线、策略对比和主操作的任务型布局。
3. [P2] 手机端旧版卡片被横向裁切。修复：决策区、策略栏、调整窗口和折叠说明在 760 px 以下全部单列；358 px 实测无溢出元素。
4. [P2] 策略说明占据主流程。修复：天气、负荷、价差、风险及拟合方法收进可展开的渐进说明区。

**Implementation Checklist**

- [x] 使用新生成目标图重构页面。
- [x] 首屏直接显示业务标题、关键指标、曲线、策略结果和复核动作。
- [x] 去除问句标题和讲义式章节。
- [x] 修复手机横向裁切。
- [x] 验证主操作和真实本地入口。

**Follow-up Polish**

- 后续可统一全站侧栏图标；属于 P3，不阻断当前交付。

final result: passed
