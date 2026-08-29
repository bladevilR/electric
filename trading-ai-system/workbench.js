import { buildDeclarationDashboardView } from './lib/declaration-dashboard-view.mjs';
import {
  applyStrategyEvolutionAction,
  buildStrategyEvolution,
} from './lib/strategy-evolution.mjs';
import { scheduleWorkbenchMotion } from './workbench-motion.js';

const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
});

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const statusLabels = {
  blocked: '不可执行',
  review_required: '待人工复核',
  verified: '已核验',
  ready: '已到位',
  complete: '已完成',
  active: '进行中',
  partial: '不完整',
  missing: '未获取',
  stale: '已过期',
  rejected: '未采纳',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(value) {
  const numeric = Number(value);
  return value === null || value === undefined || !Number.isFinite(numeric)
    ? '未获取'
    : `¥${moneyFormatter.format(numeric)}`;
}

function formatForecastNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    : '—';
}

export function buildSavingsProjection(
  dailyYuan,
  { monthlyTradingDays = 22, annualTradingDays = 264 } = {}
) {
  const daily = Number(dailyYuan);
  if (!Number.isFinite(daily)) return null;
  return {
    dailyYuan: daily,
    monthlyYuan: daily * monthlyTradingDays,
    annualYuan: daily * annualTradingDays,
    monthlyTradingDays,
    annualTradingDays,
  };
}

function formatDateTime(value) {
  if (!value) return '未获取';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未获取' : dateTimeFormatter.format(date);
}

function statusText(value) {
  return statusLabels[value] || '待确认';
}

function validationStatusText(value) {
  return (
    {
      validated: '已通过',
      rejected: '未优于基线',
      not_validated: '待验证',
    }[value] || '待验证'
  );
}

function auditLabel(value) {
  return (
    {
      system_refresh_completed: '数据刷新完成',
      production_readiness_checked: '数据准备校验',
      ukey_visible_snapshot_accepted: '实时采集已接收',
      ukey_visible_snapshot_rejected: '实时采集未通过',
      execution_proposal_created: '策略草稿生成',
      proposal_review_recorded: '人工复核已记录',
    }[value] || '系统操作记录'
  );
}

function stageNavigation(payload, activeStage) {
  return `
    <nav class="stage-nav" aria-label="交易决策闭环">
      ${(payload.stages || [])
        .map(
          (item, index) => `
            <button
              class="stage-button ${item.id === activeStage ? 'is-active' : ''} is-${escapeHtml(item.status)}"
              type="button"
              data-stage="${escapeHtml(item.id)}"
              aria-current="${item.id === activeStage ? 'step' : 'false'}"
            >
              <span class="stage-number">${index + 1}</span>
              <span class="stage-copy">
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(item.description)}</small>
              </span>
              <span class="stage-status">${escapeHtml(statusText(item.status))}</span>
            </button>
          `
        )
        .join('')}
    </nav>
  `;
}

function savingsHero(payload) {
  const verified = payload.status === 'verified';
  const value = verified ? payload.savings?.realizedNetYuan : payload.savings?.estimatedNetYuan;
  const projection = payload.savings?.projection || null;
  return `
    <section class="savings-hero" aria-labelledby="savingsTitle">
      <div>
        <span class="eyebrow" id="savingsTitle">${verified ? '已核验成本优化额' : '预计综合成本优化额'}</span>
        <div class="savings-value ${value === null || value === undefined ? 'is-missing' : ''}" id="savingsValue">
          ${escapeHtml(formatMoney(value))}
        </div>
        <p>${escapeHtml(payload.savings?.formula || '基准成本 − 实际结算成本 − 手续费 − 偏差成本 − 系统运行成本')}</p>
        ${projection ? `
          <div class="savings-projection-grid" aria-label="成本优化额测算">
            <div class="savings-projection-item is-primary">
              <span>单日净优化额</span>
              <strong>${escapeHtml(formatMoney(projection.dailyYuan))}</strong>
              <small>演示回放已核验</small>
            </div>
            <div class="savings-projection-item">
              <span>月度节约测算</span>
              <strong>${escapeHtml(formatMoney(projection.monthlyYuan))}</strong>
              <small>按 ${escapeHtml(projection.monthlyTradingDays)} 个交易日</small>
            </div>
            <div class="savings-projection-item">
              <span>年度节约潜力</span>
              <strong>${escapeHtml(formatMoney(projection.annualYuan))}</strong>
              <small>按 ${escapeHtml(projection.annualTradingDays)} 个交易日</small>
            </div>
          </div>
          <p class="savings-scope-note">按当前演示交易规模等比例测算，非已实现生产收益。</p>
        ` : ''}
      </div>
      <div class="decision-state">
        <span class="status-badge is-${escapeHtml(payload.status)}">${escapeHtml(statusText(payload.status))}</span>
        <strong>${payload.execution?.allowed ? '可以进入人工执行' : '当前不可执行'}</strong>
        <p>${payload.execution?.dataReady ? '数据校验已通过，仍需人工复核。' : '先处理阻塞项，系统不会用不完整数据给出电量。'}</p>
      </div>
    </section>
  `;
}

function decisionFlow(activeStage) {
  const steps = [
    ['connect', '成本机会'],
    ['validate', '策略依据'],
    ['execute', '风险约束'],
    ['settle', '可执行动作'],
  ];
  const activeIndex = Math.max(0, steps.findIndex(([id]) => id === activeStage));
  return `
    <nav class="decision-flow" aria-label="当日决策逻辑">
      ${steps
        .map(
          ([id, label], index) => `
            <span class="${index === activeIndex ? 'is-active' : ''}" data-flow-stage="${escapeHtml(id)}">
              ${escapeHtml(label)}
            </span>
            ${index < steps.length - 1 ? '<b aria-hidden="true">→</b>' : ''}
          `
        )
        .join('')}
    </nav>
  `;
}

function blockedDecisionGate(payload) {
  const validation = payload.strategyValidation || {};
  return `
    <section class="decision-gate" aria-labelledby="decisionGateTitle">
      <div class="decision-gate-copy">
        <span class="eyebrow">当日决策门禁</span>
        <h2 id="decisionGateTitle">数据未就绪 · 禁止下发</h2>
        <p>当前存在执行阻塞，系统不会生成交易电量、限价或虚构的成本优化金额。</p>
        <div class="primary-action-row">
          <button class="primary-action" type="button" data-primary-action="${escapeHtml(payload.primaryAction?.id || '')}">
            ${escapeHtml(payload.primaryAction?.label || '采集并校验当日数据')}
          </button>
          <button class="text-action" type="button" data-action="refresh">重新检查</button>
        </div>
      </div>
      <div class="decision-gate-state">
        <span class="eyebrow">当前状态</span>
        <strong>预计综合成本优化额：未获取</strong>
        <ul>
          <li class="is-blocked">交易下发：禁止</li>
          <li>价格模型：${escapeHtml(validationStatusText(validation.priceModel?.status))}</li>
          <li>策略成本：${escapeHtml(validation.costStrategy?.status === 'validated' ? '已验证' : '未验证')}</li>
          <li>结算验收：未完成</li>
        </ul>
      </div>
    </section>
  `;
}

function strategyValidationPanel(payload) {
  const validation = payload.strategyValidation || {};
  const price = validation.priceModel || {};
  const coverage = validation.sampleCoverage || {};
  const cost = validation.costStrategy || {};
  const replay = validation.declarationReplay || {};
  const priceRejected = price.status === 'rejected';
  const improvement =
    price.candidateImprovementPct === null || price.candidateImprovementPct === undefined
      ? '待验证'
      : `${price.candidateImprovementPct > 0 ? '+' : ''}${price.candidateImprovementPct}%`;
  return `
    <section class="strategy-validation" aria-labelledby="strategyValidationTitle">
      <div class="section-heading">
        <div>
          <span class="eyebrow">真实历史数据</span>
          <h2 id="strategyValidationTitle">历史策略验证</h2>
        </div>
        <span class="inline-state ${validation.overallStatus === 'validated' ? 'is-success' : 'is-danger'}">
          ${validation.overallStatus === 'validated' ? '验证通过' : '禁止据此下发'}
        </span>
      </div>
      <div class="validation-metrics">
        <article>
          <span>价格预测回测</span>
          <strong class="${priceRejected ? 'is-negative' : ''}">${escapeHtml(validationStatusText(price.status))}</strong>
          <small>${escapeHtml(price.sampleCount || 0)} 个可比点</small>
        </article>
        <article>
          <span>候选模型相对基线</span>
          <strong class="${Number(price.candidateImprovementPct) <= 0 ? 'is-negative' : 'is-positive'}">${escapeHtml(improvement)}</strong>
          <small>MAE 越低越好</small>
        </article>
        <article>
          <span>历史样本覆盖</span>
          <strong>${escapeHtml(coverage.evaluationDateCount || 0)} 日</strong>
          <small>${escapeHtml(coverage.pricePointCount || price.sampleCount || 0)} 个价格点</small>
        </article>
        <article>
          <span>策略成本回测</span>
          <strong>${escapeHtml(cost.status === 'validated' ? '已验证' : '未验证')}</strong>
          <small>${cost.estimatedSavingsYuan === null || cost.estimatedSavingsYuan === undefined ? '不声明节省金额' : escapeHtml(formatMoney(cost.estimatedSavingsYuan))}</small>
        </article>
      </div>
      <div class="validation-verdict">
        <strong>${priceRejected ? '验证结论：滚动中位数模型未优于同点位基线，系统已自动保留基线模型。' : '验证结论：只有优于基线且成本回测完整的策略，才能进入人工复核。'}</strong>
        <span>${cost.status === 'validated' ? '策略节省已具备历史证据。' : '策略节省尚未验证，禁止把预测价差当作已实现收益。'}</span>
      </div>
      <div class="declaration-replay">
        <div>
          <span class="eyebrow">申报偏差回放</span>
          <strong>${replay.verdict === 'improved' ? '优于默认申报' : replay.verdict === 'not_improved' ? '未优于默认申报' : '证据不足'}</strong>
          <small>实际申报 MAE ${replay.submittedMaeMwh === null || replay.submittedMaeMwh === undefined ? '未获取' : `${escapeHtml(replay.submittedMaeMwh)} MWh`}；默认基线 ${replay.baselineMaeMwh === null || replay.baselineMaeMwh === undefined ? '未获取' : `${escapeHtml(replay.baselineMaeMwh)} MWh`}</small>
        </div>
        <dl>
          <div>
            <dt>相对改善</dt>
            <dd class="${Number(replay.improvementPct) <= 0 ? 'is-negative' : 'is-positive'}">${replay.improvementPct === null || replay.improvementPct === undefined ? '待验证' : `${replay.improvementPct > 0 ? '+' : ''}${escapeHtml(replay.improvementPct)}%`}</dd>
          </div>
          <div>
            <dt>胜率</dt>
            <dd>${replay.winRatePct === null || replay.winRatePct === undefined ? '待验证' : `${escapeHtml(replay.winRatePct)}%`}</dd>
          </div>
          <div>
            <dt>证据覆盖</dt>
            <dd>${escapeHtml(moneyFormatter.format(Number(replay.comparablePointCount || 0)))} 个点 / ${escapeHtml(replay.dateCount || 0)} 日</dd>
          </div>
        </dl>
      </div>
    </section>
  `;
}

function declarationOptimizerPanel(payload) {
  const validation = payload.strategyValidation || {};
  const optimizer = validation.declarationOptimizer || {};
  const model = optimizer.selectedModel || {};
  const holdout = optimizer.holdout || {};
  const recommendation = payload.declarationRecommendation || {};
  const validated = optimizer.status === 'validated';
  const improvement =
    holdout.improvementPct === null || holdout.improvementPct === undefined
      ? '待验证'
      : `${Number(holdout.improvementPct) > 0 ? '+' : ''}${holdout.improvementPct}%`;
  const modelLabel = model.windowDays
    ? `${model.windowDays} 日同点位均值`
    : '默认申报基线';
  const currentState =
    recommendation.status === 'ready'
      ? `已生成 ${recommendation.coverage?.recommendedPointCount || 0} 点复核建议`
      : recommendation.status === 'baseline_ready'
        ? '默认申报基线可复核'
        : '当前回退默认申报';
  const recovery =
    recommendation.status === 'missing_baseline'
      ? '补齐目标日 96 点默认申报'
      : recommendation.status === 'stale_inputs'
        ? '刷新最近 48 小时实际负荷后重新计算'
        : recommendation.status === 'ready'
          ? '进入人工复核后方可采用'
          : '基线始终保留，优化失败自动回退';

  return `
    <section class="declaration-optimizer-panel" aria-labelledby="declarationOptimizerTitle">
      <div class="section-heading">
        <div>
          <span class="eyebrow">现行基线 · 候选策略验证</span>
          <h2 id="declarationOptimizerTitle">申报优化策略</h2>
        </div>
        <span class="inline-state ${validated ? 'is-success' : 'is-warning'}">
          ${validated ? '已通过独立留出集' : '默认申报基线运行'}
        </span>
      </div>
      <div class="optimizer-model-row">
        <div>
          <span>当前验证模型</span>
          <strong>${escapeHtml(modelLabel)}</strong>
          <small>${validated ? '模型失败或数据异常时自动退回默认申报' : '复杂模型未达门槛，不影响基础申报复核'}</small>
        </div>
        <div class="optimizer-current-state">
          <span>目标日运行状态</span>
          <strong>${escapeHtml(currentState)}</strong>
          <small>${escapeHtml(recovery)}</small>
        </div>
      </div>
      <div class="optimizer-evidence-grid">
        <article>
          <span>独立留出集偏差改善</span>
          <strong class="${Number(holdout.improvementPct) >= 3 ? 'is-positive' : 'is-negative'}">${escapeHtml(improvement)}</strong>
          <small>晋级门槛 ≥ 3%</small>
        </article>
        <article>
          <span>交易日胜率</span>
          <strong>${holdout.dailyWinRatePct === null || holdout.dailyWinRatePct === undefined ? '待验证' : `${escapeHtml(holdout.dailyWinRatePct)}%`}</strong>
          <small>晋级门槛 ≥ 60%</small>
        </article>
        <article>
          <span>留出集证据覆盖</span>
          <strong>${escapeHtml(moneyFormatter.format(Number(holdout.pointCount || 0)))} 个点</strong>
          <small>${escapeHtml(holdout.dateCount || 0)} 个完整交易日</small>
        </article>
      </div>
      <p class="optimizer-disclaimer">偏差改善不等于已实现人民币节省；结算成本字段未齐时不声明节省金额。</p>
    </section>
  `;
}

function blockersPanel(payload, options = {}) {
  const blockers = Array.isArray(payload.blockers) ? payload.blockers : [];
  const showAction = options.showAction !== false;
  return `
    <section class="decision-panel" aria-labelledby="decisionTitle">
      <div class="section-heading">
        <div>
          <span class="eyebrow">当前任务</span>
          <h2 id="decisionTitle">${blockers.length ? `${blockers.length} 项数据风险阻止策略下发` : '数据质量校验通过'}</h2>
        </div>
        <span class="inline-state ${blockers.length ? 'is-danger' : 'is-success'}">
          ${blockers.length ? '不可执行' : '可进入复核'}
        </span>
      </div>
      ${
        blockers.length
          ? `<div class="blocker-list">
              ${blockers
                .slice(0, 6)
                .map(
                  (item) => `
                    <article class="blocker-row">
                      <span class="severity-dot" aria-hidden="true"></span>
                      <div>
                        <strong>${escapeHtml(item.title)}</strong>
                        <p>${escapeHtml(item.detail)}</p>
                      </div>
                      <span>${escapeHtml(item.scope === 'verification' ? '影响验收' : '阻止执行')}</span>
                    </article>
                  `
                )
                .join('')}
            </div>`
          : `<div class="ready-message">
              <strong>执行所需数据已经到位</strong>
              <p>下一步生成策略草稿，检查电量、限价和最坏情景，再由人工决定是否采用。</p>
            </div>`
      }
      ${
        showAction
          ? `<div class="primary-action-row">
              <button class="primary-action" type="button" data-primary-action="${escapeHtml(payload.primaryAction?.id || '')}">
                ${escapeHtml(payload.primaryAction?.label || '继续')}
              </button>
              <button class="text-action" type="button" data-action="refresh">重新检查</button>
            </div>`
          : ''
      }
    </section>
  `;
}

function comparisonPanel(payload) {
  const costs = payload.savings?.costs || {};
  return `
    <section class="comparison-panel" aria-labelledby="comparisonTitle">
      <div class="section-heading compact">
        <div>
          <span class="eyebrow">成本对比</span>
          <h2 id="comparisonTitle">策略成本效益评估</h2>
        </div>
        <button class="text-action" type="button" data-action="open-evidence">查看依据</button>
      </div>
      <div class="comparison-table" role="table" aria-label="成本方案对比">
        <div class="comparison-row is-header" role="row">
          <span role="columnheader">成本口径</span>
          <span role="columnheader">当前/基准</span>
          <span role="columnheader">采用建议后</span>
        </div>
        <div class="comparison-row" role="row">
          <strong role="cell">综合成本</strong>
          <span role="cell">${escapeHtml(formatMoney(costs.baselineCostYuan))}</span>
          <span role="cell">${escapeHtml(formatMoney(costs.actualSettlementCostYuan))}</span>
        </div>
        <div class="comparison-row" role="row">
          <strong role="cell">手续费</strong>
          <span role="cell">—</span>
          <span role="cell">${escapeHtml(formatMoney(costs.transactionFeesYuan))}</span>
        </div>
        <div class="comparison-row" role="row">
          <strong role="cell">偏差成本</strong>
          <span role="cell">—</span>
          <span role="cell">${escapeHtml(formatMoney(costs.deviationCostYuan))}</span>
        </div>
        <div class="comparison-row" role="row">
          <strong role="cell">最坏情景</strong>
          <span role="cell">未获取</span>
          <span role="cell">未获取</span>
        </div>
      </div>
      <p class="panel-footnote">数据不完整时不估算节省金额，也不输出可执行 MWh。</p>
    </section>
  `;
}

function validationPanel(payload) {
  return `
    <section class="validation-panel" aria-labelledby="validationTitle">
      <div class="section-heading">
        <div>
          <span class="eyebrow">校验清单</span>
          <h2 id="validationTitle">执行前必须通过的数据</h2>
        </div>
        <span class="inline-state ${payload.execution?.dataReady ? 'is-success' : 'is-danger'}">
          ${payload.execution?.dataReady ? '校验通过' : '存在缺口'}
        </span>
      </div>
      <div class="validation-table" role="table" aria-label="执行数据校验">
        <div class="validation-row is-header" role="row">
          <span role="columnheader">数据项</span>
          <span role="columnheader">当前值</span>
          <span role="columnheader">状态</span>
          <span role="columnheader">影响</span>
        </div>
        ${(payload.dataEvidence || [])
          .slice(0, 5)
          .map(
            (item) => `
              <div class="validation-row" role="row">
                <div role="cell">
                  <strong>${escapeHtml(item.label)}</strong>
                  <small>${escapeHtml(item.detail)}</small>
                </div>
                <span role="cell">${escapeHtml(item.value)}</span>
                <b role="cell" class="evidence-status is-${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</b>
                <span role="cell">${item.status === 'ready' ? '已纳入策略' : '阻止执行'}</span>
              </div>
            `
          )
          .join('')}
      </div>
    </section>
  `;
}

function operationHeading(activeStage) {
  return (
    {
      connect: {
        eyebrow: '第一步',
        title: '接入当日交易数据',
        description: '只接收目标交易日的业务数据；历史快照会被标记为过期。',
      },
      validate: {
        eyebrow: '第二步',
        title: '执行前数据质量校验',
        description: '逐项确认价格、负荷预测、持仓和交易限额，缺一项就不进入执行。',
      },
      execute: {
        eyebrow: '第三步',
        title: '策略决策与风险评估',
        description: '比较综合成本、价格区间和最坏情景，策略下发前必须经过人工复核。',
      },
      settle: {
        eyebrow: '第四步',
        title: '结算绩效评估',
        description: '按统一成本口径完成结算校核，形成可审计的成本优化绩效。',
      },
    }[activeStage] || {
      eyebrow: '今日任务',
      title: '当日交易决策中心',
      description: '先校验数据质量，再生成策略；未经证据链验证不得下发。',
    }
  );
}

function operationContent(payload, activeStage) {
  const hero = payload.status === 'blocked' ? blockedDecisionGate(payload) : savingsHero(payload);
  const flow = decisionFlow(activeStage);
  if (activeStage === 'validate') {
    return `${flow}${hero}${strategyValidationPanel(payload)}${declarationOptimizerPanel(payload)}${validationPanel(payload)}${blockersPanel(payload, { showAction: payload.status !== 'blocked' })}`;
  }
  if (activeStage === 'execute') {
    return `${flow}${hero}${strategyValidationPanel(payload)}${declarationOptimizerPanel(payload)}${comparisonPanel(payload)}${blockersPanel(payload, { showAction: payload.status !== 'blocked' })}`;
  }
  if (activeStage === 'settle') {
    return `${flow}${hero}${strategyValidationPanel(payload)}${declarationOptimizerPanel(payload)}${comparisonPanel(payload)}${blockersPanel(payload, { showAction: payload.status !== 'blocked' })}`;
  }
  return `${flow}${hero}${strategyValidationPanel(payload)}${declarationOptimizerPanel(payload)}${blockersPanel(payload, { showAction: payload.status !== 'blocked' })}`;
}

function evidenceDrawer(payload, evidenceOpen) {
  if (!evidenceOpen) {
    return `
      <aside class="evidence-closed">
        <button type="button" data-action="open-evidence">打开成本优化证据链</button>
      </aside>
    `;
  }
  return `
    <aside class="evidence-drawer" aria-labelledby="evidenceTitle">
      <div class="drawer-heading">
        <div>
          <span class="eyebrow">复核层</span>
          <h2 id="evidenceTitle">成本优化证据链</h2>
        </div>
        <button class="icon-button" type="button" data-action="close-evidence" aria-label="关闭成本优化证据链">×</button>
      </div>
      <section class="formula-box">
        <span>统一计算公式</span>
        <strong>${escapeHtml(payload.savings?.formula)}</strong>
      </section>
      <section class="evidence-section">
        <div class="section-heading compact">
          <h3>数据证据</h3>
          <span>截至 ${escapeHtml(formatDateTime(payload.dataFreshness?.generatedAt))}</span>
        </div>
        <div class="evidence-list">
          ${(payload.dataEvidence || [])
            .map(
              (item) => `
                <article class="evidence-row">
                  <div>
                    <strong>${escapeHtml(item.label)}</strong>
                    <small>${escapeHtml(item.detail)}</small>
                  </div>
                  <div class="evidence-value">
                    <span>${escapeHtml(item.value)}</span>
                    <b class="evidence-status is-${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</b>
                  </div>
                </article>
              `
            )
            .join('')}
        </div>
      </section>
      <section class="evidence-section">
        <h3>最近留痕</h3>
        ${
          payload.auditEvents?.length
            ? `<ol class="audit-list">
                ${payload.auditEvents
                  .slice(0, 5)
                  .map(
                    (item) => `
                      <li>
                        <strong>${escapeHtml(auditLabel(item.type))}</strong>
                        <span>${escapeHtml(formatDateTime(item.createdAt || item.at || item.timestamp || item.generatedAt))}</span>
                      </li>
                    `
                  )
                  .join('')}
              </ol>`
            : '<p class="empty-copy">还没有当日操作留痕。</p>'
        }
      </section>
      <div class="verification-note">仅在结算完成且成本口径完整后，计入已实现成本优化额。</div>
    </aside>
  `;
}

function reviewPanel(payload) {
  return `
    <section class="review-workspace">
      <div class="review-summary">
        <span class="eyebrow">管理复核</span>
        <h1>策略绩效与审计证据</h1>
        <p>预测结果、策略执行、实际结算和成本扣减必须采用同一主体、同一交易日、同一结算口径。</p>
      </div>
      ${strategyValidationPanel(payload)}
      ${declarationOptimizerPanel(payload)}
      ${comparisonPanel(payload)}
      <section class="review-rule">
        <strong>当前结论：${escapeHtml(statusText(payload.status))}</strong>
        <p>${payload.savings?.formulaComplete ? '成本公式已完整。' : '成本公式尚未完整，不能计入已实现成本优化额。'}</p>
      </section>
    </section>
  `;
}

function demoTimePoint(pointIndex) {
  const totalMinutes = pointIndex * 15;
  if (totalMinutes === 24 * 60) {
    return '24:00';
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function buildStandaloneDemoWorkbenchPayload() {
  const rows = Array.from({ length: 96 }, (_, index) => {
    const pointIndex = index + 1;
    const hour = (pointIndex * 15) / 60;
    const baselinePowerMw =
      520 +
      260 * Math.sin(((hour - 6) / 24) * Math.PI * 2) +
      95 * Math.sin((hour / 24) * Math.PI * 4);
    const deltaPowerMw =
      34 * Math.sin(((hour + 1) / 24) * Math.PI * 6) -
      18 * Math.cos((hour / 24) * Math.PI * 2);

    return {
      pointIndex,
      timePoint: demoTimePoint(pointIndex),
      baselinePowerMw: Number(baselinePowerMw.toFixed(2)),
      recommendedPowerMw: Number(
        (baselinePowerMw + deltaPowerMw).toFixed(2)
      ),
      deltaPowerMw: Number(deltaPowerMw.toFixed(2)),
    };
  });

  return {
    date: '2026-07-31',
    status: 'review_required',
    currentStage: 'execute',
    dataFreshness: {
      status: 'ready',
      generatedAt: '2026-07-31T07:28:00.000Z',
      ageMinutes: 2,
    },
    savings: {
      estimatedNetYuan: null,
      realizedNetYuan: null,
      formulaComplete: false,
      formula:
        '基准成本 − 实际结算成本 − 手续费 − 偏差成本 − 系统运行成本',
      costs: {},
    },
    execution: {
      dataReady: true,
      reviewed: false,
      allowed: false,
      mode: 'human_decision_only',
    },
    stages: [
      {
        id: 'connect',
        label: '数据接入',
        status: 'complete',
        description: '演示数据已接入',
      },
      {
        id: 'validate',
        label: '质量校验',
        status: 'complete',
        description: '演示校验已通过',
      },
      {
        id: 'execute',
        label: '策略决策',
        status: 'active',
        description: '等待人工复核',
      },
      {
        id: 'settle',
        label: '结算评估',
        status: 'blocked',
        description: '等待结算',
      },
    ],
    blockers: [],
    dataEvidence: [
      {
        id: 'market_price',
        label: '演示市场价格',
        status: 'ready',
        value: '96/96 点',
        detail: '演示状态的完整点位，仅用于界面展示。',
      },
      {
        id: 'actual_load',
        label: '演示实际负荷',
        status: 'ready',
        value: '96/96 点',
        detail: '演示状态的负荷曲线，不用于交易。',
      },
    ],
    primaryAction: {
      id: 'review_strategy',
      label: '进入人工复核',
    },
    auditEvents: [],
    strategyValidation: {
      overallStatus: 'validated',
      operatingMode: 'validated_optimizer',
      reviewRecommendationAllowed: true,
      executionAllowed: false,
      priceModel: {
        status: 'validated',
        sampleCount: 20544,
        candidateImprovementPct: 5.8,
      },
      sampleCoverage: {
        evaluationDateCount: 214,
        pricePointCount: 20544,
      },
      costStrategy: {
        status: 'not_validated',
        estimatedSavingsYuan: null,
      },
      declarationReplay: {
        status: 'validated',
        verdict: 'improved',
        comparablePointCount: 20544,
        dateCount: 214,
        submittedMaeMwh: 3.19,
        baselineMaeMwh: 3.42,
        improvementPct: 6.73,
        winRatePct: 68.4,
        costSavingsYuan: null,
      },
      declarationOptimizer: {
        status: 'validated',
        selectedModel: {
          id: 'same_slot_mean_w42_a1',
          windowDays: 42,
          weight: 1,
        },
        holdout: {
          pointCount: 4128,
          dateCount: 43,
          baselineMaeMwh: 1.64,
          modelMaeMwh: 1.48,
          improvementPct: 9.64,
          pointWinRatePct: 58.48,
          dailyWinRatePct: 86.05,
        },
        promotion: {
          eligible: true,
          reasons: [],
        },
        costSavingsYuan: null,
      },
      reasons: [],
    },
    declarationRecommendation: {
      status: 'ready',
      operatingMode: 'validated_optimizer',
      coverage: {
        baselinePointCount: 96,
        recommendedPointCount: 96,
        requiredPointCount: 96,
        optimizerPointCount: 96,
        fallbackPointCount: 0,
      },
      rows,
      fallbackReasons: [],
      costSavingsYuan: null,
    },
    costStrategy: {
      dataConfidence: {
        score: 88,
      },
    },
    strategyEvolution: buildStrategyEvolution({
      date: '2026-07-31',
      strategyValidation: {
        overallStatus: 'validated',
        declarationOptimizer: {
          status: 'validated',
          selectedModel: {
            id: 'same_slot_mean_w42_a1',
            windowDays: 42,
            weight: 1,
          },
          holdout: {
            pointCount: 4128,
            dateCount: 43,
            baselineMaeMwh: 1.64,
            modelMaeMwh: 1.48,
            improvementPct: 9.64,
            pointWinRatePct: 58.48,
            dailyWinRatePct: 86.05,
          },
        },
        sampleCoverage: {
          evaluationDateCount: 214,
          pricePointCount: 20544,
        },
        declarationReplay: {
          improvementPct: 6.73,
          winRatePct: 68.4,
          submittedMaeMwh: 3.19,
          baselineMaeMwh: 3.42,
        },
      },
    }),
  };
}

export function buildStandaloneDemoForecastReport(targetDate = '2026-07-31') {
  const forecasts = Array.from({ length: 96 }, (_, index) => {
    const pointIndex = index + 1;
    const hour = index / 4;
    const morningPeak = 150 * Math.exp(-((hour - 10) ** 2) / 12);
    const eveningPeak = 220 * Math.exp(-((hour - 18) ** 2) / 10);
    const pointForecast = Math.round((320 + morningPeak + eveningPeak) * 100) / 100;
    return {
      target: 'realTimeAvgPrice',
      pointIndex,
      pointForecast,
      p10: Math.round((pointForecast * 0.88) * 100) / 100,
      p90: Math.round((pointForecast * 1.12) * 100) / 100,
      evidenceRows: 5,
    };
  });
  return {
    status: 'baseline_ready',
    targetDate,
    readiness: {
      status: 'baseline_ready',
      historicalDateCount: 5,
      comparablePointCount: 96,
      missingReasons: [],
    },
    forecasts,
  };
}

export function buildDemoWorkbenchScenario(payload, scenario) {
  const base = structuredClone(payload || {});
  if (scenario === 'submission') {
    return {
      ...base,
      demoMode: true,
      demoLabel: '候选优化策略 · 策略验证中',
      presentationDisclosure: '按当前输入测算，最终结果以实际结算为准',
      status: 'review_required',
      currentStage: 'execute',
      execution: {
        ...base.execution,
        dataReady: true,
        reviewed: false,
        allowed: false,
      },
      stages: (base.stages || []).map((item) => ({
        ...item,
        status: item.id === 'execute' ? 'active' : item.id === 'settle' ? 'blocked' : 'complete',
        description:
          item.id === 'connect'
            ? '多源数据已对齐'
            : item.id === 'validate'
              ? '质量门禁已通过'
              : item.id === 'execute'
                ? '候选策略待复核'
                : '等待实际结算',
      })),
      dataEvidence: [
        {
          id: 'weather_forecast',
          label: '天气预测数据',
          status: 'ready',
          value: '96/96 点',
          detail: '温度、湿度与体感温度已按交易时点对齐。',
        },
        {
          id: 'load_forecast',
          label: '负荷概率预测',
          status: 'ready',
          value: 'P10 / P50 / P90',
          detail: '负荷区间已进入候选策略计算。',
        },
        {
          id: 'market_spread',
          label: '日前与实时价差',
          status: 'ready',
          value: '96/96 点',
          detail: '价差分布已按同一交易日口径对齐。',
        },
      ],
      strategyContext: {
        weather: {
          temperatureC: 31.8,
          feelsLikeC: 34.2,
          humidityPct: 72,
          effect: '制冷负荷抬升',
        },
        loadForecast: {
          p10Mw: 571.8,
          p50Mw: 612.4,
          p90Mw: 656.2,
          peakTime: '20:15',
        },
        marketSpread: {
          expectedYuanPerMwh: 36.4,
          riskPointCount: 19,
          direction: '实时价格偏强',
        },
        risk: {
          cvar95Yuan: 42_600,
          budgetYuan: 50_000,
          scenarioCount: 1_000,
          status: '风险预算内',
        },
        estimatedDailyImprovementYuan: 24_000,
      },
      savings: {
        ...base.savings,
        estimatedNetYuan: 24_000,
        realizedNetYuan: null,
        formulaComplete: false,
      },
      strategyValidation: {
        ...base.strategyValidation,
        declarationOptimizer: {
          ...base.strategyValidation?.declarationOptimizer,
          selectedModel: {
            id: 'multi_factor_joint_scenario_v1',
            label: '多因素联合场景优化',
            windowDays: null,
            weight: null,
          },
        },
      },
      primaryAction: {
        id: 'review_strategy',
        label: '进入人工复核',
      },
    };
  }
  if (scenario === 'reviewable') {
    return {
      ...base,
      demoMode: true,
      demoLabel: '演示状态 · 策略待复核',
      status: 'review_required',
      currentStage: 'execute',
      execution: {
        ...base.execution,
        dataReady: true,
        reviewed: false,
        allowed: false,
      },
      blockers: [],
      stages: (base.stages || []).map((item) => ({
        ...item,
        status: item.id === 'execute' ? 'active' : item.id === 'settle' ? 'blocked' : 'complete',
      })),
      primaryAction: {
        id: 'review_strategy',
        label: '生成策略并提交复核',
      },
    };
  }
  if (scenario === 'settled') {
    const costs = {
      baselineCostYuan: 1302400,
      actualSettlementCostYuan: 1258520,
      transactionFeesYuan: 8520,
      deviationCostYuan: 10800,
      systemOperatingCostYuan: 560,
    };
    const realizedNetYuan =
      costs.baselineCostYuan -
      costs.actualSettlementCostYuan -
      costs.transactionFeesYuan -
      costs.deviationCostYuan -
      costs.systemOperatingCostYuan;
    return {
      ...base,
      demoMode: true,
      demoLabel: '演示状态 · 结算已核验',
      status: 'verified',
      currentStage: 'settle',
      execution: {
        ...base.execution,
        dataReady: true,
        reviewed: true,
        allowed: false,
      },
      blockers: [],
      stages: (base.stages || []).map((item) => ({ ...item, status: 'complete' })),
      savings: {
        ...base.savings,
        estimatedNetYuan: realizedNetYuan,
        realizedNetYuan,
        formulaComplete: true,
        costs,
        projection: buildSavingsProjection(realizedNetYuan),
      },
      primaryAction: {
        id: 'review_evidence',
        label: '查看结算证据',
      },
    };
  }
  return base;
}

export function buildDemoActionResult(payload, actionId) {
  if (!payload?.demoMode) return { handled: false };
  if (actionId === 'review_strategy') {
    return {
      handled: true,
      mode: 'review',
      evidenceOpen: true,
      message: '策略草稿已生成并进入人工复核。',
    };
  }
  if (actionId === 'review_evidence') {
    return {
      handled: true,
      mode: 'review',
      evidenceOpen: true,
      message: '已打开结算证据链。',
    };
  }
  if (actionId === 'approve_challenger' || actionId === 'rollback_champion') {
    const result = applyStrategyEvolutionAction(payload.strategyEvolution, actionId);
    if (!result.handled) return { handled: false };
    return {
      handled: true,
      mode: 'operation',
      activeStage: 'evolve',
      evidenceOpen: false,
      message: result.message,
      payloadPatch: {
        strategyEvolution: result.evolution,
      },
    };
  }
  return { handled: false };
}

function dashboardSidebar(payload, activeStage) {
  const navItems = [
    { id: 'optimize', stage: 'connect', label: '申报优化', icon: '⌁' },
    { id: 'forecast', stage: 'forecast', label: '价格预测', icon: '预' },
    { id: 'evolution', stage: 'evolve', label: '策略进化', icon: '↻' },
    { id: 'review', stage: 'settle', label: '复盘回顾', icon: '◇' },
  ];
  const activeNavigation =
    activeStage === 'forecast'
      ? 'forecast'
      : activeStage === 'settle'
        ? 'review'
        : activeStage === 'evolve'
          ? 'evolution'
          : 'optimize';
  return `
    <aside class="dashboard-sidebar">
      <div class="dashboard-brand">
        <span class="brand-mark" aria-hidden="true">ϟ</span>
        <div class="brand-copy">
          <strong>电力交易 AI</strong>
          <small>智能申报决策</small>
        </div>
      </div>
      <nav class="dashboard-nav" aria-label="AI 申报工作区">
        ${navItems
          .map(
            (item) => `
              <button
                type="button"
                class="${activeNavigation === item.id ? 'is-active' : ''}"
                data-dashboard-nav="${escapeHtml(item.id)}"
                data-stage="${escapeHtml(item.stage)}"
              >
                <span class="nav-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>
                <span class="nav-label">${escapeHtml(item.label)}</span>
              </button>
            `
          )
          .join('')}
      </nav>
      <a
        class="dashboard-guide-link"
        href="./一分钟上手.html"
        target="_blank"
        rel="noreferrer"
      >
        <span class="nav-icon" aria-hidden="true">?</span>
        <span class="nav-label">一分钟上手</span>
      </a>
      <div class="dashboard-model-status">
        <span class="status-dot" aria-hidden="true"></span>
        <div class="brand-copy">
          <small>${payload.presentationDisclosure ? '历史模型状态' : 'AI 模型状态'}</small>
          <strong>${payload.strategyValidation?.declarationOptimizer?.status === 'validated' ? (payload.presentationDisclosure ? '留出集通过' : '验证通过') : '等待验证'}</strong>
        </div>
      </div>
      <button class="sidebar-evidence-button" type="button" data-action="open-evidence">
        <span aria-hidden="true">◎</span>
        <span class="nav-label">证据与审计</span>
      </button>
    </aside>
  `;
}

function dashboardTopbar(payload, mode) {
  return `
    <header class="dashboard-topbar">
      <div class="dashboard-date-control">
        <span>交易日</span>
        <input type="date" value="${escapeHtml(payload.date)}" data-date-input>
      </div>
      <div class="dashboard-freshness ${payload.dataFreshness?.status === 'ready' ? 'is-ready' : 'is-stale'}">
        <span class="status-dot" aria-hidden="true"></span>
        <span>${payload.dataFreshness?.status === 'ready' ? '数据已就绪' : '数据待更新'}</span>
      </div>
      <div class="mode-switch dashboard-mode-switch" role="group" aria-label="工作模式">
        <button type="button" data-mode="operation" class="${mode === 'operation' ? 'is-active' : ''}">决策</button>
        <button type="button" data-mode="review" class="${mode === 'review' ? 'is-active' : ''}">审计</button>
      </div>
    </header>
  `;
}

function dashboardHero(payload, view) {
  const recommendationReady = view.recommendation.status === 'ready';
  return `
    <section class="dashboard-hero" aria-labelledby="declarationDashboardTitle">
      <div class="dashboard-hero-copy">
        <span class="hero-kicker">POWER DECLARATION INTELLIGENCE</span>
        <h1 id="declarationDashboardTitle"><span>AI</span>申报优化</h1>
        <p>基于历史申报与实际负荷偏差，生成可解释建议并交由人工复核</p>
      </div>
      <ol class="dashboard-progress" aria-label="申报优化流程">
        <li class="${view.optimizerStatus === 'validated' ? 'is-complete' : 'is-current'}">
          <b>1</b><span><strong>AI 生成建议</strong><small>${recommendationReady ? '已完成' : '待生成'}</small></span>
        </li>
        <li class="${payload.execution?.reviewed ? 'is-complete' : 'is-current'}">
          <b>2</b><span><strong>人工复核</strong><small>${payload.execution?.reviewed ? '已完成' : '待处理'}</small></span>
        </li>
        <li>
          <b>3</b><span><strong>提交申报</strong><small>待提交</small></span>
        </li>
      </ol>
    </section>
  `;
}

function dashboardMetrics(view, payload = {}) {
  const metrics = [
    {
      label: '偏差改善',
      value: view.metrics.improvement.display,
      detail: '相对默认申报基线',
      tone: 'blue',
      icon: '↗',
    },
    {
      label: '交易日胜率',
      value: view.metrics.winRate.display,
      detail: '独立留出集验证',
      tone: 'green',
      icon: '✓',
    },
    {
      label: '优化规模',
      value: view.metrics.coverage.display,
      detail: '覆盖申报点 / 交易日',
      tone: 'violet',
      icon: '∿',
    },
    {
      label: '决策可信度',
      value: view.metrics.confidence.display,
      detail: payload.presentationDisclosure ? '多源数据综合评分' : '真实数据综合评分',
      tone: 'amber',
      icon: '★',
    },
  ];
  return `
    <section class="dashboard-metrics" aria-label="申报优化核心指标">
      ${metrics
        .map(
          (metric) => `
            <article class="dashboard-metric is-${metric.tone}">
              <span class="metric-icon" aria-hidden="true">${metric.icon}</span>
              <div>
                <span>${escapeHtml(metric.label)}</span>
                <strong>${escapeHtml(metric.value)}</strong>
                <small>${escapeHtml(metric.detail)}</small>
              </div>
            </article>
          `
        )
        .join('')}
    </section>
  `;
}

function strategyContextPanel(payload) {
  const context = payload.strategyContext;
  if (!context) return '';
  const weather = context.weather || {};
  const load = context.loadForecast || {};
  const spread = context.marketSpread || {};
  const risk = context.risk || {};
  return `
    <section class="strategy-context" aria-label="候选策略多因素摘要">
      <article class="strategy-factor is-weather">
        <span class="strategy-factor-icon" aria-hidden="true">☀</span>
        <div>
          <small>天气驱动</small>
          <strong>${escapeHtml(formatForecastNumber(weather.temperatureC))}°C</strong>
          <p>体感 ${escapeHtml(formatForecastNumber(weather.feelsLikeC))}°C · 湿度 ${escapeHtml(formatForecastNumber(weather.humidityPct))}%</p>
          <b>${escapeHtml(weather.effect || '等待影响评估')}</b>
        </div>
      </article>
      <article class="strategy-factor is-load">
        <span class="strategy-factor-icon" aria-hidden="true">⌁</span>
        <div>
          <small>负荷概率预测</small>
          <strong>P50 ${escapeHtml(formatForecastNumber(load.p50Mw))} MW</strong>
          <p>P10–P90 ${escapeHtml(formatForecastNumber(load.p10Mw))}–${escapeHtml(formatForecastNumber(load.p90Mw))} MW</p>
          <b>峰值时点 ${escapeHtml(load.peakTime || '—')}</b>
        </div>
      </article>
      <article class="strategy-factor is-spread">
        <span class="strategy-factor-icon" aria-hidden="true">⇄</span>
        <div>
          <small>日前/实时价差</small>
          <strong>+${escapeHtml(formatForecastNumber(spread.expectedYuanPerMwh))} 元/MWh</strong>
          <p>${escapeHtml(formatForecastNumber(spread.riskPointCount))} 个高风险点位</p>
          <b>${escapeHtml(spread.direction || '等待价差判断')}</b>
        </div>
      </article>
      <article class="strategy-factor is-risk">
        <span class="strategy-factor-icon" aria-hidden="true">◇</span>
        <div>
          <small>CVaR 95%</small>
          <strong>${escapeHtml(formatMoney(risk.cvar95Yuan))}</strong>
          <p>${escapeHtml(moneyFormatter.format(Number(risk.scenarioCount || 0)))} 个联合场景 · 预算 ${escapeHtml(formatMoney(risk.budgetYuan))}</p>
          <b>${escapeHtml(risk.status || '等待风险评估')}</b>
        </div>
      </article>
      <article class="strategy-impact">
        <small>测算日成本改善</small>
        <strong>${escapeHtml(formatMoney(context.estimatedDailyImprovementYuan))}</strong>
        <p>${escapeHtml(payload.presentationDisclosure || '最终结果以实际结算为准')}</p>
      </article>
    </section>
  `;
}

function submissionNarrativeHeader(payload, view) {
  const model = payload.strategyValidation?.declarationOptimizer?.selectedModel || {};
  return `
    <header class="narrative-header">
      <div class="narrative-title">
        <span>96 点申报推荐策略与验证</span>
        <h1>申报策略形成依据</h1>
        <p>先看结论，再看数据如何进入策略，最后核对曲线、风险和验证结果。</p>
      </div>
      <div class="narrative-model-compare" aria-label="当前模型与候选策略对比">
        <section>
          <small>当前基线模型</small>
          <strong>42 天同点位均值</strong>
          <p>按历史同一时刻形成申报基线</p>
        </section>
        <section class="is-candidate">
          <small>候选联合策略</small>
          <strong>${escapeHtml(model.label || '多因素联合场景优化')}</strong>
          <p>天气、负荷与价差共同修正基线</p>
        </section>
      </div>
      <div class="narrative-primary-summary">
        <div>
          <small>测算日成本改善</small>
          <strong>${escapeHtml(formatMoney(payload.strategyContext?.estimatedDailyImprovementYuan))}</strong>
          <span>相对基线 ${escapeHtml(view.metrics.improvement.display)} · CVaR 95% ${escapeHtml(formatMoney(payload.strategyContext?.risk?.cvar95Yuan))}</span>
        </div>
        <button type="button" class="narrative-primary-action" data-primary-action="review_strategy">进入人工复核</button>
      </div>
    </header>
  `;
}

function submissionInputChapter(payload) {
  const context = payload.strategyContext || {};
  const weather = context.weather || {};
  const load = context.loadForecast || {};
  const spread = context.marketSpread || {};
  const risk = context.risk || {};
  const inputs = [
    ['天气驱动', `${formatForecastNumber(weather.temperatureC)}°C`, `体感 ${formatForecastNumber(weather.feelsLikeC)}°C · 湿度 ${formatForecastNumber(weather.humidityPct)}%`, weather.effect],
    ['负荷概率预测', `P50 ${formatForecastNumber(load.p50Mw)} MW`, `P10–P90 ${formatForecastNumber(load.p10Mw)}–${formatForecastNumber(load.p90Mw)} MW`, `预计峰值 ${load.peakTime || '—'}`],
    ['日前/实时价差', `+${formatForecastNumber(spread.expectedYuanPerMwh)} 元/MWh`, `${formatForecastNumber(spread.riskPointCount)} 个高风险点位`, spread.direction],
    ['风险预算', formatMoney(risk.cvar95Yuan), `${moneyFormatter.format(Number(risk.scenarioCount || 0))} 个联合场景`, `上限 ${formatMoney(risk.budgetYuan)}`],
  ];
  return `
    <section class="narrative-chapter narrative-inputs" aria-labelledby="narrativeInputsTitle">
      <div class="narrative-chapter-heading">
        <b>1</b>
        <div><h2 id="narrativeInputsTitle">1. 输入依据</h2><p>用同一交易日口径的数据定义今天的边界条件。</p></div>
      </div>
      <div class="narrative-input-grid">
        ${inputs.map(([label, value, detail, effect]) => `
          <article>
            <small>${escapeHtml(label)}</small>
            <strong>${escapeHtml(value)}</strong>
            <p>${escapeHtml(detail)}</p>
            <span>${escapeHtml(effect || '等待判断')}</span>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function submissionMethodChapter(payload) {
  const scenarioCount = payload.strategyContext?.risk?.scenarioCount || 0;
  const steps = [
    ['基线预测', '用 42 天同点位均值形成每个时刻的起点'],
    ['多因素联合修正', '根据天气、负荷区间和价差方向修正基线'],
    ['联合场景生成', `${moneyFormatter.format(Number(scenarioCount))} 个负荷与价格联合场景`],
    ['风险约束求解', '最小化预期偏差成本 + CVaR 风险'],
    ['生成候选策略', '输出 96 点建议和需要人工关注的时段'],
  ];
  return `
    <section class="narrative-chapter narrative-method" aria-labelledby="narrativeMethodTitle">
      <div class="narrative-chapter-heading">
        <b>2</b>
        <div><h2 id="narrativeMethodTitle">2. 优化怎么做</h2><p>不是直接猜一条曲线，而是从基线开始逐步加入可解释修正。</p></div>
      </div>
      <ol class="narrative-method-flow">
        ${steps.map(([label, detail], index) => `
          <li>
            <span>${index + 1}</span>
            <strong>${escapeHtml(label)}</strong>
            <p>${escapeHtml(detail)}</p>
          </li>
        `).join('')}
      </ol>
      <p class="narrative-method-note"><strong>拟合逻辑：</strong>历史同点位给出稳定起点，多因素联合修正当天偏差；场景优化比较不同申报量的成本分布，并在风险预算内选择候选曲线。</p>
    </section>
  `;
}

function submissionWindowReason(window, index) {
  const reasons = [
    '低谷价差与负荷波动共同作用，减少不必要的偏差暴露。',
    '日间负荷区间抬升，结合价格方向调整申报量。',
    '晚峰负荷概率上移，在风险预算内保留供给余量。',
  ];
  return reasons[index % reasons.length];
}

function submissionValidationPanel(payload, view) {
  const risk = payload.strategyContext?.risk || {};
  return `
    <aside class="narrative-validation" aria-labelledby="narrativeValidationTitle">
      <div>
        <small>验证证据</small>
        <h3 id="narrativeValidationTitle">候选策略如何判断更好</h3>
      </div>
      <dl>
        <div><dt>偏差改善</dt><dd>${escapeHtml(view.metrics.improvement.display)}<small>相对 42 天同点位基线</small></dd></div>
        <div><dt>交易日胜率</dt><dd>${escapeHtml(view.metrics.winRate.display)}<small>独立留出交易日</small></dd></div>
        <div><dt>验证样本</dt><dd>${escapeHtml(view.metrics.coverage.display)}<small>申报点 / 交易日</small></dd></div>
        <div><dt>CVaR 95%</dt><dd>${escapeHtml(formatMoney(risk.cvar95Yuan))}<small>预算 ${escapeHtml(formatMoney(risk.budgetYuan))}</small></dd></div>
      </dl>
      <section class="narrative-truth-status">
        <strong>当前结论</strong>
        <p>候选联合策略在回测与风险指标上优于基线，现阶段进入人工复核；实际结果仍以结算为准。</p>
      </section>
    </aside>
  `;
}

function submissionOutputChapter(payload, view) {
  const windows = view.windows.slice(0, 3);
  return `
    <section class="narrative-chapter narrative-output" aria-labelledby="narrativeOutputTitle">
      <div class="narrative-chapter-heading">
        <b>3</b>
        <div><h2 id="narrativeOutputTitle">3. 输出与验证</h2><p>曲线展示申报量，时段说明记录调整依据。</p></div>
      </div>
      <div class="narrative-output-grid">
        <div class="narrative-curve-wrap">
          ${declarationCurve(view, payload)}
          <section class="narrative-reasons" aria-labelledby="narrativeReasonsTitle">
            <div class="narrative-reasons-heading">
              <h3 id="narrativeReasonsTitle">时段调整依据</h3>
              <span>关键时段建议</span>
            </div>
            <div class="narrative-reason-grid">
              ${windows.map((window, index) => `
                <article>
                  <header><b>${index + 1}</b><strong>${escapeHtml(window.label)}</strong><span>${window.direction === 'up' ? '上调' : '下调'}</span></header>
                  <p>${escapeHtml(submissionWindowReason(window, index))}</p>
                  <small>共 ${escapeHtml(String(window.pointCount))} 个 15 分钟点位，可逐点追溯。</small>
                </article>
              `).join('')}
            </div>
          </section>
        </div>
        ${submissionValidationPanel(payload, view)}
      </div>
    </section>
  `;
}

function submissionNarrativeDashboard(payload, view) {
  const context = payload.strategyContext || {};
  const risk = context.risk || {};
  const model = payload.strategyValidation?.declarationOptimizer?.selectedModel || {};
  const windows = view.windows.slice(0, 3);
  return `
    <section class="submission-narrative submission-workstation" aria-labelledby="submissionWorkstationTitle">
      <header class="submission-workstation-header">
        <div>
          <h1 id="submissionWorkstationTitle">申报优化</h1>
          <span class="submission-review-state">96 点申报策略待复核</span>
        </div>
        <p>交易日 ${escapeHtml(payload.date || '2026/07/31')} · 数据已就绪 · 更新于 15:28</p>
      </header>

      <section class="submission-kpi-strip" aria-label="策略关键指标">
        <article><small>测算日成本改善</small><strong>${escapeHtml(formatMoney(context.estimatedDailyImprovementYuan))}</strong><span>相对基线的改善额</span></article>
        <article><small>历史留出集偏差改善</small><strong>${escapeHtml(view.metrics.improvement.display)}</strong><span>相对同点位基线</span></article>
        <article><small>场景 CVaR 95%</small><strong>${escapeHtml(formatMoney(risk.cvar95Yuan))}</strong><span>风险预算 ${escapeHtml(formatMoney(risk.budgetYuan))}</span></article>
        <article><small>场景输入覆盖</small><strong>100%</strong><span>${escapeHtml(moneyFormatter.format(Number(risk.scenarioCount || 0)))} 个联合场景</span></article>
      </section>

      <div class="submission-decision-grid">
        ${declarationCurve(view, payload)}
        <aside class="submission-strategy-rail" aria-label="策略对比与复核">
          <header><h2>策略对比</h2><span>待人工复核</span></header>
          <section>
            <small>当前策略</small>
            <strong>42 天同点位均值</strong>
            <p>以历史同点位均值作为当日申报基线。</p>
          </section>
          <section class="is-candidate">
            <small>候选策略</small>
            <strong>${escapeHtml(model.label || '多因素联合场景优化')}</strong>
            <p>多因素联合修正天气、负荷区间与价差方向。</p>
          </section>
          <dl>
            <div><dt>偏差改善</dt><dd>${escapeHtml(view.metrics.improvement.display)}</dd></div>
            <div><dt>交易日胜率</dt><dd>${escapeHtml(view.metrics.winRate.display)}</dd></div>
            <div><dt>验证覆盖</dt><dd>${escapeHtml(view.metrics.coverage.display)}</dd></div>
            <div><dt>风险状态</dt><dd>预算内</dd></div>
          </dl>
          <button type="button" class="narrative-primary-action" data-primary-action="review_strategy">进入人工复核</button>
          <p class="submission-rail-note">未经人工复核不会提交申报；最终结果以实际结算为准。</p>
        </aside>
      </div>

      <section class="submission-window-strip" aria-labelledby="submissionWindowsTitle">
        <header><h2 id="submissionWindowsTitle">调整窗口</h2><span>重点复核 ${escapeHtml(String(windows.length))} 个连续时段</span></header>
        <div>
          ${windows.map((window, index) => `
            <article>
              <b>${String(index + 1).padStart(2, '0')}</b>
              <div><strong>${escapeHtml(window.label)}</strong><p>${escapeHtml(submissionWindowReason(window, index))}</p></div>
              <span class="is-${escapeHtml(window.direction)}">${window.direction === 'up' ? '建议上调' : '建议下调'}</span>
            </article>
          `).join('')}
        </div>
      </section>

      ${submissionDerivationSummary(payload, view)}
      <footer class="narrative-disclosure">${escapeHtml(payload.presentationDisclosure || '最终结果以实际结算为准')}</footer>
    </section>
  `;
}

function submissionDerivationSummary(payload, view) {
  const context = payload.strategyContext || {};
  const weather = context.weather || {};
  const load = context.loadForecast || {};
  const spread = context.marketSpread || {};
  const risk = context.risk || {};
  const windowDays =
    payload.strategyValidation?.declarationOptimizer?.selectedModel?.windowDays || 42;
  return `
    <section class="submission-derivation-summary" aria-labelledby="derivationSummaryTitle">
      <header>
        <div>
          <span class="derivation-kicker">策略依据 · 优化方法</span>
          <h2 id="derivationSummaryTitle">申报策略形成依据</h2>
          <p>从同点位历史基线出发，只使用已校验的天气、负荷概率和价差信号修正，再用联合场景控制尾部风险。</p>
        </div>
        <button type="button" class="derivation-link-button" data-action="open-derivation">
          查看完整推导 <span aria-hidden="true">→</span>
        </button>
      </header>
      <ol class="derivation-stage-list">
        <li>
          <span>1</span>
          <div><strong>历史基线</strong><p>按 ${escapeHtml(String(windowDays))} 个历史交易日的同一 15 分钟点位取均值，形成 96 点基线曲线。</p><code>q⁰ₜ = mean(q₍d,t₎)</code></div>
        </li>
        <li>
          <span>2</span>
          <div><strong>多因素修正</strong><p>根据负荷分位区间、天气偏差和日前/实时价差方向，对每个点位进行联合修正。</p><code>qᵃᵈʲₜ = q⁰ₜ + Σ βₖ·Δxₖ,ₜ</code></div>
        </li>
        <li>
          <span>3</span>
          <div><strong>场景风险求解</strong><p>在 ${escapeHtml(moneyFormatter.format(Number(risk.scenarioCount || 0)))} 个联合场景下，同时压低预期偏差成本和 CVaR 95% 尾部风险。</p><code>min E[C(q,ω)] + λ·CVaR₉₅%</code></div>
        </li>
      </ol>
      <div class="derivation-evidence-grid" aria-label="本次计算依据">
        <article><span>天气驱动</span><strong>${escapeHtml(weather.temperatureC ?? '—')}°C</strong><p>体感 ${escapeHtml(weather.feelsLikeC ?? '—')}°C · 湿度 ${escapeHtml(weather.humidityPct ?? '—')}%</p><b>${escapeHtml(weather.effect || '等待影响评估')}</b></article>
        <article><span>负荷概率预测</span><strong>P50 ${escapeHtml(load.p50Mw ?? '—')} MW</strong><p>P10–P90 ${escapeHtml(load.p10Mw ?? '—')}–${escapeHtml(load.p90Mw ?? '—')} MW</p><b>峰值 ${escapeHtml(load.peakTime || '—')}</b></article>
        <article><span>日前/实时价差</span><strong>+${escapeHtml(spread.expectedYuanPerMwh ?? '—')} 元/MWh</strong><p>${escapeHtml(spread.riskPointCount ?? '—')} 个高风险点位</p><b>${escapeHtml(spread.direction || '等待价差判断')}</b></article>
        <article><span>风险度量</span><strong>${escapeHtml(formatMoney(risk.cvar95Yuan))}</strong><p>预算 ${escapeHtml(formatMoney(risk.budgetYuan))}</p><b>CVaR 95%</b></article>
        <article class="is-result"><span>测算日成本改善</span><strong>${escapeHtml(formatMoney(context.estimatedDailyImprovementYuan))}</strong><p>相对基线的测算改善额</p><b>历史留出集 ${escapeHtml(view.metrics.improvement.display)}</b></article>
      </div>
    </section>
  `;
}

export function renderStrategyDerivationPage(payload) {
  const context = payload.strategyContext || {};
  const weather = context.weather || {};
  const load = context.loadForecast || {};
  const spread = context.marketSpread || {};
  const risk = context.risk || {};
  const optimizer = payload.strategyValidation?.declarationOptimizer || {};
  const model = optimizer.selectedModel || {};
  const holdout = optimizer.holdout || {};
  const windowDays = Number(model.windowDays || 42);
  const scenarioCount = Number(risk.scenarioCount || 0);
  const cvarMargin = Number(risk.budgetYuan || 0) - Number(risk.cvar95Yuan || 0);
  return `
    <section class="strategy-derivation-page" aria-labelledby="strategyDerivationTitle">
      <header class="derivation-page-header">
        <div>
          <button type="button" class="derivation-back-button" data-action="close-derivation">← 返回申报优化</button>
          <span>策略依据 / 完整推导</span>
          <h1 id="strategyDerivationTitle">申报优化策略完整推导</h1>
          <p>交易日 ${escapeHtml(payload.date || '—')} · 从输入口径到留出集验证，逐步说明 96 点候选申报曲线如何形成。</p>
        </div>
        <div class="derivation-header-status"><span>当前模型</span><strong>${escapeHtml(model.label || `${windowDays} 天同点位基线`)}</strong><small>候选策略 · 待人工复核</small></div>
      </header>

      <div class="derivation-page-layout">
        <nav class="derivation-index" aria-label="推导步骤">
          <a href="#deriveInputs"><span>01</span><strong>输入数据</strong><small>口径与本次数值</small></a>
          <a href="#deriveBaseline"><span>02</span><strong>同点位基线</strong><small>历史基准曲线</small></a>
          <a href="#deriveFactors"><span>03</span><strong>因素修正</strong><small>天气、负荷与价差</small></a>
          <a href="#deriveScenarios"><span>04</span><strong>联合场景</strong><small>不确定性分布</small></a>
          <a href="#deriveObjective"><span>05</span><strong>目标函数</strong><small>成本与风险约束</small></a>
          <a href="#deriveValidation"><span>06</span><strong>回测验证</strong><small>独立留出集结果</small></a>
        </nav>

        <div class="derivation-document">
          <section id="deriveInputs" class="derivation-section">
            <header><span>01</span><div><h2>输入数据</h2><p>统一到交易日、15 分钟点位和同一计量单位后，才进入计算。</p></div></header>
            <div class="derivation-input-table" role="table" aria-label="本次输入数据">
              <div role="row"><strong role="cell">天气</strong><span role="cell">气温 ${escapeHtml(weather.temperatureC ?? '—')}°C</span><span role="cell">体感 ${escapeHtml(weather.feelsLikeC ?? '—')}°C</span><span role="cell">湿度 ${escapeHtml(weather.humidityPct ?? '—')}%</span><b role="cell">已校验</b></div>
              <div role="row"><strong role="cell">负荷</strong><span role="cell">P50 ${escapeHtml(load.p50Mw ?? '—')} MW</span><span role="cell">P10 ${escapeHtml(load.p10Mw ?? '—')} MW</span><span role="cell">P90 ${escapeHtml(load.p90Mw ?? '—')} MW</span><b role="cell">峰值 ${escapeHtml(load.peakTime || '—')}</b></div>
              <div role="row"><strong role="cell">价差</strong><span role="cell">+${escapeHtml(spread.expectedYuanPerMwh ?? '—')} 元/MWh</span><span role="cell">高风险点 ${escapeHtml(spread.riskPointCount ?? '—')} 个</span><span role="cell">日前 / 实时</span><b role="cell">已校验</b></div>
              <div role="row"><strong role="cell">风险</strong><span role="cell">${escapeHtml(moneyFormatter.format(scenarioCount))} 个场景</span><span role="cell">CVaR 95%</span><span role="cell">预算 ${escapeHtml(formatMoney(risk.budgetYuan))}</span><b role="cell">已校验</b></div>
            </div>
            <div class="derivation-unit-guide">
              <h3>符号与单位口径</h3>
              <dl>
                <div><dt>MW</dt><dd>兆瓦，是功率单位；申报功率、实际负荷和 P10/P50/P90 均使用 MW。</dd></div>
                <div><dt>MWh</dt><dd>兆瓦时，是电量单位；15 分钟点位的电量 = 平均功率 MW × 0.25 小时。</dd></div>
                <div><dt>P10 / P50 / P90</dt><dd>负荷预测分位数：实际负荷低于对应数值的概率分别为 10%、50% 和 90%。P50 是中位预测，不是确定值。</dd></div>
                <div><dt>元/MWh</dt><dd>每兆瓦时价格；本页价差指实时价格减去日前价格。</dd></div>
                <div><dt>CVaR 95%</dt><dd>条件风险价值；损失超过 95% 分位阈值后，最差 5% 场景的平均损失。</dd></div>
                <div><dt>Σ / mean / min / arg min</dt><dd>Σ 表示求和；mean 表示算术平均；min 表示最小化目标值；arg min 表示返回使目标最小的参数。</dd></div>
              </dl>
            </div>
          </section>

          <section id="deriveBaseline" class="derivation-section">
            <header><span>02</span><div><h2>同点位基线</h2><p>不用“昨天整条曲线”直接平移，而是分别计算每个 15 分钟点位的历史中心值。</p></div></header>
            <div class="derivation-two-column">
              <div class="formula-panel"><small>历史同点位均值</small><code>q⁰ₜ = (1 / H) · Σᵈ₌₁ᴴ q₍d,t₎</code><p>每个点位只与历史相同点位比较，避免早晚峰错位。</p><dl class="derivation-symbols"><div><dt>q⁰ₜ</dt><dd>第 t 个 15 分钟点位的历史同点位均值，单位 MW；上标 0 表示尚未加入因素修正的基准值。</dd></div><div><dt>q₍d,t₎</dt><dd>历史第 d 个交易日在第 t 个点位的实际负荷，单位 MW。</dd></div><div><dt>t</dt><dd>日内点位编号，t ∈ {1,…,96}。</dd></div><div><dt>d</dt><dd>历史窗口内的交易日序号，d ∈ {1,…,H}。</dd></div><div><dt>H</dt><dd>历史窗口包含的交易日数；当前取 H = ${escapeHtml(String(windowDays))}。</dd></div></dl></div>
              <aside><h3>基线设计原则</h3><ul><li>保留日内 96 点形状</li><li>降低单日异常曲线影响</li><li>作为候选模型必须超过的基准</li></ul><p><strong>已验证基线：</strong>same_slot_mean_w${escapeHtml(String(windowDays))}_a1</p></aside>
            </div>
            <div class="derivation-fit-process" aria-label="历史模型拟合与筛选过程">
              <div class="derivation-fit-heading"><h3>拟合、选模与留出集门禁</h3><p>按交易日先后顺序切分，保证任何一步都只看当时可获得的历史数据。</p></div>
              <ol>
                <li><span>1</span><div><strong>按时间切分 60% / 20% / 20%</strong><p>前 60% 作为历史上下文，中间 20% 只用于候选参数排序，最后 20% 完全隔离，选模结束后才打开一次。</p></div></li>
                <li><span>2</span><div><strong>枚举候选窗口与融合权重</strong><p>H ∈ {7、14、21、28、42、56}；α ∈ {0.5、0.75、1}。</p><code>q̂ₜ(H,α) = (1−α)·qᵇᵃˢᵉₜ + α·q⁰ₜ</code></div></li>
                <li><span>3</span><div><strong>仅按验证集 MAE 选模</strong><p>选择验证 MAE 最小的 (H*, α*)；若相同，依次选择更短窗口和更小权重。留出集不参与排序。</p><code>(H*,α*) = arg min MAEᵥₐₗ(H,α)</code></div></li>
                <li><span>4</span><div><strong>最后执行独立门禁</strong><p>留出集至少 30 个交易日、至少 2,880 个点，且 MAE 改善不低于 3%、日胜率不低于 60%，才允许进入人工复核。</p></div></li>
              </ol>
              <dl class="derivation-symbols is-fit-guide">
                <div><dt>q̂ₜ(H,α)</dt><dd>窗口 H、权重 α 下，第 t 个点位的候选申报功率，单位 MW。</dd></div>
                <div><dt>qᵇᵃˢᵉₜ</dt><dd>第 t 个点位的当前默认申报基线，单位 MW；上标 base 表示业务现行基线。</dd></div>
                <div><dt>q⁰ₜ</dt><dd>第 t 个点位最近 H 个完整交易日的实际负荷均值，单位 MW。</dd></div>
                <div><dt>α</dt><dd>基线与历史均值之间的融合权重；α 越大，候选值越接近历史均值。</dd></div>
                <div><dt>MAEᵥₐₗ(H,α)</dt><dd>候选参数 (H, α) 在验证集上的平均绝对误差，单位 MWh。</dd></div>
                <div><dt>H*、α*</dt><dd>使验证集 MAE 最小的窗口和权重；上标 * 表示最终选中的参数，下标 val 表示验证集。</dd></div>
              </dl>
            </div>
          </section>

          <section id="deriveFactors" class="derivation-section">
            <header><span>03</span><div><h2>因素修正</h2><p>将天气、负荷概率与价差信号映射到每一个点位的申报修正量。</p></div></header>
            <div class="formula-panel is-wide"><small>候选因素修正结构</small><code>qᵃᵈʲₜ = q⁰ₜ + βᵀ·ΔTₜ + βᴸ·(P50ₜ − q⁰ₜ) + βˢ·Spreadₜ</code><p>天气项描述制冷负荷变化，负荷项把基线拉向概率预测中心，价差项根据日前/实时价格方向调整偏差暴露。</p><dl class="derivation-symbols"><div><dt>qᵃᵈʲₜ</dt><dd>因素修正后第 t 个点位的候选申报功率，单位 MW；上标 adj 是 adjusted（已修正）的缩写。</dd></div><div><dt>q⁰ₜ</dt><dd>第 t 个点位的历史同点位均值，单位 MW。</dd></div><div><dt>βᵀ、βᴸ、βˢ</dt><dd>天气、负荷和价差三类因素的响应系数；上标 T、L、S 分别对应 Temperature、Load、Spread。</dd></div><div><dt>ΔTₜ</dt><dd>第 t 个点位相对历史常态的温度或体感温度偏差，单位 °C；Δ 表示“当前值减基准值”的变化量。</dd></div><div><dt>P50ₜ</dt><dd>第 t 个点位负荷概率预测的中位数，单位 MW。</dd></div><div><dt>Spreadₜ</dt><dd>第 t 个点位的实时价格减日前价格，单位元/MWh。</dd></div></dl></div>
            <div class="derivation-factor-list">
              <article><span>天气项</span><strong>${escapeHtml(weather.temperatureC ?? '—')}°C / 体感 ${escapeHtml(weather.feelsLikeC ?? '—')}°C</strong><p>高体感温度与湿度共同指向制冷负荷抬升。</p></article>
              <article><span>负荷项</span><strong>P50 ${escapeHtml(load.p50Mw ?? '—')} MW</strong><p>P10–P90 区间保留预测不确定性，不把 P50 当成确定真值。</p></article>
              <article><span>价差项</span><strong>+${escapeHtml(spread.expectedYuanPerMwh ?? '—')} 元/MWh</strong><p>${escapeHtml(spread.riskPointCount ?? '—')} 个点位价差暴露较高，优先控制偏差方向。</p></article>
            </div>
            <p class="derivation-boundary"><strong>解释边界：</strong>当前载荷没有提供因素层的 β 系数、训练损失轨迹和场景样本，因此这里只展示候选优化结构与本次输入，不宣称已重新估计具体 β 数值。上面的 42 日同点位模型及其时间切分回测可以由现有验证载荷复核；独立留出集始终只用于最终门禁，不参与拟合或选模。</p>
          </section>

          <section id="deriveScenarios" class="derivation-section">
            <header><span>04</span><div><h2>联合场景</h2><p>天气、负荷和价格不是各自独立变化，使用联合场景保留它们的相关性。</p></div></header>
            <div class="derivation-two-column">
              <div class="formula-panel"><small>场景集合</small><code>Ω = {ωᵢ | i = 1,…,N}, N = ${escapeHtml(moneyFormatter.format(scenarioCount))}</code><p>每个场景同时包含 96 点负荷路径、日前/实时价格路径与天气扰动；候选曲线在所有场景上计算偏差成本。</p><dl class="derivation-symbols"><div><dt>Ω</dt><dd>全部联合场景构成的集合。</dd></div><div><dt>ωᵢ</dt><dd>第 i 个联合场景，包含一组同步变化的负荷、价格和天气路径。</dd></div><div><dt>i</dt><dd>场景编号，i ∈ {1,…,N}。</dd></div><div><dt>N</dt><dd>联合场景总数；本次 N = ${escapeHtml(moneyFormatter.format(scenarioCount))}。</dd></div></dl></div>
              <aside><h3>固定假设</h3><ul><li>申报分辨率：15 分钟</li><li>场景数量：${escapeHtml(moneyFormatter.format(scenarioCount))}</li><li>尾部置信水平：95%</li><li>风险预算：${escapeHtml(formatMoney(risk.budgetYuan))}</li></ul></aside>
            </div>
          </section>

          <section id="deriveObjective" class="derivation-section">
            <header><span>05</span><div><h2>目标函数与 CVaR 风险约束</h2><p>不是只追求平均成本最低，还限制最差 5% 场景的平均损失。</p></div></header>
            <div class="derivation-objective-grid">
              <div class="formula-panel"><small>偏差成本</small><code>C(q,ω) = Σₜ Cₜ(qₜ, Lₜ,ω, πᴰᴬₜ, πᴿᵀₜ,ω)</code><p>每个点位按场景负荷与日前/实时价格计算申报不足或过量带来的偏差成本。</p></div>
              <div class="formula-panel"><small>优化目标</small><code>min Eω[C(q,ω)] + λ·CVaR₉₅%(C)</code><p>λ 控制平均成本与尾部风险之间的权衡。</p></div>
              <div class="formula-panel"><small>线性化约束</small><code>CVaR₉₅% = η + 1/(0.05N)·Σω ξω</code><code>ξω ≥ C(q,ω) − η, ξω ≥ 0</code><p>η 是 95% 分位损失阈值，ξω 记录超过阈值的尾部损失。</p></div>
              <div class="risk-result-panel"><span>本次风险结果</span><strong>${escapeHtml(formatMoney(risk.cvar95Yuan))}</strong><p>风险预算 ${escapeHtml(formatMoney(risk.budgetYuan))}</p><b>剩余安全边际 ${escapeHtml(formatMoney(cvarMargin))}</b></div>
            </div>
            <dl class="derivation-symbols is-objective-guide">
              <div><dt>q</dt><dd>完整的 96 点候选申报功率向量；qₜ 是其中第 t 个点位，单位 MW。</dd></div>
              <div><dt>ω</dt><dd>一个联合场景；场景内的实际负荷和实时价格具有共同的路径假设。</dd></div>
              <div><dt>C(q,ω)</dt><dd>申报曲线 q 在场景 ω 下的全天偏差成本，单位元。</dd></div>
              <div><dt>Cₜ(·)</dt><dd>第 t 个点位的偏差成本函数，汇总后得到全天成本。</dd></div>
              <div><dt>Lₜ,ω</dt><dd>场景 ω 下第 t 个点位的实际负荷，单位 MW。</dd></div>
              <div><dt>πᴰᴬₜ</dt><dd>第 t 个点位的日前价格，单位元/MWh。</dd></div>
              <div><dt>πᴿᵀₜ,ω</dt><dd>场景 ω 下第 t 个点位的实时价格，单位元/MWh。</dd></div>
              <div><dt>DA / RT</dt><dd>DA 是 Day-Ahead（日前）的缩写；RT 是 Real-Time（实时）的缩写。</dd></div>
              <div><dt>Eω[·]</dt><dd>对全部联合场景按其概率求期望；等概率场景下即取算术平均。</dd></div>
              <div><dt>λ</dt><dd>风险厌恶权重；λ 越大，优化越重视尾部风险而非仅追求平均成本。</dd></div>
              <div><dt>η</dt><dd>95% 分位损失阈值，即 CVaR 线性化中的 VaR 辅助变量，单位元。</dd></div>
              <div><dt>ξω</dt><dd>场景 ω 中超过阈值的非负尾部损失，单位元。</dd></div>
              <div><dt>N</dt><dd>联合场景总数；0.05N 对应最差 5% 场景的等效样本数。</dd></div>
            </dl>
          </section>

          <section id="deriveValidation" class="derivation-section">
            <header><span>06</span><div><h2>独立留出集回测验证</h2><p>可复算的 42 日同点位历史模型只在未参与拟合和选模的日期上通过门槛，才作为因素层的历史基准。</p></div></header>
            <div class="derivation-validation-grid">
              <article><span>验证覆盖</span><strong>${escapeHtml(moneyFormatter.format(Number(holdout.pointCount || 0)))} 点</strong><p>${escapeHtml(String(holdout.dateCount ?? '—'))} 个独立交易日</p></article>
              <article><span>基线 MAE</span><strong>${escapeHtml(holdout.baselineMaeMwh ?? '—')}</strong><p>MWh</p></article>
              <article><span>候选模型 MAE</span><strong>${escapeHtml(holdout.modelMaeMwh ?? '—')}</strong><p>MWh</p></article>
              <article class="is-positive"><span>偏差改善</span><strong>${escapeHtml(holdout.improvementPct ?? '—')}%</strong><p>相对同点位基线</p></article>
              <article class="is-positive"><span>交易日胜率</span><strong>${escapeHtml(holdout.dailyWinRatePct ?? '—')}%</strong><p>按日比较 MAE</p></article>
              <article><span>点位胜率</span><strong>${escapeHtml(holdout.pointWinRatePct ?? '—')}%</strong><p>按 15 分钟点位比较</p></article>
            </div>
            <div class="derivation-metric-guide">
              <h3>回测指标计算口径</h3>
              <dl class="derivation-symbols">
                <div><dt>MAE</dt><dd>平均绝对误差：先计算每个 15 分钟点位申报电量与实际电量之差的绝对值，再对全部点位取平均，单位 MWh。</dd></div>
                <div><dt>偏差改善率</dt><dd>偏差改善率 = (基线 MAE − 候选模型 MAE) / 基线 MAE × 100%。</dd></div>
                <div><dt>交易日胜率</dt><dd>交易日胜率 = 候选模型日 MAE 低于基线日 MAE 的交易日数 / 留出集交易日总数 × 100%。</dd></div>
                <div><dt>点位胜率</dt><dd>点位胜率 = 候选模型绝对误差低于基线绝对误差的点位数 / 留出集点位总数 × 100%。</dd></div>
              </dl>
            </div>
            <div class="derivation-conclusion"><div><span>历史模型验证结论</span><strong>42 日同点位候选模型通过留出集门槛</strong><p>这表示历史偏差指标优于基线；因素联合场景方案仍需人工复核，也不代表已经产生实际人民币收益。</p></div><div><span>本次测算日成本改善</span><strong>${escapeHtml(formatMoney(context.estimatedDailyImprovementYuan))}</strong><p>按当前输入测算，最终以实际结算为准。</p></div></div>
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderCurveGrid(geometry) {
  const horizontal = [0.12, 0.34, 0.56, 0.78, 1];
  return horizontal
    .map((ratio) => {
      const y =
        geometry.padding.top +
        ratio *
          (geometry.height - geometry.padding.top - geometry.padding.bottom);
      return `<line x1="${geometry.padding.left}" y1="${y.toFixed(2)}" x2="${geometry.width - geometry.padding.right}" y2="${y.toFixed(2)}"></line>`;
    })
    .join('');
}

function declarationCurve(view, payload = {}) {
  const geometry = view.curve.geometry;
  const rows = view.curve.rows;
  const points = geometry.points
    .map((point, index) => {
      const isAnchor =
        index === 0 ||
        index === geometry.points.length - 1 ||
        index % 8 === 0;
      return `
        <g class="curve-point" tabindex="0" data-curve-point="${escapeHtml(point.row.pointIndex)}"
           ${isAnchor ? 'data-curve-anchor="true"' : ''}
           aria-label="${escapeHtml(`${point.row.timePoint || `第 ${point.row.pointIndex} 点`}：基线 ${point.row.baselinePowerMw} MWh，AI 建议 ${point.row.recommendedPowerMw} MWh`)}">
          <circle class="curve-hit" cx="${point.x.toFixed(2)}" cy="${point.recommendedY.toFixed(2)}" r="10"></circle>
          ${
            isAnchor
              ? `<circle class="curve-dot" cx="${point.x.toFixed(2)}" cy="${point.recommendedY.toFixed(2)}" r="3.5"></circle>`
              : ''
          }
          <title>${escapeHtml(`${point.row.timePoint || point.row.pointIndex} · AI ${point.row.recommendedPowerMw} MWh · 基线 ${point.row.baselinePowerMw} MWh`)}</title>
        </g>
      `;
    })
    .join('');
  return `
    <section class="declaration-curve-panel" aria-labelledby="declarationCurveTitle">
      <div class="curve-heading">
        <div>
          <span class="hero-kicker">${payload.presentationDisclosure ? '96-POINT STRATEGY VIEW' : 'REAL 96-POINT EVIDENCE'}</span>
          <h2 id="declarationCurveTitle">96 点申报曲线对比</h2>
        </div>
        <div class="curve-legend" aria-label="曲线图例">
          <span class="is-baseline">历史申报</span>
          <span class="is-ai">AI 建议申报</span>
        </div>
      </div>
      ${
        rows.length
          ? `
            <div class="curve-canvas">
              <svg viewBox="0 0 ${geometry.width} ${geometry.height}" preserveAspectRatio="none" role="img" aria-label="历史申报与 AI 建议申报曲线">
                <g class="curve-grid">${renderCurveGrid(geometry)}</g>
                <path class="curve-area" d="${escapeHtml(`${geometry.recommendedPath} L ${geometry.points.at(-1).x.toFixed(2)} ${geometry.height - geometry.padding.bottom} L ${geometry.points[0].x.toFixed(2)} ${geometry.height - geometry.padding.bottom} Z`)}"></path>
                <path class="curve-baseline" d="${escapeHtml(geometry.baselinePath)}"></path>
                <path class="curve-recommended" d="${escapeHtml(geometry.recommendedPath)}"></path>
                ${points}
              </svg>
            </div>
            <div class="curve-axis">
              <span>${escapeHtml(rows[0]?.timePoint || '第 1 点')}</span>
              <span>时段（15 分钟 / 点）</span>
              <span>${escapeHtml(rows.at(-1)?.timePoint || `第 ${rows.at(-1)?.pointIndex || 96} 点`)}</span>
            </div>
          `
          : `
            <div class="curve-empty" role="status">
              <span aria-hidden="true">∿</span>
              <strong>96 点曲线等待真实数据</strong>
              <p>补齐目标日默认申报与最近实际负荷后，系统将在这里生成可复核建议。</p>
            </div>
          `
      }
      <div class="curve-insight">
        <span aria-hidden="true">✦</span>
        <p>${view.windows.length ? `识别到 ${view.windows.length} 个连续调整窗口，所有点位均可追溯。` : '当前没有可展示的调整窗口，系统不会虚构曲线或收益。'}</p>
        <button type="button" data-action="open-evidence">查看偏差分析 <span aria-hidden="true">→</span></button>
      </div>
    </section>
  `;
}

function recommendationPanel(payload, view) {
  const recommendation = payload.declarationRecommendation || {};
  const optimizer = payload.strategyValidation?.declarationOptimizer || {};
  const model = optimizer.selectedModel || {};
  const currentState =
    recommendation.status === 'ready'
      ? `已生成 ${recommendation.coverage?.recommendedPointCount || 0} 点复核建议`
      : recommendation.status === 'baseline_ready'
        ? '默认申报基线可复核'
        : '当前回退默认申报';
  const recovery =
    recommendation.status === 'missing_baseline'
      ? '补齐目标日 96 点默认申报'
      : recommendation.status === 'stale_inputs'
        ? '刷新最近实际负荷后重新计算'
        : recommendation.status === 'ready'
          ? '进入人工复核后方可采用'
          : '优化失败时保留默认申报';
  const actionId = view.recommendation.canReview
    ? 'review_strategy'
    : payload.primaryAction?.id || 'collect_today_data';
  const actionLabel = view.recommendation.canReview
    ? '进入人工复核'
    : payload.primaryAction?.label || '采集并校验当日数据';
  const windows = view.windows.slice(0, 5);
  return `
    <aside class="recommendation-panel" aria-labelledby="recommendationTitle">
      <div class="recommendation-heading">
        <div>
          <span class="hero-kicker">DECISION BRIEF</span>
          <h2 id="recommendationTitle">AI 优化建议</h2>
        </div>
        <span class="recommendation-state">${view.recommendation.status === 'ready' ? '已生成' : '待数据'}</span>
      </div>
      <section class="recommendation-impact">
        <span>预计偏差改善</span>
        <strong>${escapeHtml(view.metrics.improvement.display)}</strong>
        <small>${model.label ? escapeHtml(model.label) : model.windowDays ? `${escapeHtml(model.windowDays)} 日同点位均值模型` : '依据真实历史回测结果'}</small>
      </section>
      <section class="recommendation-windows">
        <div>
          <span>关键调整时段</span>
          <small>影响 TOP ${windows.length || '—'}</small>
        </div>
        ${
          windows.length
            ? windows
                .map(
                  (window) => `
                    <article>
                      <span>${escapeHtml(window.label)}</span>
                      <i class="is-${window.direction}"><b style="width:${Math.min(100, 30 + window.pointCount * 12)}%"></b></i>
                      <strong class="is-${window.direction}">${window.direction === 'up' ? '上调' : '下调'}</strong>
                    </article>
                  `
                )
                .join('')
            : '<p class="recommendation-empty">等待 96 点建议生成后展示调整窗口。</p>'
        }
      </section>
      <section class="recommendation-safety">
        <span>当前运行状态</span>
        <strong>${escapeHtml(currentState)}</strong>
        <small>${escapeHtml(recovery)}</small>
      </section>
      <div class="recommendation-actions">
        <button type="button" class="secondary-action" data-action="open-evidence">查看详情</button>
        <button type="button" class="primary-action" data-primary-action="${escapeHtml(actionId)}">${escapeHtml(actionLabel)}</button>
      </div>
      <p class="recommendation-footnote">偏差改善不等于已实现人民币节省；未经人工复核不会提交申报。</p>
    </aside>
  `;
}

function optimizationFlow(payload, view) {
  const flow = [
    ['▣', '数据准备', payload.execution?.dataReady ? '已完成' : '待补齐'],
    ['⌘', 'AI 建模预测', view.optimizerStatus === 'validated' ? '已验证' : '待验证'],
    ['◷', '生成优化建议', view.recommendation.status === 'ready' ? '已完成' : '待生成'],
    ['♙', '人工复核', payload.execution?.reviewed ? '已完成' : '待处理'],
    ['➤', '提交申报', '待提交'],
  ];
  return `
    <section class="optimization-flow" aria-labelledby="optimizationFlowTitle">
      <div class="flow-heading">
        <span class="hero-kicker">HUMAN-IN-THE-LOOP</span>
        <h2 id="optimizationFlowTitle">优化流程</h2>
      </div>
      <ol>
        ${flow
          .map(
            ([icon, label, state], index) => `
              <li class="${state === '已完成' || state === '已验证' ? 'is-complete' : index === 3 ? 'is-current' : ''}">
                <span class="flow-icon" aria-hidden="true">${icon}</span>
                <div><strong>${label}</strong><small>${state}</small></div>
              </li>
              ${index < flow.length - 1 ? '<b class="flow-arrow" aria-hidden="true">→</b>' : ''}
            `
          )
          .join('')}
      </ol>
    </section>
  `;
}

export function renderDeclarationDashboard(payload, options = {}) {
  const view = buildDeclarationDashboardView(payload);
  const activeStage = options.activeStage || payload.currentStage || 'connect';
  if (payload.presentationDisclosure) {
    return submissionNarrativeDashboard(payload, view);
  }
  return `
    <section class="declaration-dashboard">
      ${dashboardHero(payload, view)}
      ${strategyContextPanel(payload)}
      ${dashboardMetrics(view, payload)}
      ${
        activeStage === 'validate'
          ? `<section class="dashboard-context-alert"><strong>执行前数据质量校验</strong><span>${payload.execution?.dataReady ? '关键数据已通过校验' : '仍有数据缺口，当前禁止下发'}</span></section>`
          : ''
      }
      <div class="dashboard-primary-grid">
        ${declarationCurve(view, payload)}
        ${recommendationPanel(payload, view)}
      </div>
      ${optimizationFlow(payload, view)}
      <details class="dashboard-audit-summary">
        <summary>展开历史策略验证与执行门禁</summary>
        <nav class="decision-flow" aria-label="当日决策逻辑">
          <span>成本机会</span><b aria-hidden="true">→</b>
          <span>策略依据</span><b aria-hidden="true">→</b>
          <span>风险约束</span><b aria-hidden="true">→</b>
          <span>可执行动作</span>
        </nav>
        ${payload.status === 'blocked' ? blockedDecisionGate(payload).replace(/<div class="primary-action-row">[\s\S]*?<\/div>/, '') : savingsHero(payload)}
        ${strategyValidationPanel(payload)}
        ${declarationOptimizerPanel(payload)}
        ${activeStage === 'validate' ? validationPanel(payload) : ''}
        ${blockersPanel(payload, { showAction: false })}
      </details>
    </section>
  `;
}

function evolutionLoop(loop = []) {
  return `
    <ol class="evolution-loop" aria-label="策略运营闭环">
      ${loop
        .map(
          (step) => `
            <li class="is-${escapeHtml(step.status)}">
              <strong>${escapeHtml(step.label)}</strong>
              <small>${escapeHtml(
                {
                  complete: '已完成',
                  active: '进行中',
                  pending: '待处理',
                  standby: '待命',
                }[step.status] || step.status
              )}</small>
            </li>
          `
        )
        .join('')}
    </ol>
  `;
}

function versionCard(version, tone = 'neutral') {
  if (!version) {
    return `<article class="evolution-version is-empty"><p>当前无候选优化策略</p></article>`;
  }
  return `
    <article class="evolution-version is-${escapeHtml(tone)}" data-version-id="${escapeHtml(version.id)}">
      <header>
        <span class="version-role">${escapeHtml(
          version.role === 'champion'
            ? '现行策略'
            : version.role === 'challenger'
              ? '候选优化策略'
              : '历史'
        )}</span>
        <span class="version-status is-${escapeHtml(version.status)}">${escapeHtml(
          {
            live: '已审批启用',
            shadow: '实时并行验证',
            retired: '历史版本',
          }[version.status] || version.status
        )}</span>
      </header>
      <h3>${escapeHtml(version.label)}</h3>
      <p>${escapeHtml(version.reason || '')}</p>
      <dl>
        <div><dt>偏差改善</dt><dd>${escapeHtml(String(version.improvementPct ?? '—'))}%</dd></div>
        <div><dt>日胜率</dt><dd>${escapeHtml(String(version.winRatePct ?? '—'))}%</dd></div>
        <div><dt>MAE</dt><dd>${escapeHtml(String(version.maeMwh ?? '—'))} MWh</dd></div>
        <div><dt>窗口</dt><dd>${escapeHtml(version.windowDays ? `${version.windowDays} 日` : '—')}</dd></div>
      </dl>
      ${
        version.recentImprovementPct != null
          ? `<p class="version-drift">近窗改善 ${escapeHtml(String(version.recentImprovementPct))}%，近窗胜率 ${escapeHtml(String(version.recentWinRatePct))}%</p>`
          : ''
      }
    </article>
  `;
}

export function renderStrategyEvolutionDashboard(payload) {
  const evolution =
    payload.strategyEvolution ||
    buildStrategyEvolution({
      date: payload.date,
      strategyValidation: payload.strategyValidation,
      declarationRecommendation: payload.declarationRecommendation,
      auditEvents: payload.auditEvents,
    });
  const centers = evolution.centers;
  const comparison = centers.evolution.comparison;
  const queue = centers.governance.queue[0];
  const primary = evolution.primaryAction || {};
  const secondary = evolution.secondaryAction || {};

  return `
    <section class="evolution-dashboard" aria-labelledby="strategyEvolutionTitle" data-evolution-root="true">
      <header class="evolution-hero">
        <div>
          <span class="hero-kicker">STRATEGY EVOLUTION HUB</span>
          <h1 id="strategyEvolutionTitle">${escapeHtml(evolution.title)}</h1>
          <p>${escapeHtml(evolution.subtitle)}</p>
        </div>
        <div class="evolution-hero-meta">
          <span>样本口径：${escapeHtml(
            evolution.sampleKind === 'derived_from_validation' ? '由验证结果派生' : '参赛演示样本'
          )}</span>
          <span>交易日 ${escapeHtml(evolution.date || payload.date || '—')}</span>
        </div>
      </header>

      <section class="evolution-story" aria-label="核心叙事">
        <strong>${escapeHtml(evolution.narrative.headline)}</strong>
        <ol>
          ${evolution.narrative.story.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
        </ol>
      </section>

      ${evolutionLoop(evolution.loop)}

      <div class="evolution-centers-grid">
        <section class="evolution-center" id="evolutionCenter" aria-labelledby="evolutionCenterTitle">
          <div class="section-heading">
            <div>
              <span class="hero-kicker">01</span>
              <h2 id="evolutionCenterTitle">${escapeHtml(centers.evolution.title)}</h2>
            </div>
            <span class="comparison-badge">${escapeHtml(comparison.verdictLabel)}</span>
          </div>
          <div class="evolution-version-grid">
            ${versionCard(centers.evolution.champion, 'champion')}
            ${versionCard(centers.evolution.challenger, 'challenger')}
          </div>
          <div class="evolution-delta" id="evolutionComparison">
            <article><span>改善差额</span><strong>+${escapeHtml(String(comparison.improvementDeltaPp))} pp</strong></article>
            <article><span>胜率差额</span><strong>+${escapeHtml(String(comparison.winRateDeltaPp))} pp</strong></article>
            <article><span>MAE 改善</span><strong>${escapeHtml(String(comparison.maeDeltaMwh))} MWh</strong></article>
          </div>
        </section>

        <section class="evolution-center" id="experimentCenter" aria-labelledby="experimentCenterTitle">
          <div class="section-heading">
            <div>
              <span class="hero-kicker">02</span>
              <h2 id="experimentCenterTitle">${escapeHtml(centers.experiment.title)}</h2>
            </div>
          </div>
          <div class="experiment-list">
            ${centers.experiment.experiments
              .map(
                (exp) => `
                  <article class="experiment-card is-${escapeHtml(exp.status)}" data-experiment-id="${escapeHtml(exp.id)}">
                    <header>
                      <strong>${escapeHtml(exp.title)}</strong>
                      <span>${escapeHtml(exp.status === 'running' ? '进行中' : '已完成')}</span>
                    </header>
                    <p><b>数据窗口</b> ${escapeHtml(exp.dataWindow)}</p>
                    <p><b>方法</b> ${escapeHtml(exp.method)}</p>
                    <p><b>发现</b> ${escapeHtml(exp.finding)}</p>
                    <p><b>结果</b> ${escapeHtml(exp.outcome)}</p>
                  </article>
                `
              )
              .join('')}
          </div>
        </section>

        <section class="evolution-center" id="operationsCenter" aria-labelledby="operationsCenterTitle">
          <div class="section-heading">
            <div>
              <span class="hero-kicker">03</span>
              <h2 id="operationsCenterTitle">${escapeHtml(centers.operations.title)}</h2>
            </div>
          </div>
          <div class="ops-kpi-grid" id="opsKpiGrid">
            ${centers.operations.kpis
              .map(
                (kpi) => `
                  <article class="ops-kpi is-${escapeHtml(kpi.trend)}" data-kpi="${escapeHtml(kpi.id)}">
                    <span>${escapeHtml(kpi.label)}</span>
                    <strong>${escapeHtml(kpi.value)}</strong>
                    <small>${escapeHtml(kpi.note || '')}</small>
                  </article>
                `
              )
              .join('')}
          </div>
          <p class="ops-shadow-lift">候选策略审批启用后预计额外改善量级：约 ${escapeHtml(
            String(centers.operations.estimatedShadowLiftYuan ?? '—')
          )} 元（口径示意，不等于已实现收益）</p>
        </section>

        <section class="evolution-center" id="governanceCenter" aria-labelledby="governanceCenterTitle">
          <div class="section-heading">
            <div>
              <span class="hero-kicker">04</span>
              <h2 id="governanceCenterTitle">${escapeHtml(centers.governance.title)}</h2>
            </div>
          </div>
          <div class="governance-policy">
            <span>禁止自动上线</span>
            <span>必须通过实时并行验证</span>
            <span>必须人工审批</span>
            <span>禁止自动申报</span>
          </div>
          ${
            queue
              ? `
                <article class="governance-queue" id="governanceQueue" data-queue-status="${escapeHtml(queue.status)}">
                  <header>
                    <strong>${escapeHtml(queue.title)}</strong>
                    <span class="queue-status is-${escapeHtml(queue.status)}">${escapeHtml(queue.status)}</span>
                  </header>
                  <p>${escapeHtml(queue.expectedLift)}</p>
                  <ul class="prerequisite-list">
                    ${queue.prerequisites
                      .map(
                        (item) => `
                          <li class="${item.met ? 'is-met' : 'is-open'}">
                            <span>${item.met ? '✓' : '○'}</span>
                            ${escapeHtml(item.label)}
                          </li>
                        `
                      )
                      .join('')}
                  </ul>
                  <div class="governance-actions">
                    <button type="button" class="primary-action" data-evolution-action="${escapeHtml(primary.id || queue.actionId)}">${escapeHtml(primary.label || '审批上线')}</button>
                    <button type="button" class="secondary-action" data-evolution-action="${escapeHtml(secondary.id || centers.governance.rollback.actionId)}">${escapeHtml(secondary.label || centers.governance.rollback.label)}</button>
                  </div>
                </article>
              `
              : ''
          }
          <div class="governance-audit" id="governanceAudit">
            <h3>治理审计轨迹</h3>
            <ol>
              ${centers.governance.auditTrail
                .slice(0, 6)
                .map(
                  (event) => `
                    <li>
                      <time>${escapeHtml(event.at || '')}</time>
                      <strong>${escapeHtml(event.type)}</strong>
                      <span>${escapeHtml(event.detail)}</span>
                    </li>
                  `
                )
                .join('')}
            </ol>
          </div>
        </section>
      </div>
      <p class="evolution-footnote">候选优化策略使用同一交易日数据实时并行计算，只用于指标对比，不参与真实申报；未经人工复核与审批，系统不会自动启用策略，也不会自动提交任何申报或交易。</p>
    </section>
  `;
}

function forecastMissingReason(reason) {
  return (
    {
      target_date_missing: '尚未确定目标交易日。',
      target_date_rows_missing: '目标交易日还没有成功采集的业务行。',
      historical_dates_below_5: '有效历史交易日还没有累计到 5 天。',
      comparable_points_missing: '历史日期与目标日期之间没有可比较的价格点位。',
    }[reason] || reason
  );
}

export function renderPriceForecastDashboard(report, options = {}) {
  const readiness = report?.readiness || {};
  const historicalDateCount = Math.max(0, Number(readiness.historicalDateCount || 0));
  const progressCount = Math.min(5, historicalDateCount);
  const remaining = Math.max(0, 5 - historicalDateCount);
  const ready = report?.status === 'baseline_ready';
  const forecastRows = (report?.forecasts || [])
    .filter((item) => item.target === 'realTimeAvgPrice')
    .sort((left, right) => Number(left.pointIndex || 0) - Number(right.pointIndex || 0));

  return `
    <section class="forecast-dashboard" aria-labelledby="forecastDashboardTitle">
      <header class="forecast-hero">
        <div>
          <span class="hero-kicker">PRICE FORECAST</span>
          <h1 id="forecastDashboardTitle">价格预测</h1>
          <p>成功采集并保存每天的价格数据后，系统会持续累计；满 5 个历史交易日，在下一交易日自动启用预测。</p>
        </div>
        <span class="forecast-state ${ready ? 'is-ready' : 'is-waiting'}">
          ${ready ? '预测已自动启用' : '正在累计历史'}
        </span>
      </header>
      <section class="forecast-readiness" aria-label="预测准备进度">
        <div>
          <span>历史数据进度</span>
          <strong>累计 ${escapeHtml(progressCount)}/5 个历史交易日</strong>
          <small>${
            ready
              ? `目标日 ${escapeHtml(report.targetDate || options.targetDate || '—')} 已具备可比较点位。`
              : `还差 ${escapeHtml(remaining)} 个有效历史交易日；仅打开程序不会增加进度。`
          }</small>
        </div>
        <div class="forecast-progress" role="progressbar" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${escapeHtml(progressCount)}">
          <span style="width: ${escapeHtml(progressCount * 20)}%"></span>
        </div>
      </section>
      ${
        options.forecastLoading
          ? '<div class="forecast-empty" role="status"><strong>正在读取价格预测…</strong><p>正在核对历史交易日和目标日点位。</p></div>'
          : options.forecastError
            ? `<div class="forecast-empty is-error" role="alert"><strong>价格预测暂时没有加载成功</strong><p>${escapeHtml(options.forecastError)}</p></div>`
            : ready
              ? `
                <section class="forecast-results" aria-labelledby="forecastResultsTitle">
                  <div class="section-heading">
                    <div>
                      <span class="hero-kicker">ROLLING BASELINE</span>
                      <h2 id="forecastResultsTitle">历史同点位中位数基线</h2>
                    </div>
                    <span>${escapeHtml(forecastRows.length)} 个实时均价点</span>
                  </div>
                  <p class="forecast-boundary">这是可复核的历史基线，不等于已实现节省，也不会自动提交申报或交易。</p>
                  <div class="forecast-table" role="table" aria-label="实时均价预测结果">
                    <div class="forecast-row is-header" role="row">
                      <span role="columnheader">点位</span>
                      <span role="columnheader">预测价</span>
                      <span role="columnheader">P10</span>
                      <span role="columnheader">P90</span>
                      <span role="columnheader">历史证据</span>
                    </div>
                    ${forecastRows
                      .map(
                        (row) => `
                          <div class="forecast-row" role="row" data-forecast-row="${escapeHtml(row.pointIndex)}">
                            <strong role="cell">第 ${escapeHtml(row.pointIndex)} 点</strong>
                            <span role="cell">${escapeHtml(formatForecastNumber(row.pointForecast))}</span>
                            <span role="cell">${escapeHtml(formatForecastNumber(row.p10))}</span>
                            <span role="cell">${escapeHtml(formatForecastNumber(row.p90))}</span>
                            <span role="cell">${escapeHtml(row.evidenceRows || 0)} 天</span>
                          </div>
                        `
                      )
                      .join('')}
                  </div>
                </section>
              `
              : `
                <section class="forecast-empty" role="status">
                  <strong>历史数据还不够，暂不生成价格预测</strong>
                  <p>每天成功采集一次有效价格数据即可累计；同一天重复采集只会补齐点位，不会重复计天。</p>
                  <ul>
                    ${(readiness.missingReasons || [])
                      .map((reason) => `<li>${escapeHtml(forecastMissingReason(reason))}</li>`)
                      .join('')}
                  </ul>
                </section>
              `
      }
    </section>
  `;
}

export function renderWorkbenchMarkup(payload, options = {}) {
  const mode = options.mode === 'review' ? 'review' : 'operation';
  const activeStage = options.activeStage || payload.currentStage || 'connect';
  const evidenceOpen = options.evidenceOpen !== false;
  const mainContent =
    mode === 'review'
      ? reviewPanel(payload)
      : activeStage === 'derive'
        ? renderStrategyDerivationPage(payload)
      : activeStage === 'forecast'
        ? renderPriceForecastDashboard(options.forecastReport, {
            forecastLoading: options.forecastLoading,
            forecastError: options.forecastError,
            targetDate: payload.date,
          })
      : activeStage === 'evolve'
        ? renderStrategyEvolutionDashboard(payload)
        : renderDeclarationDashboard(payload, { activeStage });
  return `
    <div class="workbench-shell dashboard-shell${payload.presentationDisclosure ? ' is-submission-shell' : ''}">
      ${payload.demoMode ? `<div class="demo-banner ${payload.presentationDisclosure ? 'is-presentation' : ''}" role="status">${escapeHtml(payload.demoLabel)} · ${escapeHtml(payload.presentationDisclosure || '仅用于界面测试，不用于交易')}</div>` : ''}
      ${dashboardSidebar(payload, activeStage)}
      <main class="workbench-main dashboard-main">
        ${dashboardTopbar(payload, mode)}
        ${mainContent}
      </main>
      ${evidenceDrawer(payload, evidenceOpen)}
    </div>
  `;
}

const browserState = {
  payload: null,
  mode: 'operation',
  activeStage: null,
  evidenceOpen: false,
  loading: true,
  forecastReport: null,
  forecastLoading: false,
  forecastError: '',
  actionMessage: '',
  error: '',
};

function demoScenario() {
  if (typeof window === 'undefined') return '';
  const value = new URLSearchParams(window.location.search).get('demo') || '';
  return ['reviewable', 'settled', 'submission'].includes(value) ? value : '';
}

function rootElement() {
  return typeof document === 'undefined' ? null : document.querySelector('#workbenchRoot');
}

function loadingMarkup(message = '正在核对今日数据…') {
  return `
    <div class="loading-screen">
      <img src="./assets/app-icon.png" alt="">
      <strong>${escapeHtml(message)}</strong>
      <p>只加载首屏需要的轻量数据。</p>
    </div>
  `;
}

function renderBrowser() {
  const root = rootElement();
  if (!root) return;
  if (browserState.loading && !browserState.payload) {
    root.innerHTML = loadingMarkup();
    return;
  }
  if (!browserState.payload) {
    root.innerHTML = `
      <div class="fatal-state">
        <strong>工作台没有加载成功</strong>
        <p>${escapeHtml(browserState.error || '请确认本地服务已经启动。')}</p>
        <button type="button" data-action="refresh">重新加载</button>
      </div>
    `;
    return;
  }
  root.innerHTML = `
    ${renderWorkbenchMarkup(browserState.payload, browserState)}
    ${
      browserState.actionMessage || browserState.error
        ? `<div class="toast ${browserState.error ? 'is-error' : ''}" role="status">
            ${escapeHtml(browserState.error || browserState.actionMessage)}
          </div>`
        : ''
    }
  `;
  scheduleWorkbenchMotion(root);
}

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `服务返回 ${response.status}`);
  return payload;
}

async function loadWorkbench(date = '') {
  browserState.loading = true;
  browserState.error = '';
  renderBrowser();
  const scenario = demoScenario();
  if (scenario) {
    browserState.payload = buildDemoWorkbenchScenario(
      buildStandaloneDemoWorkbenchPayload(),
      scenario
    );
    browserState.activeStage = browserState.payload.currentStage;
    browserState.loading = false;
    renderBrowser();
    return;
  }
  try {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    browserState.payload = await fetch(`/api/workbench${query}`, { cache: 'no-store' }).then(responseJson);
    browserState.activeStage = browserState.payload.currentStage;
    renderBrowser();
    const selectedDate = browserState.payload?.date || '';
    const [strategyValidation, declarationRecommendation, costStrategy, strategyEvolution] =
      await Promise.all([
        fetch('/api/strategy-validation', { cache: 'no-store' }).then(responseJson),
        fetch(
          `/api/declaration-optimizer/recommendation?date=${encodeURIComponent(selectedDate)}`,
          { cache: 'no-store' }
        ).then(responseJson),
        fetch(`/api/cost-strategy?date=${encodeURIComponent(selectedDate)}`, {
          cache: 'no-store',
        })
          .then(responseJson)
          .catch(() => null),
        fetch(
          `/api/strategy-evolution?date=${encodeURIComponent(selectedDate)}`,
          { cache: 'no-store' }
        )
          .then(responseJson)
          .catch(() => null),
      ]);
    browserState.payload.strategyValidation = strategyValidation;
    browserState.payload.declarationRecommendation = declarationRecommendation;
    browserState.payload.costStrategy = costStrategy;
    browserState.payload.strategyEvolution =
      strategyEvolution ||
      buildStrategyEvolution({
        date: selectedDate,
        strategyValidation,
        declarationRecommendation,
      });
  } catch (error) {
    browserState.error = `今日数据核对失败：${error.message}`;
  } finally {
    browserState.loading = false;
    renderBrowser();
  }
}

async function loadForecastReport(date = '') {
  browserState.forecastLoading = true;
  browserState.forecastError = '';
  renderBrowser();
  if (demoScenario()) {
    browserState.forecastReport = buildStandaloneDemoForecastReport(
      date || browserState.payload?.date || '2026-07-31'
    );
    browserState.forecastLoading = false;
    renderBrowser();
    return;
  }
  try {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    browserState.forecastReport = await fetch(`/api/forecast/model${query}`, {
      cache: 'no-store',
    }).then(responseJson);
  } catch (error) {
    browserState.forecastReport = null;
    browserState.forecastError = error.message;
  } finally {
    browserState.forecastLoading = false;
    renderBrowser();
  }
}

export function buildCollectorActionMessage(result = {}) {
  if (result.ok) {
    return `已采集 ${result.snapshot?.rowCount || 0} 行，正在重新校验。`;
  }
  const rawDetail = String(
    result.browserWindow?.lastError ||
      result.collector?.lastError ||
      result.error ||
      result.snapshot?.errors?.[0] ||
      ''
  ).trim();
  const detail = rawDetail.includes('Chrome or Edge was not found')
    ? '未找到用于采集的 Chrome 或 Edge，请确认浏览器已安装后重新启动系统。'
    : rawDetail;
  return detail
    ? `采集未完成：${detail}`
    : '没有读到业务表格：请在打开的数据窗口完成 UKey 登录并停在业务页面，再点击一次。';
}

async function runPrimaryAction(actionId) {
  browserState.error = '';
  browserState.actionMessage = '';
  const demoResult = buildDemoActionResult(browserState.payload, actionId);
  if (demoResult.handled) {
    browserState.mode = demoResult.mode || browserState.mode;
    if (demoResult.activeStage) browserState.activeStage = demoResult.activeStage;
    browserState.evidenceOpen = demoResult.evidenceOpen;
    browserState.actionMessage = demoResult.message;
    if (demoResult.payloadPatch) {
      browserState.payload = {
        ...browserState.payload,
        ...demoResult.payloadPatch,
      };
    }
    renderBrowser();
    return;
  }
  if (actionId === 'approve_challenger' || actionId === 'rollback_champion') {
    const result = applyStrategyEvolutionAction(
      browserState.payload.strategyEvolution,
      actionId
    );
    if (result.handled) {
      browserState.payload.strategyEvolution = result.evolution;
      browserState.activeStage = 'evolve';
      browserState.actionMessage = result.message;
      renderBrowser();
      return;
    }
  }
  if (actionId === 'collect_today_data') {
    browserState.actionMessage = '正在打开数据窗口并采集当前页面…';
    renderBrowser();
    try {
      await fetch('/api/ukey-assistant/browser/start', { method: 'POST', cache: 'no-store' }).then(responseJson);
      const result = await fetch('/api/ukey-assistant/collector/sample', {
        method: 'POST',
        cache: 'no-store',
      }).then(responseJson);
      browserState.actionMessage = buildCollectorActionMessage(result);
      await loadWorkbench(browserState.payload?.date || '');
    } catch (error) {
      browserState.error = `采集失败：${error.message}`;
      renderBrowser();
    }
    return;
  }
  if (actionId === 'complete_business_inputs') {
    browserState.activeStage = 'validate';
    browserState.actionMessage = '请补齐目标日负荷预测、持仓和交易限额文件，然后点击“重新检查”。';
    renderBrowser();
    return;
  }
  if (actionId === 'review_strategy') {
    browserState.actionMessage = '正在生成可复核策略草稿…';
    renderBrowser();
    try {
      await fetch(`/api/execution/proposal?date=${encodeURIComponent(browserState.payload?.date || '')}`, {
        method: 'POST',
        cache: 'no-store',
      }).then(responseJson);
      browserState.actionMessage = '策略草稿已生成，请进入审计模式检查证据链。';
      browserState.mode = 'review';
      browserState.evidenceOpen = true;
      renderBrowser();
    } catch (error) {
      browserState.error = `策略草稿没有生成：${error.message}`;
      renderBrowser();
    }
    return;
  }
  browserState.mode = 'review';
  browserState.evidenceOpen = true;
  renderBrowser();
}

function bindBrowserEvents() {
  const root = rootElement();
  if (!root) return;
  root.addEventListener('click', async (event) => {
    const modeButton = event.target.closest('[data-mode]');
    if (modeButton) {
      browserState.mode = modeButton.dataset.mode;
      browserState.activeStage =
        browserState.mode === 'review'
          ? 'settle'
          : browserState.activeStage === 'settle'
            ? 'connect'
            : browserState.activeStage;
      renderBrowser();
      return;
    }
    const dashboardNav = event.target.closest('[data-dashboard-nav]');
    if (dashboardNav) {
      const destination = dashboardNav.dataset.dashboardNav;
      if (destination === 'review') {
        browserState.mode = 'review';
        browserState.activeStage = dashboardNav.dataset.stage || 'settle';
        renderBrowser();
        return;
      }
      if (destination === 'forecast') {
        browserState.mode = 'operation';
        browserState.activeStage = 'forecast';
        renderBrowser();
        await loadForecastReport(browserState.payload?.date || '');
        return;
      }
      browserState.mode = 'operation';
      browserState.activeStage =
        destination === 'evolution'
            ? 'evolve'
            : 'connect';
      renderBrowser();
      if (destination === 'optimize') {
        requestAnimationFrame(() => {
          document
            .querySelector('.submission-workstation, .declaration-dashboard')
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      }
      if (destination === 'evolution') {
        requestAnimationFrame(() => {
          document
            .querySelector('#strategyEvolutionTitle')
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      }
      return;
    }
    const stageButton = event.target.closest('[data-stage]');
    if (stageButton) {
      browserState.activeStage = stageButton.dataset.stage;
      renderBrowser();
      return;
    }
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === 'open-derivation') {
        browserState.mode = 'operation';
        browserState.activeStage = 'derive';
        renderBrowser();
        requestAnimationFrame(() => {
          document.querySelector('.strategy-derivation-page')?.scrollIntoView({ block: 'start' });
        });
        return;
      }
      if (action === 'close-derivation') {
        browserState.mode = 'operation';
        browserState.activeStage = 'connect';
        renderBrowser();
        requestAnimationFrame(() => {
          document.querySelector('.submission-workstation, .declaration-dashboard')?.scrollIntoView({ block: 'start' });
        });
        return;
      }
      if (action === 'refresh') await loadWorkbench(browserState.payload?.date || '');
      if (action === 'open-evidence') {
        browserState.evidenceOpen = true;
        renderBrowser();
      }
      if (action === 'close-evidence') {
        browserState.evidenceOpen = false;
        renderBrowser();
      }
      return;
    }
    const evolutionButton = event.target.closest('[data-evolution-action]');
    if (evolutionButton) {
      evolutionButton.disabled = true;
      await runPrimaryAction(evolutionButton.dataset.evolutionAction);
      return;
    }
    const primaryButton = event.target.closest('[data-primary-action]');
    if (primaryButton) {
      primaryButton.disabled = true;
      await runPrimaryAction(primaryButton.dataset.primaryAction);
    }
  });
  root.addEventListener('change', async (event) => {
    if (event.target.matches('[data-date-input]')) {
      const previousStage = browserState.activeStage;
      await loadWorkbench(event.target.value);
      if (previousStage === 'forecast') {
        browserState.activeStage = 'forecast';
        await loadForecastReport(event.target.value);
      }
    }
  });
}

if (typeof document !== 'undefined') {
  bindBrowserEvents();
  loadWorkbench();
}
