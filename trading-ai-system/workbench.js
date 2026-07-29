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

export function renderWorkbenchMarkup(payload, options = {}) {
  const mode = options.mode === 'review' ? 'review' : 'operation';
  const activeStage = options.activeStage || payload.currentStage || 'connect';
  const evidenceOpen = options.evidenceOpen !== false;
  const heading = operationHeading(activeStage);
  return `
    <div class="workbench-shell">
      ${payload.demoMode ? `<div class="demo-banner" role="status">${escapeHtml(payload.demoLabel)} · 仅用于界面测试，不用于交易</div>` : ''}
      <header class="app-topbar">
        <div class="product-lockup">
          <img src="./assets/app-icon.png" alt="">
          <div>
            <strong>电力交易智能决策平台</strong>
            <span>成本优化 · 风险控制 · 结算验证</span>
          </div>
        </div>
        <div class="topbar-context">
          <label>
            <span>交易日</span>
            <input type="date" value="${escapeHtml(payload.date)}" data-date-input>
          </label>
          <div class="freshness ${payload.dataFreshness?.status === 'ready' ? 'is-ready' : 'is-stale'}">
            <span>数据截至</span>
            <strong>${escapeHtml(formatDateTime(payload.dataFreshness?.generatedAt))}${payload.dataFreshness?.status === 'stale' ? ' · 已过期' : ''}</strong>
          </div>
          <div class="mode-switch" role="group" aria-label="工作模式">
            <button type="button" data-mode="operation" class="${mode === 'operation' ? 'is-active' : ''}">决策</button>
            <button type="button" data-mode="review" class="${mode === 'review' ? 'is-active' : ''}">审计</button>
          </div>
        </div>
      </header>
      <aside class="process-sidebar">
        <div class="sidebar-intro">
          <span>全流程决策闭环</span>
          <strong>${escapeHtml(payload.date)}</strong>
        </div>
        ${stageNavigation(payload, activeStage)}
        <a href="./一分钟上手.html" target="_blank" rel="noreferrer" class="help-link">操作指引</a>
      </aside>
      <main class="workbench-main">
        ${
          mode === 'review'
            ? reviewPanel(payload)
            : `
              <div class="page-heading">
                <div>
                  <span class="eyebrow">${escapeHtml(heading.eyebrow)}</span>
                  <h1>${escapeHtml(heading.title)}</h1>
                  <p>${escapeHtml(heading.description)}</p>
                </div>
                <span class="trading-status">${escapeHtml(statusText(payload.status))}</span>
              </div>
              ${operationContent(payload, activeStage)}
            `
        }
      </main>
      ${evidenceDrawer(payload, evidenceOpen)}
    </div>
  `;
}

const browserState = {
  payload: null,
  mode: 'operation',
  activeStage: null,
  evidenceOpen: typeof window === 'undefined' ? true : window.innerWidth > 1100,
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
  try {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    browserState.payload = await fetch(`/api/workbench${query}`, { cache: 'no-store' }).then(responseJson);
    if (demoScenario()) {
      browserState.payload = buildDemoWorkbenchScenario(browserState.payload, demoScenario());
    }
    browserState.activeStage = browserState.payload.currentStage;
    renderBrowser();
    const date = browserState.payload?.date || '';
    const [strategyValidation, declarationRecommendation] = await Promise.all([
      fetch('/api/strategy-validation', { cache: 'no-store' }).then(responseJson),
      fetch(
        `/api/declaration-optimizer/recommendation?date=${encodeURIComponent(date)}`,
        { cache: 'no-store' }
      ).then(responseJson),
    ]);
    browserState.payload.strategyValidation = strategyValidation;
    browserState.payload.declarationRecommendation = declarationRecommendation;
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
