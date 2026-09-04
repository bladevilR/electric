import {renderAvailableReview} from './data-sources-view.js';
export function renderHistoryReviewView(state={}) {
  const preview=state.foundationInput?.reviewPreview || state.reviewPreview;
  return `<section class="cockpit-view foundation-workbench" data-view="history-review"><header><h2>历史复盘</h2><span class="mode-identity">${state.mode==='demo'?'演示数据':'真实数据'}</span></header><p>分清“当时发布的预测”和“事后重新计算”，再与实际结果比较。</p>${renderAvailableReview(preview)||'<p>暂时没有已完成的历史对比，可以先到数据页查询已有记录。</p>'}<details><summary>三种复盘有什么区别</summary><p>当时发布的预测：核对当时留下的预测记录与后来实际结果。</p><p>历史重新计算：只用目标日期之前的数据重新预测；不代表当时已经发布。</p><p>结算后核对：比较最终电费与实际购电情况；没有结算单时不估算成真实收益。</p></details><button type="button" data-cockpit-view="data-sources">查询历史数据与预测依据</button></section>`;
}
