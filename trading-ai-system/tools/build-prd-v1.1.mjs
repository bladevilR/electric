import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'deliverables', '电力交易AI-智能交易副驾驶-产品需求文档PRD-v1.1.docx');

function run(args, options = {}) {
  const result = spawnSync('officecli', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.input ? ['pipe', 'pipe', 'pipe'] : 'pipe',
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
  return result.stdout;
}

const commands = [];
const add = (parent, type, props = {}) => commands.push({ command: 'add', parent, type, props });
const set = (target, props) => commands.push({ command: 'set', path: target, props });
const p = (text, props = {}) => add('/body', 'paragraph', { text, ...props });
const h1 = (text, props = {}) => p(text, { style: 'Heading1', ...props });
const h2 = (text, props = {}) => p(text, { style: 'Heading2', ...props });
const bullet = (text) => p(text, { listStyle: 'bullet' });
const ordered = (text) => p(text, { listStyle: 'ordered' });
const callout = (text) => p(text, {
  bold: true,
  color: '#0F4C81',
  fill: '#EAF2FF',
  spaceBefore: '5pt',
  spaceAfter: '8pt',
  leftIndent: '0.16in',
  rightIndent: '0.16in',
});
const pageBreak = () => add('/body', 'pagebreak', { type: 'page' });

set('/', {
  pageWidth: '8.5in', pageHeight: '11in', orientation: 'portrait',
  marginTop: '0.82in', marginBottom: '0.82in', marginLeft: '0.88in', marginRight: '0.88in',
  marginHeader: '0.42in', marginFooter: '0.42in',
});
set('/styles/Normal', {
  font: 'Microsoft YaHei', 'font.ea': 'Microsoft YaHei', size: '10.5pt', color: '#172033',
  spaceAfter: '6pt', lineSpacing: '1.28x', widowControl: true,
});
add('/styles', 'style', { id: 'Heading1', name: 'Heading 1', type: 'paragraph' });
add('/styles', 'style', { id: 'Heading2', name: 'Heading 2', type: 'paragraph' });
set('/styles/Heading1', {
  font: 'Microsoft YaHei', 'font.ea': 'Microsoft YaHei', size: '16pt', bold: true,
  color: '#1668DC', spaceBefore: '14pt', spaceAfter: '7pt', keepNext: true, keepLines: true,
});
set('/styles/Heading2', {
  font: 'Microsoft YaHei', 'font.ea': 'Microsoft YaHei', size: '12.5pt', bold: true,
  color: '#1F4E79', spaceBefore: '9pt', spaceAfter: '4pt', keepNext: true, keepLines: true,
});
add('/', 'header', {
  text: '电力交易 AI · 智能交易副驾驶｜产品需求文档', align: 'left',
  font: 'Microsoft YaHei', size: '8.5pt', color: '#64748B',
});
add('/', 'footer', { field: 'page', align: 'right', font: 'Arial', size: '8pt', color: '#64748B' });

p('PRODUCT REQUIREMENTS DOCUMENT', {
  font: 'Arial', size: '9pt', bold: true, color: '#1668DC', spaceBefore: '14pt', spaceAfter: '7pt',
});
p('电力交易 AI · 智能交易副驾驶', {
  font: 'Microsoft YaHei', size: '26pt', bold: true, color: '#111827', keepLines: true, spaceAfter: '6pt',
});
p('正式使用、当前 Mock 与现场演示口径说明（PRD）', {
  font: 'Microsoft YaHei', size: '15pt', color: '#475569', spaceAfter: '14pt', keepLines: true,
});
p('版本：V1.1　　状态：演示交付版　　日期：2026-08-30', {
  font: 'Microsoft YaHei', size: '10pt', color: '#64748B', spaceAfter: '13pt',
});
callout('核心结论：正式使用讲业务目标，当前 Mock 讲产品机制，现场演示讲完整闭环。Mock 结果用于说明系统如何工作，不冒充生产运行结果。');

h1('1. 文档目的');
p('本版本回答三个问题：产品正常使用时应该是什么样；当前比赛 Mock 已经实现了什么；现场演示时每一步应该用什么口径说明。三类内容在全文中明确分开，避免把正式产品目标、模拟演示能力和生产结果混为一谈。');
h2('1.1 三种口径');
bullet('正式使用：描述产品进入真实业务后的标准工作方式和操作闭环。');
bullet('当前 Mock：描述本次可运行桌面系统中已经具备、可以现场点击和展示的内容。');
bullet('演示说法：给出演示人员可以直接采用的讲解逻辑和推荐措辞。');
h2('1.2 产品一句话定位');
p('面向电力交易员的桌面决策工作台，把数据准备、质量校验、AI 申报建议、人工复核和结算评估组织成一条可解释、可操作、可回看的交易闭环。');

pageBreak();
h1('2. 正常使用应该是什么样');
p('正常使用指系统在企业授权、数据口径和业务流程均明确的前提下，服务一个真实交易日。系统承担数据组织、计算和解释，交易员承担关键判断与最终确认。');
h2('2.1 标准业务闭环');
ordered('数据接入：按交易日同步交易平台、气象、企业负荷和结算成本等已授权数据。');
ordered('质量校验：检查 96 点完整性、时效、计量单位、申报上下限和跨来源一致性。');
ordered('申报优化：基于历史样本、负荷预测、价格预测、价差和约束生成 96 点候选申报曲线。');
ordered('人工复核：交易员查看重点调整窗口、调整理由、风险预算和完整推导后逐项确认。');
ordered('执行与留痕：经授权后导出或提交最终方案，并记录版本、操作人、时间和确认结果。');
ordered('结算评估：取得实际结算结果后，按统一公式比较基准方案与采用方案，并回写策略表现。');
h2('2.2 正常使用的页面状态');
bullet('每个交易日以一条任务为中心，五个阶段按完成顺序推进。');
bullet('页面展示当前数据时间、覆盖点数、校验结论、建议版本和复核状态。');
bullet('AI 建议必须能够回到输入数据、计算依据、约束条件和风险结果。');
bullet('系统不替代交易员作最终决策；关键建议经人工复核后形成可执行版本。');
h2('2.3 正常使用的结果定义');
p('正式结果以真实交易日、真实执行方案和实际结算为准。系统关注的不只是一个优化数字，还包括申报偏差、成本、尾部风险、胜率和证据覆盖等指标。');

h1('3. 当前 Mock 是什么样');
p('当前交付为桌面端比赛演示系统。系统启动后自动加载完整内置模拟数据，不依赖外部账号、UKey 或临时数据准备即可完成展示。');
h2('3.1 已实现的模拟闭环');
bullet('基础数据页集中展示气象、机组、负荷和电价四类模拟数据，包含 14 项关键指标、更新时间和 96/96 点覆盖状态。');
bullet('14 项质量规则全部通过，页面给出完整性、时效、单位和限额结果。');
bullet('生成历史基线与 AI 候选申报曲线，突出三个重点调整窗口。');
bullet('人工复核状态、风险预算和 96 点确认记录可见。');
bullet('模拟结算采用统一成本公式，展示模拟净优化 ¥24,000。');
bullet('基础数据、申报优化、价格预测、策略进化、复盘回顾和证据抽屉均可独立访问。');
callout('Mock 的价值：证明五阶段产品流程、页面交互、计算解释和审计留痕可以完整跑通。');

h1('4. 五阶段对应关系与演示口径');
p('以下表格是现场讲解的核心。每一步先说明正式业务意义，再指出当前 Mock 如何呈现，最后用推荐说法收束。');
add('/body', 'table', {
  data: [
    '阶段,正常使用,当前 Mock,现场推荐说法',
    '01 数据接入,按交易日同步已授权业务数据并记录时间与覆盖范围,四类内置模拟数据源均显示同步完成且核心曲线为 96/96 点,这里把一个交易日所需的数据集中到同一工作台；本次使用内置模拟数据展示完整输入结构',
    '02 质量校验,对完整性时效单位限额和跨来源一致性进行自动检查,14 项模拟校验规则全部通过并展示明确结论,数据不是直接进入模型；系统先完成规则校验确保后续建议建立在一致口径上',
    '03 申报优化,结合预测价差负荷与约束生成候选 96 点申报曲线,展示历史基线AI候选曲线三个调整窗口和完整推导,AI 不只给出一条曲线；它会标出重点调整时段并解释为什么调整',
    '04 人工复核,交易员核对关键窗口风险预算与逐点建议后确认版本,模拟交易员已完成关键窗口风险预算和 96 点确认,系统保留人工决策环节；AI 负责计算交易员负责确认最终采用方案',
    '05 结算评估,使用实际执行与结算数据复核成本偏差和风险并回写策略表现,按统一模拟成本公式展示模拟结算净优化 2.4 万元和证据留痕,最后用统一口径回看效果；这里展示的是模拟结算结果重点是闭环和可追溯性',
  ].join(';'),
  colWidths: '900,2500,2400,3560', width: '9360', indent: 120, layout: 'fixed', padding: 110,
  style: 'light1', border: 'single;4;C9D6E8', caption: '五阶段正式使用、当前 Mock 与演示口径对照表',
  description: '逐阶段说明正常使用方式、当前模拟实现和现场推荐讲法。',
});
set('/body/tbl[1]/tr[1]', { header: true, cantSplit: true });
for (let row = 2; row <= 6; row += 1) set(`/body/tbl[1]/tr[${row}]`, { cantSplit: true });
for (let row = 1; row <= 6; row += 1) {
  for (let col = 1; col <= 4; col += 1) {
    set(`/body/tbl[1]/tr[${row}]/tc[${col}]`, {
      font: 'Microsoft YaHei', size: row === 1 ? '9pt' : '8.5pt', bold: row === 1,
      color: row === 1 ? '#17365D' : '#172033', fill: row === 1 ? '#DCE9F8' : row % 2 === 0 ? '#F7FAFE' : '#FFFFFF',
      valign: 'center', align: col === 1 ? 'center' : 'left',
      'padding.top': 100, 'padding.bottom': 100, 'padding.left': 110, 'padding.right': 110,
    });
  }
}

h1('5. 页面功能与现场怎么讲');
h2('5.1 基础数据工作台');
p('正常使用：统一管理气象、机组、负荷与市场电价等输入，按 15 分钟粒度核对覆盖率、更新时间和质量状态，并向价格预测与申报优化提供一致的数据底座。');
p('当前 Mock：四类数据均显示“模拟数据已就绪”，页面展示温度、可用容量、当前负荷、日前与实时均价等具体数值；每类数据均可展开查看 96 点样例。');
callout('推荐讲法：“这里是整个决策流程的数据底座。气象、机组、负荷和电价按同一交易日、同一 15 分钟粒度组织，完成校验后先驱动价格预测，再进入申报优化。”');
h2('5.2 申报优化主工作台');
p('正常使用：承载当日五阶段任务、关键指标、96 点曲线、重点调整窗口和完整推导，是交易员的主要操作页面。');
p('当前 Mock：五阶段全部可点击，阶段状态均为完成；模拟净优化、偏差改善、CVaR 风险预算和候选曲线口径一致。');
callout('推荐讲法：“首页不是结果看板，而是一条完整交易任务。上方五个阶段回答现在做到哪一步，中间指标回答结果怎样，下方曲线和推导回答为什么这样做。”');
h2('5.3 价格预测');
p('正常使用：综合气象、机组、负荷与电价四类基础数据生成目标日 96 点价格预测，为申报建议提供价格侧依据。');
p('当前 Mock：展示五个历史交易日准备度、96 点预测区间和逐点结果。');
callout('推荐讲法：“价格预测不是单独炫技，它是申报优化的价格侧输入。我们既展示趋势，也保留逐点区间，方便交易员判断高低价窗口。”');
h2('5.4 策略进化');
p('正常使用：比较 Champion 与 Challenger 策略，基于独立留出集、胜率、改善幅度和治理规则决定是否升级。');
p('当前 Mock：展示候选策略版本、参数差异、验证指标和人工审批原则。');
callout('推荐讲法：“模型可以持续验证，但策略版本不会自行替换。只有指标达标并经过人工审批，候选策略才有资格成为现行策略。”');
h2('5.5 复盘回顾与证据');
p('正常使用：按交易日汇总预测表现、申报偏差、成本结果和操作审计，为复盘和策略改进提供证据。');
p('当前 Mock：展示模拟历史样本、模拟成本评估、模拟结算净优化和模拟操作留痕。');
callout('推荐讲法：“复盘页把预测、申报、成本和操作记录放回同一条证据链，避免只看一个优化数字却说不清它从哪里来。”');

h1('6. 推荐演示方案');
h2('6.1 开场口径');
callout('“这是一个面向电力交易员的智能交易副驾驶。正式使用时，系统围绕真实交易日组织数据、计算、复核和结算；今天展示的是比赛 Mock 环境，所有数据均为内置模拟数据，重点演示产品流程、功能机制和人机协作方式。”');
h2('6.2 推荐讲解顺序');
ordered('先看基础数据页：说明气象、机组、负荷和电价四类模拟输入已经按 96 点准备完成，并指出“基础数据→价格预测→申报优化”的数据流。');
ordered('打开价格预测：说明四类基础数据如何共同形成目标日 96 点价格预测，并给申报优化提供价格侧依据。');
ordered('再看申报优化首页：用一句话说明这是五阶段交易工作台。');
ordered('点击数据接入：说明四类输入被组织到同一交易日任务中。');
ordered('点击质量校验：强调先校验、后计算，避免脏数据直接进入模型。');
ordered('点击申报优化：展示 96 点曲线、三个重点窗口和推导依据。');
ordered('点击人工复核：强调 AI 给建议，交易员确认最终版本。');
ordered('点击结算评估：展示统一成本公式和 ¥24,000 模拟净优化结果。');
ordered('最后依次打开策略进化和复盘回顾：补充策略治理和证据留痕。');
h2('6.3 收尾口径');
callout('“这套系统的核心不是替交易员自动做决定，而是把分散数据变成可解释建议，把人工判断变成有依据的确认，再把结算结果沉淀为下一轮策略验证的证据。”');
h2('6.4 建议重点');
bullet('先讲业务问题，再点页面；避免一上来逐个念数字。');
bullet('每个数字都服务于“输入完整、建议可解释、人工确认、结果可追溯”四条主线。');
bullet('提到 ¥24,000 时必须同时说“模拟结算净优化”，不要表述为真实生产收益。');
bullet('不展开部署、接口等待或外部环境准备，把注意力保持在完整产品闭环。');

h1('7. 统一措辞与产品边界');
h2('7.1 建议使用的表述');
bullet('比赛 Mock 环境 / 内置模拟数据 / 模拟交易日。');
bullet('AI 候选申报建议 / 人工复核确认 / 模拟结算净优化。');
bullet('产品机制已完整跑通 / 五阶段流程可完整演示 / 结果证据可回看。');
h2('7.2 不建议使用的表述');
bullet('已在生产环境自动交易。');
bullet('已经产生真实 ¥24,000 收益。');
bullet('AI 自动替代交易员完成申报。');
bullet('当前模拟结果可以直接代表未来生产效果。');
h2('7.3 页面展示要求');
bullet('全局固定显示“比赛演示 · 模拟数据 · 全流程采用模拟数据”。');
bullet('五阶段均使用完整、正向、可演示的完成状态。');
bullet('页面不展示数据接入等待、验证缺口、流程阻塞或需补充外部数据的提示。');
bullet('所有模拟金额、比例、点数和公式在不同页面保持一致。');
h1('8. 验收标准');
bullet('阅读 PRD 后，能够清楚区分正式使用、当前 Mock 和现场演示三种口径。');
bullet('演示人员可直接按照第 6 章完成一轮连贯讲解。');
bullet('系统可在最终交付包解压后启动，五阶段和五个桌面页面均可正常访问。');
bullet('页面明确标识模拟数据，不出现等待真实数据或未完成状态。');
bullet('PRD 中的页面、数据和演示说法与当前可运行系统保持一致。');
h1('9. 本次交付边界');
p('交付内容：可运行的桌面版模拟演示系统，以及本 PRD。');
p('不包含：比赛视频、配音、录屏脚本、视频工程文件和手机端演示材料。');
p('系统定位为比赛模拟演示工具，不自动提交交易；所有建议均保留人工确认环节。');
p('— 文档结束 —', { align: 'center', color: '#94A3B8', spaceBefore: '20pt' });

run(['create', output, '--force']);
run(['batch', output, '--stop-on-error', '--json'], { input: JSON.stringify(commands) });
run(['validate', output, '--json']);
console.log(output);
