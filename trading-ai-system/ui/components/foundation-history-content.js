import { renderSvgTimeseries } from './svg-timeseries.js';
const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderHistoryContent(history = {}) {
  const rows = history.rows || [];
  if (history.mode === 'evidence') {
    const captures = history.captures || [];
    return `<div class="foundation-history-evidence local-scroll" style="max-height:400px;overflow:auto">${captures.length ? captures.map(capture => `<article><h3>${esc(capture.businessDate)} · ${esc(capture.sourceId)}</h3><dl><dt>来源文件 / 页面</dt><dd>${esc(capture.evidence?.sourceFile || capture.pageUrl)}</dd><dt>工作表</dt><dd>${esc(capture.evidence?.sourceSheet)}</dd><dt>换算依据</dt><dd>${esc(capture.evidence?.conversion || '使用源页面字段单位，未进行电量 / 功率换算')}</dd><dt>采集时间（非历史发布时间）</dt><dd>${esc(capture.capturedAt)}</dd><dt>证据 SHA-256</dt><dd style="overflow-wrap:anywhere">${esc(capture.contentSha256)}</dd><dt>采集结果</dt><dd>${capture.accepted ? '校验通过' : '未通过'} · ${Number(capture.rowCount || 0)} 条${capture.evidence?.reasonCode ? `<p>${esc(capture.evidence.reasonCode)} · ${esc(capture.evidence.reason)}</p>` : ''}</dd></dl></article>`).join('') : '<p role="status">当前筛选条件没有采集证据。</p>'}</div>`;
  }
  if (!rows.length) return '<div class="foundation-history-empty" role="status"><strong>尚无可查询的基础数据历史</strong><p>当前日期 / 字段 / 来源没有记录。可切换日期，或启动专用 Chrome 回填。</p></div>';
  const query = history.query || {};
  const pagination = `<p>本页 ${rows.length} 条 · 偏移 ${Number(query.offset || 0)}${history.nextOffset != null ? ` <button type="button" data-foundation-action="history-next" data-offset="${Number(history.nextOffset)}">下一页</button>` : ''}</p>`;
  if (history.mode === 'chart') {
    const groups = new Map();
    for (const row of rows) {
      if (row.value == null || !Number.isFinite(Number(row.value))) continue;
      const key = JSON.stringify([row.businessDate, row.fieldId, row.sourceId, row.unit]);
      if (!groups.has(key)) groups.set(key, { row, points: new Map() });
      const previous = groups.get(key).points.get(row.pointIndex);
      if (!previous || row.availableAt >= previous.availableAt) groups.get(key).points.set(row.pointIndex, row);
    }
    return pagination + `<p>按日期、字段和来源分图；同点采用本页最新采集版本。最多显示 8 组，请缩小筛选范围查看其余曲线。</p><div class="foundation-history-charts local-scroll" style="max-height:450px;overflow:auto">${[...groups.values()].slice(0,8).map(({row,points}) => renderSvgTimeseries({title:`历史曲线 · ${row.businessDate}`,unit:row.unit,series:[{label:`${row.fieldId} · ${row.sourceId}`,points:[...points.values()].sort((a,b)=>a.pointIndex-b.pointIndex)}]})).join('')}</div>`;
  }
  return pagination + `<div class="local-scroll foundation-history-table" style="max-height:360px;overflow:auto"><table><thead><tr><th>业务日期</th><th>点位</th><th>字段</th><th>值 / 单位</th><th>来源</th><th>可用时间</th><th>版本</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.businessDate)}</td><td>${esc(row.pointIndex)}</td><td>${esc(row.fieldId)}</td><td>${esc(row.value)} ${esc(row.unit)}</td><td>${esc(row.sourceId)}</td><td>${esc(row.availableAt)}</td><td>${esc(row.sourceRevision)}</td></tr>`).join('')}</tbody></table></div>`;
}
