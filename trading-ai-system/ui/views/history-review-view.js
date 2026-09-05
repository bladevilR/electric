import {renderAvailableReview} from './data-sources-view.js';

const emptyHistoryIllustration = `<svg class="cockpit-empty-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="24"/><path d="M32 16v16l10 6"/><path d="M12 20a24 24 0 0 1 8-8"/></svg>`;

export function renderHistoryReviewView(state={}) {
  const preview = state.foundationInput?.reviewPreview || state.reviewPreview;
  const emptyMarkup = `
    <div class="cockpit-empty-state">
      ${emptyHistoryIllustration}
      <p class="empty-state-lead">暂时没有已完成的历史对比，可以先到数据页查询已有记录。</p>
      <p class="cockpit-empty-desc">复盘需要基于历史已归档的正式发布版本或事后回测数据；未归档前不进行推测性比对，确保核算客观严谨。</p>
      <button type="button" class="foundation-primary-button" data-cockpit-view="data-sources">查询历史数据与预测依据</button>
    </div>
  `;

  return `<section class="cockpit-view foundation-workbench" data-view="history-review">
    <header>
      <h2>历史复盘</h2>
      <span class="mode-identity">${state.mode === 'demo' ? '演示数据' : '真实数据'}</span>
    </header>
    <p class="cockpit-view-lead">分清“当时发布的预测”和“事后重新计算”，再与实际结果比较。</p>
    ${renderAvailableReview(preview) || emptyMarkup}
    <details class="foundation-disclosure-card">
      <summary>三种复盘有什么区别</summary>
      <p><strong>当时发布的预测：</strong>核对当时留下的预测记录与后来实际结果。</p>
      <p><strong>历史重新计算：</strong>只用目标日期之前的数据重新预测；不代表当时已经发布。</p>
      <p><strong>结算后核对：</strong>比较最终电费与实际购电情况；没有结算单时不估算成真实收益。</p>
    </details>
    <div class="cockpit-view-actions">
      <button type="button" class="foundation-secondary-button" data-cockpit-view="data-sources">查询历史数据与预测依据</button>
    </div>
  </section>`;
}
