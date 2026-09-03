import { buildPriceForecastModel } from '../view-models/price-forecast-model.js';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function renderRun(role, run) {
  if (!run) {
    const missing = role === 'actual' ? '尚无可用实际结果' : '尚无可用预测运行';
    return `<article><h3>${role}</h3><p>— · ${missing}</p></article>`;
  }
  const name = [run.modelId, run.modelVersion].filter(Boolean).join(' · ') || '版本与数据可追溯';
  const points = Array.isArray(run.rows)
    ? run.rows.length
    : Array.isArray(run.points)
      ? run.points.length
      : null;
  const date = run.targetTradingDate || run.targetDate || '';
  return `<article><h3>${role}</h3><p>${esc(name)}</p><small>${[
    date,
    points === null ? '' : `${points} 点`,
  ].filter(Boolean).map(esc).join(' · ')}</small></article>`;
}

export function renderPriceForecastView(state = {}) {
  const report = state.forecastReport || {};
  const reportRuns = report.forecastRuns || report.runs || [];
  const issuedRuns = Array.isArray(state.forecastRuns)
    ? state.forecastRuns
    : state.forecastRuns?.runs || [];
  const model = buildPriceForecastModel({
    ...report,
    forecastRuns: reportRuns.length ? reportRuns : issuedRuns,
    outcomes: report.outcomes || report.actuals || [],
    targetDate: report.targetDate || state.targetDate,
  });
  return `<section class="cockpit-view" data-view="price-forecast"><header><h2>价格预测</h2><span class="mode-identity">${
    state.mode === 'demo' ? '演示环境 · 模拟输入' : '真实环境 · 时点数据'
  }</span></header><p>${model.labels.join(' · ')}</p><div class="role-grid">${model.series
    .map((series) => renderRun(series.role, series.run))
    .join('')}</div><p>P10 / P50 / P90 · 区间宽度 · 校准状态 · 尖峰概率 · 模型版本 · 特征快照 ID</p>${model.warnings
    .map((warning) => `<p class="warning">${esc(warning)}</p>`)
    .join('')}</section>`;
}
