import {escapeText as esc,unitLabel,slotTime} from '../presentation-language.js';

const has=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const num=(v,digits=2)=>has(v)?Number(v).toLocaleString('zh-CN',{maximumFractionDigits:digits}):'暂无';
const signed=v=>has(v)?`${v>0?'+':''}${num(v)}`:'暂无';
const labels={price:['电价','元/兆瓦时'],temperature:['温度','℃'],load:['用电功率','兆瓦']};
const kindLabel=kind=>({live_issued:'当时发布的预测',historical_backtest:'历史重算',current_estimate:'当前参考预测',weather_archive:'历史天气预报',weather_forecast:'天气预报'}[kind]||'基础预测');

function curve(rows,{width=1000,height=260,mini=false,monthly=false,selectedDate='',type='price'}={}) {
  const keys=['predicted','actual'];
  const values=rows.flatMap(row=>keys.filter(k=>has(row[k])).map(k=>Number(row[k])));
  if(!values.length) return `<div class="review-empty${mini?' is-mini':''}">${mini?'待补充':'所选日期尚无可绘制的记录。补采后会在这里显示，不用其他日期替代。'}</div>`;
  const left=mini?2:64,right=mini?2:26,top=mini?3:28,bottom=mini?3:35;
  const low=Math.min(...values),high=Math.max(...values),padding=Math.max((high-low)*.12,Math.abs(high||1)*.015,.1);
  const min=low-padding,max=high+padding;
  const x=i=>left+i/Math.max(1,rows.length-1)*(width-left-right);
  const y=v=>top+(max-v)/(max-min)*(height-top-bottom);
  const n=v=>v.toFixed(2);
  const title=monthly?'每日预测与实际均值对比':`96 点预测${labels[type][0]}与实际${labels[type][0]}对比`;
  const grid=mini?'':Array.from({length:5},(_,i)=>{
    const value=min+(max-min)*i/4;
    return `<line x1="${left}" x2="${width-right}" y1="${n(y(value))}" y2="${n(y(value))}" stroke="#e6edf4"/><text x="${left-12}" y="${n(y(value)+4)}" text-anchor="end">${num(value,1)}</text>`;
  }).join('');
  const ticks=mini?'':(monthly?[0,7,14,21,rows.length-1].filter((v,i,a)=>v<rows.length&&a.indexOf(v)===i):[0,23,47,71,95]).map(i=>`<text x="${n(x(i))}" y="${height-9}" text-anchor="middle">${esc(monthly?rows[i]?.date?.slice(5):slotTime(i+1))}</text>`).join('');
  const lines=keys.map((key,index)=>{
    const groups=[];let current=[];
    rows.forEach((r,i)=>{if(has(r[key]))current.push({row:r,i});else if(current.length){groups.push(current);current=[];}});
    if(current.length) groups.push(current);
    return groups.map(group=>`<polyline data-series-role="${key==='predicted'?'forecast':'actual'}" points="${group.map(p=>`${n(x(p.i))},${n(y(p.row[key]))}`).join(' ')}" fill="none" stroke="${index?'#dd8a32':'#2165dc'}" stroke-width="${mini?1.6:2.8}" stroke-linejoin="round" stroke-linecap="round"/>${group.filter(p=>monthly||!mini&&group.length===1).map(p=>`<circle cx="${n(x(p.i))}" cy="${n(y(p.row[key]))}" r="${monthly?3.7:2.5}" fill="${index?'#dd8a32':'#2165dc'}"><title>${esc(p.row.date||slotTime(p.i+1))} ${index?'实际':'预测'}：${num(p.row[key])}</title></circle>`).join('')}`).join('');
  }).join('');
  const hitTargets=monthly?rows.map((r,i)=>`<rect data-review-date="${esc(r.date)}" x="${n(Math.max(left-12,x(i)-12))}" y="${top}" width="24" height="${height-top-bottom}" fill="#2165dc" fill-opacity="${r.date===selectedDate?.toString()?'.07':'0'}" role="button" tabindex="0" aria-label="查看 ${esc(r.date)} 的 96 点对比"><title>${esc(r.date)} · 预测 ${num(r.predicted)} · 实际 ${num(r.actual)} · 点击查看当天</title></rect>`).join(''):!mini?rows.map((r,i)=>`<rect x="${n(x(i)-4)}" y="${top}" width="8" height="${height-top-bottom}" fill="transparent"><title>${slotTime(i+1)} · 预测 ${num(r.predicted)} · 实际 ${num(r.actual)} · 相差 ${signed(r.difference)}</title></rect>`).join(''):'';
  return `<svg ${monthly?'data-review-month-chart':'data-review-day-chart'} viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"${mini?' aria-hidden="true"':''}><title>${esc(title)}</title>${grid}${ticks}${lines}${hitTargets}</svg>`;
}

const legend=type=>`<div class="review-legend"><span><i class="predicted"></i>预测${labels[type][0]}</span><span><i class="actual"></i>实际${labels[type][0]}</span></div>`;
const metric=(label,value,unit='',hint='')=>`<div class="review-metric"><span>${label}</span><strong>${num(value)}${has(value)?` <small>${unit}</small>`:''}</strong>${hint?`<small>${hint}</small>`:''}</div>`;

export function renderForecastReview(report,{loading=false,error='',selection}={}) {
  const date=selection?.date||report?.targetDate||'';
  const type=selection?.type||report?.type||'price';
  if(!report) return `<section class="foundation-section review-loading" aria-live="polite"><h2>${esc(date)} · ${labels[type][0]}预测与实际</h2><p${error?' role="alert"':''}>${esc(error||'正在读取所选月份的预测与实际记录…')}</p>${error?'<button type="button" data-review-retry>重新加载</button>':''}</section>`;
  const {days,selected,summary}=report;
  const unit=labels[type][1]||unitLabel(report.unit);
  const monthlyRows=days.map(day=>({date:day.date,predicted:day.forecastMean,actual:day.actualMean}));
  const kinds=[...new Set(days.filter(d=>d.forecastCount).map(d=>d.forecastKind))].map(kind=>`${kindLabel(kind)} ${days.filter(d=>d.forecastCount&&d.forecastKind===kind).length} 天`).join('；');
  const available=Array.from(new Set([...(report.availableMonths||[]),report.month])).sort().reverse();
  return `<div class="forecast-review" data-review-report data-review-type="${type}" data-review-selected-date="${esc(selected.date)}" aria-busy="${loading}">
    <section class="foundation-section review-month" aria-labelledby="reviewMonthTitle">
      <header class="review-section-heading"><div><small>月度趋势与单日下钻</small><h2 id="reviewMonthTitle">${esc(report.month)} · ${labels[type][0]}预测偏差与精度分析</h2></div>
        <div class="review-month-controls"><button type="button" data-review-month-step="-1" aria-label="上一个月">‹</button><label>月份<input type="month" data-review-month value="${esc(report.month)}"></label><button type="button" data-review-month-step="1" aria-label="下一个月">›</button><label class="review-month-jump">已有记录<select data-review-month-jump>${available.map(m=>`<option value="${esc(m)}"${m===report.month?' selected':''}>${esc(m)}</option>`).join('')}</select></label></div>
      </header>
      <div class="review-summary">${metric('本月平均每时段误差',summary.mae,unit,'只计算预测与实际都有值的时段')}${metric('已可对比',summary.pairedDays,'天',`本月 ${days.length} 天均可点击`)}${metric('已有预测',summary.forecastDays,'天')}${metric('已有实际',summary.actualDays,'天')}</div>
      <p class="review-chart-note review-kind-note">${esc(kinds||'暂无预测记录')}。离线历史重算仅用于回溯检验，与实盘发布版本严格隔离。</p>
      ${legend(type)}${curve(monthlyRows,{monthly:true,selectedDate:selected.date,type})}
      <p class="review-chart-note">上图按各日有效时段计算日均值（单日完整为 96 时段）；统计误差基于点对点偏差。点击日期快速下钻单日分时详情；数据缺失时段保持断开以确保统计客观性。</p>
      <div class="review-day-grid" aria-label="选择本月任意一天">${days.map(day=>`<button type="button" class="review-day-card${day.date===selected.date?' is-selected':''}" data-review-date="${esc(day.date)}" aria-pressed="${day.date===selected.date}" aria-label="查看 ${esc(day.date)} 的 96 点对比"><span class="review-day-top"><strong>${Number(day.date.slice(-2))} 日</strong><small>${day.pairedCount?`平均差 ${num(day.mae,1)}`:day.forecastCount?'等待实际':'待补充'}</small></span>${curve(day.rows,{width:150,height:38,mini:true,type})}<span class="review-day-values"><span>预测 ${num(day.forecastMean,1)}</span><span>实际 ${num(day.actualMean,1)}</span></span></button>`).join('')}</div>
    </section>
    <section class="foundation-section review-day-detail" id="foundationForecastPanel" data-review-detail aria-labelledby="reviewDayTitle">
      <header class="review-section-heading"><div><small>当天分时对比 · ${unit}</small><h2 id="reviewDayTitle">${esc(selected.date)} · 96 个时段</h2><p>${esc(kindLabel(selected.forecastKind))} · ${esc(selected.methodLabel||'基础参考方法')}</p></div><div class="review-day-controls"><button type="button" data-review-day-step="-1">前一天</button><button type="button" data-review-day-step="1">后一天</button></div></header>
      ${legend(type)}${curve(selected.rows,{type})}
      <div class="review-summary">${metric('预测日均值',selected.forecastMean,unit)}${metric('实际日均值',selected.actualMean,unit)}${metric('平均每时段相差',selected.mae,unit)}${metric('最大单时段相差',selected.maxAbsoluteError,unit,`${selected.pairedCount}/96 个时段可对比`)}</div>
      <div class="review-analysis"><h3>${type==='price'?'当日时段预测偏差溯源分析':'当日预测与实况偏差分析'}</h3>${(selected.analysis||[]).map(line=>`<p>${esc(line)}</p>`).join('')}${!selected.pairedCount?'<p>当日实际结果尚未齐备，暂不计算准确度；已有预测照常展示。</p>':''}</div>
      <details class="review-method"><summary>预测依据与算法口径说明</summary><p>${esc(selected.methodLabel||'基础参考方法')}</p>${(selected.caveats||[]).map(line=>`<p>${esc(line)}</p>`).join('')}<p>平均绝对误差 (MAE) ＝ 各配对时段 |预测 − 实际| 之和 ÷ 配对时段数。历史重算只使用该业务日期之前的数据，不是当时发布的预测。</p></details>
      <details class="review-point-details" id="reviewPointDetails"><summary>展开当日 96 时段逐点预测与实况明细表</summary><div class="local-scroll"><table><thead><tr><th>时段结束</th><th>预测${labels[type][0]}</th><th>实际${labels[type][0]}</th><th>预测 − 实际</th><th>绝对误差</th></tr></thead><tbody>${selected.rows.map(r=>`<tr data-review-point="${r.pointIndex}"><td>${slotTime(r.pointIndex)}</td><td>${num(r.predicted)}</td><td>${num(r.actual)}</td><td class="${r.difference>0?'is-positive':r.difference<0?'is-negative':''}">${signed(r.difference)}</td><td>${num(r.absoluteError)}</td></tr>`).join('')}</tbody></table></div></details>
    </section>
  </div>`;
}
