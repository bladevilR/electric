import { renderFieldCatalogTable } from '../components/field-catalog-table.js';
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
  Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('zh-CN')}${suffix}` : '—';

const metricCard = (id, label, value, suffix, explanation, openExplanation) => `
  <div class="foundation-metric${openExplanation === id ? ' is-explained' : ''}">
    <div><span>${esc(label)}</span>${renderExplanationButton(id, label)}</div>
    <strong>${numberText(value, suffix)}</strong>
    ${openExplanation === id ? renderFoundationTooltip(explanation) : ''}
  </div>
`;

function truthStrip(model) {
  const current = model.collection.current;
  const history = model.collection.history;
  const stopped = model.collection.collectorState !== 'running';
  return `
    <section class="foundation-truth-strip" aria-label="数据真实性和采集状态">
      <div class="foundation-truth-item is-warning">
        <small>今日真实数据</small>
        <strong>${current.complete ? '今日数据已闭环' : '今日数据未闭环'}</strong>
        <span>${current.coverage}/96点${current.complete ? '' : `（缺${96 - current.coverage}点）`}</span>
      </div>
      <div class="foundation-truth-item ${stopped ? 'is-danger' : 'is-ready'}">
        <small>采集状态</small>
        <strong>${stopped ? '采集器已停止' : '采集器运行中'}</strong>
        <span>${stopped ? '需要连接已登录的数据窗口' : '约每 30 秒检查一次当前页'}</span>
      </div>
      <div class="foundation-truth-item is-ready">
        <small>历史真实数据</small>
        <strong>${history.coverage}/96点</strong>
        <span>${esc(history.date || '尚无历史日期')}</span>
      </div>
      <button type="button" class="foundation-primary-button" data-primary-action="collect_today_data">开始自动采集</button>
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

function accuracySection(model, activeTab, openExplanation) {
  const metrics = model.accuracy.metrics;
  return `
    <section class="foundation-section foundation-accuracy" aria-labelledby="foundationAccuracyTitle">
      <header class="foundation-section-heading">
        <div><small>FORECAST AUDIT</small><h2 id="foundationAccuracyTitle">预测准确度回溯</h2></div>
        <div class="foundation-heading-actions"><button type="button">查看预测版本</button><button type="button">查看回测证据</button></div>
      </header>
      <div class="foundation-metrics-grid">
        ${metricCard('mae', 'MAE', metrics.mae, activeTab.unit, model.explanations.mae, openExplanation)}
        ${metricCard('rmse', 'RMSE', metrics.rmse, activeTab.unit, model.explanations.rmse, openExplanation)}
        ${metricCard('mape', 'MAPE', metrics.mape, '%', model.explanations.mape, openExplanation)}
        ${metricCard(
          'baselineSkill',
          '相对基线改善',
          metrics.baselineSkill,
          '%',
          model.explanations.baselineSkill,
          openExplanation
        )}
      </div>
      <div class="foundation-accuracy-grid">
        <div>${renderAccuracyHistory(model.accuracy.history, activeTab.unit)}</div>
        <div class="foundation-version-panel">
          <h3>版本对比（${esc(activeTab.label)}）</h3>
          ${
            model.accuracy.versions.length
              ? `<div class="local-scroll"><table><thead><tr><th>模型版本</th><th>发布时间</th><th>样本量</th><th>MAE</th><th>相对基线</th><th>状态</th></tr></thead><tbody>${model.accuracy.versions
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

function sandboxSection(model, controls) {
  const result = applyFoundationSandbox(model, controls);
  const controlRows = [
    ['priceWeight', '价格信号', result.controls.priceWeight, '提高后更偏向低价窗口'],
    ['temperatureWeight', '温度影响', result.controls.temperatureWeight, '提高后更关注气象驱动负荷'],
    ['loadWeight', '负荷缺口', result.controls.loadWeight, '提高后更关注预测负荷缺口'],
  ];
  return `
    <section class="foundation-section foundation-sandbox" aria-labelledby="foundationSandboxTitle">
      <header class="foundation-section-heading">
        <div><small>SENSITIVITY SANDBOX</small><h2 id="foundationSandboxTitle">策略微调沙盒</h2><p>仅模拟，不会提交交易；不修改正式模型和正式推荐。</p></div>
        <span class="foundation-simulation-label">模拟测算</span>
      </header>
      <div class="foundation-sandbox-controls">
        <div class="foundation-weight-controls">
          ${controlRows
            .map(
              ([id, label, value, effect]) => `<label><span><strong>${label}</strong>${renderExplanationButton(
                id === 'priceWeight' ? 'optimizer' : id === 'loadWeight' ? 'risk' : 'baselineSkill',
                label
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
        <article><small>峰谷转移</small><strong>${numberText(
          result.peakValleyShiftMwh,
          ' MWh'
        )}</strong><span>模拟测算</span></article>
        <article><small>风险暴露</small><strong>${numberText(
          result.riskExposureChangePct,
          '%'
        )}</strong><span>模拟测算</span></article>
      </div>
      <footer><button type="button" class="foundation-secondary-button" data-foundation-action="reset-sandbox">恢复推荐参数</button><button type="button" class="foundation-primary-button" data-foundation-action="apply-simulation">应用到模拟方案</button></footer>
    </section>
  `;
}

function derivationSection(model) {
  return `
    <section class="foundation-section foundation-derivation" aria-labelledby="foundationDerivationTitle">
      <header class="foundation-section-heading"><div><small>STRATEGY EVIDENCE</small><h2 id="foundationDerivationTitle">整体策略依据</h2><p>从原始数据到人工复核，每一步都保留来源、版本与时点。</p></div></header>
      <ol class="foundation-derivation-chain">${model.derivation.stages
        .map(
          (stage) =>
            `<li>${
              stage.explanationId
                ? `<button type="button" data-foundation-action="open-explanation" data-explanation-id="${stage.explanationId}">${esc(
                    stage.label
                  )}<span>查看依据</span></button>`
                : `<span><strong>${esc(stage.label)}</strong></span>`
            }</li>`
        )
        .join('')}</ol>
      <div class="foundation-evidence-groups">
        <article><h3>1. 依据：关键信号与影响</h3><ul><li>价格：识别低价与高价风险窗口</li><li>温度：解释气象驱动的负荷变化</li><li>负荷：定位预测需求与已有头寸的缺口</li><li>风险：在业务限额内形成候选</li></ul></article>
        <article><h3>2. 来源：数据与事实</h3><ul><li>JSPEC 可见页面与平台导出</li><li>有发布时间的气象预报</li><li>历史实际负荷和预测版本</li><li>持仓、可买卖量与申报边界</li></ul></article>
        <article><h3>3. 算法：方法与规则</h3><ul><li>强季节基线与滚动中位数</li><li>温度、湿度等气象修正</li><li>负荷预测与特征融合</li><li>带业务约束的申报优化</li></ul></article>
        <article><h3>4. 可追溯证据</h3><ul><li>源时间戳与事实 ID</li><li>预测模型和特征快照版本</li><li>约束版本与回退原因</li><li>操作人、复核人与审批记录</li></ul></article>
      </div>
      <div class="foundation-why-chain"><h3>为什么得到这个策略？</h3><div><span>低价窗口</span><b>+</b><span>温度驱动负荷上升</span><b>+</b><span>预测负荷缺口</span><b>+</b><span>交易与风险约束</span><b>→</b><strong>申报调整建议</strong></div><button type="button" data-foundation-action="open-explanation" data-explanation-id="optimizer">查看公式与完整推导</button></div>
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
    marketCockpit: state.foundationInput?.marketCockpit || state.marketCockpit || {},
    strategyTrace: state.foundationInput?.strategyTrace || state.strategyTrace || {},
  };
  const model = buildStrategyFoundationModel(input);
  const activeId = model.forecastTabs.some((tab) => tab.id === state.activeForecastTab)
    ? state.activeForecastTab
    : 'price';
  const activeTab = model.forecastTabs.find((tab) => tab.id === activeId);
  const explanation = model.explanations[state.openExplanation] || null;
  const catalogModel = { fields: state.fieldCatalog?.fields || [] };
  return `
    <section class="cockpit-view foundation-workbench${state.openExplanation ? ' has-evidence-open' : ''}${
      state.provenanceOpen ? ' has-provenance-open' : ''
    }" data-view="data-sources" data-foundation-root>
      ${truthStrip(model)}
      <header class="foundation-page-heading">
        <div><small>FOUNDATION &amp; FORECAST EVIDENCE</small><h1>基础数据与预测依据</h1><p>价格、温度与负荷共同影响 96 点申报策略；每条预测均可追溯来源、版本与准确度。</p></div>
        <span class="mode-identity">${esc(model.identity.environment)} · ${esc(
          model.identity.targetDate || '未选择交易日'
        )}</span>
      </header>
      ${forecastTabs(model, activeId)}
      <section class="foundation-section foundation-forecast" id="foundationForecastPanel" role="tabpanel" aria-labelledby="foundationTab-${activeId}">
        <div class="foundation-forecast-layout">
          ${renderFoundationForecastChart(activeTab)}
          <aside class="foundation-model-evidence" aria-label="${esc(activeTab.label)}模型证据">
            <header><div><small>MODEL EVIDENCE</small><h2>模型证据（${esc(
              activeTab.label
            )}）</h2></div></header>
            <dl>
              <div><dt>当前模型</dt><dd>${esc(model.accuracy.modelVersion || '尚无有效版本')}</dd></div>
              <div><dt>数据截止</dt><dd>${esc(model.identity.dataCutoff || '尚无可用证据')}</dd></div>
              <div><dt>样本天数</dt><dd>${numberText(model.accuracy.sampleDays, ' 天')}</dd></div>
              <div><dt>最近回测</dt><dd>${esc(model.accuracy.lastBacktestAt || '尚未完成')}</dd></div>
            </dl>
            <button type="button" class="foundation-secondary-button" data-foundation-action="open-explanation" data-explanation-id="baselineSkill">解释模型选择</button>
          </aside>
        </div>
      </section>
      ${accuracySection(model, activeTab, state.openExplanation)}
      ${sandboxSection(model, state.sandboxControls || model.sandbox.defaults)}
      ${derivationSection(model)}
      <details class="foundation-catalog"><summary>完整字段目录与原始证据</summary>${renderFieldCatalogTable(
        catalogModel
      )}</details>
      ${renderFoundationProvenance(Boolean(state.provenanceOpen))}
      ${renderFoundationEvidenceDrawer(explanation || {}, {
        dataCutoff: model.identity.dataCutoff,
        modelVersion: model.accuracy.modelVersion,
        constraintVersion: state.constraintVersion || null,
        selectedFacts: model.derivation.evidenceStages.length
          ? `${model.derivation.evidenceStages.length} 个阶段`
          : null,
      })}
    </section>
  `;
}
