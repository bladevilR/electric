import {buildMarketCockpitModel} from '../view-models/market-cockpit-model.js';
import {renderSvgTimeseries} from '../components/svg-timeseries.js';
import {escapeText as esc,plainText,fieldLabel,reasonLabel,unitLabel,dateTime} from '../presentation-language.js';

const emptyMarketIllustration = `<svg class="cockpit-empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="10" width="52" height="44" rx="6"/><path d="M6 22h52"/><path d="M16 38l8-8 8 6 16-14"/><circle cx="48" cy="22" r="2" fill="currentColor"/><circle cx="16" cy="38" r="1.5" fill="currentColor"/></svg>`;

export function renderMarketCockpitView(state={}) {
  const m = buildMarketCockpitModel(state.marketCockpit);
  const cards = m.cards.filter(c => c.envelope.value != null);
  const emptyMarkup = `
    <div class="cockpit-empty-state">
      ${emptyMarketIllustration}
      <p class="empty-state-lead">所选日期尚未形成完整市场概览。已有用电复盘可在“数据与预测”查看。</p>
      <p class="cockpit-empty-desc">系统遵循客观审计原则，未从交易平台同步完整出清与负荷实况前，拒绝填充虚构数据或零值替代。</p>
      <button type="button" class="foundation-secondary-button" data-cockpit-view="data-sources">前往「数据与预测」查看已有记录</button>
    </div>
  `;

  return `<section class="cockpit-view" data-view="market-cockpit">
    <header>
      <h2>市场概览</h2>
      <span class="mode-identity">${state.mode === 'demo' ? '演示数据' : '真实数据'}</span>
    </header>
    <p class="cockpit-view-lead">查看日期：<strong>${esc(state.targetDate || '待选择')}</strong>。这里只展示已有市场数据，不把未知情况当成零。</p>
    <div class="cockpit-cards">${cards.length ? cards.map(c => `
      <article class="cockpit-metric-tile">
        <strong>${esc(plainText(c.label))}</strong>
        <span class="metric-value">${typeof c.envelope.value === 'number' ? esc(c.envelope.value) : esc(plainText(c.envelope.value, '数据待核对'))} <small class="metric-unit">${esc(unitLabel(c.envelope.unit))}</small></span>
      </article>
    `).join('') : emptyMarkup}</div>
    ${m.charts.filter(c => c.series.some(s => s.points?.length)).map(renderSvgTimeseries).join('')}
    ${m.events.length ? `<section class="cockpit-events-card"><h3>需要留意的事件</h3>${m.events.map(e => `<p>${esc(plainText(e.title, '市场事件待核实'))} · ${dateTime(e.startAt || e.eventTime)}</p>`).join('')}</section>` : ''}
    ${m.gaps.length ? `<details class="foundation-disclosure-card"><summary>还需要哪些数据</summary>${m.gaps.map(g => `<p>${esc(fieldLabel(g.fieldId))}：${esc(reasonLabel(g.reason, '来源尚待确认。'))}</p>`).join('')}</details>` : ''}
  </section>`;
}
