import { renderFieldCatalogTable } from '../components/field-catalog-table.js';
import { renderHistoryContent } from '../components/foundation-history-content.js';
import {
  renderAccuracyHistory,
  renderFoundationForecastChart,
  renderSandboxChart,
} from '../components/foundation-forecast-chart.js';
import {
  renderExplanationButton,
  renderFoundationEvidenceDrawer,
  renderFoundationProvenance,
  renderFoundationTooltip,
} from '../components/foundation-explanation.js';
import {
  applyFoundationSandbox,
  buildStrategyFoundationModel,
} from '../view-models/strategy-foundation-model.js';

const esc = (value) =>
  String(value ?? '—').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]
  );

const numberText = (value, suffix = '') =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? `${Number(value).toLocaleString('zh-CN')}${suffix}`
    : '—';

const evidenceTimeText = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(date)
    .replaceAll('/', '-');
};

const inlineAlert = (label, detail) =>
  detail
    ? `<div class="foundation-inline-alert" role="alert"><strong>${esc(label)}</strong><span>${esc(
        detail
      )}</span></div>`
    : '';

const metricCard = (id, label, value, suffix, explanation, openExplanation, activeTriggerKey) => `
  <div class="foundation-metric${openExplanation === id ? ' is-explained' : ''}">
    <div><span>${esc(label)}</span>${renderExplanationButton(
      id,
      label,
      `metric-${id}`,
      openExplanation === id && (!activeTriggerKey || activeTriggerKey === `metric-${id}`)
    )}</div>
    <strong>${numberText(value, suffix)}</strong>
    ${openExplanation === id ? renderFoundationTooltip(explanation) : ''}
  </div>
`;

export function renderCollectionTruthStrip(model) {
  const current = model.collection.current;
  const history = model.collection.history;
  const lastAttempt = evidenceTimeText(model.collection.lastSampleAt);
  const collector = {
    ready: ['采集器已就绪', '专用 Chrome 已识别业务页面', 'is-ready'],
    collecting: ['正在采集', '正在按断点逐日写入规范化事实', 'is-ready'],
    paused: ['采集已暂停', '检查点已保存，可从原位置继续', 'is-warning'],
    rate_limited: ['访问频率受限', '任务已退避，达到重试时点后继续', 'is-warning'],
    login_required: ['等待 UKey 登录', '请在专用 Chrome 中手工完成登录', 'is-warning'],
    login_expired: ['UKey 登录已过期', '请在专用 Chrome 中重新登录后继续', 'is-danger'],
    page_changed: ['未识别业务页面', '请在专用 Chrome 中打开 JSPEC 业务数据页面', 'is-warning'],
    running: ['采集器运行中', '约每 30 秒检查一次当前页', 'is-ready'],
    running_with_error: [
      '运行中，但最近采集失败',
      `${model.collection.collectorError || '采集失败'}${
        lastAttempt ? ` · 最近尝试：${lastAttempt}` : ''
      }`,
      'is-danger',
    ],
    error: [model.collection.collectorErrorCode === 'service_unavailable' ? '平台数据接口维护中' : '采集器异常', model.collection.collectorError || '请检查浏览器连接', 'is-danger'],
    unavailable: [
      '采集状态不可用',
      model.collection.collectorError || '状态接口暂时不可访问',
      'is-danger',
    ],
    simulation: ['演示数据源', '仅展示模拟输入，不连接真实 UKey', 'is-warning'],
    stopped: [
      '采集器已停止',
      model.collection.collectorError || '需要连接已登录的数据窗口',
      'is-danger',
    ],
  }[model.collection.collectorState] || [
    `采集器${model.collection.collectorState}`,
    model.collection.collectorError || '等待状态更新',
    'is-warning',
  ];
  const chromeConnected = model.collection.dedicatedChrome.connected;
  const ukeyLoggedIn = model.collection.ukey.state === 'logged_in';
  const range = model.collection.range;
  const backfill = model.collection.backfill;
  const days = backfill.dayProgress;
  const sourceLabel = {'JSPEC-DAYAHEAD-USER':'日前电价','JSPEC-LOAD':'用户负荷'}[backfill.currentSourceId]
    || (backfill.currentSourceId?.startsWith('OPEN-METEO') ? '温度预报与实况' : backfill.currentSourceId);
  const reason = {operator_paused:'已手动暂停',collector_restarted:'服务重启后已暂停，断点保留',service_unavailable:'平台接口维护，未跳过当前日期',
    login_expired:'登录已过期，请在专用 Chrome 登录后继续',login_required:'请在专用 Chrome 登录后继续',rate_limited:'平台限流',
    collection_stalled:'检查点未推进，已保护性暂停'}[backfill.lastErrorCode] || backfill.lastErrorMessage || backfill.lastErrorCode;
  const phase = backfill.state === 'completed' ? '查询已完成' : backfill.scheduler?.phase === 'draining' ? '暂停中，正在保存当前查询'
    : backfill.state === 'paused' ? (reason || '已暂停') : backfill.scheduler?.phase === 'waiting' ? '等待自动重试'
      : backfill.state === 'running' ? '正在逐日查询' : '尚未开始';
  const jobAction = backfill.state === 'running'
    ? { id: 'pause-backfill', label: '暂停回填' }
    : backfill.state === 'paused'
      ? { id: 'resume-backfill', label: '继续回填' }
      : { id: 'start-backfill', label: '开始全量回填' };
  const rangeText = range.earliestDate && range.latestDate
    ? `${range.earliestDate} 至 ${range.latestDate}`
    : '尚未形成历史覆盖';
  const browserActionAttribute = model.identity.environment === '演示环境'
    ? 'data-primary-action="collect_today_data"'
    : 'data-foundation-action="start-browser"';
  return `
    <section class="foundation-truth-strip" aria-label="专用浏览器、UKey 与历史回填状态">
      <div class="foundation-truth-item ${chromeConnected ? 'is-ready' : collector[2]}">
        <small>专用 Chrome</small>
        <strong>${chromeConnected ? '已连接' : '未连接'}</strong>
        <span>${esc(collector[0])} · ${esc(collector[1])}${lastAttempt ? ` · 最近尝试：${esc(lastAttempt)}` : ''}</span>
        <span class="foundation-legacy-truth">${esc(current.label)} · ${current.complete ? '今日数据已闭环' : '今日数据未闭环'} · ${esc(collector[0])}</span>
      </div>
      <div class="foundation-truth-item ${ukeyLoggedIn ? 'is-ready' : 'is-warning'}">
        <small>UKey</small>
        <strong>${ukeyLoggedIn ? '已登录' : model.collection.ukey.state === 'login_expired' ? '登录已过期' : '等待人工登录'}</strong>
        <span>登录只在专用窗口中完成，系统不读取口令或凭据</span>
      </div>
      <div class="foundation-truth-item ${range.dateCount ? 'is-ready' : 'is-warning'}">
        <small>历史覆盖</small>
        <strong>${esc(rangeText)}</strong>
        <span>${range.dateCount ? `${range.dateCount} 个业务日` : `${esc(history.label)} · ${history.coverage}/96点`}</span>
        <button type="button" class="foundation-storage-link" data-foundation-action="open-provenance" data-foundation-trigger="storage-location">${esc(model.collection.storageEngine || 'SQLite')} · 查看采集数据位置</button>
      </div>
      <div class="foundation-truth-item ${backfill.state === 'completed' ? 'is-ready' : 'is-warning'}">
        <small>回填进度</small>
        <strong>${numberText(backfill.progressPct, '%')}</strong>
        <span>${days ? `已查询 ${days.processed}/${days.total} 个来源日 · ${esc(phase)}` : backfill.totalChunks ? `${backfill.completedChunks}/${backfill.totalChunks} 个分片` : '尚未开始全量历史回填'}</span>
        ${days ? `<progress class="foundation-backfill-progress" value="${days.processed}" max="${days.total || 1}" aria-label="回填查询进度"></progress><span>成功取数 ${days.accepted} · 空数据 ${days.noData}${days.unverified ? ` · 待核实 ${days.unverified}` : ''}</span>` : ''}
        ${backfill.currentDate ? `<span>断点：${esc(sourceLabel)} · ${esc(backfill.currentDate)}</span>` : ''}
        ${backfill.nextAttemptAt && backfill.state === 'running' ? `<span>自动重试：${esc(evidenceTimeText(backfill.nextAttemptAt))}（北京时间）</span>` : ''}
        ${reason && backfill.state !== 'paused' ? `<span>${esc(reason)}</span>` : ''}
        <span>查询进度不是数据完整率；同一天的不同来源分别计数</span>
        <div class="foundation-strip-actions"><button type="button" class="foundation-secondary-button" ${browserActionAttribute}>打开专用 Chrome</button><button type="button" class="foundation-primary-button" data-foundation-action="${jobAction.id}" data-job-id="${esc(backfill.id || '')}">${jobAction.label}</button></div>
      </div>
      <p class="foundation-collector-freshness" role="status">${model.collection.statusPollError ? `状态更新失败，显示上次结果；正在重连 · ${esc(model.collection.statusPollError)}` : `状态自动更新${model.collection.statusObservedAt ? ` · 最近同步 ${esc(evidenceTimeText(model.collection.statusObservedAt))}` : ''}`}</p>
    </section>
  `;
}

function forecastTabs(model, activeId) {
  return `
    <div class="foundation-tabs" role="tablist" aria-label="预测类型">
      ${model.forecastTabs
        .map(
          (tab) => `<button type="button" role="tab" id="foundationTab-${tab.id}" data-forecast-tab="${
            tab.id
          }" aria-controls="foundationForecastPanel" aria-selected="${tab.id === activeId}">${esc(
            tab.label
          )}</button>`
        )
        .join('')}
    </div>
  `;
}

function accuracySection(
  accuracy,
  activeTab,
  openExplanation,
  explanations,
  activeTriggerKey,
  loadError
) {
  const metrics = accuracy.metrics;
  return `
    <section class="foundation-section foundation-accuracy" aria-labelledby="foundationAccuracyTitle">
      <header class="foundation-section-heading">
        <div><small>FORECAST AUDIT</small><h2 id="foundationAccuracyTitle">预测准确度回溯</h2></div>
        <div class="foundation-heading-actions"><button type="button" data-foundation-action="focus-versions">查看预测版本</button><button type="button" data-foundation-action="open-explanation" data-explanation-id="baselineSkill" data-foundation-trigger="accuracy-evidence" aria-controls="foundationEvidenceDrawer" aria-expanded="${
          openExplanation === 'baselineSkill' && activeTriggerKey === 'accuracy-evidence'
        }">查看回测证据</button></div>
      </header>
      ${inlineAlert('准确度回溯加载失败', loadError)}
      <div class="foundation-metrics-grid">
        ${metricCard('mae', 'MAE', metrics.mae, activeTab.unit, explanations.mae, openExplanation, activeTriggerKey)}
        ${metricCard('rmse', 'RMSE', metrics.rmse, activeTab.unit, explanations.rmse, openExplanation, activeTriggerKey)}
        ${metricCard('mape', 'MAPE', metrics.mape, '%', explanations.mape, openExplanation, activeTriggerKey)}
        ${metricCard(
          'baselineSkill',
          '相对基线改善',
          metrics.baselineSkill,
          '%',
          explanations.baselineSkill,
          openExplanation,
          activeTriggerKey
        )}
      </div>
      <div class="foundation-accuracy-grid">
        <div>${renderAccuracyHistory(accuracy.history, activeTab.unit)}</div>
        <div class="foundation-version-panel" id="foundationVersionPanel" tabindex="-1">
          <h3>版本对比（${esc(activeTab.label)}）</h3>
          ${
            accuracy.versions.length
              ? `<div class="local-scroll"><table><thead><tr><th>模型版本</th><th>发布时间</th><th>样本量</th><th>MAE</th><th>相对基线</th><th>状态</th></tr></thead><tbody>${accuracy.versions
                  .map(
                    (version) =>
                      `<tr><td>${esc(version.modelVersion || version.id)}</td><td>${esc(
                        version.issuedAt || version.createdAt
                      )}</td><td>${numberText(version.sampleDays || version.sampleCount)}</td><td>${numberText(
                        version.mae
                      )}</td><td>${numberText(version.baselineSkill, '%')}</td><td>${esc(
                        version.status || '待核验'
                      )}</td></tr>`
                  )
                  .join('')}</tbody></table></div>`
              : `<div class="foundation-version-empty" role="status"><strong>尚无可比较的预测版本</strong><p>版本必须包含发布时间、样本覆盖和同口径回测结果。</p></div>`
          }
        </div>
      </div>
    </section>
  `;
}

function sandboxSection(model, controls, openExplanation, activeTriggerKey) {
  const result = applyFoundationSandbox(model, controls);
  const controlRows = [
    ['priceWeight', '价格信号', result.controls.priceWeight, '提高后更偏向低价窗口'],
    ['temperatureWeight', '温度影响', result.controls.temperatureWeight, '提高后更关注气象驱动负荷'],
    ['loadWeight', '负荷缺口', result.controls.loadWeight, '提高后更关注预测负荷缺口'],
  ];
  return `
    <section class="foundation-section foundation-sandbox" aria-labelledby="foundationSandboxTitle">
      <header class="foundation-section-heading">
        <div><small>SENSITIVITY SANDBOX</small><h2 id="foundationSandboxTitle">策略微调沙盒 · 演示</h2><p><strong>仅演示，不修改正式策略</strong>；仅模拟，不会提交交易，也不会写入预测账本。</p></div>
        <span class="foundation-simulation-label">模拟测算</span>
      </header>
      <div class="foundation-sandbox-controls">
        <div class="foundation-weight-controls">
          ${controlRows
            .map(
              ([id, label, value, effect]) => `<label><span><strong>${label}</strong>${renderExplanationButton(
                id === 'priceWeight' ? 'optimizer' : id === 'loadWeight' ? 'risk' : 'baselineSkill',
                label,
                `sandbox-${id}`,
                activeTriggerKey === `sandbox-${id}`
              )}</span><input type="range" min="0" max="1" step="0.05" value="${value}" data-sandbox-control="${id}"><output>${value.toFixed(
                2
              )}</output><small>${effect}</small></label>`
            )
            .join('')}
        </div>
        <fieldset class="foundation-risk-control"><legend>风险偏好</legend>${[
          ['conservative', '保守'],
          ['balanced', '均衡'],
          ['active', '积极'],
        ]
          .map(
            ([id, label]) =>
              `<button type="button" data-risk-profile="${id}" aria-pressed="${
                result.controls.riskProfile === id
              }">${label}</button>`
          )
          .join('')}</fieldset>
      </div>
      <div class="foundation-sandbox-chart">${renderSandboxChart(
        model.sandbox.formalRows,
        result.series
      )}</div>
      <div class="foundation-impact-grid">
        <article><small>预计成本变化</small><strong>${
          result.estimatedCostChangeYuan === null
            ? '证据不足'
            : numberText(result.estimatedCostChangeYuan, ' 元')
        }</strong><span>模拟测算</span></article>
        <article><small>峰谷转移</small><strong>${
          result.peakValleyShiftMwh === null
            ? '证据不足'
            : numberText(result.peakValleyShiftMwh, ' MWh')
        }</strong><span>需要峰谷分类与约束证据</span></article>
        <article><small>风险暴露</small><strong>${
          result.riskExposureChangePct === null
            ? '证据不足'
            : numberText(result.riskExposureChangePct, '%')
        }</strong><span>需要风险模型与限额证据</span></article>
      </div>
      <footer><button type="button" class="foundation-secondary-button" data-foundation-action="reset-sandbox">恢复推荐参数</button><button type="button" class="foundation-primary-button" data-foundation-action="apply-simulation">应用到模拟方案</button></footer>
    </section>
  `;
}

function historySection(model) {
  const query = model.historyExplorer.query || {};
  const options = (items, selected) => items.map(([value,label]) => `<option value="${esc(value)}"${value === (selected || '') ? ' selected' : ''}>${esc(label)}</option>`).join('');
  return `
    <section class="foundation-section foundation-history" aria-labelledby="foundationHistoryTitle">
      <header class="foundation-section-heading">
        <div><small>CANONICAL HISTORY</small><h2 id="foundationHistoryTitle">基础数据历史</h2><p>查询规范化事实、版本和采集证据；数据保存在 ${esc(model.collection.storageEngine || 'SQLite')}。</p></div>
        <span class="foundation-storage-badge">${esc(model.collection.storageEngine || '尚未初始化')}</span>
      </header>
      <div class="foundation-history-filters">
        <label>开始日期<input type="date" value="${esc(query.from || query.businessDate || model.identity.targetDate || '')}" data-history-filter="from"></label>
        <label>结束日期<input type="date" value="${esc(query.to || query.businessDate || model.identity.targetDate || '')}" data-history-filter="to"></label>
        <label>数据字段<select data-history-filter="field">${options([['','全部'],['dayAheadUserPriceFinalYuanPerMwh','价格'],['temperatureForecastC','温度预报'],['actualAverageLoadMw','用户实际负荷 MW'],['actualKwh','用户实际电量 kWh'],['loadForecastMw','负荷预测']],query.fieldId)}</select></label>
        <label>数据来源<select data-history-filter="source">${options([['','全部'],...[...new Set(['JSPEC-DAYAHEAD-USER','JSPEC-LOAD','OPEN-METEO-PREVIOUS-RUNS:suzhou-center-v1',...(model.historyExplorer.sourceIds || [])])].map(id=>[id,id.startsWith('OPEN-METEO-') ? `Open-Meteo · ${id.includes('ARCHIVE') ? '历史天气' : '温度预报'}` : id.startsWith('LOCAL-LOAD:') ? id.slice(11) : id])],query.sourceId)}</select></label>
      </div>
      <div class="foundation-history-modes" role="group" aria-label="历史数据查看形式">
        ${[['chart','曲线'],['detail','明细'],['evidence','采集证据']].map(([id,label])=>`<button type="button" class="${model.historyExplorer.mode === id ? 'is-active' : ''}" aria-pressed="${model.historyExplorer.mode === id}" data-history-mode="${id}">${label}</button>`).join('')}
      </div>
      ${renderHistoryContent(model.historyExplorer)}
    </section>
  `;
}

function derivationSection(model, openExplanation, activeTriggerKey) {
  return `
    <section class="foundation-section foundation-derivation" aria-labelledby="foundationDerivationTitle">
      <header class="foundation-section-heading"><div><small>STRATEGY EVIDENCE</small><h2 id="foundationDerivationTitle">策略形成 · 整体策略依据</h2><p>从原始数据到人工复核，每一步都保留来源、版本与时点。</p></div></header>
      <ol class="foundation-derivation-chain">${model.derivation.stages
        .map(
          (stage) =>
            `<li><button type="button" data-foundation-action="open-explanation" data-explanation-id="${stage.explanationId}" data-foundation-trigger="derivation-${stage.id}" aria-controls="foundationEvidenceDrawer" aria-expanded="${
              openExplanation === stage.explanationId &&
              (!activeTriggerKey || activeTriggerKey === `derivation-${stage.id}`)
            }">${esc(stage.label)}<span>查看依据</span></button></li>`
        )
        .join('')}</ol>
      <div class="foundation-evidence-groups">
        <article><h3>1. 依据：关键信号与影响</h3><ul><li>价格：识别低价与高价风险窗口</li><li>温度：解释气象驱动的负荷变化</li><li>负荷：定位预测需求与已有头寸的缺口</li><li>风险：在业务限额内形成候选</li></ul></article>
        <article><h3>2. 来源：数据与事实</h3><ul><li>JSPEC 可见页面与平台导出</li><li>有发布时间的气象预报</li><li>历史实际负荷和预测版本</li><li>持仓、可买卖量与申报边界</li></ul></article>
        <article><h3>3. 算法：方法与规则</h3><ul><li>强季节基线与滚动中位数</li><li>温度、湿度等气象修正</li><li>负荷预测与特征融合</li><li>带业务约束的申报优化</li></ul></article>
        <article><h3>4. 可追溯证据</h3><ul><li>源时间戳与事实 ID</li><li>预测模型和特征快照版本</li><li>约束版本与回退原因</li><li>操作人、复核人与审批记录</li></ul></article>
      </div>
      <div class="foundation-why-chain"><h3>为什么得到这个策略？</h3><div><span>低价窗口</span><b>+</b><span>温度驱动负荷上升</span><b>+</b><span>预测负荷缺口</span><b>+</b><span>交易与风险约束</span><b>→</b><strong>申报调整建议</strong></div><button type="button" data-foundation-action="open-explanation" data-explanation-id="optimizer" data-foundation-trigger="why-optimizer" aria-controls="foundationEvidenceDrawer" aria-expanded="${
        openExplanation === 'optimizer' && activeTriggerKey === 'why-optimizer'
      }">查看公式与完整推导</button></div>
    </section>
  `;
}

export function renderDataSourcesView(state = {}) {
  const input = {
    ...(state.foundationInput || {}),
    mode: state.mode,
    targetDate: state.targetDate,
    workbench: state.foundationInput?.workbench || state.workbench || state.payload || {},
    ukeyStatus: state.foundationInput?.ukeyStatus || state.ukeyStatus || {},
    forecastReport: state.foundationInput?.forecastReport || state.forecastReport || {},
    accuracyReport: state.foundationInput?.accuracyReport || state.accuracyReport || {},
    forecastRuns: state.foundationInput?.forecastRuns || state.forecastRuns || {},
    marketCockpit: state.foundationInput?.marketCockpit || state.marketCockpit || {},
    strategyTrace: state.foundationInput?.strategyTrace || state.strategyTrace || {},
    collectorStatus: state.foundationInput?.collectorStatus || state.collectorStatus || {},
    historyFacts: state.foundationInput?.historyFacts || state.historyFacts || {},
    historyCoverage: state.foundationInput?.historyCoverage || state.historyCoverage || {},
  };
  const model = buildStrategyFoundationModel(input);
  const activeId = model.forecastTabs.some((tab) => tab.id === state.activeForecastTab)
    ? state.activeForecastTab
    : 'price';
  const activeTab = model.forecastTabs.find((tab) => tab.id === activeId);
  const activeAccuracy = model.accuracy.byTab?.[activeId] || model.accuracy;
  const activeForecastEvidence = model.forecast.evidenceByTab?.[activeId] || {};
  const explanation = model.explanations[state.openExplanation] || null;
  const activeTriggerKey =
    String(state.returnFocusSelector || '').match(/data-foundation-trigger="([^"]+)"/)?.[1] || '';
  const catalogModel = { fields: state.fieldCatalog?.fields || [] };
  const activeStageEvidence = model.derivation.evidenceByExplanation[state.openExplanation];
  const hasActiveStageReferences = Boolean(
    activeStageEvidence &&
      [
        activeStageEvidence.conclusionIds,
        activeStageEvidence.inputRefs,
        activeStageEvidence.featureSnapshotIds,
        activeStageEvidence.forecastRunIds,
        activeStageEvidence.modelVersions,
        activeStageEvidence.constraintRefs,
      ].some((values) => Array.isArray(values) && values.length)
  );
  return `
    <section class="cockpit-view foundation-workbench${state.openExplanation ? ' has-evidence-open' : ''}${
      state.provenanceOpen ? ' has-provenance-open' : ''
    }" data-view="data-sources" data-foundation-root>
      <header class="foundation-page-heading">
        <div><small>FOUNDATION &amp; FORECAST EVIDENCE</small><h1>基础数据与预测依据</h1><p>价格、温度与负荷共同影响 96 点申报策略；每条预测均可追溯来源、版本与准确度。</p></div>
        <div class="foundation-heading-controls"><label>交易日<input type="date" value="${esc(model.identity.targetDate || '')}" data-foundation-date></label><button type="button" class="foundation-primary-button" data-foundation-action="start-backfill">开始全量回填</button><span class="mode-identity">${esc(model.identity.environment)}</span></div>
      </header>
      ${renderCollectionTruthStrip(model)}
      ${forecastTabs(model, activeId)}
      ${activeId === 'load' ? `<section class="foundation-section"><strong>真实用户负荷历史：${Number(model.loadHistory.dateCount || 0)} 天</strong><p>最近有数据日：${esc(model.loadHistory.latestDate || '暂无')}。历史记录不代表当前交易日已采集。</p>${model.loadHistory.latestComparableDate ? `<button class="foundation-secondary-button" type="button" data-foundation-action="open-load-backtest" data-date="${esc(model.loadHistory.latestComparableDate)}">查看最近可回测日 ${esc(model.loadHistory.latestComparableDate)}</button>` : ''}${model.loadHistory.latestDate ? `<button class="foundation-secondary-button" type="button" data-foundation-action="open-load-backtest" data-date="${esc(model.loadHistory.latestDate)}">查看最近实际负荷 ${esc(model.loadHistory.latestDate)}</button>` : ''}</section>` : ''}
      <section class="foundation-section foundation-forecast" id="foundationForecastPanel" role="tabpanel" aria-labelledby="foundationTab-${activeId}">
        ${inlineAlert(
          '预测证据加载失败',
          (activeId === 'load' ? [model.failures.load] : [model.failures.forecast, model.failures.versions]).filter(Boolean).join('；')
        )}
        <div class="foundation-forecast-layout">
          ${renderFoundationForecastChart(activeTab)}
          <aside class="foundation-model-evidence" aria-label="${esc(activeTab.label)}预测依据">
            <header><div><small>MODEL EVIDENCE</small><h2>预测依据（${esc(
              activeTab.label
            )}）</h2></div></header>
            <dl>
              <div><dt>数据来源</dt><dd>${esc(activeForecastEvidence.source || (activeId === 'temperature' ? `${model.collection.weather.provider || '天气预报源'} · ${numberText(model.collection.weather.forecastLeadHours, 'h 提前量')}` : activeId === 'load' ? 'JSPEC 负荷预测' : `JSPEC 历史价格 + ${model.collection.weather.provider || '天气预报源'} 温度预报 + JSPEC 负荷预测`))}</dd></div>
              <div><dt>核心公式</dt><dd>${esc(activeForecastEvidence.formula || (activeId === 'price' ? '价格 = 同点基线 + 温度贡献 + 负荷贡献' : activeId === 'temperature' ? '小时预报 → 15分钟线性对齐' : '同点历史 + 日历与气象特征'))}</dd></div>
              ${activeForecastEvidence.sourceDetails?.length ? `<div><dt>来源明细</dt><dd><details><summary>查看 ${activeForecastEvidence.sourceDetails.length} 个来源</summary>${activeForecastEvidence.sourceDetails.map(source=>`<p>${esc(source)}</p>`).join('')}</details></dd></div>` : ''}
              ${activeForecastEvidence.trainingPeriod ? `<div><dt>训练日期区间</dt><dd>${esc(activeForecastEvidence.trainingPeriod)}</dd></div>` : ''}
              <div><dt>当前模型</dt><dd>${esc(activeAccuracy.modelVersion || '尚无有效版本')}</dd></div>
              <div><dt>${activeId === 'load' ? '证据可用时间' : '数据截止'}</dt><dd>${esc(evidenceTimeText(activeId === 'load' ? activeForecastEvidence.dataCutoff : model.identity.dataCutoff) || '尚无可用证据')}</dd></div>
              <div><dt>样本天数</dt><dd>${numberText(activeAccuracy.sampleDays, ' 天')}</dd></div>
              <div><dt>最近回测</dt><dd>${esc(evidenceTimeText(activeAccuracy.lastBacktestAt) || '尚未完成')}</dd></div>
              ${activeForecastEvidence.caveat ? `<div><dt>当前限制</dt><dd>${esc(activeForecastEvidence.caveat)}</dd></div>` : ''}
            </dl>
            <button type="button" class="foundation-secondary-button" data-foundation-action="open-explanation" data-explanation-id="baselineSkill" data-foundation-trigger="model-choice" aria-controls="foundationEvidenceDrawer" aria-expanded="${
              state.openExplanation === 'baselineSkill' && activeTriggerKey === 'model-choice'
            }">解释模型选择</button>
          </aside>
        </div>
      </section>
      ${accuracySection(
        activeAccuracy,
        activeTab,
        state.openExplanation,
        model.explanations,
        activeTriggerKey,
        model.failures.accuracy
      )}
      ${derivationSection(model, state.openExplanation, activeTriggerKey)}
      <div class="foundation-bottom-grid">
        ${sandboxSection(model, state.sandboxControls || model.sandbox.defaults, state.openExplanation, activeTriggerKey)}
        ${historySection(model)}
      </div>
      <details class="foundation-catalog"><summary>完整字段目录与原始证据</summary>${renderFieldCatalogTable(
        catalogModel
      )}</details>
      ${renderFoundationProvenance(Boolean(state.provenanceOpen), model.collection)}
      ${renderFoundationEvidenceDrawer(explanation || {}, {
        ...(activeStageEvidence
          ? {
              stageEvidence: activeStageEvidence,
              stageEvidenceLabel:
                model.identity.environment === '演示环境'
                  ? '节点级演示证据'
                  : hasActiveStageReferences
                    ? '节点级真实证据'
                    : '节点级证据状态（未形成）',
            }
          : {
              dataCutoff: evidenceTimeText(model.identity.dataCutoff),
              modelVersion: activeAccuracy.modelVersion,
              constraintVersion: state.constraintVersion || null,
              selectedFacts: model.derivation.evidenceStages.length
                ? `${model.derivation.evidenceStages.length} 个阶段`
                : null,
            }),
      })}
    </section>
  `;
}
