import { appendAuditEvent } from './audit-log.mjs';
import { buildStrategyReport } from './strategy-report.mjs';

function uniqueText(items) {
  return [...new Set(items.filter(Boolean))];
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function sum(rows, key) {
  return round(rows.reduce((total, row) => total + (numeric(row[key]) || 0), 0));
}

function rowsForPoints(rows = [], date, points = []) {
  const pointSet = new Set(points.map(Number));
  return rows.filter((row) => row.date === date && pointSet.has(Number(row.pointIndex)));
}

function readinessBlockers(readiness = {}) {
  return (Array.isArray(readiness.blockers) ? readiness.blockers : []).map((item) => {
    const details = Array.isArray(item.missingKeys) && item.missingKeys.length
      ? `：缺少 ${item.missingKeys.join(', ')}`
      : '';
    return `${item.title || item.id}${details}`;
  });
}

function readinessWarnings(readiness = {}) {
  return (Array.isArray(readiness.warnings) ? readiness.warnings : []).map((item) => {
    const details = Array.isArray(item.missingKeys) && item.missingKeys.length
      ? `：缺少 ${item.missingKeys.join(', ')}`
      : item.evidence?.items?.length
        ? `：${item.evidence.items.join('、')}`
        : '';
    return `${item.title || item.id}${details}`;
  });
}

function lineDirection(suggestion) {
  if (suggestion.type === 'low_price') {
    return '买入观察';
  }
  if (suggestion.type === 'high_price_risk') {
    return '风险控制';
  }
  return '补齐数据';
}

function capQuantity(quantity, limits = {}) {
  const value = numeric(quantity);
  if (value === null) {
    return null;
  }
  const max = numeric(limits.maxDraftQuantityMwh);
  const min = numeric(limits.minQuantityMwh);
  if (max !== null && value > max) {
    return max;
  }
  if (min !== null && value < min) {
    return null;
  }
  return round(value);
}

function linePrefill({ suggestion, date, businessInputs = {} }) {
  const points = Array.isArray(suggestion.points) ? suggestion.points : [];
  const forecastRows = rowsForPoints(businessInputs.forecastLoad96?.rows, date, points);
  const positionRows = rowsForPoints(businessInputs.position96?.rows, date, points);
  const limits = businessInputs.tradeLimits?.values || {};
  const forecastMwh = round(sum(forecastRows, 'forecastKwh') / 1000);
  const buyMwh = sum(positionRows, 'availableBuyMwh');
  const sellMwh = sum(positionRows, 'availableSellMwh');
  const isBuy = suggestion.type === 'low_price';
  const quantityMwh = capQuantity(isBuy ? buyMwh : sellMwh, limits);
  const priceLimit = isBuy
    ? numeric(limits.buyPriceCeilingYuanPerMwh)
    : numeric(limits.sellPriceFloorYuanPerMwh);
  const evidence = [];

  if (forecastRows.length) {
    evidence.push(`预测负荷 ${forecastRows.length} 点，合计 ${forecastMwh} MWh`);
  }
  if (positionRows.length) {
    evidence.push(
      `持仓边界 ${positionRows.length} 点，可买 ${round(buyMwh)} MWh，可卖 ${round(sellMwh)} MWh`
    );
  }
  if (priceLimit !== null) {
    evidence.push(`限价 ${priceLimit} 元/MWh`);
  }

  return {
    quantityMwh,
    priceLimit,
    evidence,
  };
}

function proposalLinesFromSuggestions(suggestions = [], options = {}) {
  return suggestions
    .filter((item) => ['low_price', 'high_price_risk'].includes(item.type))
    .map((item, index) => {
      const prefill = linePrefill({
        suggestion: item,
        date: options.date,
        businessInputs: options.businessInputs,
      });
      return {
        id: `draft-${index + 1}`,
        sourceSuggestionType: item.type,
        title: item.title,
        direction: lineDirection(item),
        timePoints: Array.isArray(item.points) ? item.points : [],
        quantityMwh: prefill.quantityMwh,
        priceLimit: prefill.priceLimit,
        evidence: prefill.evidence,
        reason: item.description,
        editable: true,
        submitAllowed: false,
        humanDecisionRequired: true,
      };
    });
}

export function buildExecutionProposal({
  report,
  readiness,
  actor = 'system',
  businessInputs,
} = {}) {
  const suggestions = Array.isArray(report?.suggestions) ? report.suggestions : [];
  const costStrategy = report?.costStrategy || null;
  const settlementReferenceSummary = report?.settlementReferenceSummary || null;
  const confidenceScore = Number(costStrategy?.dataConfidence?.score || 0);
  const blockers = uniqueText(readinessBlockers(readiness));
  const reviewWarnings = uniqueText([
    ...readinessWarnings(readiness),
    ...(Array.isArray(report?.blockingReasons) ? report.blockingReasons : []),
    `成本优化策略置信度 ${confidenceScore}/100；当前为人工决策支持，不会自动提交。`,
  ]);
  const candidateLines = proposalLinesFromSuggestions(suggestions, {
    date: report?.date,
    businessInputs,
  });
  const canDraft = readiness?.capabilities?.proposalDraft !== false && candidateLines.length > 0;
  const proposalLines = blockers.length || !canDraft ? [] : candidateLines;

  return {
    generatedAt: new Date().toISOString(),
    type: 'execution_proposal',
    actor,
    date: report?.date || '',
    status: blockers.length || !canDraft ? 'blocked' : 'draft_ready',
    statusText: blockers.length || !canDraft ? '草稿生成阻塞' : '提案草稿已生成',
    mode: 'human_decision_only',
    humanDecisionRequired: true,
    autoSubmit: false,
    orderLines: [],
    proposalLines,
    costStrategy,
    settlementReferenceSummary,
    reportStatus: report?.status || 'trial_only',
    blockers,
    reviewWarnings,
    controls: Array.isArray(readiness?.controls) ? readiness.controls : [],
    nextAction: blockers.length
      ? '补齐数据闭环阻塞项后重新生成提案草稿。'
      : '人工复核提案草稿，填写或修改电量、限价和交易平台字段后由授权人员决定是否提交。',
  };
}

export async function createExecutionProposal(options = {}) {
  const report = buildStrategyReport(options.dataset, {
    date: options.date,
    integrationClosure: options.integrationClosure,
    assets: options.assets,
    featureStore: options.featureStore,
    strategyDataset: options.strategyDataset,
    modelReport: options.modelReport,
    forecastReport: options.forecastReport,
    backtestReport: options.backtestReport,
    costStrategy: options.costStrategy,
    settlementReference: options.settlementReference,
  });
  const proposal = buildExecutionProposal({
    report,
    readiness: options.readiness,
    actor: options.actor,
    businessInputs: options.businessInputs,
  });

  await appendAuditEvent(options.auditPath, {
    type: 'execution_proposal_created',
    actor: options.actor || 'system',
    outcome: proposal.status,
    date: proposal.date,
    blockerCount: proposal.blockers.length,
    warningCount: proposal.reviewWarnings.length,
    draftLineCount: proposal.proposalLines.length,
    blockers: proposal.blockers,
    reviewWarnings: proposal.reviewWarnings,
    autoSubmit: proposal.autoSubmit,
  });

  return proposal;
}
