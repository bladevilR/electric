import {escapeText as esc,plainText,unitLabel,slotTime} from '../presentation-language.js';

const usable = points => (points || []).filter(p=>p.value != null && p.value !== '' && Number.isFinite(Number(p.value)));
const styleFor = (role,index) => role==='actual' ? ['#17386f',3.2,''] : role==='forecast' ? ['#1765e8',3.2,''] : role==='previous' ? ['#8a99ac',2.5,'8 6'] : [['#1765e8','#0a9b70','#8a99ac','#7c4fe0'][index%4],3,index>1?'8 6':''];
const number = n => Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});

export function renderSvgTimeseries({title='每日变化曲线',unit='',series=[],detailsLabel='查看每 15 分钟的明细',indexLabel='时段结束'}={}) {
  const ss=series.map(s=>({...s,label:plainText(s.label||s.fieldId,'数据曲线'),points:usable(s.points),lowerPoints:usable(s.lowerPoints),upperPoints:usable(s.upperPoints)}));
  const points=ss.flatMap(s=>[...s.points,...s.lowerPoints,...s.upperPoints].map(p=>({...p,seriesLabel:s.label})));
  if(!points.length) return `<p role="status">所选范围没有可绘制的数据。</p>`;
  const values=points.map(p=>Number(p.value)),low=Math.min(...values),high=Math.max(...values),pad=Math.max((high-low)*.08,Math.abs(high||1)*.02,1);
  const rawStep=(high-low+2*pad)/4,baseStep=10**Math.floor(Math.log10(rawStep));
  const step=([1,2,5,10].find(n=>n*baseStep>=rawStep)||10)*baseStep;
  const min=low<0?Math.floor((low-pad)/step)*step:Math.max(0,Math.floor((low-pad)/step)*step),max=Math.ceil((high+pad)/step)*step,range=max-min||1;
  const x=i=>58+(Number(i||1)-1)/95*876, y=v=>220-(Number(v)-min)/range*192;
  const xy=p=>`${x(p.pointIndex).toFixed(2)},${y(p.value).toFixed(2)}`;
  const levels=Array.from({length:Math.round(range/step)+1},(_,i)=>min+step*i);
  const timeTicks=[[1,'00:15'],[24,'06:00'],[48,'12:00'],[72,'18:00'],[96,'24:00']];
  const dateTicks = indexLabel==='交易日' ? ss.find(s=>s.points.length)?.points || [] : [];
  const ticks=dateTicks.length?dateTicks.filter((_,i)=>i===0||i===dateTicks.length-1||i===Math.floor(dateTicks.length/2)).map(p=>[p.pointIndex,p.displayLabel]):timeTicks;
  return `<figure class="timeseries local-scroll" role="region" aria-label="${esc(title)}，单位 ${esc(unitLabel(unit))}"><figcaption><strong>${esc(plainText(title))}</strong> · ${esc(unitLabel(unit))}</figcaption>
    <svg viewBox="0 0 960 260" role="img" aria-label="${esc(title)}"><title>${esc(title)}，单位 ${esc(unitLabel(unit))}</title>
      ${levels.map(v=>`<line x1="58" x2="934" y1="${y(v)}" y2="${y(v)}" stroke="#e3eaf4"/><text x="48" y="${y(v)+4}" text-anchor="end" fill="#506b8b" font-size="11">${number(v)}</text>`).join('')}
      ${ticks.map(([i,label])=>`<text x="${x(i)}" y="246" text-anchor="middle" fill="#506b8b" font-size="11">${esc(label)}</text>`).join('')}
      ${ss.filter(s=>s.role==='interval').map(s=>`<polygon data-series-role="interval" points="${[...s.upperPoints,...[...s.lowerPoints].reverse()].map(xy).join(' ')}" fill="#dbeafe" fill-opacity="0.78" stroke="none"/>`).join('')}
      ${ss.filter(s=>s.role!=='interval'&&s.points.length).map((s,i)=>{const [color,width,dash]=styleFor(s.role,i);return `<polyline data-series-role="${esc(s.role||`series-${i+1}`)}" fill="none" stroke="${color}" stroke-width="${width}"${dash?` stroke-dasharray="${dash}"`:''} points="${s.points.map(xy).join(' ')}"/>`;}).join('')}
    </svg><div class="chart-legend">${ss.filter(s=>s.points.length||s.lowerPoints.length).map(s=>`<span data-series-role="${esc(s.role||'series')}">${esc(s.label)}</span>`).join('')}</div>
    <details data-disclosure="${esc(JSON.stringify([title,unit,ss.map(s=>s.label)]))}"><summary>${esc(detailsLabel)}</summary><table><thead><tr><th>曲线</th><th>${esc(indexLabel)}</th><th>数值（${esc(unitLabel(unit))}）</th></tr></thead><tbody>${points.map(p=>`<tr><td>${esc(p.seriesLabel)}</td><td>${esc(p.displayLabel??slotTime(p.pointIndex))}</td><td>${number(p.value)}</td></tr>`).join('')}</tbody></table></details></figure>`;
}
