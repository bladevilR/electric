import {buildDeclarationStrategyModel} from '../view-models/declaration-strategy-model.js';
import {renderStrategyChain} from '../components/strategy-chain.js';
import {escapeText as esc,methodLabel} from '../presentation-language.js';

const bound = (value,unit) => typeof value==='number'&&Number.isFinite(value) ? `${value} ${unit}` : value && Number.isFinite(value.minMw)&&Number.isFinite(value.maxMw) ? `${value.minMw} 至 ${value.maxMw} ${unit}` : '尚待核实，不能据此提交申报';

export function renderDeclarationStrategyView(state={}) {
  const m = buildDeclarationStrategyModel(state.strategyReport || {});

  return `<section class="cockpit-view" data-view="declaration-strategy">
    <header>
      <h2>申报策略</h2>
      <span class="mode-identity">${state.mode === 'demo' ? '演示数据' : '真实数据'}</span>
    </header>
    <p class="cockpit-view-lead">结合预计用电量、已购电量和电价判断申报方案，再检查业务限制。历史预测表现不能替代当天的申报条件。</p>
    <details class="foundation-disclosure-card">
      <summary>查看申报限制与计算依据</summary>
      <div class="constraint-grid">
        <article class="cockpit-metric-tile">
          <h3>申报功率允许范围</h3>
          <p class="metric-value">${esc(bound(m.constraints.declarationPower.value, '兆瓦'))}</p>
        </article>
        <article class="cockpit-metric-tile">
          <h3>可交易电量上限</h3>
          <p class="metric-value">${esc(bound(m.constraints.energyBlockLimit.value, '兆瓦时'))}</p>
        </article>
      </div>
      <p class="cockpit-price-ref">价格参考：${m.priceVersions.map(v => esc(methodLabel(v))).join('、') || '尚待核实'}</p>
      ${renderStrategyChain(m.trace)}
    </details>
    <p class="cockpit-notice-banner">试调不提交交易；正式采用前需要业务人员确认。</p>
  </section>`;
}
