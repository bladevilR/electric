import {buildModelGovernanceModel} from '../view-models/model-governance-model.js';
import {escapeText as esc,methodLabel,plainText} from '../presentation-language.js';

const emptyGovernanceIllustration = `<svg class="cockpit-empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M32 6l22 10v18c0 14-10 24-22 28C20 58 10 48 10 34V16L32 6z"/><path d="M24 32l6 6 12-12"/></svg>`;

export function renderModelGovernanceView(state={}) {
  const m = buildModelGovernanceModel(state.governanceReport || {});
  const emptyMarkup = `
    <div class="cockpit-empty-state">
      ${emptyGovernanceIllustration}
      <p class="empty-state-lead">当前没有待评估的新方法。</p>
      <p class="cockpit-empty-desc">生产运行中的预测方法保持稳定在盘；新候选算法需完成留出集严格检验与人工确认，绝不自动启用。</p>
    </div>
  `;

  return `<section class="cockpit-view" data-view="model-governance">
    <header>
      <h2>预测方法管理</h2>
      <span class="mode-identity">${state.mode === 'demo' ? '演示数据' : '真实数据'}</span>
    </header>
    <p class="cockpit-view-lead">查看哪些方法正在使用、哪些还需要评估。新方法未通过检查和人工确认，不会自动启用。</p>
    ${m.versions.length ? `
      <div class="model-version-grid">
        ${m.versions.map(v => `
          <article class="model-version-card">
            <h3>${esc(methodLabel(v.modelId))}</h3>
            <span class="status-badge ${v.status === 'champion_review_eligible' ? 'is-eligible' : ''}">${esc(plainText(v.statusText, '待评估'))}</span>
          </article>
        `).join('')}
      </div>
    ` : emptyMarkup}
    <details class="foundation-disclosure-card">
      <summary>更换预测方法前检查什么</summary>
      <p>用相同日期的数据比较误差，检查异常时段、适用范围和使用限制，再由业务人员确认是否采用。</p>
    </details>
  </section>`;
}
