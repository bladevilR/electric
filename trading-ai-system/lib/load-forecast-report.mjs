const DAY = 86400000;
const gap = (later, earlier) => (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY;
const median = (values) => { const sorted = [...values].sort((a,b)=>a-b), mid = Math.floor(sorted.length/2); return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2; };
const emptyMetrics = () => ({ mae:null, rmse:null, mape:null, baselineSkill:null });

export function buildLoadForecastReport(facts, { targetDate, now = new Date().toISOString() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate || '') || !Number.isFinite(Date.parse(targetDate)) || new Date(targetDate).toISOString().slice(0,10)!==targetDate) throw new Error('target_date_invalid');
  const byDate = new Map();
  for (const fact of facts || []) {
    if (!['actualAverageLoadMw','actualLoadMw'].includes(fact.fieldId) || fact.unit !== 'MW' || fact.value === null || fact.value === '' || !Number.isFinite(Number(fact.value)) || Number(fact.value)<0 || !Number.isFinite(Date.parse(fact.availableAt)) || Date.parse(fact.availableAt)>Date.parse(now)) continue;
    if (!Number.isInteger(fact.pointIndex) || fact.pointIndex<1 || fact.pointIndex>96) continue;
    const day = byDate.get(fact.businessDate) || new Map();
    const old = day.get(fact.pointIndex);
    if (!old || Date.parse(fact.availableAt)>=Date.parse(old.availableAt)) day.set(fact.pointIndex, fact);
    byDate.set(fact.businessDate, day);
  }
  const dates = [...byDate.keys()].filter((date)=>byDate.get(date).size===96).sort();
  const trainingDates = (date) => dates.filter((candidate)=>candidate<date && gap(date,candidate)<=42).slice(-28);
  const predictable = (date) => { const days=trainingDates(date); return days.length>=5 && gap(date,days.at(-1))<=7; };
  const predict = (date) => {
    const days=trainingDates(date);
    return Array.from({length:96},(_,index)=>({pointIndex:index+1,pointForecast:median(days.map(day=>Number(byDate.get(day).get(index+1).value))),actualValue:byDate.get(date)?.size===96 ? Number(byDate.get(date).get(index+1).value) : null}));
  };
  const metricsFor = (rows) => {
    const paired=rows.filter(row=>row.actualValue!==null);
    if(!paired.length)return emptyMetrics();
    const errors=paired.map(row=>row.pointForecast-row.actualValue), nonzero=paired.filter(row=>row.actualValue!==0);
    return {mae:errors.reduce((s,e)=>s+Math.abs(e),0)/errors.length,rmse:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),mape:nonzero.length?100*nonzero.reduce((s,r)=>s+Math.abs((r.pointForecast-r.actualValue)/r.actualValue),0)/nonzero.length:null,baselineSkill:null};
  };
  const selectedTraining=trainingDates(targetDate), preceding=dates.filter(date=>date<targetDate), latest=preceding.at(-1);
  const stale=Boolean(latest && gap(targetDate,latest)>7);
  const ready=predictable(targetDate), rows=ready?predict(targetDate):[];
  const comparableDates=dates.filter(date=>date<=targetDate && predictable(date));
  const history=comparableDates.slice(-30).map(date=>({date,...metricsFor(predict(date))}));
  const kind=targetDate<=now.slice(0,10)?'historical_backtest':'current_estimate';
  const selectedFacts=[...selectedTraining,targetDate].flatMap(date=>[...(byDate.get(date)?.values() || [])]);
  return {
    status:ready?'ready':stale?'stale_history':'insufficient_history',kind,targetDate,generatedAt:now,
    modelId:'user_load_same_slot_median_28',modelVersion:'1.0.0',unit:'MW',rows,metrics:metricsFor(rows),history,
    sampleDays:selectedTraining.length,trainingStartDate:selectedTraining[0]||null,trainingEndDate:selectedTraining.at(-1)||null,
    latestComparableDate:comparableDates.at(-1)||null,
    coverage:{dateCount:dates.length,earliestDate:dates[0]||null,latestDate:dates.at(-1)||null,dates},
    sources:[...new Set(selectedFacts.map(fact=>fact.sourceId))],
    allSources:[...new Set(dates.flatMap(date=>[...byDate.get(date).values()].map(fact=>fact.sourceId)))],
    dataCutoff:selectedFacts.map(fact=>fact.availableAt).sort().at(-1)||null,
    formula:'用户负荷(t) = median(目标日前42天内最近28个完整日的同点实际MW)',
    caveat:[kind==='historical_backtest'?'真实历史数据的事后回测，不是当时发布的预测；输入仅使用目标日之前的业务日期。':'当前计算结果尚未发布为正式预测。', 'MW = 15分钟电量(kWh) / 1000 / 0.25；未拟合气象因素，不代表全省系统负荷。',stale?'最近完整负荷距目标日超过7天，禁止用陈旧数据生成当前预测。':!ready?'近42天不足5个完整历史日，暂不生成预测。':''].filter(Boolean).join(' '),
  };
}
