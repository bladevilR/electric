import {escapeText as esc,sourceLabel,fieldLabel,dateTime,statusLabel,unitLabel} from '../presentation-language.js';
export function renderEvidenceDrawer(e={}) {
  return `<aside class="cockpit-evidence" role="dialog" aria-modal="true" aria-label="数值来源"><button data-close-evidence aria-label="关闭来源说明">关闭</button><h2>这个数从哪里来</h2><dl><dt>数据项目</dt><dd>${esc(fieldLabel(e.fieldId))}</dd><dt>来源</dt><dd>${esc(sourceLabel(e.sourceId))}</dd><dt>数值</dt><dd>${typeof e.value==='number'?esc(e.value):'暂无可用数值'} ${esc(unitLabel(e.unit))}</dd><dt>发布时间</dt><dd>${dateTime(e.publishedAt)}</dd><dt>取得时间</dt><dd>${dateTime(e.capturedAt)}</dd><dt>核对结果</dt><dd>${statusLabel(e.qualityStatus)}</dd></dl></aside>`;
}
