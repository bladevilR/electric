import { buildDeclarationDashboardView } from './lib/declaration-dashboard-view.mjs';
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
  return `
    <section class="savings-hero" aria-labelledby="savingsTitle">
      <div>
        <span class="eyebrow" id="savingsTitle">${verified ? '已核验成本优化额' : '预计综合成本优化额'}</span>
        <div class="savings-value ${value === null || value === undefined ? 'is-missing' : ''}" id="savingsValue">
          ${escapeHtml(formatMoney(value))}
        </div>
        <p>${escapeHtml(payload.savings?.formula || '基准成本 − 实际结算成本 − 手续费 − 偏差成本 − 系统运行成本')}</p>
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
          <span class="eyebrow">冠军基线 · 挑战者验证</span>
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
  };
}

export function buildDemoWorkbenchScenario(payload, scenario) {
  const base = structuredClone(payload || {});
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
        estimatedNetYuan: 24000,
        realizedNetYuan: 24000,
        formulaComplete: true,
        costs: {
          baselineCostYuan: 1302400,
          actualSettlementCostYuan: 1268520,
          transactionFeesYuan: 8520,
          deviationCostYuan: 10800,
          systemOperatingCostYuan: 560,
        },
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
      message: '演示：策略草稿已生成并进入人工复核。',
    };
  }
  if (actionId === 'review_evidence') {
    return {
      handled: true,
      mode: 'review',
      evidenceOpen: true,
      message: '演示：已打开结算证据链。',
    };
  }
  return { handled: false };
}

function dashboardSidebar(payload, activeStage) {
  const navItems = [
    { id: 'curve', stage: 'connect', label: 'AI申报优化', icon: '⌁' },
    { id: 'validate', stage: 'validate', label: '申报总览', icon: '▦' },
    { id: 'curve', stage: 'execute', label: '曲线对比', icon: '⌁' },
    { id: 'review', stage: 'settle', label: '复盘回顾', icon: '◇' },
  ];
  const activeNavigation =
    activeStage === 'validate'
      ? 'validate'
      : activeStage === 'settle'
        ? 'review'
        : 'primary';
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
                class="${
                  (activeNavigation === 'primary' && item.stage === 'connect') ||
                  (activeNavigation === item.id && item.stage !== 'connect')
                    ? 'is-active'
                    : ''
                }"
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
          <small>AI 模型状态</small>
          <strong>${payload.strategyValidation?.declarationOptimizer?.status === 'validated' ? '验证通过' : '等待验证'}</strong>
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

function dashboardMetrics(view) {
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
      detail: '真实数据综合评分',
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

function declarationCurve(view) {
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
          <span class="hero-kicker">REAL 96-POINT EVIDENCE</span>
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
        <small>${model.windowDays ? `${escapeHtml(model.windowDays)} 日同点位均值模型` : '依据真实历史回测结果'}</small>
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
  return `
    <section class="declaration-dashboard">
      ${dashboardHero(payload, view)}
      ${dashboardMetrics(view)}
      ${
        activeStage === 'validate'
          ? `<section class="dashboard-context-alert"><strong>执行前数据质量校验</strong><span>${payload.execution?.dataReady ? '关键数据已通过校验' : '仍有数据缺口，当前禁止下发'}</span></section>`
          : ''
      }
      <div class="dashboard-primary-grid">
        ${declarationCurve(view)}
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

export function renderWorkbenchMarkup(payload, options = {}) {
  const mode = options.mode === 'review' ? 'review' : 'operation';
  const activeStage = options.activeStage || payload.currentStage || 'connect';
  const evidenceOpen = options.evidenceOpen !== false;
  return `
    <div class="workbench-shell dashboard-shell">
      ${payload.demoMode ? `<div class="demo-banner" role="status">${escapeHtml(payload.demoLabel)} · 仅用于界面测试，不用于交易</div>` : ''}
      ${dashboardSidebar(payload, activeStage)}
      <main class="workbench-main dashboard-main">
        ${dashboardTopbar(payload, mode)}
        ${mode === 'review' ? reviewPanel(payload) : renderDeclarationDashboard(payload, { activeStage })}
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
  actionMessage: '',
  error: '',
};

function demoScenario() {
  if (typeof window === 'undefined') return '';
  const value = new URLSearchParams(window.location.search).get('demo') || '';
  return ['reviewable', 'settled'].includes(value) ? value : '';
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
    const [strategyValidation, declarationRecommendation, costStrategy] = await Promise.all([
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
    ]);
    browserState.payload.strategyValidation = strategyValidation;
    browserState.payload.declarationRecommendation = declarationRecommendation;
    browserState.payload.costStrategy = costStrategy;
  } catch (error) {
    browserState.error = `今日数据核对失败：${error.message}`;
  } finally {
    browserState.loading = false;
    renderBrowser();
  }
}

async function runPrimaryAction(actionId) {
  browserState.error = '';
  browserState.actionMessage = '';
  const demoResult = buildDemoActionResult(browserState.payload, actionId);
  if (demoResult.handled) {
    browserState.mode = demoResult.mode;
    browserState.evidenceOpen = demoResult.evidenceOpen;
    browserState.actionMessage = demoResult.message;
    renderBrowser();
    return;
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
      browserState.actionMessage = result.ok
        ? `已采集 ${result.snapshot?.rowCount || 0} 行，正在重新校验。`
        : '没有读到业务表格：请在打开的数据窗口完成 UKey 登录并停在业务页面，再点击一次。';
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
      browserState.mode = 'operation';
      browserState.activeStage =
        destination === 'validate'
          ? 'validate'
          : dashboardNav.dataset.stage || 'connect';
      renderBrowser();
      if (destination === 'curve') {
        requestAnimationFrame(() => {
          document
            .querySelector('#declarationCurveTitle')
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    const primaryButton = event.target.closest('[data-primary-action]');
    if (primaryButton) {
      primaryButton.disabled = true;
      await runPrimaryAction(primaryButton.dataset.primaryAction);
    }
  });
  root.addEventListener('change', async (event) => {
    if (event.target.matches('[data-date-input]')) {
      await loadWorkbench(event.target.value);
    }
  });
}

if (typeof document !== 'undefined') {
  bindBrowserEvents();
  loadWorkbench();
}
