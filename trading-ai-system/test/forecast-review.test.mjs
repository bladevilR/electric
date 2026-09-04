import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastReview, readForecastReview } from '../lib/forecast-review.mjs';

const PRICE='dayAheadUserPriceFinalYuanPerMwh';
const NOW='2026-09-04T10:00:00Z';
const fact=(date,value,pointIndex=1,fieldId=PRICE,unit='元/MWh',extra={})=>({businessDate:date,pointIndex,fieldId,unit,value,availableAt:NOW,...extra});
const curve=(date,value,field=PRICE,unit='元/MWh')=>Array.from({length:96},(_,i)=>fact(date,value,i+1,field,unit));
const review=(facts=[],options={})=>buildForecastReview({facts,month:'2026-02',targetDate:'2026-02-06',now:NOW,...options});

test('calendar covers leap and ordinary months with selected object identity',()=>{
  for(const [month,count] of [['2024-02',29],['2026-02',28],['2026-04',30],['2026-01',31]]) {
    const r=review([],{month,targetDate:`${month}-02`});
    assert.equal(r.days.length,count); assert.equal(r.selected,r.days[1]);
    assert.ok(r.days.every(d=>d.rows.length===96)); assert.equal(r.selected.rows[0].predicted,null);
  }
});
test('rejects malformed months, impossible dates, mismatches and invalid types',()=>{
  for(const options of [{month:'2026-13'},{month:'26-02'},{targetDate:'2026-02-30'},{targetDate:'2026-03-01'},{type:'wind'},{now:'bad'}]) assert.throws(()=>review([],options));
});
test('price works with sparse historical prices alone, never same-day or future actuals',()=>{
  const r=review([fact('2026-02-01',10),fact('2026-02-06',900),fact('2026-02-07',9999)]);
  assert.equal(r.selected.rows[0].predicted,10); assert.equal(r.selected.rows[95].predicted,10);
  assert.equal(r.selected.rows[0].actual,900); assert.equal(r.selected.sampleDays,1);
  assert.equal(r.selected.forecastKind,'historical_backtest'); assert.ok(r.selected.caveats.length);
  assert.equal(r.days[0].forecastCount,0); assert.equal(r.days[6].rows[0].predicted,455);
});
test('uses complete preceding rolling price days and realtime only when no day-ahead history',()=>{
  const r=review([...curve('2026-02-01',10),...curve('2026-02-02',30),fact('2026-02-03',999)]);
  assert.equal(r.selected.rows[0].predicted,20);
  const fallback=review([fact('2026-01-01',-5,1,'realTimeSettlementPriceYuanPerMwh')]);
  assert.equal(fallback.selected.rows[95].predicted,-5); assert.match(fallback.selected.methodLabel,/实时/);
  assert.equal(fallback.selected.actualCount,0);
});
test('recent partial prices do not hide stale complete-day training history',()=>{
  const oldHistory=[1,2,3,4,5].flatMap(n=>curve(`2026-01-0${n}`,n*10));
  const r=review([...oldHistory,fact('2026-09-03',999)],{month:'2026-09',targetDate:'2026-09-04'});
  assert.equal(r.selected.forecastCount,96); assert.equal(r.selected.forecastMean,30);
  assert.match(r.selected.caveats.join(' '),/陈旧/);
  const sparse=review([fact('2026-09-03',99)],{month:'2026-09',targetDate:'2026-09-04'});
  assert.equal(sparse.selected.forecastCount,96); assert.equal(sparse.selected.forecastMean,99);
  assert.doesNotMatch(sparse.selected.caveats.join(' '),/陈旧/);
});
test('deduplicates available revisions and excludes malformed values, units, points, dates',()=>{
  const r=review([fact('2026-02-01',10),fact('2026-02-01',20,1,PRICE,'元/MWh',{availableAt:'2026-09-04T09:00:00Z'}),
    fact('2026-02-01',99,1,PRICE,'元/MWh',{availableAt:'2026-09-05T00:00:00Z'}),fact('2026-02-06',null),fact('2026-02-06','',2),
    fact('2026-02-06',7,3,PRICE,'MW'),fact('2026-02-06',4,97),fact('2026-02-30',900),fact('2026-02-06',false,4)]);
  assert.equal(r.selected.rows[0].predicted,10); assert.equal(r.selected.actualCount,0);
});
test('matched metrics preserve zero and negative prices; monthly metrics pool slots',()=>{
  const r=review([fact('2026-02-01',-10),fact('2026-02-02',0),fact('2026-02-03',-20),fact('2026-02-03',-10,2)]);
  assert.equal(r.days[1].mape,null); assert.equal(r.days[1].bias,-10);
  // Day 3 slot 1 median is -5 (error 15); missing slot 2 uses day 2 mean 0 (error 10).
  assert.equal(r.days[2].mae,12.5); assert.equal(r.days[2].mape,87.5);
  assert.equal(r.summary.pairedCount,3); assert.equal(r.summary.mae,35/3); assert.equal(r.summary.bias,5);
});
const live=(date,extra={})=>({forecastRunType:'live_issued',targetField:PRICE,targetTradingDate:date,forecastGeneratedAt:'2026-02-05T15:59:59Z',decisionCutoffAt:'2026-02-05T15:00:00Z',featureSnapshotId:'immutable-fixture',rows:Array.from({length:96},(_,i)=>({pointIndex:i+1,p50:70})),...extra});
test('live forecast must match date and field, be complete and issued before Shanghai midnight',()=>{
  const facts=curve('2026-02-01',10);
  assert.equal(review(facts,{runs:[live('2026-02-06')]}).selected.forecastKind,'live_issued');
  assert.equal(review(facts,{runs:[live('2026-02-06')]}).selected.forecastMean,70);
  for(const run of [live('2026-02-07'),live('2026-02-06',{targetField:'other'}),live('2026-02-06',{forecastGeneratedAt:'2026-02-05T16:00:00Z'}),live('2026-02-06',{availableAt:'2027-01-01T00:00:00Z'}),live('2026-02-06',{rows:[{pointIndex:1,p50:70}]}),live('2026-02-06',{featureSnapshotId:''})]) {
    assert.equal(review(facts,{runs:[run]}).selected.forecastMean,10);
  }
});
test('weather uses archived forecast and reanalysis only on matching date and slots',()=>{
  const r=review([fact('2026-02-06',12,1,'temperatureForecastC','C'),fact('2026-02-06',10,1,'temperatureActualC','°C'),fact('2026-02-07',99,1,'temperatureForecastC','°C')],{type:'temperature'});
  assert.equal(r.selected.mae,2); assert.equal(r.selected.forecastKind,'weather_archive');
  assert.equal(r.days[4].forecastCount,0); assert.match(r.selected.caveats.join(' '),/再分析/);
});
test('user load requires five recent complete days and still shows partial actuals when blocked',()=>{
  const history=[1,2,3,4,5].flatMap(n=>curve(`2026-02-0${n}`,n*10,'actualAverageLoadMw','MW'));
  const r=review([...history,fact('2026-02-06',35,1,'actualLoadMw','MW')],{type:'load'});
  assert.equal(r.selected.forecastMean,30); assert.equal(r.selected.mae,5); assert.equal(r.selected.sampleDays,5);
  assert.equal(r.days[0].forecastCount,0); assert.equal(r.days[0].actualCount,96);
  const stale=review(history,{type:'load',month:'2026-09',targetDate:'2026-09-04'});
  assert.equal(stale.selected.forecastCount,0);
});
test('future classification uses Shanghai day and no synthetic weather predictions',()=>{
  const r=review([fact('2026-09-04',10)],{month:'2026-09',targetDate:'2026-09-06',now:'2026-09-04T17:00:00Z'});
  assert.equal(r.days[4].forecastKind,'historical_backtest'); assert.equal(r.selected.forecastKind,'current_estimate');
});
test('analysis describes peak error using settlement time, values, direction and sample count',()=>{
  const r=review([...curve('2026-02-01',10),fact('2026-02-06',25,96)]);
  const analysis=r.selected.analysis.join(' ');
  assert.match(analysis,/24:00/); assert.match(analysis,/预测10\.00/); assert.match(analysis,/实际25\.00/);
  assert.match(analysis,/偏低15\.00/); assert.match(analysis,/1个历史日/); assert.doesNotMatch(analysis,/第96/);
});
test('reader paginates filtered facts in one transaction and obtains coverage months',()=>{
  let transactions=0,inside=false;
  const facts=Array.from({length:10001},(_,i)=>fact('2026-02-01',i===10000?40:10,1,PRICE,'元/MWh',{availableAt:i===10000?NOW:'2026-09-04T09:00:00Z'}));
  const store={transaction(fn){transactions++;inside=true;try{return fn();}finally{inside=false;}},
    queryFacts(q){assert.ok(inside);assert.ok(q.fieldId);assert.equal(q.to,'2026-02-28');return q.fieldId===PRICE?facts.slice(q.offset,q.offset+q.limit):[];},
    queryForecastRuns(q){assert.ok(inside);assert.equal(q.from,'2026-02-01');assert.equal(q.to,'2026-02-28');return [];},
    getCoverage(q){assert.ok(inside);assert.equal(q.fieldId,PRICE);return {pointsByDate:{'2025-12-01':96,'2026-03-01':96}};}};
  const r=readForecastReview(store,{month:'2026-02',targetDate:'2026-02-06',now:NOW});
  assert.equal(r.selected.forecastMean,40);assert.equal(transactions,1);assert.deepEqual(r.availableMonths,['2025-12','2026-02','2026-03']);
});
