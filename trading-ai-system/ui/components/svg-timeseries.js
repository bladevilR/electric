const esc=(v)=>String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const roleStyle = (role, index) => {
  if (role === 'actual') return { color: '#17386f', width: 3.2, dash: '' };
  if (role === 'forecast') return { color: '#1765e8', width: 3.2, dash: '' };
  if (role === 'previous') return { color: '#8a99ac', width: 2.5, dash: '8 6' };
  return {
    color: ['#1765e8','#0a9b70','#8a99ac','#7c4fe0'][index%4],
    width: 3,
    dash: index > 1 ? '8 6' : '',
  };
};

export function renderSvgTimeseries({title='96点曲线',unit='',series=[]}={}){
  const points=series.flatMap(s=>s.points||[]).filter(p=>Number.isFinite(Number(p.value)));
  const values=points.map(p=>Number(p.value));
  const low=Math.min(...values,0),high=Math.max(...values,1);
  const observedLow=Math.min(...values),observedHigh=Math.max(...values);
  const padding=Math.max((observedHigh-observedLow)*0.08,Math.abs(observedHigh||1)*0.02,1);
  const min=values.length?(observedLow<0?observedLow-padding:Math.max(0,observedLow-padding)):low;
  const max=values.length?observedHigh+padding:high;
  const range=max-min||1;
  return `<figure class="timeseries local-scroll" role="region" aria-label="${esc(title)}，单位 ${esc(unit)}"><figcaption><strong>${esc(title)}</strong> · ${esc(unit)}</figcaption><svg viewBox="0 0 960 260" role="img" aria-label="${esc(title)}"><title>${esc(title)}，单位 ${esc(unit)}</title>${series.map((s,i)=>{const style=roleStyle(s.role,i);return `<polyline data-series-role="${esc(s.role||`series-${i+1}`)}" fill="none" stroke="${style.color}" stroke-width="${style.width}"${style.dash?` stroke-dasharray="${style.dash}"`:''} points="${(s.points||[]).filter(p=>Number.isFinite(Number(p.value))).map(p=>`${Number(p.pointIndex||1)*10},${230-(Number(p.value)-min)/range*200}`).join(' ')}"/>`;}).join('')}</svg><div class="chart-legend">${series.map(s=>`<span data-series-role="${esc(s.role||'series')}">${esc(s.label||s.fieldId)}（${esc(unit)}）</span>`).join('')}</div><details><summary>查看96点明细</summary><table><thead><tr><th>点</th><th>值（${esc(unit)}）</th></tr></thead><tbody>${points.map(p=>`<tr><td>${p.pointIndex}</td><td>${p.value}</td></tr>`).join('')}</tbody></table></details></figure>`;
}
