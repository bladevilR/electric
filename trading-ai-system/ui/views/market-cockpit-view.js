import {buildMarketCockpitModel} from '../view-models/market-cockpit-model.js';
import {renderSvgTimeseries} from '../components/svg-timeseries.js';
import {escapeText as esc,plainText,fieldLabel,reasonLabel,unitLabel,dateTime} from '../presentation-language.js';
export function renderMarketCockpitView(state={}) {
  const m=buildMarketCockpitModel(state.marketCockpit),cards=m.cards.filter(c=>c.envelope.value!=null);
  return `<section class="cockpit-view" data-view="market-cockpit"><header><h2>市场概览</h2><span class="mode-identity">${state.mode==='demo'?'演示数据':'真实数据'}</span></header><p>查看日期：${esc(state.targetDate||'待选择')}。这里只展示已有市场数据，不把未知情况当成零。</p>
    <div class="cockpit-cards">${cards.map(c=>`<article><strong>${esc(plainText(c.label))}</strong><span>${typeof c.envelope.value==='number'?esc(c.envelope.value):esc(plainText(c.envelope.value,'数据待核对'))} ${esc(unitLabel(c.envelope.unit))}</span></article>`).join('')||'<p>所选日期尚未形成完整市场概览。已有用电复盘可在“数据与预测”查看。</p>'}</div>
    ${m.charts.filter(c=>c.series.some(s=>s.points?.length)).map(renderSvgTimeseries).join('')}
    ${m.events.length?`<section><h3>需要留意的事件</h3>${m.events.map(e=>`<p>${esc(plainText(e.title,'市场事件待核实'))} · ${dateTime(e.startAt||e.eventTime)}</p>`).join('')}</section>`:''}
    ${m.gaps.length?`<details><summary>还需要哪些数据</summary>${m.gaps.map(g=>`<p>${esc(fieldLabel(g.fieldId))}：${esc(reasonLabel(g.reason,'来源尚待确认。'))}</p>`).join('')}</details>`:''}</section>`;
}
