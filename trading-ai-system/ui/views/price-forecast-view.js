import {buildStrategyFoundationModel} from '../view-models/strategy-foundation-model.js';
import {renderFoundationForecastChart} from '../components/foundation-forecast-chart.js';
import {escapeText as esc,methodLabel,dateTime} from '../presentation-language.js';

export function renderPriceForecastView(state={}) {
  const input = {...state, ...state.foundationInput, targetDate: state.targetDate, mode: state.mode};
  const m = buildStrategyFoundationModel(input);
  const tab = m.forecastTabs.find(t => t.id === 'price');

  return `<section class="cockpit-view foundation-workbench" data-view="price-forecast">
    <header>
      <h2>价格预测</h2>
      <span class="mode-identity">${state.mode === 'demo' ? '演示数据' : '真实数据'}</span>
    </header>
    <p class="cockpit-view-lead">查看日期：<strong>${esc(state.targetDate || '待选择')}</strong>。每 15 分钟预测一次电价；实际结果公布后才可以比较误差。</p>
    ${renderFoundationForecastChart(tab)}
    <details class="foundation-disclosure-card">
      <summary>这条预测怎么来的</summary>
      <p>方法：${esc(methodLabel(m.accuracy.modelVersion))}</p>
      <p>使用数据截至：${dateTime(m.identity.dataCutoff)}</p>
      <p>“价格可能范围”表示不同情形下的估计范围，不是价格保证。没有同日实际结果时，不会显示虚假的准确度。</p>
    </details>
    <div class="cockpit-view-actions">
      <button type="button" class="foundation-secondary-button" data-cockpit-view="data-sources">查看预测依据与历史数据</button>
    </div>
  </section>`;
}
