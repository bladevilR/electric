import { renderSvgTimeseries } from './svg-timeseries.js';

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]
  );

const usableSeries = (series = []) =>
  series.map((item) => ({
    ...item,
    points: (item.points || []).filter((point) => Number.isFinite(Number(point.value))),
  }));

export function renderFoundationForecastChart(tab = {}) {
  const series = usableSeries(tab.series || []);
  const pointCount = series.reduce((count, item) => count + item.points.length, 0);
  if (!pointCount) {
    return `
      <figure class="foundation-chart foundation-chart-empty" role="group" aria-labelledby="foundationChartTitle">
        <figcaption id="foundationChartTitle">
          <strong>${esc(tab.label || '预测')}曲线</strong>
          <span>单位：${esc(tab.unit || '—')}</span>
        </figcaption>
        <div class="foundation-empty-plot" role="status">
          <strong>当前页签尚无可用预测曲线</strong>
          <p>需要同一目标日、同一口径的实际值和预测版本后才能比较。</p>
        </div>
        <p class="foundation-chart-note">空白表示缺失，不会用零值或历史曲线冒充当前预测。</p>
      </figure>
    `;
  }

  return `<div class="foundation-chart">${renderSvgTimeseries({
    title: `${tab.label}曲线`,
    unit: tab.unit,
    series,
  })}<p class="foundation-chart-note">虚线分界表示预测发布时间；分界后的实际结果仅用于后续回溯。</p></div>`;
}

export function renderAccuracyHistory(history = [], unit = '') {
  const points = (Array.isArray(history) ? history : [])
    .map((row, index) => ({ pointIndex: index + 1, value: row.mae ?? row.value }))
    .filter((row) => Number.isFinite(Number(row.value)));
  if (!points.length) {
    return `<div class="foundation-accuracy-empty" role="status"><strong>尚无可回溯的准确度序列</strong><p>预测发布后，需要等待实际结果入库并完成同点位配对。</p></div>`;
  }
  return renderSvgTimeseries({
    title: '近 30 个交易日滚动 MAE',
    unit,
    series: [{ label: '滚动 MAE', points }],
  });
}

export function renderSandboxChart(formalRows = [], simulatedRows = []) {
  const current = formalRows
    .map((row, index) => ({
      pointIndex: Number(row.pointIndex || index + 1),
      value: Number(
        row.recommendedPowerMw ?? row.recommendedMw ?? row.powerMw ?? row.value
      ),
    }))
    .filter((row) => Number.isFinite(row.value));
  const simulated = simulatedRows
    .map((row) => ({ pointIndex: row.pointIndex, value: row.adjustedMw }))
    .filter((row) => Number.isFinite(Number(row.value)));
  if (!current.length) {
    return `<div class="foundation-sandbox-empty" role="status"><strong>暂无可微调的正式推荐曲线</strong><p>补齐今日价格、负荷、持仓和交易限额后，才会显示模拟对比。</p></div>`;
  }
  return renderSvgTimeseries({
    title: '当前策略与微调后策略',
    unit: 'MW',
    series: [
      { label: '当前策略', points: current },
      { label: '微调后策略（模拟）', points: simulated },
    ],
  });
}
