import {buildModelGovernanceModel} from '../view-models/model-governance-model.js';
import {escapeText as esc,methodLabel,plainText} from '../presentation-language.js';
export function renderModelGovernanceView(state={}) {
  const m=buildModelGovernanceModel(state.governanceReport||{});
  return `<section class="cockpit-view" data-view="model-governance"><header><h2>预测方法管理</h2><span class="mode-identity">${state.mode==='demo'?'演示数据':'真实数据'}</span></header><p>查看哪些方法正在使用、哪些还需要评估。新方法未通过检查和人工确认，不会自动启用。</p>${m.versions.map(v=>`<article><h3>${esc(methodLabel(v.modelId))}</h3><p>${esc(plainText(v.statusText,'待评估'))}</p></article>`).join('')||'<p>当前没有待评估的新方法。</p>'}<details><summary>更换预测方法前检查什么</summary><p>用相同日期的数据比较误差，检查异常时段、适用范围和使用限制，再由业务人员确认是否采用。</p></details></section>`;
}
