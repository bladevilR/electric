import test from 'node:test';
import assert from 'node:assert/strict';
import {renderForecastReview} from '../ui/components/forecast-review.js';
import {createReviewController} from '../ui/review-controller.js';

function report(date='2026-02-01',type='price') {
  const days=Array.from({length:28},(_,i)=>({date:`2026-02-${String(i+1).padStart(2,'0')}`,forecastMean:300+i,actualMean:290+i,pairedCount:96,forecastCount:96,actualCount:96,mae:10,rmse:10,bias:10,mape:3,forecastKind:'historical_backtest',methodLabel:'历史电价基础预测',caveats:['历史重算，不是当时发布'],analysis:['预测平均偏高 10 元/兆瓦时。'],rows:Array.from({length:96},(_,p)=>({pointIndex:p+1,predicted:300+i,actual:290+i,difference:10,absoluteError:10}))}));
  return {month:'2026-02',targetDate:date,type,unit:'元/MWh',days,selected:days.find(d=>d.date===date),summary:{pairedDays:28,forecastDays:28,actualDays:28,mae:10,rmse:10,bias:10},availableMonths:['2026-01','2026-02']};
}
test('month chart, every clickable day and selected 96-point comparison are rendered without another-date preview',()=>{
  const html=renderForecastReview(report('2026-02-03'));
  assert.match(html,/data-review-month-chart/);
  assert.match(html,/预测电价/);assert.match(html,/实际电价/);
  assert.equal((html.match(/class="review-day-card/g)||[]).length,28);
  assert.match(html,/data-review-date="2026-02-03"[^>]*aria-pressed="true"/);
  assert.match(html,/2026-02-03 · 96 个时段/);
  assert.equal((html.match(/data-review-point="/g)||[]).length,96);
  assert.match(html,/预测 − 实际/);
  assert.match(html,/历史重算/);
  assert.ok(html.indexOf('历史重算')<html.indexOf('data-review-month-chart'));
  assert.doesNotMatch(html,/data-result-preview/);
});
test('missing points are not drawn at zero and error fields remain unavailable',()=>{
  const data=report();data.selected.rows[1]={pointIndex:2,predicted:null,actual:null,difference:null,absoluteError:null};
  const html=renderForecastReview(data);
  const second=html.match(/<tr data-review-point="2">([\s\S]*?)<\/tr>/)[1];
  assert.match(second,/暂无/);assert.doesNotMatch(second,/>0(?:\.00)?</);
  assert.match(html,/data-series-role="forecast"/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});
test('late results cannot replace the newest selected date or dimension',async()=>{
  const pending=[];const states=[];
  const controller=createReviewController({fetchReport:selection=>new Promise(resolve=>pending.push({selection,resolve})),onState:s=>states.push(s)});
  const a=controller.select({date:'2026-02-01',type:'price'});
  const b=controller.select({date:'2026-02-03',type:'load'});
  pending[1].resolve(report('2026-02-03','load'));await b;
  pending[0].resolve(report('2026-02-01','price'));await a;
  assert.equal(states.at(-1).selection.date,'2026-02-03');assert.equal(states.at(-1).report.type,'load');
  assert.equal(states.at(-1).report.selected.date,'2026-02-03');
});
test('loading a new date never retains the previous day detail',async()=>{
  let release;const states=[];let first=true;
  const controller=createReviewController({fetchReport:async s=>first?(first=false,report(s.date,s.type)):new Promise(resolve=>release=resolve),onState:s=>states.push(s)});
  await controller.select({date:'2026-02-01',type:'price'});
  const next=controller.select({date:'2026-02-03',type:'price'});
  assert.equal(states.at(-1).selection.date,'2026-02-03');
  assert.ok(!states.at(-1).report || states.at(-1).report.selected.date==='2026-02-03');
  release(report('2026-02-03'));await next;
});
test('a mismatched server date is rejected instead of relabelled',async()=>{
  let state;
  const controller=createReviewController({fetchReport:async()=>report('2026-02-01'),onState:s=>state=s});
  await controller.select({date:'2026-02-03',type:'price'});
  assert.ok(state.error);assert.equal(state.report,null);
});
