import { renderFieldCatalogTable } from '../components/field-catalog-table.js';
import { renderHistoryContent } from '../components/foundation-history-content.js';
import { renderAccuracyHistory, renderFoundationForecastChart, renderSandboxChart } from '../components/foundation-forecast-chart.js';
import { renderExplanationButton, renderFoundationEvidenceDrawer, renderFoundationProvenance, renderFoundationTooltip } from '../components/foundation-explanation.js';
import { applyFoundationSandbox, buildStrategyFoundationModel } from '../view-models/strategy-foundation-model.js';
import { escapeText as esc, sourceLabel, methodLabel, dateTime, reasonLabel, plainText, unitLabel, statusLabel, EXPLANATION_COPY } from '../presentation-language.js';
import {renderForecastReview} from '../components/forecast-review.js';

const numberText = (v, unit='') => v != null && v !== '' && Number.isFinite(Number(v)) ? `${Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2})}${unit}` : '待比较';
const action = (id, label, extra='') => `<button type="button" class="foundation-secondary-button" data-foundation-action="${id}" ${extra}>${esc(label)}</button>`;

export function renderCollectionTruthStrip(model) {
  const c = model.collection, b = c.backfill, days = b.dayProgress;
  if(c.supplemental) {
    const s=c.supplemental;
    const title=s.phase==='collecting'?'正在补充历史电价':s.nextAttemptAt?'等待平台恢复后继续':'补采进度已保存';
    const message=s.phase==='collecting'?'已有数据和预测可以照常查看，无需重复连接。':reasonLabel(s.reasonCode,'本轮查询已暂停，已有数据保留。');
    return `<section class="foundation-truth-strip foundation-collection-summary" aria-label="数据更新情况"><div class="foundation-update-message"><strong>${title}</strong><span>${message}</span></div><details data-collection-details><summary>查看更新情况</summary><div class="foundation-update-details"><p>本轮已补充 ${Number(s.collectedDays)||0} 天电价，当前查询日期：${esc(s.currentDate)}。</p><p>使用现有登录连接，逐日保存。不会提交交易。</p>${s.nextAttemptAt?`<p>平台等待期限：${dateTime(s.nextAttemptAt)}。</p>`:''}<small>正常运行时自动继续，更新状态会自动刷新。</small></div></details></section>`;
  }
  const error = b.lastErrorCode || c.collectorErrorCode || (['unavailable','error','running_with_error'].includes(c.collectorState) ? 'collection_failed' : null);
  const maintenance = error === 'service_unavailable';
  const title = maintenance ? '部分数据更新暂停' : b.state === 'running' ? '正在更新数据' : b.state === 'paused' ? '数据更新已暂停' : model.identity.environment === '演示环境' ? '当前为演示数据' : '数据更新';
  const message = maintenance ? reasonLabel(error) : c.statusPollError ? '暂时无法获取最新更新状态，已有数据仍可查看。' : b.state === 'completed' ? '本次查询已结束，能否使用请以各项数据的实际结果为准。' : b.state === 'running' ? '新取得的数据会保存在本机，你可以继续查看已有结果。' : error ? reasonLabel(error) : '已有结果可直接查看；需要新数据时再连接交易平台。';
  const jobAction = b.state === 'running' ? ['pause-backfill','暂停更新'] : b.state === 'paused' ? ['resume-backfill','继续更新'] : ['start-backfill','更新历史数据'];
  return `<section class="foundation-truth-strip foundation-collection-summary" aria-label="数据更新情况">
    <div class="foundation-update-message"><strong>${title}</strong><span>${esc(message)}</span></div>
    <details data-collection-details><summary>查看更新情况</summary><div class="foundation-update-details">
      <p>交易平台连接：${c.dedicatedChrome.connected ? '已连接' : '尚未连接'}；账号：${c.ukey.state === 'logged_in' ? '已登录' : c.ukey.state === 'login_expired' ? '登录已过期' : '需要登录'}。连接窗口用于读取你有权限查看的数据，不会提交交易。</p>
      ${b.currentDate ? `<p>正在查询：${esc(sourceLabel(b.currentSourceId))}，${esc(b.currentDate)}。</p>` : ''}
      ${days ? `<p>已检查 ${days.processed} 项日期查询，其中 ${days.accepted} 项取得数据，${days.noData} 项没有记录${days.unverified ? `，${days.unverified} 项待核实` : ''}。同一天会分别查询不同数据，这不是数据完整率。</p>` : ''}
      ${b.nextAttemptAt && b.state === 'running' ? `<p>预计重试时间：${dateTime(b.nextAttemptAt)}（北京时间）。</p>` : ''}
      <div class="foundation-strip-actions">${action('start-browser','连接交易平台')}${action(jobAction[0],jobAction[1],`data-job-id="${esc(b.id || '')}"`)}</div>
      <small class="foundation-collector-freshness" role="status">${c.statusPollError ? '状态更新失败，正在重连。' : '更新状态会自动刷新。'}</small>
    </div></details>
  </section>`;
}

export function renderAvailableReview(report, model = {identity:{targetDate:''}}) {
  if (report?.status !== 'ready' || report.kind !== 'historical_backtest' || !report.rows?.some(r => r.actualValue != null && r.pointForecast != null) || report.targetDate === model.identity.targetDate) return '';
  const tab = {id:'load',label:'用电预测与实际对比',unit:'MW',description:'事后回测：用该日期之前的历史数据重新计算，再与实际用电比较；不是当时发布的预测。',series:[
    {role:'actual',label:'实际用电',points:report.rows.filter(r=>r.actualValue!=null).map(r=>({pointIndex:r.pointIndex,value:r.actualValue}))},
    {role:'forecast',label:'历史重新预测',points:report.rows.filter(r=>r.pointForecast!=null).map(r=>({pointIndex:r.pointIndex,value:r.pointForecast}))},
  ]};
  return `<section class="foundation-section foundation-result-preview" data-result-preview>
    <header class="foundation-section-heading"><div><small>已有复盘结果</small><h2>${esc(report.targetDate)} · 用电预测与实际对比</h2><p>这是已有完整比对结果的历史日期，不是今日数据。</p></div>${action('open-load-backtest','展开这天的复盘',`data-date="${esc(report.targetDate)}"`)}</header>
    <div class="foundation-review-result"><div>${renderFoundationForecastChart(tab)}</div><aside><span>平均相差</span><strong>${numberText(report.metrics?.mae,' 兆瓦')}</strong><p>每个 15 分钟时段的预测与实际用电功率，平均相差多少。</p><span>平均误差比例</span><strong>${numberText(report.metrics?.mape,'%')}</strong><p>越低越好；实际接近零时需结合平均误差判断。</p></aside></div>
  </section>`;
}

function accuracySection(accuracy, tab, state) {
  const m = accuracy.metrics || {};
  const metrics = [['mae','平均误差',m.mae,unitLabel(tab.unit)],['rmse','大误差参考',m.rmse,unitLabel(tab.unit)],['mape','平均误差比例',m.mape,'%'],['baselineSkill','相比参考方法',m.baselineSkill,'%']];
  const available = metrics.filter(([, ,v])=>v!=null);
  return `<section class="foundation-section foundation-accuracy" aria-labelledby="foundationAccuracyTitle"><header class="foundation-section-heading"><div><h2 id="foundationAccuracyTitle">预测得准不准</h2><p>只比较同一天、同一时段的预测和实际结果。</p></div>${action('focus-versions','查看以往预测')}</header>
    ${available.length ? `<div class="foundation-metrics-grid">${available.map(([id,label,value,unit])=>`<div class="foundation-metric"><div><span>${label}</span>${renderExplanationButton(id,label,`metric-${id}`,state.openExplanation===id)}</div><strong>${numberText(value)} <small>${esc(unit)}</small></strong>${state.openExplanation===id ? renderFoundationTooltip({id,...EXPLANATION_COPY[id]}) : ''}</div>`).join('')}</div>` : '<p class="foundation-muted-note">所选日期暂时没有可比较的结果；可以在上方打开已有的历史复盘。</p>'}
    <details class="foundation-past-comparisons" id="foundationVersionPanel" tabindex="-1"><summary>以往预测与误差记录</summary>${renderAccuracyHistory(accuracy.history,tab.unit)}
      ${accuracy.versions?.length ? `<div class="local-scroll"><table><thead><tr><th>预测方法</th><th>生成时间</th><th>参考天数</th><th>平均误差</th><th>状态</th></tr></thead><tbody>${accuracy.versions.map(v=>`<tr><td>${esc(methodLabel(v.modelVersion || v.modelId))}</td><td>${dateTime(v.issuedAt||v.createdAt)}</td><td>${numberText(v.sampleDays||v.sampleCount)}</td><td>${numberText(v.mae)}</td><td>${statusLabel(v.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p>尚无同口径的多次预测记录。</p>'}
    ${state.foundationInput?.accuracyReport?.loadError?'<p role="alert">准确度记录暂时加载失败，请稍后重试。</p>':''}</details></section>`;
}

function historySection(model) {
  const h=model.historyExplorer,q=h.query || {};
  const options = (items,selected) => items.map(([value,label])=>`<option value="${esc(value)}"${value===(selected || '') ? ' selected':''}>${esc(label)}</option>`).join('');
  const sources=[...new Set(['JSPEC-DAYAHEAD-USER','JSPEC-LOAD','SETTLEMENT-XLSX','OPEN-METEO-PREVIOUS-RUNS:suzhou-center-v1',...(h.sourceIds || [])])];
  return `<section class="foundation-section foundation-history" aria-labelledby="foundationHistoryTitle"><header class="foundation-section-heading"><div><h2 id="foundationHistoryTitle">查询历史数据</h2><p>按日期查看电价、天气和用电记录，也可以核对原始报表来源。</p></div></header>
    <div class="foundation-history-filters"><label>开始日期<input type="date" value="${esc(q.from||q.businessDate||model.identity.targetDate)}" data-history-filter="from"></label><label>结束日期<input type="date" value="${esc(q.to||q.businessDate||model.identity.targetDate)}" data-history-filter="to"></label>
    <label>数据项目<select data-history-filter="field">${options([['','全部'],['dayAheadUserPriceFinalYuanPerMwh','日前电价'],['realTimeSettlementPriceYuanPerMwh','实时结算电价'],['temperatureForecastC','预报温度'],['temperatureActualC','实际温度'],['actualAverageLoadMw','实际用电功率'],['actualKwh','实际用电量'],['loadForecastMw','预测用电功率'],['settledLongTermEnergyMwh','历史合约结算电量'],['settledEnergyBlockMwh','历史能量块结算电量'],['settlementAmountYuan','历史结算电费']],q.fieldId)}</select></label>
    <label>数据来源<select data-history-filter="source">${options([['','全部'],...sources.map(id=>[id,sourceLabel(id)])],q.sourceId)}</select></label></div>
    <div class="foundation-history-modes" role="group" aria-label="历史数据查看形式">${[['chart','曲线'],['detail','明细'],['evidence','来源说明']].map(([id,label])=>`<button type="button" aria-pressed="${h.mode===id}" class="${h.mode===id?'is-active':''}" data-history-mode="${id}">${label}</button>`).join('')}</div>${renderHistoryContent(h)}</section>`;
}

function strategySection(model,state) {
  const stages = [['sources','数据从哪来'],['quality','检查能否使用'],['forecasts','预测价格和用电'],['fusion','分析购电需求'],['optimizer','比较申报方案'],['risk','检查业务限制'],['review','人工确认']];
  return `<section class="foundation-section foundation-derivation"><header class="foundation-section-heading"><div><h2>这些数据怎样形成策略</h2><p>先判断需要买多少电，再比较不同时段的成本，最后检查业务限制。</p></div></header>
    <ol class="foundation-derivation-chain">${stages.map(([id,label])=>`<li><button type="button" data-foundation-action="open-explanation" data-explanation-id="${id}" data-foundation-trigger="derivation-${id}" aria-controls="foundationEvidenceDrawer" aria-expanded="${state.openExplanation===id}">${label}<span>查看说明</span></button></li>`).join('')}</ol>
    <div class="foundation-strategy-summary"><p><strong>价格</strong>帮助比较成本；<strong>天气</strong>帮助理解用电变化；<strong>用电预测</strong>和已购电量决定需要补充多少。每项实际采用的数据和方法，以对应曲线的说明为准。</p><p>这张图说明计算思路，不代表今天已经形成可执行方案。历史用电复盘不能替代当前持仓和交易限额。</p></div>
  </section>`;
}

function sandboxSection(model,state) {
  const r=applyFoundationSandbox(model,state.sandboxControls || model.sandbox.defaults);
  return `<details class="foundation-section foundation-sandbox"><summary>调整策略试试看 · 不改变正式方案</summary><p>仅模拟，不会提交交易。数据和限制齐全时，才能计算调整前后的效果。</p>
    <div class="foundation-sandbox-controls"><div class="foundation-weight-controls">${[['priceWeight','价格因素','更关注低价时段'],['temperatureWeight','温度因素','更关注天气影响'],['loadWeight','用电需求','更关注预计缺口']].map(([id,label,hint])=>`<label><span>${label}</span><input type="range" min="0" max="1" step="0.05" value="${r.controls[id]}" data-sandbox-control="${id}"><output>重视程度 ${Math.round(r.controls[id]*100)}%</output><small>${hint}</small></label>`).join('')}</div>
    <fieldset class="foundation-risk-control"><legend>风险偏好</legend>${[['conservative','保守'],['balanced','均衡'],['active','积极']].map(([id,label])=>`<button type="button" data-risk-profile="${id}" aria-pressed="${r.controls.riskProfile===id}">${label}</button>`).join('')}</fieldset></div>
    ${renderSandboxChart(model.sandbox.formalRows,r.series)}<p>模拟测算 · 预计成本变化：${numberText(r.estimatedCostChangeYuan,' 元')}；转移电量：${numberText(r.peakValleyShiftMwh,' 兆瓦时')}。</p><footer>${action('reset-sandbox','恢复推荐参数')}${action('apply-simulation','应用到模拟方案')}</footer></details>`;
}

export function renderDataSourcesView(state={}) {
  const input={...(state.foundationInput||{}),mode:state.mode,targetDate:state.targetDate};
  for(const name of ['workbench','ukeyStatus','forecastReport','accuracyReport','forecastRuns','marketCockpit','strategyTrace','collectorStatus','historyFacts','historyCoverage']) input[name] ||= state[name] || (name==='workbench' ? state.payload : {}) || {};
  const model=buildStrategyFoundationModel(input), activeId=model.forecastTabs.some(t=>t.id===state.activeForecastTab)?state.activeForecastTab:'price';
  const tab=model.forecastTabs.find(t=>t.id===activeId), a=model.accuracy.byTab[activeId], e=model.forecast.evidenceByTab[activeId] || {};
  const hasCurve=tab.series.some(s=>s.points?.length), stage=model.derivation.evidenceByExplanation[state.openExplanation];
  const method=activeId==='temperature' ? '采用天气预报，按每 15 分钟一个时段对齐。' : activeId==='load' ? '参考过去相同时间段的用电规律，历史结果与实际用电逐段比较。' : /rolling_same_slot_median/.test(a.modelVersion || '') ? '参考过去同一时段的电价，选取中间价格作为预测；当前方法没有使用缺失的温度和用电数据。' : '当前采用的方法和使用数据需要与预测记录核对；不会把缺失的影响因素当成已使用。';
  return `<section class="cockpit-view foundation-workbench${state.openExplanation?' has-evidence-open':''}${state.provenanceOpen?' has-provenance-open':''}" data-view="data-sources" data-foundation-root>
    <header class="foundation-page-heading"><div><h1>电价预测与复盘</h1><p>每月看趋势，每天看误差。温度和用电作为价格预测的辅助依据。</p></div><div class="foundation-heading-controls"><label>查看日期<input type="date" value="${esc(state.reviewState?.selection?.date||model.identity.targetDate)}" data-foundation-date></label><span class="mode-identity">${model.identity.environment==='演示环境'?'演示数据':'真实数据'}</span>${action('open-provenance','数据来源','data-foundation-trigger="storage-location"')}</div></header>
    ${renderCollectionTruthStrip(model)}
    <div class="foundation-forecast-tabs" role="tablist" aria-label="选择预测类型">${model.forecastTabs.map(t=>`<button type="button" role="tab" id="foundationTab-${t.id}" data-forecast-tab="${t.id}" aria-selected="${t.id===activeId}" aria-controls="foundationForecastPanel" tabindex="${t.id===activeId?0:-1}">${esc(t.label)}</button>`).join('')}</div>
    ${state.reviewState ? renderForecastReview(state.reviewState.report,state.reviewState) : `<section class="foundation-section foundation-forecast" id="foundationForecastPanel" role="tabpanel" aria-labelledby="foundationTab-${activeId}">
      <header class="foundation-section-heading"><div><h2>${esc(model.identity.targetDate)} · ${esc(tab.label)}</h2><p>每 15 分钟一个时段 · 单位：${esc(unitLabel(tab.unit))}</p></div>${activeId==='load' && model.loadHistory.latestComparableDate && model.loadHistory.latestComparableDate!==model.identity.targetDate ? action('open-load-backtest','查看已有用电复盘',`data-date="${esc(model.loadHistory.latestComparableDate)}"`) : ''}</header>
      ${model.failures[activeId==='load'?'load':'forecast'] ? '<p role="alert">这份预测暂时加载失败，请稍后重试；不影响查看其他已有结果。</p>' : ''}
      <div class="foundation-forecast-layout">${renderFoundationForecastChart(tab)}<aside class="foundation-model-evidence" aria-label="预测方法说明"><h3>这条预测怎么来的</h3><p>${hasCurve ? method : '所选日期尚无可用预测，可以换一个有记录的日期查看。'}</p>
      ${e.caveat ? `<p class="foundation-method-caveat">${esc(plainText(e.caveat,'当前数据不足以支持更复杂的预测，结果仅供参考。'))}</p>`:''}
      <details><summary>查看来源与计算方法</summary><dl><div><dt>预测方法</dt><dd>${esc(methodLabel(a.modelVersion))}</dd></div><div><dt>参考历史</dt><dd>${numberText(a.sampleDays,' 天')}</dd></div><div><dt>使用数据截至</dt><dd>${dateTime(activeId==='load'?e.dataCutoff:model.identity.dataCutoff)}</dd></div>${e.trainingPeriod?`<div><dt>参考日期</dt><dd>${esc(plainText(e.trainingPeriod))}</dd></div>`:''}${e.sourceDetails?.length?`<div><dt>来源报表</dt><dd>${e.sourceDetails.map(s=>esc(sourceLabel(s))).join('；')}</dd></div>`:''}</dl></details>
      ${renderExplanationButton('forecasts','了解预测方法','model-choice',state.openExplanation==='forecasts')}</aside></div>
    </section>
    ${accuracySection(a,tab,state)}`}${historySection(model)}${strategySection(model,state)}${sandboxSection(model,state)}
    <details class="foundation-catalog"><summary>数据项目说明</summary>${renderFieldCatalogTable({fields:state.fieldCatalog?.fields||[]})}</details>
    ${renderFoundationProvenance(Boolean(state.provenanceOpen),model.collection)}
    ${renderFoundationEvidenceDrawer(state.openExplanation ? {id:state.openExplanation,...EXPLANATION_COPY[state.openExplanation]} : {},{stageEvidence:stage,dataCutoff:model.identity.dataCutoff,modelVersion:a.modelVersion})}
  </section>`;
}
