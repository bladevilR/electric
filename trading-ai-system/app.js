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

const sourceCatalog = [
  { id: 'user_bid_96', label: '主动申报 96 点' },
  { id: 'user_default_bid_96', label: '默认申报 96 点' },
  { id: 'dayahead_user_clearing', label: '日前用户侧价格' },
  { id: 'dayahead_public_clearing', label: '日前市场价格' },
  { id: 'realtime_public_clearing', label: '实时市场价格' },
  { id: 'realtime_average_price', label: '实时均价' },
  { id: 'actual_load_96', label: '实际负荷 96 点' },
  { id: 'settle_day', label: '日结算结果' },
];

const importantFields = [
  { id: 'realTimeAvgPrice', label: '实时均价' },
  { id: 'dayAheadPublicPrice', label: '日前市场价' },
  { id: 'dayAheadUserPrice', label: '日前用户价' },
  { id: 'defaultDeclarationPower', label: '默认申报' },
  { id: 'declarationPower', label: '主动申报' },
  { id: 'actualKwh', label: '实际负荷' },
  { id: 'settleAmount', label: '结算金额' },
];

const modules = [
  { id: 'report', group: '总览', label: '今日概览', icon: '总' },
  { id: 'revenue', group: '总览', label: '收益情况', icon: '收' },
  { id: 'operator', group: '总览', label: '主体信息', icon: '主' },
  { id: 'settlement', group: '总览', label: '结算复盘', icon: '结' },
  { id: 'review', group: '总览', label: '复盘看板', icon: '复' },
  { id: 'publicData', group: '数据', label: '市场数据', icon: '市' },
  { id: 'privateData', group: '数据', label: '我的数据', icon: '私' },
  { id: 'dataQuality', group: '数据', label: '数据准备情况', icon: '数' },
  { id: 'dataAssets', group: '数据', label: '数据资产', icon: 'D' },
  { id: 'settlementReference', group: '数据', label: '结算参考', icon: 'R' },
  { id: 'ukey', group: '实时', label: '实时数据助手', icon: '实' },
  { id: 'forecastLab', group: '模型', label: '预测实验室', icon: 'F' },
  { id: 'backtestReport', group: '模型', label: '回测结果', icon: 'B' },
  { id: 'costStrategy', group: '策略', label: '省钱策略', icon: '¥' },
  { id: 'strategy', group: '策略', label: 'AI策略建议', icon: 'AI' },
  { id: 'production', group: '策略', label: '交易草稿复核', icon: '稿' },
];

let state = {
  moduleId: 'report',
  date: rawData.quality?.dates?.[0] || '',
  loadError: '',
  integrationClosure: null,
  integrationError: '',
  strategyAdvice: null,
  strategyModelPrediction: null,
  strategySuggestions: [],
  strategyGeneratedAt: '',
  strategyError: '',
  strategyReport: null,
  strategyReportError: '',
  productionReadiness: null,
  productionError: '',
  businessInputs: null,
  auditEvents: [],
  executionProposal: null,
  executionError: '',
  ukeyAssistant: null,
  ukeyError: '',
  costStrategy: null,
  dataAssets: null,
  settlementReference: null,
  forecastLab: null,
  backtestReport: null,
  backfillPlan: null,
  costStrategyError: '',
  dataAssetsError: '',
  settlementReferenceError: '',
  forecastLabError: '',
  backtestError: '',
  backfillError: '',
};

const formatNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
const formatDateTime = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function n(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function fmt(value, fallback = '-') {
  const numeric = n(value);
  return numeric === null ? fallback : formatNumber.format(numeric);
}

function money(value) {
  const numeric = n(value);
  return numeric === null ? '-' : `${formatNumber.format(numeric)} 元`;
}

function timeText(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : formatDateTime.format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function avg(values) {
  const clean = values.map(n).filter((value) => value !== null);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function sum(values) {
  return values.map(n).filter((value) => value !== null).reduce((total, value) => total + value, 0);
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
  return date ? rows.filter((row) => row.date === date) : rows;
}

function allDates() {
  return rawData.quality?.dates?.length
    ? rawData.quality.dates
    : [...new Set((rawData.rows || []).map((row) => row.date).filter(Boolean))].sort();
}

function fieldCount(field) {
  return Number(rawData.quality?.fieldCompleteness?.[field] || 0);
}

function sourceCount() {
  return sourceCatalog.filter((source) => rawData.sources?.[source.id]).length;
}

function dataReadyPercent() {
  if (!sourceCatalog.length) return 0;
  return Math.round((sourceCount() / sourceCatalog.length) * 100);
}

function selectedModule() {
  return modules.find((item) => item.id === state.moduleId) || modules[0];
}

function severityLabel(value) {
  return (
    {
      info: '观察',
      warning: '提醒',
      high: '重点',
      critical: '高风险',
    }[value] || '建议'
  );
}

function statusText(value) {
  return (
    {
      closed: '已整理',
      registered: '已登记',
      source_empty: '暂时没有数据',
      ready: '已准备好',
      warning: '需要人工看一眼',
      action_required: '需要补充设置',
      blocked: '暂时不能生成可用草稿',
      decision_support_ready: '可以辅助判断',
      data_blocked: '数据还不够',
      running: '正在采集',
      stopped: '未自动采集',
      idle: '待命',
      failed: '上次失败',
      not_started: '未打开',
      started: '已打开',
      ready_for_local_user: '可以使用',
      snapshot_available: '已有实时数据',
      waiting_for_visible_page: '等你打开实时页面',
      available_snapshot: '已有价格',
      missing: '缺少数据',
      observation_ready: '可以先看建议',
      waiting_for_realtime_price: '等待实时价格',
      trial_only: '只作参考，不会自动提交',
      heuristic_fallback: '规则兜底',
      insufficient_history: '历史不足',
      baseline_ready: '基线可用',
      unavailable: '暂不可用',
      savings_unavailable: '不能声明节省金额',
      targeted: '定向补采',
      conservative: '保守',
      neutral: '中性',
      aggressive: '激进',
    }[value] || value || '-'
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(items, fallback = '-') {
  const clean = asArray(items).filter(Boolean);
  return clean.length ? clean.join('、') : fallback;
}

function percent(value) {
  const numeric = n(value);
  return numeric === null ? '-' : `${Math.round(numeric)}%`;
}

function pageTitle(title, desc, action = '') {
  return `
    <div class="page-title">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(desc)}</p>
      </div>
      <div>${action}</div>
    </div>
  `;
}

function toolbar(extra = '') {
  return `
    <div class="toolbar">
      <label class="field">交易主体 <input value="苏州市轨道交通集团有限公司" readonly></label>
      <label class="field">交易日 <select>${allDates()
        .map((date) => `<option ${date === state.date ? 'selected' : ''}>${escapeHtml(date)}</option>`)
        .join('')}</select></label>
      ${extra}
    </div>
  `;
}

function kpi(label, value, note, pill = '') {
  return `
    <article class="card kpi">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
      ${pill}
    </article>
  `;
}

function emptyCard(title, note) {
  return `
    <article class="card pending-card">
      <h2>${escapeHtml(title)}</h2>
      <div class="empty">${escapeHtml(note)}</div>
    </article>
  `;
}

function table(columns, rows) {
  if (!rows.length) {
    return '<div class="empty">现在还没有可展示的数据。</div>';
  }
  return `
    <table class="model-table">
      <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                ${columns
                  .map((column) => {
                    const value = typeof column.render === 'function' ? column.render(row) : row[column.key];
                    return `<td>${escapeHtml(value)}</td>`;
                  })
                  .join('')}
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function simpleList(items) {
  if (!items.length) return '<div class="empty">暂时没有需要处理的事项。</div>';
  return `
    <div class="pending-list">
      ${items
        .map((item) => `<div><strong>${escapeHtml(item.title || item.label || item.name || '-')}</strong><span>${escapeHtml(item.note || item.description || item.detail || '')}</span></div>`)
        .join('')}
    </div>
  `;
}

function lineChart(rows, series) {
  const values = rows.flatMap((row) => series.map((item) => n(row[item.field]))).filter((value) => value !== null);
  if (!values.length) return '<div class="empty">还没有价格曲线。</div>';
  const ceiling = Math.max(...values, 1);
  return `
    <div class="line-chart">
      ${series
        .map(
          (item) => `
            <div class="line-row">
              <span>${escapeHtml(item.label)}</span>
              <div class="bars">
                ${rows
                  .slice(0, 96)
                  .map((row) => {
                    const value = n(row[item.field]);
                    const height = value === null ? 4 : Math.max(6, Math.round((value / ceiling) * 86));
                    return `<i class="${item.className || ''}" title="${escapeHtml(row.timePoint || '')} ${fmt(value)}" style="height:${height}%"></i>`;
                  })
                  .join('')}
              </div>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function heatmap(rows, field) {
  const values = rows.map((row) => n(row[field])).filter((value) => value !== null);
  if (!values.length) return '<div class="empty">还没有实时价格。</div>';
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(high - low, 1);
  return `
    <div class="heatmap">
      ${rows
        .slice(0, 96)
        .map((row) => {
          const value = n(row[field]);
          const intensity = value === null ? 0 : (value - low) / range;
          const color = `rgba(45, 125, 210, ${0.18 + intensity * 0.7})`;
          return `<span style="background:${color}" title="${escapeHtml(row.timePoint || '')} ${fmt(value)}"></span>`;
        })
        .join('')}
    </div>
  `;
}

function pointTable(rows, limit = 12) {
  return table(
    [
      { key: 'pointIndex', label: '点位' },
      { key: 'timePoint', label: '时间' },
      { label: '实时均价', render: (row) => fmt(row.realTimeAvgPrice) },
      { label: '日前市场价', render: (row) => fmt(row.dayAheadPublicPrice) },
      { label: '主动申报', render: (row) => fmt(row.declarationPower) },
      { label: '实际负荷', render: (row) => fmt(row.actualKwh) },
    ],
    rows.slice(0, limit)
  );
}

function renderStrategyReportPanel() {
  const report = state.strategyReport;
  if (state.strategyReportError) return emptyCard('报告没有生成', state.strategyReportError);
  if (!report) return emptyCard('还没有生成报告', '点击右上角“生成建议报告”，系统会把当前交易日的数据和建议整理成一份报告。');
  const suggestions = Array.isArray(report.suggestions) ? report.suggestions : [];
  return `
    <article class="card report-card">
      <div class="report-head">
        <div>
          <span class="status-pill">报告已生成</span>
          <h2>${escapeHtml(report.title || 'AI建议报告')}</h2>
          <p>交易日：${escapeHtml(report.date || state.date)} · 生成时间：${escapeHtml(timeText(report.generatedAt))}</p>
        </div>
      </div>
      <div class="strategy-grid">
        ${kpi('覆盖点位', String(report.market?.rowCount || 0), '本交易日已读取的点位数')}
        ${kpi('实时价格点位', String(report.market?.realTimePricePoints || 0), '用于判断低价和高价窗口')}
        ${kpi('平均实时价', fmt(report.market?.averageRealTimePrice), '元/MWh')}
      </div>
      <h3>报告里的建议</h3>
      ${simpleList(
        suggestions.map((item) => ({
          title: item.title,
          note: `${item.description || ''} ${item.executable ? '' : '目前只作为参考，不会自动提交。'}`,
        }))
      )}
    </article>
  `;
}

function renderReport() {
  const rows = rowsForDate();
  const realTimeAverage = avg(rows.map((row) => row.realTimeAvgPrice));
  const settlementChecks = state.integrationClosure?.settlementChecks || {};
  const suggestions = state.strategySuggestions || [];
  const warningCount = suggestions.filter((item) => item.severity === 'warning').length;
  return `
    ${pageTitle('今日概览', '先看当天价格、数据是否齐，再决定要不要进入策略页。')}
    ${state.loadError ? `<div class="notice warn">${escapeHtml(state.loadError)}</div>` : ''}
    <section class="kpi-grid">
      ${kpi('已读取点位', String(rows.length), '通常一天应有 96 个点')}
      ${kpi('实时均价', fmt(realTimeAverage), '元/MWh')}
      ${kpi('数据准备度', `${dataReadyPercent()}%`, `${sourceCount()}/${sourceCatalog.length} 类数据已读取`)}
      ${kpi('AI提醒', String(suggestions.length), warningCount ? `${warningCount} 条需要重点看` : '没有高风险提醒')}
    </section>
    <section class="grid two">
      <article class="card">
        <h2>价格走势</h2>
        ${lineChart(rows, [
          { field: 'realTimeAvgPrice', label: '实时均价', className: 'line-blue' },
          { field: 'dayAheadPublicPrice', label: '日前市场价', className: 'line-orange' },
        ])}
      </article>
      <article class="card">
        <h2>今天能做什么</h2>
        ${simpleList([
          { title: '先看实时数据', note: fieldCount('realTimeAvgPrice') ? '已经有实时价格，可以进入 AI策略建议。' : '还没有实时价格，先打开实时数据助手采集。' },
          { title: '再看负荷和持仓', note: fieldCount('actualKwh') ? '已有实际负荷，可用于复盘。' : '实际负荷未到齐时，策略只作参考。' },
          { title: '最后人工确认', note: '系统只给建议和草稿，最终申报仍由人确认。' },
        ])}
      </article>
    </section>
    <section class="grid two">
      <article class="card">
        <h2>最近点位</h2>
        ${pointTable(rows)}
      </article>
      <article class="card">
        <h2>结算文件</h2>
        ${simpleList([
          { title: '已读取文件', note: `${settlementChecks.fileCount || 0} 个` },
          { title: '需要留意', note: settlementChecks.gapCount ? `${settlementChecks.gapCount} 项数据还需要补齐` : '目前没有明显缺项' },
        ])}
      </article>
    </section>
  `;
}

function renderRevenue() {
  const rows = rowsForDate();
  const ledger = state.integrationClosure?.ledger || {};
  return `
    ${pageTitle('收益情况', '把价格、申报、负荷和结算放在一起看，帮助判断收益变化来自哪里。')}
    <section class="kpi-grid">
      ${kpi('交易记录', String(ledger.rowCount || rows.length), '已纳入分析的记录')}
      ${kpi('结算金额', money(sum(rows.map((row) => row.settleAmount))), '当前交易日合计')}
      ${kpi('实时最高价', fmt(max(rows.map((row) => row.realTimeAvgPrice))), '元/MWh')}
      ${kpi('实时最低价', fmt(min(rows.map((row) => row.realTimeAvgPrice))), '元/MWh')}
    </section>
    <section class="grid two">
      <article class="card"><h2>价格对比</h2>${lineChart(rows, [
        { field: 'realTimeAvgPrice', label: '实时均价', className: 'line-blue' },
        { field: 'dayAheadUserPrice', label: '日前用户价', className: 'line-red' },
      ])}</article>
      <article class="card"><h2>收益判断</h2>${simpleList([
        { title: '看价差', note: '实时价格高于日前价格的时段，需要重点关注偏差风险。' },
        { title: '看负荷', note: fieldCount('actualKwh') ? '已有实际负荷，可以做更完整的收益复盘。' : '实际负荷还缺，收益归因先按参考口径看。' },
        { title: '看结算', note: fieldCount('settleAmount') ? '已有结算金额。' : '结算金额未到齐，暂不判断最终收益。' },
      ])}</article>
    </section>
  `;
}

function renderOperator() {
  const participants = Array.isArray(state.integrationClosure?.participants) ? state.integrationClosure.participants : [];
  const rows = participants.length
    ? participants
    : [{ name: '苏州市轨道交通集团有限公司', role: '市场主体', status: '已登记', note: '用于本地试用展示。' }];
  return `
    ${pageTitle('主体信息', '这里放交易主体、角色和状态，方便确认当前看的数据属于谁。')}
    <section class="grid two">
      <article class="card">
        <h2>交易主体</h2>
        ${table(
          [
            { key: 'name', label: '名称' },
            { key: 'role', label: '角色' },
            { label: '状态', render: (row) => statusText(row.status) },
            { key: 'note', label: '说明' },
          ],
          rows
        )}
      </article>
      <article class="card">
        <h2>使用提醒</h2>
        ${simpleList([
          { title: '本机登录', note: 'UKey 登录动作在用户自己的浏览器里完成。' },
          { title: '只给建议', note: '系统不会代替用户提交交易。' },
          { title: '人工留痕', note: '草稿通过后，仍建议保留人工确认记录。' },
        ])}
      </article>
    </section>
  `;
}

function renderSettlement() {
  const checks = state.integrationClosure?.settlementChecks || {};
  const gaps = Array.isArray(checks.gaps) ? checks.gaps : [];
  return `
    ${pageTitle('结算复盘', '用于核对结算文件、价格点位和负荷数据，发现缺项后再回到数据页补齐。')}
    <section class="kpi-grid">
      ${kpi('结算文件', String(checks.fileCount || 0), '已读取的核对单')}
      ${kpi('缺项数量', String(checks.gapCount || gaps.length || 0), '需要人工确认的项目')}
      ${kpi('结算金额点位', String(fieldCount('settleAmount')), '已读取的结算记录')}
      ${kpi('实际负荷点位', String(fieldCount('actualKwh')), '用于偏差复盘')}
    </section>
    <article class="card">
      <h2>需要关注的缺项</h2>
      ${simpleList(gaps.map((item) => ({ title: item.name || item.id || '缺项', note: item.note || item.reason || '需要补齐后再复盘。' })))}
    </article>
  `;
}

function renderReview() {
  const rows = rowsForDate();
  return `
    ${pageTitle('复盘看板', '把一天 96 个点摊开看，快速找出高价、低价和异常时段。')}
    <section class="grid two">
      <article class="card"><h2>价格热力</h2>${heatmap(rows, 'realTimeAvgPrice')}</article>
      <article class="card"><h2>复盘重点</h2>${simpleList([
        { title: '低价窗口', note: '适合观察是否有补足空间。' },
        { title: '高价窗口', note: '需要检查申报和实际负荷有没有偏差。' },
        { title: '空白点位', note: '如果出现空白，先回到实时数据助手重新采集。' },
      ])}</article>
    </section>
    <article class="card">
      <h2>点位明细</h2>
      ${pointTable(rows, 24)}
    </article>
  `;
}

function renderPublicData() {
  const rows = rowsForDate();
  return `
    ${pageTitle('市场数据', '展示市场侧价格，主要用于判断当天价格区间和波动。')}
    <section class="kpi-grid">
      ${kpi('实时价格点位', String(fieldCount('realTimeAvgPrice')), '已读取点位')}
      ${kpi('日前价格点位', String(fieldCount('dayAheadPublicPrice')), '已读取点位')}
      ${kpi('实时最高价', fmt(max(rows.map((row) => row.realTimeAvgPrice))), '元/MWh')}
      ${kpi('实时最低价', fmt(min(rows.map((row) => row.realTimeAvgPrice))), '元/MWh')}
    </section>
    <article class="card">
      <h2>市场价格明细</h2>
      ${table(
        [
          { key: 'pointIndex', label: '点位' },
          { key: 'timePoint', label: '时间' },
          { label: '实时均价', render: (row) => fmt(row.realTimeAvgPrice) },
          { label: '实时节点价', render: (row) => fmt(row.realTimePointPriceCurrent) },
          { label: '日前市场价', render: (row) => fmt(row.dayAheadPublicPrice) },
        ],
        rows.slice(0, 48)
      )}
    </article>
  `;
}

function renderPrivateData() {
  const rows = rowsForDate();
  return `
    ${pageTitle('我的数据', '展示本主体相关的申报、负荷和结算数据。')}
    <section class="kpi-grid">
      ${kpi('主动申报点位', String(fieldCount('declarationPower')), '用户主动申报')}
      ${kpi('默认申报点位', String(fieldCount('defaultDeclarationPower')), '平台默认申报')}
      ${kpi('实际负荷点位', String(fieldCount('actualKwh')), '实际用电')}
      ${kpi('结算点位', String(fieldCount('settleAmount')), '结算金额')}
    </section>
    <article class="card">
      <h2>我的点位明细</h2>
      ${pointTable(rows, 48)}
    </article>
  `;
}

function renderDataQuality() {
  const rows = sourceCatalog.map((source) => ({
    name: source.label,
    status: rawData.sources?.[source.id] ? '已读取' : '暂时没有',
    note: rawData.sources?.[source.id] ? '可以用于页面分析' : '缺少时相关判断只作参考',
  }));
  const fieldRows = importantFields.map((field) => ({
    name: field.label,
    count: fieldCount(field.id),
    note: fieldCount(field.id) ? '已读取' : '暂时没有',
  }));
  return `
    ${pageTitle('数据准备情况', '不用看字段名，只看哪些业务数据已经到位，哪些还会影响建议可信度。')}
    <section class="kpi-grid">
      ${kpi('整体准备度', `${dataReadyPercent()}%`, `${sourceCount()}/${sourceCatalog.length} 类数据已读取`)}
      ${kpi('交易日数量', String(allDates().length), '可切换查看')}
      ${kpi('当前点位', String(rowsForDate().length), '当前交易日记录')}
      ${kpi('缺项提醒', String(rawData.quality?.gaps?.length || 0), '需要补数据或人工确认')}
    </section>
    <section class="grid two">
      <article class="card">
        <h2>业务数据是否到位</h2>
        ${table(
          [
            { key: 'name', label: '数据' },
            { key: 'status', label: '状态' },
            { key: 'note', label: '影响' },
          ],
          rows
        )}
      </article>
      <article class="card">
        <h2>当前交易日点位</h2>
        ${table(
          [
            { key: 'name', label: '内容' },
            { key: 'count', label: '点位数' },
            { key: 'note', label: '状态' },
          ],
          fieldRows
        )}
      </article>
    </section>
  `;
}

function reasonText(value) {
  return (
    {
      actual_load_missing: '缺用户实际负荷，不能验证移峰影响',
      settlement_missing: '缺结算金额，不能核算真实节省',
      contract_missing: '合同资产缺失',
      contract_partial: '合同接口还有分页未抓取',
      trade_sequence_missing: '交易序列缺失',
      system_load_forecast_missing: '系统负荷预测缺失',
      realtime_points_low: '实时均价点数不足',
      forecast_history_insufficient: '预测历史不足',
      backtest_unavailable: '回测不可用',
      historical_dates_below_minimum: '历史交易日不足 5 天',
      historical_dates_below_5: '历史交易日不足 5 天',
      comparable_points_missing: '缺少同点位可比历史',
      target_date_rows_missing: '目标日没有特征行',
      target_date_missing: '目标日为空',
      insufficient_actuals: '缺实际负荷或结算，不能做节省金额回测',
    }[value] || value || '-'
  );
}

function targetLabel(value) {
  return (
    {
      realtime_average_price: '实时均价',
      actual_load_96: '用户实际负荷',
      settle_day: '日结算',
      dayahead_public_clearing: '日前公开出清',
      dayahead_user_clearing: '用户日前出清',
      user_default_bid_96: '缺省申报',
      short_system_load_forecast: '短期系统负荷预测',
      current_contract: '当前合同',
      history_contract: '历史合同',
      trade_sequence: '交易序列',
      historical_price_samples: '连续历史样本',
      actual_daily_96: '实际负荷导出',
      settlement_files: '结算文件导出',
      position_curve: '持仓曲线导出',
    }[value] || value || '-'
  );
}

function forecastTargetLabel(value) {
  return (
    {
      realTimeAvgPrice: '实时均价',
      priceSpread: '实时-日前价差',
      highPriceRiskLabel: '高价风险',
    }[value] || value || '-'
  );
}

function riskBadge(text, className = '') {
  return `<span class="risk-badge ${className}">${escapeHtml(text)}</span>`;
}

function renderConfidence(score = 0) {
  const width = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  return `
    <div class="confidence-meter">
      <div class="confidence-bar" style="width:${width}%"></div>
      <strong>${width}/100</strong>
    </div>
  `;
}

function renderBackfillQueue(plan = state.backfillPlan) {
  const targets = asArray(plan?.targets);
  return `
    <article class="card">
      <h2>补采队列</h2>
      <div class="target-queue">
        ${
          targets.length
            ? targets
                .map(
                  (target) => `
                    <div>
                      <b>${escapeHtml(targetLabel(target.id))}</b>
                      <span>${escapeHtml(target.reason || '')}</span>
                      ${riskBadge(`${Math.round((target.delayMs || 0) / 1000)} 秒间隔`, 'soft')}
                    </div>
                  `
                )
                .join('')
            : '<div class="empty">当前没有定向补采目标。</div>'
        }
      </div>
      <p class="muted-text">模式：${escapeHtml(statusText(plan?.mode || 'targeted'))}；预计 ${escapeHtml(String(plan?.estimatedSeconds || 0))} 秒。${
        plan?.rateLimited ? ' 已检测到频率风险，建议等待后再采。' : ''
      }</p>
    </article>
  `;
}

function renderDataAssets() {
  const inventory = state.dataAssets || {};
  const summary = inventory.summary || {};
  const evidence = inventory.evidence || {};
  const assetRows = [
    { name: '实时均价', rows: summary.realtimeAveragePriceRows || 0 },
    { name: '日前公开出清', rows: summary.dayAheadPublicClearingRows || 0 },
    { name: '用户日前出清', rows: summary.dayAheadUserClearingRows || 0 },
    { name: '实时公开出清', rows: summary.realtimePublicClearingRows || 0 },
    { name: '主动申报', rows: summary.userBidRows || 0 },
    { name: '缺省申报', rows: summary.userDefaultBidRows || 0 },
    { name: '系统负荷预测', rows: summary.systemLoadForecastRows || 0 },
    { name: '系统实际负荷', rows: summary.actualSystemLoadRows || 0 },
    { name: '交易序列', rows: summary.tradeSequenceRows || 0 },
  ];
  return `
    ${pageTitle('数据资产', '把本地 raw captures 里能用的数据、分页缺口和空接口证据放在一起看。')}
    ${state.dataAssetsError ? `<div class="notice warn">${escapeHtml(state.dataAssetsError)}</div>` : ''}
    <section class="kpi-grid">
      ${kpi('实时均价行数', String(summary.realtimeAveragePriceRows || 0), 'raw capture 标准化后')}
      ${kpi('日前公开行数', String(summary.dayAheadPublicClearingRows || 0), '出清价格基础')}
      ${kpi('当前合同', `${summary.contractCurrentCapturedRows || 0}/${summary.contractCurrentTotal || 0}`, 'captured / total')}
      ${kpi('历史合同', `${summary.contractHistoryCapturedRows || 0}/${summary.contractHistoryTotal || 0}`, 'captured / total')}
    </section>
    <section class="grid two">
      <article class="card">
        <h2>raw 数据类别</h2>
        ${table(
          [
            { key: 'name', label: '类别' },
            { key: 'rows', label: '行数' },
          ],
          assetRows
        )}
      </article>
      <article class="card">
        <h2>缺失证据</h2>
        ${simpleList([
          { title: '空实际负荷接口', note: `${summary.emptyActualLoadEndpoints || 0} 个 endpoint 返回空列表` },
          { title: '空结算接口', note: `${summary.emptySettlementEndpoints || 0} 个 endpoint 返回空列表` },
          { title: '合同分页缺口', note: `${asArray(evidence.partialSources).length} 个接口 total 大于已抓取行数` },
        ])}
      </article>
    </section>
    <section class="grid two">
      <article class="card">
        <h2>空接口样本</h2>
        ${simpleList(
          asArray(evidence.emptySources)
            .slice(0, 8)
            .map((item) => ({
              title: item.kind === 'settlement' ? '结算为空' : '实际负荷为空',
              note: item.endpoint || item.sourceFile || '',
            }))
        )}
      </article>
      <article class="card">
        <h2>分页缺口</h2>
        ${simpleList(
          asArray(evidence.partialSources)
            .slice(0, 8)
            .map((item) => ({
              title: targetLabel(item.targetId),
              note: `total ${item.total || 0}，已抓 ${item.capturedRows || 0}`,
            }))
        )}
      </article>
    </section>
  `;
}

function renderSettlementReference() {
  const reference = state.settlementReference || {};
  const summary = reference.summary || {};
  const workbooks = asArray(reference.workbooks);
  const manualExports = asArray(reference.manualExports);
  const workbookRows = workbooks.map((item) => ({
    fileName: item.fileName,
    kind:
      item.kind === 'spot_reconciliation'
        ? '现货核对单'
        : item.kind === 'monthly_settlement_overview'
          ? '月度结算概览'
          : item.kind === 'transaction_calculation'
            ? '交易计算表'
          : '参考文件',
    sheetCount: asArray(item.sheets).length,
    featureRowCount: item.featureRowCount || 0,
    numericRows: asArray(item.sheets).reduce((total, sheet) => total + Number(sheet.numericRows || 0), 0),
    referenceStrength:
      item.referenceStrength === 'historical_96_point_truth'
        ? '历史真值'
        : item.referenceStrength === 'transaction_calculation_reference'
          ? '交易测算'
          : item.referenceStrength === 'point_like_reference'
            ? '点位参考'
            : '背景参考',
  }));
  const sheetRows = workbooks.flatMap((workbook) =>
    asArray(workbook.sheets).map((sheet) => ({
      workbook: workbook.fileName,
      sheet: sheet.name,
      dimension: sheet.dimension,
      nonEmptyRows: sheet.nonEmptyRows,
      numericRows: sheet.numericRows,
    }))
  );
  const exportRows = manualExports.map((item) => ({
    category: targetLabel(item.category),
    exportDate: item.exportDate,
    fileCount: item.fileCount,
    status: item.status === 'files_available' ? '已有文件' : '空清单',
  }));

  return `
    ${pageTitle('结算参考', '登记本地 Excel 核对单和手工导出清单，作为复核证据和后续升级入口，不替代缺失的业务真值。')}
    ${state.settlementReferenceError ? `<div class="notice warn">${escapeHtml(state.settlementReferenceError)}</div>` : ''}
    <section class="kpi-grid">
      ${kpi('参考文件', String(summary.workbookCount || 0), '根目录 Excel')}
      ${kpi('历史标签点', String(summary.featureRowCount || 0), '可进入特征库')}
      ${kpi('实际负荷候选', String(summary.actualKwhCandidateRows || 0), '核对单 + 交易计算表')}
      ${kpi('结算金额候选', String(summary.settleAmountCandidateRows || 0), '核对单')}
      ${kpi('交易计算表 CSV', String(summary.transactionCalculationFeatureRowCount || 0), '用电/申报候选')}
      ${kpi('小时持仓参考', String(summary.transactionCalculationPositionHourlyRows || 0), '历史约束参考')}
      ${kpi('操作量参考', String(summary.transactionCalculationOperationHourlyRows || 0), '历史买卖测算')}
      ${kpi('可填业务真值', summary.canFillActualKwh || summary.canFillSettleAmount ? '部分可填' : '不可填', '历史 actualKwh / settleAmount')}
    </section>
    <section class="grid two">
      <article class="card">
        <h2>Excel 参考文件</h2>
        ${table(
          [
            { key: 'fileName', label: '文件' },
            { key: 'kind', label: '类型' },
            { key: 'sheetCount', label: 'sheet' },
            { key: 'featureRowCount', label: '标签点' },
            { key: 'numericRows', label: '数值行' },
            { key: 'referenceStrength', label: '用途' },
          ],
          workbookRows
        )}
      </article>
      <article class="card">
        <h2>使用边界</h2>
        ${simpleList(asArray(reference.usageBoundaries).map((item) => ({ title: '边界', note: item })))}
      </article>
    </section>
    <section class="grid two">
      <article class="card">
        <h2>sheet 覆盖</h2>
        ${table(
          [
            { key: 'workbook', label: '文件' },
            { key: 'sheet', label: 'sheet' },
            { key: 'dimension', label: '范围' },
            { key: 'nonEmptyRows', label: '非空行' },
            { key: 'numericRows', label: '数值行' },
          ],
          sheetRows.slice(0, 16)
        )}
      </article>
      <article class="card">
        <h2>手工导出清单</h2>
        ${table(
          [
            { key: 'category', label: '目标' },
            { key: 'exportDate', label: '日期' },
            { key: 'fileCount', label: '文件数' },
            { key: 'status', label: '状态' },
          ],
          exportRows
        )}
      </article>
    </section>
    <article class="card">
      <h2>升级钩子</h2>
      ${simpleList(asArray(reference.upgradeHooks).map((item) => ({ title: targetLabel(item.id), note: item.reason })))}
    </article>
  `;
}

function renderForecastLab() {
  const report = state.forecastLab || {};
  const readiness = report.readiness || {};
  const forecasts = asArray(report.forecasts);
  return `
    ${pageTitle('预测实验室', '只展示当前可验证的基线预测；历史不足时明确给出原因，不声称训练模型更好。')}
    ${state.forecastLabError ? `<div class="notice warn">${escapeHtml(state.forecastLabError)}</div>` : ''}
    <section class="kpi-grid">
      ${kpi('模型状态', statusText(report.status || 'unavailable'), '当前不训练深度学习')}
      ${kpi('历史天数', String(readiness.historicalDateCount || 0), '目标日前可用历史')}
      ${kpi('可比点位', String(readiness.comparablePointCount || 0), '同点位历史覆盖')}
      ${kpi('预测点数', String(forecasts.length), 'same-slot baseline 输出')}
    </section>
    <section class="grid two">
      <article class="card">
        <h2>模型清单</h2>
        ${table(
          [
            { key: 'label', label: '模型' },
            { label: '状态', render: (row) => (row.enabled ? '启用' : '未启用') },
          ],
          asArray(report.models)
        )}
      </article>
      <article class="card">
        <h2>缺失原因</h2>
        ${simpleList(asArray(readiness.missingReasons).map((item) => ({ title: reasonText(item), note: item })))}
      </article>
    </section>
    <article class="card">
      <h2>基线预测摘要</h2>
      ${table(
        [
          { label: '目标', render: (row) => forecastTargetLabel(row.target) },
          { key: 'pointIndex', label: '点位' },
          { label: '预测', render: (row) => fmt(row.pointForecast) },
          { label: 'p90', render: (row) => fmt(row.p90) },
          { key: 'evidenceRows', label: '证据行' },
        ],
        forecasts.slice(0, 18)
      )}
    </article>
  `;
}

function renderBacktestReport() {
  const report = state.backtestReport || {};
  const metrics = report.metrics || {};
  const metricRows = ['realTimeAvgPrice', 'priceSpread'].map((field) => ({
    field,
    label: forecastTargetLabel(field),
    ...(metrics[field] || {}),
  }));
  const strategy = report.strategyComparison || {};
  return `
    ${pageTitle('回测结果', 'walk-forward 按日期评估，只用评估日前的数据；没有实际负荷/结算时不伪造节省金额。')}
    ${state.backtestError ? `<div class="notice warn">${escapeHtml(state.backtestError)}</div>` : ''}
    <section class="kpi-grid">
      ${kpi('评估状态', statusText(report.status || 'unavailable'), 'walk-forward')}
      ${kpi('评估日期', String(asArray(report.evaluationDates).length), '满足历史门槛的日期')}
      ${kpi('实时价样本', String(metrics.realTimeAvgPrice?.sampleCount || 0), '价格误差样本')}
      ${kpi('策略回测', statusText(strategy.status || 'unavailable'), strategy.estimatedSavings === null ? '不声明节省金额' : '可对比 no_action')}
    </section>
    <section class="grid two">
      <article class="card">
        <h2>价格预测误差</h2>
        ${table(
          [
            { key: 'label', label: '目标' },
            { key: 'sampleCount', label: '样本' },
            { label: 'MAE', render: (row) => fmt(row.mae) },
            { label: 'RMSE', render: (row) => fmt(row.rmse) },
            { label: 'Bias', render: (row) => fmt(row.bias) },
          ],
          metricRows
        )}
      </article>
      <article class="card">
        <h2>为什么还不能声明节省金额</h2>
        ${simpleList(
          asArray(report.warnings).length
            ? asArray(report.warnings).map((item) => ({ title: reasonText(item), note: item }))
            : [{ title: '仍需人工复核', note: '策略收益需要和 no_action 基线、实际负荷、结算共同验证。' }]
        )}
      </article>
    </section>
  `;
}

function renderCostStrategy() {
  const strategy = state.costStrategy || {};
  const confidence = strategy.dataConfidence || {};
  const signals = strategy.signals || {};
  const lowWindows = asArray(signals.lowPriceWindows);
  const highWindows = asArray(signals.highPriceExposureWindows);
  const tiers = asArray(strategy.policyTiers);
  return `
    ${pageTitle('省钱策略', '把价格窗口、基线预测、回测状态和数据缺口合成三档人工决策建议。')}
    ${state.costStrategyError ? `<div class="notice warn">${escapeHtml(state.costStrategyError)}</div>` : ''}
    ${state.backfillError ? `<div class="notice warn">${escapeHtml(state.backfillError)}</div>` : ''}
    <section class="kpi-grid">
      ${kpi('模型模式', statusText(strategy.modelMode || 'heuristic_fallback'), '缺数据时只做规则兜底')}
      ${kpi('置信度', `${confidence.score ?? 0}/100`, '按缺口扣分')}
      ${kpi('低价窗口', String(lowWindows.length), '可观察补采或移峰机会')}
      ${kpi('高价暴露', String(highWindows.length), '需要人工复核偏差风险')}
    </section>
    <article class="card">
      <h2>置信度</h2>
      ${renderConfidence(confidence.score || 0)}
      <div class="tag-list">
        ${asArray(confidence.penalties)
          .map((item) => riskBadge(`-${item.points} ${reasonText(item.id)}`, 'warn'))
          .join('')}
      </div>
    </article>
    <section class="grid three">
      ${tiers
        .map(
          (tier) => `
            <article class="card policy-tier ${tier.enabled ? '' : 'disabled'}">
              <h2>${escapeHtml(tier.title || statusText(tier.id))}</h2>
              <div class="tag-list">
                ${riskBadge(tier.enabled ? '可展示' : '未启用', tier.enabled ? 'good' : 'warn')}
                ${riskBadge(tier.executable ? '可执行' : '不可执行', tier.executable ? 'good' : 'warn')}
              </div>
              <p>${escapeHtml(tier.action || '')}</p>
              <small>${escapeHtml(compactText(tier.blockers, '无阻断项'))}</small>
            </article>
          `
        )
        .join('')}
    </section>
    <section class="grid two">
      <article class="card">
        <h2>低价窗口</h2>
        ${table(
          [
            { key: 'pointIndex', label: '点位' },
            { key: 'timePoint', label: '时间' },
            { label: '实时价', render: (row) => fmt(row.realTimeAvgPrice) },
            { label: '价差', render: (row) => fmt(row.priceSpread) },
            { key: 'reason', label: '原因' },
          ],
          lowWindows
        )}
      </article>
      <article class="card">
        <h2>高价暴露</h2>
        ${table(
          [
            { key: 'pointIndex', label: '点位' },
            { key: 'timePoint', label: '时间' },
            { label: '实时价', render: (row) => fmt(row.realTimeAvgPrice) },
            { label: '价差', render: (row) => fmt(row.priceSpread) },
            { key: 'reason', label: '原因' },
          ],
          highWindows
        )}
      </article>
    </section>
    <section class="grid two">
      <article class="card">
        <h2>下一批关键数据</h2>
        ${simpleList(asArray(strategy.nextBestData).map((item) => ({ title: targetLabel(item.id), note: item.reason || item.id })))}
      </article>
      ${renderBackfillQueue()}
    </section>
  `;
}

function renderUkeyAssistant() {
  const status = state.ukeyAssistant || {};
  const browser = status.browserWindow || {};
  const collector = status.collector || {};
  const sweep = status.sweep || {};
  const snapshot = status.lastSnapshot || status.visibleSnapshot || {};
  const realtime = status.realtimeData || {};
  const lastError = sweep.lastError || collector.lastError || browser.lastError || state.ukeyError || '';
  return `
    ${pageTitle(
      '实时数据助手',
      '插上 UKey 后，在本机打开交易平台页面；系统只读取页面上已经显示的业务表格。',
      '<button class="primary-button" id="ukeyRefreshButton">刷新状态</button>'
    )}
    <section class="kpi-grid">
      ${kpi('数据窗口', statusText(browser.state || browser.status || 'not_started'), '点击按钮后会打开专用浏览器')}
      ${kpi('自动采集', statusText(collector.state || 'stopped'), collector.intervalSeconds ? `约 ${collector.intervalSeconds} 秒一次` : '默认约 30 秒一次')}
      ${kpi('核心巡扫', statusText(sweep.state || 'idle'), sweep.lastRunAt ? `${sweep.lastAcceptedPageCount || 0}/${sweep.lastPageCount || 0} 页，${sweep.lastRowCount || 0} 行` : '默认 4 个核心页面')}
      ${kpi('最近采集', snapshot.generatedAt ? timeText(snapshot.generatedAt) : '-', snapshot.rowCount ? `${snapshot.rowCount} 行` : '还没有采集到表格')}
      ${kpi('实时价格', realtime.pointCount ? `${realtime.pointCount} 点` : '等待页面', statusText(realtime.status))}
    </section>
    ${lastError ? `<div class="notice warn">${escapeHtml(lastError)}</div>` : ''}
    <section class="grid two">
      <article class="card">
        <h2>一键操作</h2>
        <div class="action-row">
          <button class="primary-button" id="ukeyStartBrowserButton">打开数据窗口</button>
          <button class="primary-button" id="ukeySweepButton">自动扫核心页</button>
          <button class="ghost-button" id="ukeySampleButton">采集一次</button>
          <button class="ghost-button" id="ukeyStartCollectorButton">开始自动采集</button>
          <button class="ghost-button" id="ukeyStopCollectorButton">停止自动采集</button>
        </div>
        ${simpleList([
          { title: '第一步', note: '插上 UKey，点击“打开数据窗口”。' },
          { title: '第二步', note: '在打开的浏览器里完成登录，停在任意 JSPEC 页面即可。' },
          { title: '第三步', note: '点击“自动扫核心页”，系统会先扫首页、实时均价、实际负荷、日结算。' },
        ])}
      </article>
      <article class="card">
        <h2>当前页面识别</h2>
        ${table(
          [
            { key: 'item', label: '项目' },
            { key: 'value', label: '状态' },
          ],
          [
            { item: '页面', value: browser.currentUrl || '还没打开实时页面' },
            { item: '登录', value: browser.currentUrl ? '以页面实际显示为准' : '等待打开数据窗口' },
            { item: '采集结果', value: snapshot.accepted ? `已读取 ${snapshot.rowCount || 0} 行` : '还没有读到可用表格' },
            { item: '巡扫结果', value: sweep.lastRunAt ? `已扫 ${sweep.lastPageCount || 0} 页，命中 ${sweep.lastAcceptedPageCount || 0} 页` : '4 个核心页面待扫' },
          ]
        )}
      </article>
    </section>
    <article class="card">
      <h2>使用边界</h2>
      ${simpleList([
        { title: '只读屏幕上看得到的数据', note: '比如时间点、价格、申报量、负荷等业务表格。' },
        { title: '不会替你点提交', note: 'AI 只给建议和草稿，最终操作仍由用户确认。' },
        { title: '登录留在本机', note: 'UKey 和浏览器登录状态只保存在使用者电脑上。' },
      ])}
    </article>
  `;
}

function renderStrategyAdvicePanel() {
  if (state.strategyError) return emptyCard('AI建议暂时没出来', state.strategyError);
  const advice = state.strategyAdvice || {};
  const signal = advice.priceSignal || {};
  const realtime = advice.realtimePrice || {};
  const modelPrediction = state.strategyModelPrediction;
  const suggestions = state.strategySuggestions || [];
  const modelText = modelPrediction?.content || modelPrediction?.text || '';
  return `
    <section class="kpi-grid">
      ${kpi('实时价格', realtime.pointCount ? `${realtime.pointCount} 点` : '未读取', statusText(realtime.status))}
      ${kpi('平均实时价', fmt(signal.averageRealTimePrice), '元/MWh')}
      ${kpi('低价观察点', Array.isArray(signal.lowWindowPoints) ? String(signal.lowWindowPoints.length) : '0', '可用于观察补足机会')}
      ${kpi('高价观察点', Array.isArray(signal.highWindowPoints) ? String(signal.highWindowPoints.length) : '0', '需要留意偏差风险')}
    </section>
    ${modelText ? `<article class="card ai-card"><h2>模型预测</h2><p>${escapeHtml(modelText)}</p></article>` : ''}
    <section class="grid two">
      <article class="card">
        <h2>系统建议</h2>
        ${simpleList(
          suggestions.map((item) => ({
            title: `${severityLabel(item.severity)}：${item.title}`,
            note: `${item.description || ''}${item.action ? ` 建议方向：${item.action}。` : ''}`,
          }))
        )}
      </article>
      <article class="card">
        <h2>为什么还不能直接照做</h2>
        ${simpleList(
          suggestions
            .flatMap((item) => item.blockingReasons || [])
            .map((reason) => ({ title: '需要人工确认', note: reason }))
        )}
      </article>
    </section>
  `;
}

function renderStrategy() {
  return `
    ${pageTitle(
      'AI策略建议',
      '这里把实时价格转换成“观察窗口”和“风险提醒”。它不是下单器，只帮你少漏看。'
    )}
    ${renderStrategyAdvicePanel()}
    ${renderStrategyReportPanel()}
  `;
}

function renderProduction() {
  const readiness = state.productionReadiness || {};
  const controls = Array.isArray(readiness.controls) ? readiness.controls : [];
  const proposal = state.executionProposal;
  const tradeLimits = state.businessInputs?.inputs?.tradeLimits || {};
  return `
    ${pageTitle(
      '交易草稿复核',
      '把 AI 建议整理成草稿，给人复核用；这里不会自动提交交易。',
      '<button class="primary-button" id="proposalButton">生成草稿</button>'
    )}
    ${state.executionError ? `<div class="notice warn">${escapeHtml(state.executionError)}</div>` : ''}
    <section class="kpi-grid">
      ${kpi('当前状态', statusText(readiness.status), readiness.capabilities?.proposalDraft ? '可以生成草稿' : '数据不足时只能查看')}
      ${kpi('最大单次电量', tradeLimits.maxSingleTradeMwh ? `${fmt(tradeLimits.maxSingleTradeMwh)} MWh` : '-', '来自本地交易限制')}
      ${kpi('最小申报电量', tradeLimits.minDeclarationMwh ? `${fmt(tradeLimits.minDeclarationMwh)} MWh` : '-', '来自本地交易限制')}
      ${kpi('人工确认', '必须', '最终申报由用户在交易平台确认')}
    </section>
    <section class="grid two">
      <article class="card">
        <h2>生成前检查</h2>
        ${table(
          [
            { key: 'title', label: '检查项' },
            { label: '状态', render: (row) => statusText(row.status) },
            { key: 'description', label: '说明' },
          ],
          controls.slice(0, 8)
        )}
      </article>
      <article class="card">
        <h2>草稿</h2>
        ${
          proposal
            ? simpleList([
                { title: '草稿状态', note: statusText(proposal.status || 'trial_only') },
                { title: '交易日', note: proposal.date || state.date || '-' },
                { title: '说明', note: proposal.summary || proposal.note || '已生成，仍需人工核对。' },
              ])
            : '<div class="empty">还没有草稿。点击“生成草稿”后，先看清楚内容再决定是否采纳。</div>'
        }
        ${
          proposal
            ? `<div class="action-row">
                <button class="ghost-button data-review-decision" data-decision="approve">记录为已看过</button>
                <button class="ghost-button data-review-decision" data-decision="reject">记录为不采纳</button>
              </div>`
            : ''
        }
      </article>
    </section>
  `;
}

const renderers = {
  report: renderReport,
  revenue: renderRevenue,
  operator: renderOperator,
  settlement: renderSettlement,
  review: renderReview,
  publicData: renderPublicData,
  privateData: renderPrivateData,
  dataQuality: renderDataQuality,
  dataAssets: renderDataAssets,
  settlementReference: renderSettlementReference,
  ukey: renderUkeyAssistant,
  forecastLab: renderForecastLab,
  backtestReport: renderBacktestReport,
  costStrategy: renderCostStrategy,
  strategy: renderStrategy,
  production: renderProduction,
};

function renderNav() {
  const nav = document.querySelector('#sideNav');
  if (!nav) return;
  const groups = [...new Set(modules.map((item) => item.group))];
  nav.innerHTML = groups
    .map(
      (group) => `
        <div class="nav-group-title">${escapeHtml(group)}</div>
        ${modules
          .filter((item) => item.group === group)
          .map(
            (item) => `
              <button class="nav-item ${item.id === state.moduleId ? 'active' : ''}" data-module="${item.id}">
                <span class="nav-icon">${escapeHtml(item.icon)}</span>
                ${escapeHtml(item.label)}
              </button>
            `
          )
          .join('')}
      `
    )
    .join('');
}

function renderDates() {
  const select = document.querySelector('#dateSelect');
  if (!select) return;
  const dates = allDates();
  if (!state.date && dates.length) state.date = dates[0];
  select.innerHTML = dates.map((date) => `<option value="${escapeHtml(date)}" ${date === state.date ? 'selected' : ''}>${escapeHtml(date)}</option>`).join('');
}

function render() {
  renderNav();
  renderDates();
  const module = selectedModule();
  const crumb = document.querySelector('#moduleCrumb');
  if (crumb) crumb.textContent = module.label;
  const workspace = document.querySelector('#workspace');
  if (!workspace) return;
  workspace.innerHTML = renderers[state.moduleId]?.() || renderReport();
  bindDynamicActions();
}

function bindDynamicActions() {
  document.querySelector('#proposalButton')?.addEventListener('click', createExecutionProposal);
  document.querySelectorAll('.data-review-decision').forEach((button) => {
    button.addEventListener('click', () => recordProposalReview(button.dataset.decision));
  });
  wireUkeyActionButton('ukeyStartBrowserButton', '/api/ukey-assistant/browser/start', { label: '打开中...' });
  wireUkeyActionButton('ukeySweepButton', '/api/ukey-assistant/sweep/run', { label: '巡扫中...', body: { mode: 'core' } });
  wireUkeyActionButton('ukeySampleButton', '/api/ukey-assistant/collector/sample', { label: '采集中...' });
  wireUkeyActionButton('ukeyStartCollectorButton', '/api/ukey-assistant/collector/start', { label: '启动中...' });
  wireUkeyActionButton('ukeyStopCollectorButton', '/api/ukey-assistant/collector/stop', { label: '停止中...' });
  document.querySelector('#ukeyRefreshButton')?.addEventListener('click', async () => {
    await loadUkeyAssistant();
    render();
  });
}

function wireUkeyActionButton(id, endpoint, options = {}) {
  const button = document.querySelector(`#${id}`);
  if (!button) return;
  button.addEventListener('click', async () => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = options.label || '处理中...';
    await postUkeyAssistantAction(endpoint, options);
    button.disabled = false;
    button.textContent = original;
  });
}

async function loadProductionState() {
  try {
    const [readinessResponse, auditResponse, businessInputsResponse] = await Promise.all([
      fetch('/api/production/readiness', { cache: 'no-store' }),
      fetch('/api/audit?limit=20', { cache: 'no-store' }),
      fetch('/api/business-inputs', { cache: 'no-store' }),
    ]);
    state.productionReadiness = await readinessResponse.json();
    const auditPayload = await auditResponse.json();
    state.auditEvents = Array.isArray(auditPayload.events) ? auditPayload.events : [];
    state.businessInputs = await businessInputsResponse.json();
    state.productionError = '';
  } catch (error) {
    state.productionError = `交易草稿信息没有读到：${error.message}`;
  }
}

async function loadUkeyAssistant() {
  try {
    const response = await fetch('/api/ukey-assistant', { cache: 'no-store' });
    state.ukeyAssistant = await response.json();
    state.ukeyError = '';
  } catch (error) {
    state.ukeyError = `实时数据助手状态没有读到：${error.message}`;
  }
}

async function loadStrategySuggestions() {
  try {
    const response = await fetch(`/api/strategy?date=${encodeURIComponent(state.date)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
    const payload = await response.json();
    state.strategyAdvice = payload;
    state.strategySuggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
    state.strategyModelPrediction = payload.modelPrediction || null;
    state.strategyGeneratedAt = payload.generatedAt || '';
    state.strategyError = '';
  } catch (error) {
    state.strategyAdvice = null;
    state.strategySuggestions = [];
    state.strategyModelPrediction = null;
    state.strategyError = `AI建议暂时没有生成：${error.message}`;
  }
}

async function loadDataAssets() {
  try {
    const response = await fetch('/api/data-assets', { cache: 'no-store' });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
    state.dataAssets = await response.json();
    state.dataAssetsError = '';
  } catch (error) {
    state.dataAssets = null;
    state.dataAssetsError = `数据资产没有读到：${error.message}`;
  }
}

async function loadSettlementReference() {
  try {
    const response = await fetch('/api/settlement/reference', { cache: 'no-store' });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
    state.settlementReference = await response.json();
    state.settlementReferenceError = '';
  } catch (error) {
    state.settlementReference = null;
    state.settlementReferenceError = `结算参考没有读到：${error.message}`;
  }
}

async function loadForecastLab() {
  try {
    const response = await fetch(`/api/forecast/model?date=${encodeURIComponent(state.date)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
    state.forecastLab = await response.json();
    state.forecastLabError = '';
  } catch (error) {
    state.forecastLab = null;
    state.forecastLabError = `预测实验室没有读到：${error.message}`;
  }
}

async function loadBacktestReport() {
  try {
    const response = await fetch('/api/backtest', { cache: 'no-store' });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
    state.backtestReport = await response.json();
    state.backtestError = '';
  } catch (error) {
    state.backtestReport = null;
    state.backtestError = `回测结果没有读到：${error.message}`;
  }
}

async function loadCostStrategy() {
  try {
    const response = await fetch(`/api/cost-strategy?date=${encodeURIComponent(state.date)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
    state.costStrategy = await response.json();
    state.costStrategyError = '';
  } catch (error) {
    state.costStrategy = null;
    state.costStrategyError = `省钱策略没有读到：${error.message}`;
  }
}

async function loadBackfillPlan() {
  try {
    const response = await fetch(`/api/backfill/plan?date=${encodeURIComponent(state.date)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
    state.backfillPlan = await response.json();
    state.backfillError = '';
  } catch (error) {
    state.backfillPlan = null;
    state.backfillError = `补采队列没有读到：${error.message}`;
  }
}

async function loadCostStrategyContext() {
  await Promise.all([
    loadDataAssets(),
    loadSettlementReference(),
    loadForecastLab(),
    loadBacktestReport(),
    loadCostStrategy(),
    loadBackfillPlan(),
  ]);
}

async function loadSystemData() {
  try {
    const [datasetResponse, integrationsResponse] = await Promise.all([
      fetch('/api/dataset', { cache: 'no-store' }),
      fetch('/api/integrations', { cache: 'no-store' }),
    ]);
    if (!datasetResponse.ok) throw new Error(`服务返回 ${datasetResponse.status}`);
    rawData = normalizeDataset(await datasetResponse.json());
    state.integrationClosure = await integrationsResponse.json();
    state.loadError = '';
    if (!state.date) state.date = allDates()[0] || '';
  } catch (error) {
    state.loadError = `数据没读到，请重新启动软件或检查文件是否完整：${error.message}`;
    state.integrationClosure = null;
  }
  await Promise.all([loadProductionState(), loadUkeyAssistant(), loadStrategySuggestions(), loadCostStrategyContext()]);
  render();
}

async function refreshData() {
  const button = document.querySelector('#refreshButton');
  if (button) {
    button.disabled = true;
    button.textContent = '刷新中...';
  }
  try {
    const response = await fetch('/api/refresh', { method: 'POST', cache: 'no-store' });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
  } catch (error) {
    state.loadError = `刷新失败：${error.message}`;
  }
  await loadSystemData();
  if (button) {
    button.disabled = false;
    button.textContent = '刷新数据';
  }
}

async function loadStrategyReport() {
  const button = document.querySelector('#reportButton');
  if (button) {
    button.disabled = true;
    button.textContent = '生成中...';
  }
  try {
    const response = await fetch(`/api/strategy-report?date=${encodeURIComponent(state.date)}`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`服务返回 ${response.status}`);
    state.strategyReport = await response.json();
    state.strategyReportError = '';
    state.moduleId = 'strategy';
  } catch (error) {
    state.strategyReportError = `报告没有生成：${error.message}`;
  }
  if (button) {
    button.disabled = false;
    button.textContent = '生成建议报告';
  }
  render();
}

async function postUkeyAssistantAction(endpoint, options = {}) {
  try {
    const request = { method: 'POST', cache: 'no-store' };
    if (options.body) {
      request.headers = { 'content-type': 'application/json' };
      request.body = JSON.stringify(options.body);
    }
    const response = await fetch(endpoint, request);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `服务返回 ${response.status}`);
    state.ukeyAssistant = payload.status || payload;
    state.ukeyError = '';
  } catch (error) {
    state.ukeyError = `操作失败：${error.message}`;
  }
  await loadUkeyAssistant();
  await loadStrategySuggestions();
  await loadCostStrategyContext();
  render();
}

async function createExecutionProposal() {
  const button = document.querySelector('#proposalButton');
  if (button) {
    button.disabled = true;
    button.textContent = '生成中...';
  }
  try {
    const response = await fetch(`/api/execution/proposal?date=${encodeURIComponent(state.date)}`, {
      method: 'POST',
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `服务返回 ${response.status}`);
    state.executionProposal = payload;
    state.executionError = '';
  } catch (error) {
    state.executionError = `草稿没有生成：${error.message}`;
  }
  if (button) {
    button.disabled = false;
    button.textContent = '生成草稿';
  }
  render();
}

async function recordProposalReview(decision) {
  try {
    const params = new URLSearchParams({ date: state.date, decision: decision || 'reviewed' });
    const response = await fetch(`/api/execution/review?${params.toString()}`, {
      method: 'POST',
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `服务返回 ${response.status}`);
    state.executionProposal = payload.proposal || state.executionProposal;
    state.executionError = decision === 'approve' ? '已记录：人工已看过。' : '已记录：本次不采纳。';
  } catch (error) {
    state.executionError = `复核记录没有保存：${error.message}`;
  }
  render();
}

document.querySelector('#sideNav')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-module]');
  if (!button) return;
  state.moduleId = button.dataset.module;
  render();
});

document.querySelector('#dateSelect')?.addEventListener('change', async (event) => {
  state.date = event.target.value;
  await Promise.all([loadStrategySuggestions(), loadCostStrategyContext()]);
  render();
});

document.querySelector('#refreshButton')?.addEventListener('click', refreshData);
document.querySelector('#reportButton')?.addEventListener('click', loadStrategyReport);

loadSystemData();
