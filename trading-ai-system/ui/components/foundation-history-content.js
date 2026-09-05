import { renderSvgTimeseries } from './svg-timeseries.js';
import {escapeText as esc,sourceLabel,fieldLabel,unitLabel,dateTime,slotTime,reportName,reasonLabel} from '../presentation-language.js';

function conversionText(conversion) {
  if (/MW\s*=\s*kWh\s*\/\s*1000\s*\/\s*0\.25/i.test(conversion || '')) return '每 15 分钟的电量（千瓦时）÷ 250，得到该时段的平均用电功率（兆瓦）。';
  if (/MW\s*=\s*MWh\s*\/\s*0\.25/.test(conversion || '')) return '每 15 分钟的电量（兆瓦时）÷ 0.25，得到该时段的平均用电功率（兆瓦）。';
  return conversion ? '单位换算方式需结合原始报表核实。' : '按来源给出的单位展示。';
}

export function renderHistoryContent(history={}) {
  const rows=history.rows || [];
  if(history.mode==='evidence') {
    const captures=history.captures || [];
    return `<div class="foundation-history-evidence local-scroll">${captures.length?captures.map(c=>`<article><h3>${esc(c.businessDate)} · ${esc(sourceLabel(c.sourceId))}</h3><dl>
      <dt>来源报表或平台</dt><dd>${esc(c.evidence?.sourceFile ? reportName(c.evidence.sourceFile) : sourceLabel(c.sourceId))}</dd>
      ${c.evidence?.sourceSheet?`<dt>报表工作表</dt><dd>${esc(c.evidence.sourceSheet)}</dd>`:''}
      <dt>单位怎样换算</dt><dd>${conversionText(c.evidence?.conversion)}</dd>
      <dt>取得时间</dt><dd>${dateTime(c.capturedAt)}；这不是历史数据当时的发布时间。</dd>
      <dt>核对结果</dt><dd>${c.accepted?'已通过核对':'尚未通过核对'} · ${Number(c.rowCount || 0)} 条记录${c.evidence?.reasonCode?`<p>${esc(reasonLabel(c.evidence.reasonCode,'这份记录仍需进一步核对。'))}</p>`:''}</dd></dl></article>`).join(''):'<p role="status">当前筛选条件没有来源记录，请换一个有数据的日期。</p>'}</div>`;
  }
  if(!rows.length) return '<div class="foundation-history-empty" role="status"><strong>所选日期没有这项数据</strong><p>可以换一个日期或数据项目，已有历史不会受到平台维护影响。</p></div>';
  const start=Number(history.query?.offset || 0)+1;
  const pagination=`<p>显示第 ${start}–${start+rows.length-1} 条记录${history.nextOffset!=null?` <button type="button" data-foundation-action="history-next" data-offset="${Number(history.nextOffset)}">下一页</button>`:''}</p>`;
  if(history.mode==='chart') {
    const groups=new Map();
    for(const row of rows) {
      if(row.value==null || !Number.isFinite(Number(row.value))) continue;
      const key=JSON.stringify([row.businessDate,row.fieldId,row.sourceId,row.unit]);
      if(!groups.has(key)) groups.set(key,{row,points:new Map()});
      const old=groups.get(key).points.get(row.pointIndex);
      if(!old || row.availableAt>=old.availableAt) groups.get(key).points.set(row.pointIndex,row);
    }
    return pagination+`<p>按日期、数据项目与来源分别展示；同一时段取本页最新记录。最多显示 8 组，可缩小日期范围查看更多。</p><div class="foundation-history-charts local-scroll">${[...groups.values()].slice(0,8).map(({row,points})=>renderSvgTimeseries({title:`历史曲线 · ${row.businessDate}`,unit:row.unit,series:[{label:`${fieldLabel(row.fieldId)} · ${sourceLabel(row.sourceId)}`,points:[...points.values()].sort((a,b)=>a.pointIndex-b.pointIndex)}]})).join('')}</div>`;
  }
  return pagination+`<div class="local-scroll foundation-history-table"><table><thead><tr><th>日期</th><th>时段结束</th><th>数据项目</th><th>数值</th><th>来源</th><th>取得时间</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.businessDate)}</td><td>${slotTime(r.pointIndex)}</td><td>${esc(fieldLabel(r.fieldId))}</td><td>${esc(r.value)} ${esc(unitLabel(r.unit))}</td><td>${esc(sourceLabel(r.sourceId))}</td><td>${dateTime(r.availableAt)}</td></tr>`).join('')}</tbody></table></div>`;
}
