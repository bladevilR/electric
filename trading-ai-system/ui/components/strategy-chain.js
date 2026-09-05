import {escapeText as esc,plainText,statusLabel,fieldLabel} from '../presentation-language.js';
const stages={evidence:'检查数据来源',load:'预计用电需求',price:'预计购电价格',supplyNetwork:'检查市场供需',positionLimits:'核对已购电量和限制',objectiveConstraints:'比较可行方案',recommendation:'形成申报建议'};
export function renderStrategyChain(trace={}) {
  return `<ol class="strategy-chain" aria-label="策略形成步骤">${(trace.stages||[]).map(s=>`<li><strong>${esc(stages[s.id]||plainText(s.title,'方案检查'))}</strong><span>${statusLabel(s.status)}</span>${s.missingFields?.length?`<small>还需核对：${s.missingFields.map(f=>esc(fieldLabel(f))).join('、')}</small>`:''}</li>`).join('')}</ol>`;
}
