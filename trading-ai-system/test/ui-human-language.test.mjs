import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDataSourcesView } from '../ui/views/data-sources-view.js';
import { renderHistoryContent } from '../ui/components/foundation-history-content.js';
import { renderFoundationEvidenceDrawer, renderFoundationProvenance } from '../ui/components/foundation-explanation.js';
import {renderSvgTimeseries} from '../ui/components/svg-timeseries.js';
import {renderPriceForecastView} from '../ui/views/price-forecast-view.js';
import {renderHistoryReviewView} from '../ui/views/history-review-view.js';
import {renderModelGovernanceView} from '../ui/views/model-governance-view.js';
import {renderMarketCockpitView} from '../ui/views/market-cockpit-view.js';
import {renderDeclarationStrategyView} from '../ui/views/declaration-strategy-view.js';

const text = html => html.replace(/<[^>]*>/g, ' ');
const internal = /数据血缘|SQLite|SHA-256|[A-Z]:\\|actualAverageLoadMw|rolling_same_slot_median_28|JSPEC-LOAD|[a-f0-9]{64}/;

test('a verified supplemental worker takes precedence over old paused job messages',()=>{
  const html=renderDataSourcesView({mode:'real',targetDate:'2026-02-03',foundationInput:{collectorStatus:{
    supplemental:{phase:'collecting',source:'日前电价',currentDate:'2026-06-10',collectedDays:23},
    jobs:[{state:'paused',lastErrorCode:'collection_failed'}],browser:{state:'stopped'},
  }}});
  assert.match(html,/正在补充历史电价/);
  assert.match(html,/2026-06-10/);
  assert.doesNotMatch(html,/数据连接暂时中断/);
});

test('home keeps maintenance visible but puts collection controls behind an initially closed disclosure', () => {
  const html = renderDataSourcesView({mode:'real', targetDate:'2026-09-04', foundationInput:{collectorStatus:{state:'error',lastErrorCode:'service_unavailable',jobs:[{id:'private-job',state:'paused',lastErrorCode:'service_unavailable',currentSourceId:'JSPEC-LOAD',currentDate:'2024-01-01',dayProgress:{total:2931,processed:31,accepted:0,noData:31}}]}}});
  assert.match(html, /<details[^>]*data-collection-details[^>]*>/);
  assert.doesNotMatch(html.match(/<details[^>]*data-collection-details[^>]*>/)?.[0] || '', /\bopen\b/);
  assert.match(text(html), /维护/);
  assert.doesNotMatch(text(html), internal);
  assert.match(html, /data-foundation-action="resume-backfill"/);
});

test('history translates fields and sources without losing values, time slots, or source report names', () => {
  const html = renderHistoryContent({mode:'detail',rows:[{businessDate:'2026-02-28',pointIndex:96,fieldId:'actualAverageLoadMw',value:39.348,unit:'MW',sourceId:'LOCAL-LOAD:E:\\private\\核对单.xlsx',availableAt:'2026-09-04T08:00:00Z',sourceRevision:'a'.repeat(64)}]});
  assert.match(text(html), /实际用电功率/);
  assert.match(text(html), /39\.348/);
  assert.match(text(html), /24:00/);
  assert.match(text(html), /核对单.xlsx/);
  assert.match(text(html), /16:00/);
  assert.doesNotMatch(text(html), internal);
});

test('newly recovered settlement data have business labels and are not presented as current positions', () => {
  const html = renderHistoryContent({mode:'detail',rows:[{businessDate:'2026-01-01',pointIndex:1,fieldId:'settledLongTermEnergyMwh',value:6.991,unit:'MWh',sourceId:'SETTLEMENT-XLSX'}]});
  assert.match(text(html), /历史中长期合约结算电量/);
  assert.match(text(html), /结算核对单/);
  assert.doesNotMatch(text(html), /来源名称待确认|其他数据|当前持仓|SETTLEMENT-XLSX|settledLongTermEnergyMwh/);
  const home = renderDataSourcesView({mode:'real',targetDate:'2026-01-01'});
  assert.match(home, /value="realTimeSettlementPriceYuanPerMwh"/);
  assert.match(home, /value="settledLongTermEnergyMwh"/);
  assert.match(home, /value="SETTLEMENT-XLSX"/);
});

test('source drawer explains data origin without exposing local storage or claiming all sources are ready', () => {
  const html = renderFoundationProvenance(true,{current:{storagePath:'E:\\private\\snapshot.json'},history:{storagePath:'E:\\private\\history.json'},lastPageTitle:'demo',range:{dateCount:220,earliestDate:'2025-06-01',latestDate:'2026-09-02'}});
  assert.match(text(html), /数据来源/);
  assert.match(text(html), /交易平台/);
  assert.match(text(html), /历史/);
  assert.doesNotMatch(text(html), /demo|snapshot\.json|history\.json|全部.*就绪/);
  assert.doesNotMatch(text(html), internal);
});

test('explanation reports missing stage inputs in business terms instead of displaying record identifiers', () => {
  const html = renderFoundationEvidenceDrawer({id:'risk',title:'依据说明 · 风险约束',principle:'检查申报是否超过限额',formula:'x_t <= maxPowerMw'}, {stageEvidence:{stageStatus:['risk:blocked'],inputRefs:['private-fact-id'],modelVersions:['rolling_same_slot_median_28'],warnings:['actualAverageLoadMw'],conclusionIds:[],forecastRunIds:[],constraintRefs:[]}});
  assert.match(text(html), /实际用电功率/);
  assert.match(text(html), /未|缺|不足/);
  assert.doesNotMatch(text(html), /private-fact-id|maxPowerMw|x_t|risk:blocked/);
  assert.doesNotMatch(text(html), internal);
});

test('another historical date cannot appear as the selected date primary comparison', () => {
  const html = renderDataSourcesView({mode:'real',targetDate:'2026-09-04',foundationInput:{reviewPreview:{status:'ready',kind:'historical_backtest',targetDate:'2026-02-28',rows:[{pointIndex:1,pointForecast:37.16,actualValue:39.348}],metrics:{mae:5.37,mape:7.93}}}});
  assert.doesNotMatch(html, /data-result-preview/);
  assert.doesNotMatch(text(html), /2026-02-28/);
  assert.match(text(html), /2026-09-04/);
});

test('curves show readable times and scale without plotting a missing value as zero',()=>{
  const html=renderSvgTimeseries({unit:'MW',series:[{label:'actualAverageLoadMw',points:[{pointIndex:1,value:40},{pointIndex:2,value:null},{pointIndex:96,value:50}]}]});
  assert.match(text(html),/06:00/);
  assert.match(text(html),/24:00/);
  assert.doesNotMatch(text(html),/actualAverageLoadMw|null/);
  assert.match(text(html),/实际用电功率/);
  assert.equal((html.match(/<tbody>(.*?)<\/tbody>/s)?.[1].match(/<tr>/g)||[]).length,2);
});

test('secondary forecast and review pages do not leak model roles and have no pretend review buttons',()=>{
  const price=renderPriceForecastView({forecastRuns:{runs:[{modelId:'rolling_same_slot_median_28',targetTradingDate:'2026-09-04',rows:[{pointIndex:1,p50:300}]}]}});
  assert.doesNotMatch(text(price),/baseline|champion|challenger|rolling_same_slot_median_28|特征快照 ID/);
  const history=renderHistoryReviewView({});
  assert.doesNotMatch(text(history),/live-issued|point-in-time-replay|pinball loss|Brier/);
  assert.doesNotMatch(renderModelGovernanceView({}),/>记录人工评审决定<\/button>/);
});

test('source explanation distinguishes energy units instead of applying a thousand-fold wrong conversion',()=>{
  const html=renderHistoryContent({mode:'evidence',captures:[{businessDate:'2026-02-28',accepted:true,evidence:{conversion:'MW = MWh / 0.25'}}]});
  assert.match(text(html),/兆瓦时.*0\.25/);
  assert.doesNotMatch(text(html),/÷ 250/);
});

test('market and strategy gaps expose business needs rather than internal codes and objects',()=>{
  const market=renderMarketCockpitView({marketCockpit:{gaps:[{fieldId:'actualAverageLoadMw',reason:'source_not_confirmed'}]}});
  assert.doesNotMatch(text(market),/actualAverageLoadMw|source_not_confirmed/);
  assert.match(text(market),/实际用电功率/);
  const strategy=renderDeclarationStrategyView({strategyReport:{recommendation:{declarationPowerBounds:{minMw:1,maxMw:10},priceVersions:['rolling_same_slot_median_28']},trace:{stages:[{id:'load',status:'blocked',missingFields:['actualAverageLoadMw']}]}}});
  assert.doesNotMatch(text(strategy),/\[object Object\]|rolling_same_slot_median_28|actualAverageLoadMw|blocked/);
});
