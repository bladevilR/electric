import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDataSourcesView} from '../ui/views/data-sources-view.js';
import {renderAccuracyHistory} from '../ui/components/foundation-forecast-chart.js';
const text = html=>html.replace(/<[^>]*>/g,' ');
const render=(overrides={})=>renderDataSourcesView({mode:'real',targetDate:'2026-09-03',activeForecastTab:'price',foundationInput:{workbench:{metrics:{marketPricePointCount:0},readiness:{status:'data_blocked'}},ukeyStatus:{collector:{state:'stopped'},visibleHistory:{dates:['2026-06-29'],rowCount:79}}},...overrides});

test('collection details distinguish attempted dates from dates with usable data',()=>{
  const html=render({foundationInput:{collectorStatus:{pollError:'连接中断',jobs:[{state:'running',dayProgress:{total:2931,processed:20,accepted:0,noData:20,unverified:0},currentSourceId:'JSPEC-DAYAHEAD-USER',currentDate:'2024-01-21',nextAttemptAt:'2026-09-04T08:01:00Z',lastErrorCode:'rate_limited'}]}}});
  for(const value of ['20 项日期查询','0 项取得数据','20 项没有记录','2024-01-21','16:01','状态更新失败','不是数据完整率']) assert.ok(text(html).includes(value),value);
  assert.match(html,/<details data-collection-details>/);
});

test('history chart and source modes render different views of the same record',()=>{
  const input={historyFacts:{rows:[{businessDate:'2026-02-28',pointIndex:1,fieldId:'actualAverageLoadMw',value:40,unit:'MW',sourceId:'LOCAL-LOAD:核对单.xlsx'}]}};
  const chart=render({foundationInput:{...input,historyMode:'chart'}});
  assert.match(chart,/历史曲线 · 2026-02-28/);assert.match(chart,/实际用电功率/);
  const source=render({foundationInput:{...input,historyMode:'evidence',historyCaptures:{captures:[{businessDate:'2026-02-28',sourceId:'LOCAL-LOAD:核对单.xlsx',contentSha256:'a'.repeat(64),evidence:{sourceFile:'核对单.xlsx',sourceSheet:'28',conversion:'MW = kWh / 1000 / 0.25'}}]}}});
  assert.match(source,/÷ 250/);assert.match(source,/核对单.xlsx/);assert.doesNotMatch(source,/foundation-history-table/);
});

test('load workbench retains every interval and labels retrospective prediction honestly',()=>{
  const html=render({targetDate:'2026-02-28',activeForecastTab:'load',foundationInput:{loadForecastReport:{kind:'historical_backtest',status:'ready',rows:[{pointIndex:1,pointForecast:42,actualValue:40}],metrics:{mae:2},sources:['LOCAL-LOAD:核对单.xlsx'],coverage:{dateCount:214,latestDate:'2026-05-05'},latestComparableDate:'2026-02-28',caveat:'事后回测，不是当时发布的预测'},historyFacts:{query:{fieldId:'actualAverageLoadMw'},rows:Array.from({length:96},(_,i)=>({businessDate:'2026-02-28',pointIndex:i+1,fieldId:'actualAverageLoadMw',value:40,unit:'MW',sourceId:'LOCAL-LOAD:核对单.xlsx'}))}}});
  assert.match(html,/事后回测/);assert.match(html,/value="actualAverageLoadMw" selected/);assert.match(html,/<td>24:00<\/td>/);assert.match(html,/核对单/);
});

test('tabs remain accessible while missing data is not turned into a zero curve or accuracy',()=>{
  const html=render();
  for(const label of ['价格预测','温度预测','负荷预测']) assert.match(html,new RegExp(label));
  assert.match(html,/role="tablist"/);assert.match(html,/data-forecast-tab="price"[^>]*aria-selected="true"/);
  assert.match(html,/所选日期还没有这项预测/);assert.match(html,/元\/兆瓦时/);
  assert.doesNotMatch(html,/数据已就绪|今日数据已闭环/);
  assert.equal((html.match(/<polyline/g)||[]).length,0);
  assert.doesNotMatch(html,/class="foundation-metric"/);
});

test('error explanation describes percentage calculation and its zero-value limitation',()=>{
  const html=render({openExplanation:'mape'});
  assert.match(html,/平均误差比例/);assert.match(html,/实际值为零或接近零/);
  assert.match(html,/id="foundationEvidenceDrawer"/);assert.match(html,/role="dialog"/);assert.match(html,/怎样计算或判断/);
});

test('strategy explanation describes costs, limitations and human review without variable names',()=>{
  const html=render({openExplanation:'optimizer'});
  assert.match(html,/申报建议怎样计算/);assert.match(html,/预计购电费用/);assert.match(html,/人工确认/);
  assert.doesNotMatch(text(html),/λ₁|featureSnapshot|constraintVersion|modelVersion/);
});

test('tuning stays simulation only and exposes no submit transaction control',()=>{
  const html=render();
  assert.match(html,/调整策略试试看/);assert.match(html,/仅模拟，不会提交交易/);assert.match(html,/应用到模拟方案/);
  assert.doesNotMatch(html,/自动提交|确认交易|立即下单/);
});

test('catalog explains supported but not yet collected data as unavailable, not ready',()=>{
  const html=render({fieldCatalog:{fields:[{fieldId:'temperatureC',confirmationStatus:'code_supported'}]}});
  assert.match(html,/数据项目说明/);assert.match(html,/尚未取得数据/);assert.match(html,/<td>温度<\/td>/);
  assert.doesNotMatch(text(html),/程序字段|页面原始表头|temperatureC/);
});

test('comparison preserves actual current and previous curve roles with dashed previous series',()=>{
  const html=render({foundationInput:{forecastReport:{forecasts:[{pointIndex:1,pointForecast:420}],actuals:[{pointIndex:1,value:405}],previousForecasts:[{pointIndex:1,value:438}]}}});
  for(const role of ['actual','forecast','previous']) assert.match(html,new RegExp(`data-series-role="${role}"`));
  assert.match(html,/data-series-role="previous"[^>]*stroke-dasharray/);assert.match(html,/data-foundation-action="focus-versions"/);
});

test('accuracy history uses date labels and stretches across the plot',()=>{
  const html=renderAccuracyHistory([{date:'2026-09-01',value:8.4},{date:'2026-09-02',value:7.1},{date:'2026-09-03',value:6.3}],'元/MWh');
  assert.match(html,/points="58\.00,/);assert.match(html,/934\.00,/);
  assert.match(html,/2026-09-01/);assert.match(html,/2026-09-03/);assert.doesNotMatch(html,/>06:00</);
});

test('each strategy step offers an explanation and announces expanded state',()=>{
  const html=render({openExplanation:'sources'});
  for(const id of ['sources','quality','forecasts','fusion','optimizer','risk','review']) assert.match(html,new RegExp(`data-explanation-id="${id}"`));
  assert.match(html,/data-foundation-trigger="derivation-sources"[^>]*aria-expanded="true"/);
});

test('collection and forecast request failures remain clear without showing raw service errors',()=>{
  const html=render({foundationInput:{ukeyStatus:{collector:{state:'running',lastError:'browserContext.newPage: context closed'}},forecastReport:{loadError:'预测模型接口 503'},accuracyReport:{loadError:'准确度接口 500'}}});
  assert.match(html,/数据连接暂时中断/);assert.match(html,/这份预测暂时加载失败/);assert.match(html,/准确度记录暂时加载失败/);
  assert.doesNotMatch(text(html),/browserContext|接口 503|接口 500/);
});

test('node-specific missing limitations are explained but raw record ids never leak',()=>{
  const html=render({openExplanation:'risk',foundationInput:{strategyTrace:{stages:[{id:'positionLimits',status:'degraded',conclusion:{conclusionId:'decision:risk',inputRefs:['fact:limit:1'],constraintRefs:['constraint-v7'],warnings:['limit_missing']}}]}}});
  assert.match(html,/交易限额尚未齐全/);assert.doesNotMatch(text(html),/decision:risk|fact:limit:1|constraint-v7|limit_missing/);
});

test('no trace references never becomes a confirmed business conclusion',()=>{
  const html=render({openExplanation:'sources',foundationInput:{strategyTrace:{stages:[{id:'evidence',status:'unavailable',conclusion:{inputRefs:[],warnings:['source_evidence_missing']}}]}}});
  assert.match(html,/尚未形成可采用的结论/);assert.match(html,/来源记录尚未齐全/);
});

test('issued price quantiles still render an uncertainty band under a plain-language label',()=>{
  const rows=Array.from({length:96},(_,i)=>({pointIndex:i+1,pointForecast:300+i,p10:280+i,p50:300+i,p90:325+i}));
  const html=render({foundationInput:{forecastRuns:{runs:[{forecastRunId:'live-1',forecastRunType:'live_issued',targetField:'dayAheadUserPriceFinalYuanPerMwh',modelVersion:'1.0.0',rows}]}}});
  assert.match(html,/data-series-role="interval"/);assert.match(html,/价格可能范围/);assert.doesNotMatch(text(html),/P10|P90/);
});
