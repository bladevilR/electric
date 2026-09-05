import {renderStatusBadge} from './status-badge.js';
import {fieldLabel,sourceLabel,unitLabel,plainText} from '../presentation-language.js';
const COLUMNS=['数据项目','用途','单位说明','来源','当前情况'];
const esc=(v)=>String(v??'—').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderFieldCatalogTable(model={}){return `<div class="local-scroll" role="region" aria-label="数据项目说明，可横向滚动" tabindex="0"><table><thead><tr>${COLUMNS.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${(model.fields||[]).map(f=>`<tr><td>${esc(fieldLabel(f.fieldId))}</td><td>${esc(plainText(f.businessMeaning||f.description,'用于辅助判断数据与预测，具体用途待核实。'))}</td><td>${esc(unitLabel(f.unit))}</td><td>${esc(sourceLabel(f.sourceId))}</td><td>${renderStatusBadge(f.confirmationStatus)}</td></tr>`).join('')}</tbody></table></div>`;}
