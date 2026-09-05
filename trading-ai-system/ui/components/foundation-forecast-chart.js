import { renderSvgTimeseries } from './svg-timeseries.js';
import {plainText,unitLabel} from '../presentation-language.js';

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
    label: plainText(item.label, '预测结果'),
    points: (item.points || []).filter((point) => point.value != null && Number.isFinite(Number(point.value))),
  })).filter(item => item.points.length || item.lowerPoints?.length);

export function renderFoundationForecastChart(tab = {}) {
  const series = usableSeries(tab.series || []);
  const pointCount = series.reduce((count, item) => count + item.points.length, 0);
  if (!pointCount) {
    return `
      <figure class="foundation-chart foundation-chart-empty" role="group" aria-labelledby="foundationChartTitle">
        <figcaption id="foundationChartTitle">
          <strong>${esc(tab.label || '预测')}曲线</strong>
          <span>单位：${esc(unitLabel(tab.unit))}</span>
        </figcaption>
        <div class="foundation-empty-plot" role="status">
          <strong>所选日期还没有这项预测</strong>
          <p>可先查看已有历史复盘，或换一个有记录的日期。</p>
        </div>
        <p class="foundation-chart-note">空白表示缺失，不会用零值或历史曲线冒充当前预测。</p>
      </figure>
    `;
  }

  return `<div class="foundation-chart">${renderSvgTimeseries({
    title: `${tab.label}曲线`,
    unit: tab.unit,
    series,
  })}<p class="foundation-chart-note">${esc(tab.id === 'load' ? plainText(tab.description,'比较同一日期的预测与实际用电，查看每 15 分钟的偏差。') : '实线区分实际值与本次预测，虚线表示上一版预测；实际结果仅用于发布后的回溯。')}</p></div>`;
}

export function renderAccuracyHistory(history = [], unit = '') {
  const rows = Array.isArray(history) ? history : [];
  const points = rows
    .map((row, index) => ({
      pointIndex:
        rows.length === 1 ? 48 : 1 + (index / Math.max(1, rows.length - 1)) * 95,
      displayLabel: row.date || index + 1,
      value: row.mae ?? row.value,
    }))
    .filter((row) => Number.isFinite(Number(row.value)));
  if (!points.length) {
    return `<div class="foundation-accuracy-empty" role="status"><strong>尚无可回溯的准确度序列</strong><p>预测发布后，需要等待实际结果入库并完成同点位配对。</p></div>`;
  }
  return renderSvgTimeseries({
    title: '历史平均误差变化',
    unit,
    series: [{ label: '平均误差', points }],
    detailsLabel: '查看历史误差明细',
    indexLabel: '交易日',
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
      { label: '当前策略', role: 'formal', points: current },
      { label: '微调后策略（模拟）', role: 'simulation', points: simulated },
    ],
  });
}
