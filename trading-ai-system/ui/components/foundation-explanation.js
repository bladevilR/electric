import {escapeText as esc, EXPLANATION_COPY, plainText, reasonLabel, methodLabel, dateTime} from '../presentation-language.js';

export function renderExplanationButton(id,label,triggerKey='',expanded=false) {
  return `<button type="button" class="foundation-info-button" data-foundation-action="open-explanation" data-explanation-id="${esc(id)}"${triggerKey?` data-foundation-trigger="${esc(triggerKey)}"`:''} aria-label="${esc(label)}：查看说明" aria-controls="foundationEvidenceDrawer" aria-expanded="${expanded}"><span aria-hidden="true">查看说明</span></button>`;
}
const copyFor = explanation => ({...explanation,...EXPLANATION_COPY[explanation.id]});
export function renderFoundationTooltip(explanation={}) {
  if(!explanation.id) return '';
  const e=copyFor(explanation);
  return `<aside class="foundation-tooltip" role="note" aria-label="${esc(e.title)}"><strong>${esc(e.title)}</strong><p>${esc(plainText(e.principle))}</p><p>${esc(plainText(e.formula))}</p><small>${esc(plainText(e.caveat))}</small></aside>`;
}

export function renderFoundationEvidenceDrawer(explanation={},evidence={}) {
  if(!explanation.id) return '';
  const e=copyFor(explanation),stage=evidence.stageEvidence;
  const warnings=(stage?.warnings||[]).map(x=>reasonLabel(x,plainText(x,'必要数据或限制尚未齐全。')));
  const blocked=(stage?.stageStatus||[]).some(s=>/blocked|unavailable|missing|未|缺/.test(s));
  return `<aside class="foundation-evidence-drawer" id="foundationEvidenceDrawer" role="dialog" aria-modal="false" aria-labelledby="foundationEvidenceTitle" tabindex="-1">
    <header><h2 id="foundationEvidenceTitle">${esc(e.title)}</h2><button type="button" data-foundation-action="close-explanation" aria-label="关闭依据说明">关闭</button></header>
    <section><h3>这是做什么的</h3><p>${esc(plainText(e.principle))}</p></section>
    <section><h3>怎样计算或判断</h3><p class="foundation-formula">${esc(plainText(e.formula,'计算方法还需要进一步说明。'))}</p><p>${esc(plainText(e.caveat))}</p></section>
    <section><h3>本次使用情况</h3>${stage ? `<p>${blocked || !stage.conclusionIds?.length ? '尚未形成可采用的结论。' : '已保留这一步的计算记录，仍需结合业务限制与人工复核。'}</p><p>${stage.inputRefs?.length ? '已保留使用数据的来源记录。' : '使用数据尚未齐全。'}</p>${warnings.length?`<p>需要注意：${[...new Set(warnings)].map(esc).join('；')}</p>`:''}` : `<dl><div><dt>预测方法</dt><dd>${esc(methodLabel(evidence.modelVersion))}</dd></div><div><dt>使用数据截至</dt><dd>${dateTime(evidence.dataCutoff)}</dd></div></dl>`}</section>
    <footer><button type="button" class="foundation-secondary-button" data-foundation-action="open-provenance" data-foundation-trigger="provenance-rail">查看数据来源</button><button type="button" class="foundation-primary-button" data-foundation-action="close-explanation">关闭</button></footer>
  </aside>`;
}

export function renderFoundationProvenance(open=false,collection={}) {
  if(!open) return '';
  const r=collection.range || {};
  return `<aside class="foundation-provenance" id="foundationProvenance" role="dialog" aria-modal="false" aria-label="数据来源" tabindex="-1"><header><strong>数据来源</strong><button type="button" data-foundation-action="close-provenance">收起</button></header>
    <p>这里说明数据从哪里来、用来做什么。是否能用于所选日期，请以对应曲线和历史查询为准。</p>
    <ol><li><strong>电价 · 交易平台</strong><small>读取你有权限查看的市场电价，用来判断购电成本。缺失日期不会用其他日期冒充。</small></li>
    <li><strong>天气 · 天气预报与历史天气</strong><small>温度可使用天气预报；历史实况用于核对预报偏差。预测中是否实际采用天气因素，会在方法说明中标明。</small></li>
    <li><strong>实际用电 · 平台或用电报表</strong><small>导入报表和在线采集分别保留来源。历史查询中的“来源说明”可查看报表名称、数据日期及取得时间。</small></li>
    <li><strong>购电计划与业务限制</strong><small>用于判断还需购买多少，以及申报不能超过哪些限额。未核实前不会视为可执行方案。</small></li></ol>
    <section class="foundation-storage-evidence"><h3>怎样找到已有数据</h3><p>在首页“查询历史数据”中选择日期与数据项目，再切换曲线、明细或来源说明。</p>${r.earliestDate&&r.latestDate?`<p>已有记录分布在 ${esc(r.earliestDate)} 至 ${esc(r.latestDate)}；其中存在缺失日期，并非每种数据都覆盖整个区间。</p>`:''}</section>
  </aside>`;
}
