const REQUIRED_POINTS = 96;
const STALE_AFTER_MINUTES = 30;

function numberOrNull(value) {
  if (value === '' || value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function chinaDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function rowsForDate(rows, date) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.date === date);
}

function countValues(rows, fields) {
  return rows.filter((row) => fields.some((field) => numberOrNull(row?.[field]) !== null)).length;
}

function statusForCount(count, required = REQUIRED_POINTS) {
  if (count <= 0) return 'missing';
  if (count < required) return 'partial';
  return 'ready';
}

function ageMinutes(timestamp, nowMs) {
  const value = new Date(timestamp || '').getTime();
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round((nowMs - value) / 60000));
}

function freshnessStatus(timestamp, nowMs) {
  const minutes = ageMinutes(timestamp, nowMs);
  if (minutes === null) return { status: 'missing', ageMinutes: null };
  return {
    status: minutes > STALE_AFTER_MINUTES ? 'stale' : 'ready',
    ageMinutes: minutes,
  };
}

function hasConfiguredLimits(values = {}) {
  const minimumQuantity = numberOrNull(values.minQuantityMwh);
  const maximumQuantity = numberOrNull(values.maxDraftQuantityMwh);
  const tradeLimitsReady =
    minimumQuantity !== null &&
    maximumQuantity !== null &&
    minimumQuantity >= 0 &&
    maximumQuantity >= 0 &&
    minimumQuantity <= maximumQuantity &&
    numberOrNull(values.buyPriceCeilingYuanPerMwh) !== null &&
    numberOrNull(values.sellPriceFloorYuanPerMwh) !== null;
  const minimumPower = numberOrNull(values.minDeclarationPowerMw);
  const maximumPower = numberOrNull(values.maxDeclarationPowerMw);
  const hasPowerBoundary = minimumPower !== null || maximumPower !== null;
  const powerLimitsValid =
    hasPowerBoundary &&
    (minimumPower === null || minimumPower >= 0) &&
    (maximumPower === null || maximumPower >= 0) &&
    (minimumPower === null ||
      maximumPower === null ||
      minimumPower <= maximumPower);
  return tradeLimitsReady && powerLimitsValid;
}

function evidence(id, label, status, value, detail, actionId = null) {
  return { id, label, status, value, detail, actionId };
}

function issue(id, title, detail, actionId, scope = 'execution') {
  return { id, title, detail, actionId, scope };
}

function completeCostFormula(costs = {}) {
  const values = {
    baselineCostYuan: numberOrNull(costs.baselineCostYuan),
    actualSettlementCostYuan: numberOrNull(costs.actualSettlementCostYuan),
    transactionFeesYuan: numberOrNull(costs.transactionFeesYuan),
    deviationCostYuan: numberOrNull(costs.deviationCostYuan),
    systemOperatingCostYuan: numberOrNull(costs.systemOperatingCostYuan),
  };
  return {
    values,
    complete: Object.values(values).every((value) => value !== null),
  };
}

function stage(id, label, status, description) {
  return { id, label, status, description };
}

export function buildSavingsWorkbench(options = {}) {
  const nowDate = new Date(options.now || Date.now());
  const nowMs = nowDate.getTime();
  const date = options.date || chinaDate(nowDate);
  const dataset = options.dataset || {};
  const currentRows = rowsForDate(dataset.rows, date);
  const businessInputs = options.businessInputs || {};
  const forecastRows = rowsForDate(businessInputs.forecastLoad96?.rows, date);
  const positionRows = rowsForDate(businessInputs.position96?.rows, date);
  const limits = businessInputs.tradeLimits?.values || {};
  const snapshot = options.ukeyStatus?.visibleSnapshot || {};
  const datasetFreshness = freshnessStatus(dataset.generatedAt, nowMs);
  const snapshotFreshness = freshnessStatus(snapshot.generatedAt, nowMs);

  const marketPriceCount = countValues(currentRows, [
    'realTimeAvgPrice',
    'realTimePointPriceCurrent',
    'dayAheadPublicPrice',
    'dayAheadUserPrice',
  ]);
  const actualLoadCount = countValues(currentRows, ['actualKwh']);
  const settlementCount = countValues(currentRows, ['settleAmount']);
  const forecastCount = countValues(forecastRows, ['forecastKwh']);
  const positionCount = countValues(positionRows, [
    'availableBuyMwh',
    'availableSellMwh',
    'contractedMwh',
    'tradedMwh',
  ]);
  const limitsReady = hasConfiguredLimits(limits);
  const datasetIsCurrent = currentRows.length > 0 && datasetFreshness.status === 'ready';
  const snapshotStatus = snapshot.accepted
    ? snapshotFreshness.status
    : snapshot.generatedAt
      ? 'rejected'
      : 'missing';

  const dataEvidence = [
    evidence(
      'market_price',
      '当日市场价格',
      statusForCount(marketPriceCount),
      `${marketPriceCount}/${REQUIRED_POINTS} 点`,
      marketPriceCount ? '仅统计所选交易日的有效价格点。' : '所选交易日没有价格数据。',
      'collect_today_data'
    ),
    evidence(
      'load_forecast',
      '96 点负荷预测',
      statusForCount(forecastCount),
      `${forecastCount}/${REQUIRED_POINTS} 点`,
      forecastCount ? '用于估算采购需求和偏差风险。' : '未获取目标日负荷预测。',
      'complete_business_inputs'
    ),
    evidence(
      'position',
      '当日持仓',
      statusForCount(positionCount),
      `${positionCount}/${REQUIRED_POINTS} 点`,
      positionCount ? '用于限制可买可卖电量。' : '未获取目标日持仓。',
      'complete_business_inputs'
    ),
    evidence(
      'trade_limits',
      '交易限额',
      limitsReady ? 'ready' : 'missing',
      limitsReady ? '已配置' : '未获取',
      limitsReady ? '交易电量、买卖限价和 MW 申报功率边界均已配置。' : '缺少或错误配置完整交易限额（含至少一侧 MW 申报功率边界）。',
      'complete_business_inputs'
    ),
    evidence(
      'actual_load',
      '当日实际负荷',
      statusForCount(actualLoadCount),
      `${actualLoadCount}/${REQUIRED_POINTS} 点`,
      actualLoadCount ? '用于结算后验证偏差和实际成本。' : '结算验收前必须补齐。',
      'collect_settlement_data'
    ),
    evidence(
      'settlement',
      '当日结算',
      settlementCount > 0 ? 'ready' : 'missing',
      settlementCount > 0 ? `${settlementCount} 条` : '未获取',
      settlementCount > 0 ? '已发现所选交易日结算证据。' : '没有结算就不能声明实际节省。',
      'collect_settlement_data'
    ),
    evidence(
      'visible_snapshot',
      '实时采集快照',
      snapshotStatus,
      snapshot.rowCount ? `${snapshot.rowCount} 行` : '未获取',
      snapshotFreshness.ageMinutes === null
        ? '没有可用快照。'
        : `快照距现在 ${snapshotFreshness.ageMinutes} 分钟。`,
      'collect_today_data'
    ),
  ];

  const blockers = [];
  if (!currentRows.length) {
    blockers.push(
      issue('current_day_missing', '没有当日业务数据', `${date} 没有可用于决策的业务行。`, 'collect_today_data')
    );
  } else if (!datasetIsCurrent) {
    blockers.push(
      issue('current_day_stale', '当日数据已过期', `数据距现在 ${datasetFreshness.ageMinutes} 分钟。`, 'collect_today_data')
    );
  }
  if (marketPriceCount < REQUIRED_POINTS) {
    blockers.push(
      issue(
        'market_price_incomplete',
        '当日价格不完整',
        `当前 ${marketPriceCount}/${REQUIRED_POINTS} 点。`,
        'collect_today_data'
      )
    );
  }
  if (forecastCount < REQUIRED_POINTS) {
    blockers.push(
      issue(
        'load_forecast_incomplete',
        '负荷预测不完整',
        `当前 ${forecastCount}/${REQUIRED_POINTS} 点。`,
        'complete_business_inputs'
      )
    );
  }
  if (positionCount < REQUIRED_POINTS) {
    blockers.push(
      issue(
        'position_incomplete',
        '持仓数据不完整',
        `当前 ${positionCount}/${REQUIRED_POINTS} 点。`,
        'complete_business_inputs'
      )
    );
  }
  if (!limitsReady) {
    blockers.push(issue('trade_limits_missing', '交易限额未配置', '不能计算安全的可执行电量。', 'complete_business_inputs'));
  }

  const costFormula = completeCostFormula(options.costs);
  const settlementEvidenceReady = actualLoadCount >= REQUIRED_POINTS && settlementCount > 0;
  if (settlementEvidenceReady && !costFormula.complete) {
    blockers.push(
      issue(
        'cost_formula_incomplete',
        '成本优化公式口径不完整',
        '基准成本、实际结算成本、手续费、偏差成本和系统运行成本必须全部到位。',
        'complete_cost_evidence',
        'verification'
      )
    );
  }

  const executionBlockers = blockers.filter((item) => item.scope === 'execution');
  const dataReady = executionBlockers.length === 0;
  const reviewed = Boolean(options.executionReview?.approved);
  const executionAllowed = dataReady && reviewed;
  const realizedNetYuan =
    settlementEvidenceReady && costFormula.complete
      ? costFormula.values.baselineCostYuan -
        costFormula.values.actualSettlementCostYuan -
        costFormula.values.transactionFeesYuan -
        costFormula.values.deviationCostYuan -
        costFormula.values.systemOperatingCostYuan
      : null;
  const verified = realizedNetYuan !== null;

  const connectComplete = datasetIsCurrent && marketPriceCount > 0;
  const validateComplete = dataReady;
  const executeComplete = executionAllowed;
  const settleComplete = verified;
  const stages = [
    stage('connect', '数据接入', connectComplete ? 'complete' : 'active', connectComplete ? '当日数据已接入' : '需要采集当日数据'),
    stage(
      'validate',
      '质量校验',
      validateComplete ? 'complete' : connectComplete ? 'active' : 'blocked',
      validateComplete ? '执行所需数据已通过校验' : '缺失项会阻止执行'
    ),
    stage(
      'execute',
      '策略决策',
      executeComplete ? 'complete' : validateComplete ? 'active' : 'blocked',
      executeComplete ? '人工复核已通过' : validateComplete ? '等待人工复核' : '等待数据校验'
    ),
    stage(
      'settle',
      '结算评估',
      settleComplete ? 'complete' : executeComplete ? 'active' : 'blocked',
      settleComplete ? '成本优化绩效已核验' : '结算后才计入已实现成本优化额'
    ),
  ];

  const currentStage = settleComplete
    ? 'settle'
    : validateComplete
      ? 'execute'
      : connectComplete
        ? 'validate'
        : 'connect';
  const status = verified ? 'verified' : dataReady ? 'review_required' : 'blocked';
  const primaryAction = !currentRows.length || marketPriceCount < REQUIRED_POINTS || !datasetIsCurrent
    ? { id: 'collect_today_data', label: '采集并校验当日数据' }
    : !dataReady
      ? { id: 'complete_business_inputs', label: '补齐执行数据' }
      : !reviewed
        ? { id: 'review_strategy', label: '生成策略并提交复核' }
        : { id: 'collect_settlement_data', label: '导入结算并评估绩效' };

  return {
    generatedAt: nowDate.toISOString(),
    date,
    status,
    currentStage,
    dataFreshness: {
      status: datasetFreshness.status,
      generatedAt: dataset.generatedAt || null,
      ageMinutes: datasetFreshness.ageMinutes,
    },
    savings: {
      estimatedNetYuan: numberOrNull(options.estimatedNetYuan),
      realizedNetYuan,
      formulaComplete: costFormula.complete,
      formula:
        '基准成本 − 实际结算成本 − 手续费 − 偏差成本 − 系统运行成本',
      costs: costFormula.values,
    },
    execution: {
      dataReady,
      reviewed,
      allowed: executionAllowed,
      mode: 'human_decision_only',
    },
    metrics: {
      rowCount: currentRows.length,
      marketPricePointCount: marketPriceCount,
      forecastLoadPointCount: forecastCount,
      positionPointCount: positionCount,
      actualLoadPointCount: actualLoadCount,
      settlementPointCount: settlementCount,
      tradeLimitsConfigured: limitsReady,
      executionInputsReady:
        forecastCount >= REQUIRED_POINTS && positionCount >= REQUIRED_POINTS && limitsReady,
    },
    stages,
    blockers,
    dataEvidence,
    primaryAction,
    auditEvents: (Array.isArray(options.auditEvents) ? options.auditEvents : []).slice(0, 8),
  };
}
