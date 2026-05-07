function emptyDataset() {
  return {
    rows: [],
    quality: { dates: [], fieldCompleteness: {}, gaps: [] },
    sources: {},
  };
}

function normalizeDataset(dataset) {
  return {
    generatedAt: dataset?.generatedAt || null,
    rows: Array.isArray(dataset?.rows) ? dataset.rows : [],
    quality: {
      dates: Array.isArray(dataset?.quality?.dates) ? dataset.quality.dates : [],
      fieldCompleteness: dataset?.quality?.fieldCompleteness || {},
      gaps: Array.isArray(dataset?.quality?.gaps) ? dataset.quality.gaps : [],
    },
    sources: dataset?.sources || {},
  };
}

let rawData = normalizeDataset(window.TRADING_SYSTEM_DATA || emptyDataset());

const modules = [
  { id: 'report', group: 'AI智能运营', label: '运营报告', icon: '报' },
  { id: 'revenue', group: 'AI智能运营', label: '收益明细', icon: '益' },
  { id: 'operator', group: 'AI智能运营', label: '运营商管理', icon: '商' },
  { id: 'settlement', group: 'AI智能运营', label: '自动结算', icon: '结' },
  { id: 'review', group: 'AI智能运营', label: '复盘对标', icon: '复' },
  { id: 'publicData', group: '数据中心', label: '公共数据', icon: '公' },
  { id: 'privateData', group: '数据中心', label: '私有数据', icon: '私' },
  { id: 'strategy', group: '策略中心', label: 'AI策略工作台', icon: 'AI' },
];

let state = {
  moduleId: 'report',
  date: rawData.quality?.dates?.[0] || '',
  loadError: '',
};

const formatNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
const currency = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

function n(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function fmt(value, fallback = '-') {
  const numeric = n(value);
  return numeric === null ? fallback : formatNumber.format(numeric);
}

function avg(values) {
  const clean = values.map(n).filter((value) => value !== null);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function max(values) {
  const clean = values.map(n).filter((value) => value !== null);
  return clean.length ? Math.max(...clean) : null;
}

function min(values) {
  const clean = values.map(n).filter((value) => value !== null);
  return clean.length ? Math.min(...clean) : null;
}

function rowsForDate(date = state.date) {
  const rows = rawData.rows || [];
  if (!date) return rows;
  return rows.filter((row) => row.date === date);
}

function allDates() {
  return rawData.quality?.dates?.length
    ? rawData.quality.dates
    : [...new Set((rawData.rows || []).map((row) => row.date))].sort();
}

function sourceCount() {
  const p0 = [
    'user_bid_96',
    'user_default_bid_96',
    'dayahead_user_clearing',
    'dayahead_public_clearing',
    'realtime_public_clearing',
    'realtime_average_price',
    'actual_load_96',
    'settle_day',
  ];
  return p0.filter((id) => rawData.sources?.[id]).length;
}

function highPriceRows(limit = 6) {
  const rows = rowsForDate().filter((row) => n(row.realTimeAvgPrice) !== null);
  const values = rows.map((row) => n(row.realTimeAvgPrice)).sort((a, b) => a - b);
  const threshold = values.length ? values[Math.floor(values.length * 0.78)] : null;
  if (threshold === null) return [];
  return rows
    .filter((row) => n(row.realTimeAvgPrice) >= threshold)
    .slice(0, limit);
}

function lowPriceRows(limit = 6) {
  const rows = rowsForDate().filter((row) => n(row.realTimeAvgPrice) !== null);
  return rows
    .slice()
    .sort((a, b) => n(a.realTimeAvgPrice) - n(b.realTimeAvgPrice))
    .slice(0, limit);
}

function estimateDefaultEnergy() {
  const total = rowsForDate()
    .map((row) => n(row.defaultDeclarationPower))
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value * 0.25, 0);
  return total || null;
}

function riskLevel() {
  const gaps = rawData.quality?.gaps?.length || 0;
  if (gaps >= 4) return { text: '需补数据', className: 'warn' };
  if (gaps) return { text: '可试算', className: 'warn' };
  return { text: '可运行', className: '' };
}

function pageTitle(title, desc, action = '') {
  return `
    <div class="page-title">
      <div>
        <h1>${title}</h1>
        <p>${desc}</p>
      </div>
      <div>${action}</div>
    </div>
  `;
}

function toolbar(extra = '') {
  return `
    <div class="toolbar">
      <label class="field">市场主体 <input value="苏州市轨道交通集团有限公司"></label>
      <label class="field">交易品种 <select><option>江苏省内现货</option><option>中长期交易</option></select></label>
      <label class="field">数据口径 <select><option>15分钟 / 96点</option><option>小时级</option></select></label>
      ${extra}
      <button class="primary-button">查询</button>
      <button class="ghost-button">导出</button>
    </div>
  `;
}

function kpi(label, value, note, pill = '') {
  return `
    <article class="card kpi">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${note}</small>
      ${pill}
    </article>
  `;
}

function linePath(rows, field, width = 760, height = 238) {
  const valid = rows
    .filter((row) => n(row[field]) !== null && n(row.pointIndex) !== null)
    .map((row) => ({ x: n(row.pointIndex), y: n(row[field]) }));
  if (!valid.length) return '';
  const values = valid.map((point) => point.y);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue === minValue ? 1 : maxValue - minValue;
  return valid
    .map((point, index) => {
      const x = 36 + ((point.x - 1) / 95) * (width - 58);
      const y = height - 26 - ((point.y - minValue) / span) * (height - 58);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function chart(rows, series) {
  const width = 760;
  const height = 238;
  return `
    <div class="chart-box">
      <svg viewBox="0 0 ${width} ${height}" aria-label="chart">
        <line class="axis-line" x1="36" y1="${height - 26}" x2="${width - 22}" y2="${height - 26}"></line>
        <line class="axis-line" x1="36" y1="18" x2="36" y2="${height - 26}"></line>
        ${series
          .map(
            (item) =>
              `<path class="${item.className}" d="${linePath(rows, item.field, width, height)}"></path>`
          )
          .join('')}
      </svg>
    </div>
  `;
}

function barChart(items) {
  const maxValue = Math.max(...items.map((item) => Math.abs(item.value)), 1);
  return items
    .map(
      (item) => `
        <div class="progress-row">
          <span>${item.label}</span>
          <div class="progress"><b style="width:${Math.max(
            6,
            (Math.abs(item.value) / maxValue) * 100
          )}%;background:${item.color}"></b></div>
          <strong style="color:${item.color}">${item.value > 0 ? '+' : ''}${item.value} 万</strong>
        </div>`
    )
    .join('');
}

function table(headers, rows) {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>${headers.map((item) => `<th class="${item.num ? 'num' : ''}">${item.label}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows
            .map(
              (row) =>
                `<tr>${headers
                  .map((head) => `<td class="${head.num ? 'num' : ''}">${row[head.key] ?? '-'}</td>`)
                  .join('')}</tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function heatmap(rows, field) {
  const values = rows.map((row) => n(row[field])).filter((value) => value !== null);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const span = maxValue === minValue ? 1 : maxValue - minValue;
  return `
    <div class="heatmap">
      ${Array.from({ length: 96 }, (_, index) => {
        const row = rows.find((item) => item.pointIndex === index + 1);
        const value = n(row?.[field]);
        const ratio = value === null ? 0.08 : (value - minValue) / span;
        const color = field.includes('Price')
          ? `rgba(47, 124, 246, ${0.18 + ratio * 0.76})`
          : `rgba(24, 166, 106, ${0.18 + ratio * 0.76})`;
        return `<div class="heat-cell" title="${row?.timePoint || ''} ${fmt(value)}" style="background:${color}"></div>`;
      }).join('')}
    </div>
  `;
}

function strategyCards() {
  const highs = highPriceRows(4);
  const lows = lowPriceRows(4);
  return `
    <div class="grid cols-3">
      <article class="strategy-card">
        <h3>低价窗口补足</h3>
        <p>优先观察 ${lows.map((row) => row.timePoint).join('、') || '待补实时价'} 等低价点位，适合做缺口补足和低风险增配。</p>
        <div class="tag-list"><span class="tag">动作：增配买入</span><span class="tag">置信度：试算</span></div>
      </article>
      <article class="strategy-card">
        <h3>晚高峰风险控制</h3>
        <p>${highs.map((row) => row.timePoint).join('、') || '晚峰'} 为高价观察窗口，建议先锁定申报偏差和负荷异常。</p>
        <div class="tag-list"><span class="tag">动作：控制暴露</span><span class="tag">需人工确认</span></div>
      </article>
      <article class="strategy-card">
        <h3>数据补齐优先级</h3>
        <p>当前实际日电量和日结算为空，系统可做策略试算，但收益归因与偏差考核需要补齐。</p>
        <div class="tag-list"><span class="tag">补数据：实际负荷</span><span class="tag">补数据：日结算</span></div>
      </article>
    </div>
  `;
}

function renderReport() {
  const rows = rowsForDate();
  const realtimeAvg = avg(rows.map((row) => row.realTimeAvgPrice));
  const risk = riskLevel();
  return `
    ${pageTitle('运营报告', '按截图系统的运营报表形态呈现交易规模、收益测算、风险窗口和数据完整性。')}
    ${toolbar('<label class="field">日期 <input value="' + state.date + '"></label>')}
    <section class="grid cols-4">
      ${kpi('年度交易规模', '72,783 万度', '来自既有方案口径，用于收益测算基准')}
      ${kpi('预计节约区间', '218 ~ 728 万/年', '按 0.3 ~ 1.0 分/度合理预期测算')}
      ${kpi('实时均价', fmt(realtimeAvg), '当前日期已返回实时均价点数 ' + fieldCount('realTimeAvgPrice'))}
      ${kpi('系统状态', risk.text, 'P0 数据源覆盖 ' + sourceCount() + '/8', `<span class="status-pill ${risk.className}">${risk.text}</span>`)}
    </section>
    <section class="grid layout-7-5" style="margin-top:10px">
      <article class="card">
        <h2>价格与负荷联合曲线</h2>
        <div class="legend">
          <span><i style="background:#2f7cf6"></i>实时均价</span>
          <span><i style="background:#19a778"></i>缺省申报</span>
          <span><i style="background:#e49a21"></i>日前公开价</span>
        </div>
        ${chart(rows, [
          { field: 'realTimeAvgPrice', className: 'line-blue' },
          { field: 'defaultDeclarationPower', className: 'line-green' },
          { field: 'dayAheadPublicPrice', className: 'line-orange' },
        ])}
      </article>
      <article class="card">
        <h2>数据完整性</h2>
        ${barChart([
          { label: '缺省申报', value: fieldCount('defaultDeclarationPower'), color: '#18a66a' },
          { label: '实时均价', value: fieldCount('realTimeAvgPrice'), color: '#2f7cf6' },
          { label: '实际负荷', value: fieldCount('actualKwh'), color: '#df5d5d' },
          { label: '日结算', value: fieldCount('settleAmount'), color: '#e7a23c' },
        ])}
      </article>
    </section>
  `;
}

function fieldCount(field) {
  return rawData.quality?.fieldCompleteness?.[field] || 0;
}

function renderRevenue() {
  const rows = rowsForDate();
  return `
    ${pageTitle('收益明细', '透明化收益分成与收益明细，按业务系统样式提供筛选、曲线和明细表。')}
    ${toolbar('<label class="field">收益类型 <select><option>策略优化收益</option><option>偏差控制收益</option></select></label>')}
    <section class="grid layout-7-5">
      <article class="card">
        <h2>日内收益测算曲线</h2>
        ${chart(rows, [
          { field: 'realTimeAvgPrice', className: 'line-blue' },
          { field: 'defaultDeclarationPower', className: 'line-green' },
        ])}
      </article>
      <article class="card">
        <h2>收益拆解</h2>
        ${barChart([
          { label: '午间低价增配', value: 43, color: '#18a66a' },
          { label: '晚峰控暴露', value: 35, color: '#2f7cf6' },
          { label: '富余电量卖出', value: 18, color: '#16a39a' },
          { label: '识别损失', value: -11, color: '#df5d5d' },
        ])}
      </article>
    </section>
    <article class="card" style="margin-top:10px">
      <h2>收益明细表</h2>
      ${table(
        [
          { key: 'period', label: '时段' },
          { key: 'action', label: '策略动作' },
          { key: 'energy', label: '影响电量', num: true },
          { key: 'gain', label: '预计收益', num: true },
          { key: 'risk', label: '风险说明' },
        ],
        [
          { period: '10:30-14:30', action: '低价窗口补足', energy: '+2.8 万kWh', gain: '+1.2 ~ +2.6 万元', risk: '负荷预测偏差不超过 2.5%' },
          { period: '17:30-20:30', action: '晚峰控暴露', energy: '0', gain: '以避损为主', risk: '保护牵引负荷，避免高峰误买' },
          { period: '21:00-22:00', action: '小仓位择机卖出', energy: '-0.6 万kWh', gain: '+0.2 ~ +0.7 万元', risk: '仅在预测富余仍成立时执行' },
        ]
      )}
    </article>
  `;
}

function renderOperator() {
  return `
    ${pageTitle('运营商管理', '管理售电代理、数据来源、账号权限和服务绩效。')}
    ${toolbar('<label class="field">运营商 <input value="协鑫能科"></label><label class="field">状态 <select><option>全部</option><option>正常</option></select></label>')}
    <article class="card">
      <h2>运营商台账</h2>
      ${table(
        [
          { key: 'name', label: '运营商名称' },
          { key: 'role', label: '服务角色' },
          { key: 'data', label: '数据接口' },
          { key: 'score', label: '服务评分', num: true },
          { key: 'status', label: '状态' },
          { key: 'action', label: '操作' },
        ],
        [
          { name: '协鑫能科 GCL-ET', role: '电力交易代理', data: '结算、现货、公共数据', score: '92', status: '正常', action: '<button class="mini-button">查看</button>' },
          { name: '国网江苏交易平台', role: '市场数据来源', data: '出清、申报、结算', score: '接口中', status: '需CA登录', action: '<button class="mini-button">采集</button>' },
          { name: '苏州地铁内部台账', role: '私有负荷/合同', data: 'Excel、核对单、人工确认', score: '86', status: '待治理', action: '<button class="mini-button">治理</button>' },
        ]
      )}
    </article>
  `;
}

function renderSettlement() {
  return `
    ${pageTitle('自动结算', '对接日结算、月结算和现货核对单，形成自动归因和差异解释。')}
    ${toolbar('<label class="field">结算周期 <select><option>日结算</option><option>月结算</option></select></label>')}
    <section class="grid cols-4">
      ${kpi('日结算记录', fieldCount('settleAmount'), '当前 JSPEC 日结算返回空列表')}
      ${kpi('待核对月份', '2026-03', '已有现货核对单文件可作为下一步接入源')}
      ${kpi('异常项', '4', '价格口径、偏差电量、线损和系统运行费')}
      ${kpi('自动匹配率', '待计算', '需补日结算和实际负荷')}
    </section>
    <section class="grid cols-2" style="margin-top:10px">
      <article class="card"><h2>结算差异归因</h2>${barChart([
        { label: '交易价格差异', value: 21, color: '#2f7cf6' },
        { label: '偏差考核', value: -8, color: '#df5d5d' },
        { label: '线损/基金附加', value: 14, color: '#e7a23c' },
      ])}</article>
      <article class="card"><h2>日结算缺口</h2><div class="empty">本次 JSPEC 捕获中，日结算接口 queryDaySettleResult 返回 total = 0。系统已保留接口位，待有记录后自动入表。</div></article>
    </section>
  `;
}

function renderReview() {
  return `
    ${pageTitle('复盘对标', '把人工策略、模型建议、实际结果放在同一张表里复盘。')}
    ${toolbar('<label class="field">复盘周期 <select><option>日</option><option>周</option><option>月</option></select></label>')}
    <section class="grid cols-2">
      <article class="card"><h2>价格热力</h2>${heatmap(rowsForDate(), 'realTimeAvgPrice')}</article>
      <article class="card"><h2>申报热力</h2>${heatmap(rowsForDate(), 'defaultDeclarationPower')}</article>
    </section>
    <section class="grid cols-2" style="margin-top:10px">
      <article class="card"><h2>复盘时间线</h2>${timeline()}</article>
      <article class="card"><h2>复盘台账</h2>${reviewTable()}</article>
    </section>
  `;
}

function timeline() {
  return `
    <div class="timeline">
      ${[
        ['08:40', '读取日前曲线', '导入 D 日日前价格预测、负荷预测和申报草案。'],
        ['10:20', '识别午间低价窗口', '系统提示 10:30-14:30 可作为主增配时段。'],
        ['14:15', '发出拐点告警', '监测到午后新能源扰动可能抬升实时价。'],
        ['17:45', '锁定高峰风险', '晚高峰负荷上修概率升高，禁止激进卖出。'],
      ]
        .map(
          ([time, title, text]) =>
            `<div class="event"><time>${time}</time><div><strong>${title}</strong><p>${text}</p></div></div>`
        )
        .join('')}
    </div>
  `;
}

function reviewTable() {
  return table(
    [
      { key: 'date', label: '日期' },
      { key: 'suggestion', label: '建议' },
      { key: 'result', label: '结果' },
      { key: 'reason', label: '核心判断' },
    ],
    [
      { date: '2026-05-07', suggestion: '晚峰控暴露', result: '等待实际结算', reason: '实时均价高位窗口已出现' },
      { date: '2026-05-08', suggestion: '缺省申报复核', result: '待执行', reason: '缺省申报曲线已完整' },
    ]
  );
}

function renderPublicData() {
  const rows = rowsForDate();
  return `
    ${pageTitle('公共数据', '对应截图中的公共数据页面：日前、实时、平均价、节点价等市场公开数据。')}
    ${toolbar('<label class="field">数据类型 <select><option>实时加权均价</option><option>日前公开出清</option></select></label>')}
    <section class="grid layout-7-5">
      <article class="card"><h2>公开价格曲线</h2>${chart(rows, [
        { field: 'realTimeAvgPrice', className: 'line-blue' },
        { field: 'dayAheadPublicPrice', className: 'line-orange' },
      ])}</article>
      <article class="card"><h2>市场指标</h2>
        ${kpi('实时均价最高', fmt(max(rows.map((row) => row.realTimeAvgPrice))), '当前捕获日期')}
        ${kpi('实时均价最低', fmt(min(rows.map((row) => row.realTimeAvgPrice))), '当前捕获日期')}
      </article>
    </section>
    <article class="card" style="margin-top:10px"><h2>96点公开数据</h2>${pointTable(rows)}</article>
  `;
}

function renderPrivateData() {
  const rows = rowsForDate();
  return `
    ${pageTitle('私有数据', '对应截图中的私有数据页面：申报曲线、实际负荷、结算和内部台账。')}
    ${toolbar('<label class="field">私有数据源 <select><option>JSPEC 申报</option><option>现货核对单</option><option>人工台账</option></select></label>')}
    <section class="grid cols-4">
      ${kpi('缺省申报点数', fieldCount('defaultDeclarationPower'), '已拿到完整 96 点缺省申报')}
      ${kpi('主动申报点数', fieldCount('declarationPower'), '当前主动申报功率为空')}
      ${kpi('实际日电量', fieldCount('actualKwh'), '接口已通但返回空列表')}
      ${kpi('日结算', fieldCount('settleAmount'), '接口已通但返回空列表')}
    </section>
    <section class="grid cols-2" style="margin-top:10px">
      <article class="card"><h2>申报曲线</h2>${chart(rows, [{ field: 'defaultDeclarationPower', className: 'line-green' }])}</article>
      <article class="card"><h2>私有数据明细</h2>${pointTable(rows)}</article>
    </section>
  `;
}

function renderStrategy() {
  return `
    ${pageTitle('AI策略工作台', '围绕月度分配、D-2/D-3 能量块、D-1 日前申报和 D 日风控输出可解释建议。', '<span class="status-pill warn">辅助决策，不自动下单</span>')}
    ${toolbar('<label class="field">策略场景 <select><option>D-1 日前申报</option><option>D-2/D-3 能量块</option><option>D 日实时风控</option></select></label>')}
    ${strategyCards()}
    <section class="grid cols-2" style="margin-top:10px">
      <article class="card"><h2>推荐原因拆解</h2>
        <div class="strategy-card"><h3>负荷曲线稳定，午间预测误差较小</h3><p>如果补齐实际负荷，系统会自动计算 WAPE/MAPE 并进入策略评分。</p></div>
        <div class="strategy-card" style="margin-top:10px"><h3>目前与实时价差结构呈“午低晚高”</h3><p>低价补足、高价控暴露是第一版最稳健的策略方向。</p></div>
      </article>
      <article class="card"><h2>策略执行单</h2>${table(
        [
          { key: 'time', label: '时段' },
          { key: 'action', label: '建议动作' },
          { key: 'effect', label: '预计影响' },
          { key: 'guard', label: '执行约束' },
        ],
        [
          { time: '10:30-14:30', action: '低价增配', effect: '+2.8万kWh', guard: '负荷预测偏差不超过 2.5%' },
          { time: '17:30-20:30', action: '控制暴露', effect: '以避损为主', guard: '牵引负荷安全优先' },
          { time: '21:00-22:00', action: '小仓位择机卖出', effect: '-0.6万kWh', guard: '富余电量预测仍成立' },
        ]
      )}</article>
    </section>
  `;
}

function pointTable(rows) {
  const visible = rows.slice(0, 24).map((row) => ({
    point: row.timePoint,
    rt: fmt(row.realTimeAvgPrice),
    da: fmt(row.dayAheadPublicPrice),
    def: fmt(row.defaultDeclarationPower),
    actual: fmt(row.actualKwh),
    source: (row.sourceTargets || []).join(' / '),
  }));
  return table(
    [
      { key: 'point', label: '点位' },
      { key: 'rt', label: '实时均价', num: true },
      { key: 'da', label: '日前公开价', num: true },
      { key: 'def', label: '缺省申报', num: true },
      { key: 'actual', label: '实际kWh', num: true },
      { key: 'source', label: '来源' },
    ],
    visible
  );
}

const renderers = {
  report: renderReport,
  revenue: renderRevenue,
  operator: renderOperator,
  settlement: renderSettlement,
  review: renderReview,
  publicData: renderPublicData,
  privateData: renderPrivateData,
  strategy: renderStrategy,
};

function renderNav() {
  const nav = document.getElementById('sideNav');
  const groups = [...new Set(modules.map((item) => item.group))];
  nav.innerHTML = groups
    .map(
      (group) => `
        <div class="nav-group-title">${group}</div>
        ${modules
          .filter((item) => item.group === group)
          .map(
            (item) => `
              <button class="nav-item ${item.id === state.moduleId ? 'active' : ''}" data-module="${item.id}">
                <span class="nav-icon">${item.icon}</span>
                <span>${item.label}</span>
              </button>`
          )
          .join('')}
      `
    )
    .join('');

  nav.querySelectorAll('[data-module]').forEach((button) => {
    button.addEventListener('click', () => {
      state.moduleId = button.dataset.module;
      render();
    });
  });
}

function renderDates() {
  const select = document.getElementById('dateSelect');
  select.innerHTML = allDates()
    .map((date) => `<option value="${date}" ${date === state.date ? 'selected' : ''}>${date}</option>`)
    .join('');
  select.onchange = () => {
    state.date = select.value;
    render();
  };
}

function render() {
  const active = modules.find((item) => item.id === state.moduleId) || modules[0];
  document.getElementById('moduleCrumb').textContent = active.label;
  renderDates();
  renderNav();
  const alert = state.loadError
    ? `<div class="system-alert">${state.loadError}</div>`
    : '';
  document.getElementById('workspace').innerHTML = alert + renderers[state.moduleId]();
}

async function loadSystemData() {
  try {
    const response = await fetch('/api/dataset', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    rawData = normalizeDataset(await response.json());
    state.loadError = '';
  } catch (error) {
    state.loadError = `API 数据加载失败，当前使用本地降级数据：${error.message}`;
    rawData = normalizeDataset(window.TRADING_SYSTEM_DATA || rawData || emptyDataset());
  }

  const dates = allDates();
  if (!state.date || !dates.includes(state.date)) {
    state.date = dates[0] || '';
  }
  render();
}

async function refreshSystemData() {
  const button = document.getElementById('refreshButton');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '刷新中';

  try {
    const response = await fetch('/api/refresh', { method: 'POST', cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await loadSystemData();
  } catch (error) {
    state.loadError = `刷新失败：${error.message}`;
    render();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

document.getElementById('refreshButton').addEventListener('click', refreshSystemData);

loadSystemData();
