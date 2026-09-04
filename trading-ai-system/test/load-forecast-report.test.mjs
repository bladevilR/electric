import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLoadForecastReport} from '../lib/load-forecast-report.mjs';

test('load report rejects impossible dates and missing facts safely',()=>{
  assert.throws(()=>buildLoadForecastReport([], {targetDate:'2026-02-30'}), /target_date_invalid/);
  assert.equal(buildLoadForecastReport(undefined,{targetDate:'2026-02-28'}).status,'insufficient_history');
});
const facts=(date,value)=>Array.from({length:96},(_,i)=>({fieldId:'actualAverageLoadMw',businessDate:date,pointIndex:i+1,value,unit:'MW',availableAt:'2026-09-04T00:00:00Z',sourceId:'LOCAL-LOAD:source.xlsx'}));
const input=[...facts('2026-02-01',10),...facts('2026-02-02',20),...facts('2026-02-03',30),...facts('2026-02-04',40),...facts('2026-02-05',50),...facts('2026-02-06',35)];
test('load backtest trains on earlier days only and compares actual MW without claiming historical issuance',async()=>{
  const {buildLoadForecastReport}=await import('../lib/load-forecast-report.mjs');
  const report=buildLoadForecastReport(input,{targetDate:'2026-02-06',now:'2026-09-04T10:00:00Z'});
  assert.equal(report.status,'ready');assert.equal(report.kind,'historical_backtest');
  assert.equal(report.rows.length,96);assert.equal(report.rows[0].pointForecast,30);assert.equal(report.rows[0].actualValue,35);
  assert.equal(report.metrics.mae,5);assert.equal(report.metrics.rmse,5);
  assert.equal(report.trainingEndDate,'2026-02-05');assert.equal(report.sampleDays,5);
  assert.match(report.caveat,/事后回测/);
});
test('old load history cannot masquerade as a current forecast and incomplete curves are excluded',async()=>{
  const {buildLoadForecastReport}=await import('../lib/load-forecast-report.mjs');
  const report=buildLoadForecastReport([...input,...facts('2026-09-03',100).slice(0,95)],{targetDate:'2026-09-04',now:'2026-09-04T10:00:00Z'});
  assert.equal(report.status,'stale_history');assert.equal(report.rows.length,0);assert.equal(report.metrics.mae,null);
  assert.equal(report.latestComparableDate,'2026-02-06');
  assert.equal(report.coverage.dateCount,6);
});
