import { numeric } from './strategy-engine.mjs';
import { forecastNaiveSameSlot, forecastRollingSameSlot } from './forecast-models.mjs';

const TARGET_FIELDS = ['realTimeAvgPrice', 'priceSpread'];

function round(value, digits = 6) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function rowsUpToDate(rows, date) {
  return rows.filter((row) => row.date <= date);
}

function actualMap(rows, date, field) {
  const map = new Map();
  rows
    .filter((row) => row.date === date && numeric(row[field]) !== null)
    .forEach((row) => {
      map.set(Number(row.pointIndex), numeric(row[field]));
    });
  return map;
}

export function computeRegressionMetrics(actuals = [], forecasts = []) {
  const pairs = actuals
    .map((actual, index) => [numeric(actual), numeric(forecasts[index])])
    .filter(([actual, forecast]) => actual !== null && forecast !== null);
  if (!pairs.length) {
    return { sampleCount: 0, mae: null, rmse: null, bias: null };
  }

  const errors = pairs.map(([actual, forecast]) => forecast - actual);
  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length;
  const mse = errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length;
  const bias = errors.reduce((sum, error) => sum + error, 0) / errors.length;

  return {
    sampleCount: pairs.length,
    mae: round(mae),
    rmse: round(Math.sqrt(mse)),
    bias: round(bias),
  };
}

export function validateBacktestSplit(split = {}) {
  const groups=['trainingDates','validationDates','holdoutDates','liveDates'].map(key=>split[key]||[]);
  const all=groups.flat();
  const errors=new Set(all.length===new Set(all).size?[]:['split_dates_overlap']);
  return {ok:errors.size===0,errors:[...errors]};
}

export async function runPointInTimeBacktest({dates=[],buildSnapshot,forecast,outcomes=[],config={}}={}) {
  if(!config.decisionCutoffAt&&!config.resolveDecisionCutoffAt)return{status:'decision_cutoff_unconfirmed',runType:'point_in_time_replay',runs:[],usedFactIds:[]};
  const runs=[];const usedFactIds=[];
  for(const date of [...dates].sort()){
    const decisionCutoffAt=config.resolveDecisionCutoffAt?config.resolveDecisionCutoffAt(date):config.decisionCutoffAt;
    const snapshot=await buildSnapshot({targetDate:date,decisionCutoffAt});
    usedFactIds.push(...(snapshot.selectedFactIds||snapshot.factIds||snapshot.rows?.flatMap(row=>row.selectedFactIds||[])||[]));
    runs.push({targetTradingDate:date,decisionCutoffAt,trainingDates:[...dates].filter(item=>item<date),rows:await forecast({date,snapshot}),outcomes:outcomes.filter(item=>item.businessDate===date)});
  }
  return{status:'ready',runType:'point_in_time_replay',runs,usedFactIds:[...new Set(usedFactIds)]};
}

function compareModel(rows, evaluationDates, modelId, forecastFn, targetField) {
  const actuals = [];
  const forecasts = [];

  evaluationDates.forEach((date) => {
    const availableRows = rowsUpToDate(rows, date);
    const actualsByPoint = actualMap(rows, date, targetField);
    const pointForecasts = forecastFn(availableRows, date, targetField);
    pointForecasts.forEach((forecast) => {
      const actual = actualsByPoint.get(Number(forecast.pointIndex));
      if (numeric(actual) === null || numeric(forecast.pointForecast) === null) {
        return;
      }
      actuals.push(actual);
      forecasts.push(forecast.pointForecast);
    });
  });

  return {
    modelId,
    target: targetField,
    ...computeRegressionMetrics(actuals, forecasts),
  };
}

function bestModel(comparisons = []) {
  return comparisons
    .filter((item) => numeric(item?.mae) !== null && Number(item.sampleCount || 0) > 0)
    .sort((left, right) => Number(left.mae) - Number(right.mae))[0] || null;
}

export function buildStrategyValidation(backtestReport = {}, options = {}) {
  const comparisons = Array.isArray(backtestReport.modelComparison)
    ? backtestReport.modelComparison.filter((item) => item.target === 'realTimeAvgPrice')
    : [];
  const baseline = comparisons.find((item) => item.modelId === 'naive_same_slot') || null;
  const candidate = comparisons.find((item) => item.modelId === 'rolling_same_slot_median') || null;
  const preferred = bestModel(comparisons);
  const baselineMae = numeric(baseline?.mae);
  const candidateMae = numeric(candidate?.mae);
  const candidateImprovementPct =
    baselineMae !== null && baselineMae > 0 && candidateMae !== null
      ? round(((baselineMae - candidateMae) / baselineMae) * 100, 2)
      : null;
  const priceSampleCount = Math.max(
    Number(baseline?.sampleCount || 0),
    Number(candidate?.sampleCount || 0)
  );
  const priceStatus =
    backtestReport.status !== 'ready' || priceSampleCount === 0
      ? 'not_validated'
      : candidateImprovementPct !== null && candidateImprovementPct > 0
        ? 'validated'
        : 'rejected';
  const strategyComparison = backtestReport.strategyComparison || {};
  const declarationReplay = options.declarationReplay || {
    status: 'insufficient_evidence',
    verdict: 'not_validated',
    comparablePointCount: 0,
    dateCount: 0,
    submittedMaeMwh: null,
    baselineMaeMwh: null,
    improvementPct: null,
    winRatePct: null,
    costSavingsYuan: null,
    warnings: ['declaration_replay_unavailable'],
  };
  const declarationOptimizer = options.declarationOptimizer || {
    status: 'insufficient_history',
    selectedModel: null,
    holdout: null,
    promotion: {
      eligible: false,
      reasons: ['optimizer_evidence_unavailable'],
    },
    costSavingsYuan: null,
  };
  const optimizerValidated = declarationOptimizer.status === 'validated';
  const operatingMode = optimizerValidated
    ? 'validated_optimizer'
    : 'baseline_fallback';
  const estimatedSavings = numeric(strategyComparison.estimatedSavings);
  const costStatus =
    strategyComparison.status === 'ready' && estimatedSavings !== null
      ? 'validated'
      : 'not_validated';
  const reasons = [];

  if (priceStatus === 'not_validated') reasons.push('price_backtest_unavailable');
  if (priceStatus === 'rejected') reasons.push('candidate_not_better_than_baseline');
  if (declarationReplay.verdict === 'not_improved') {
    reasons.push('declaration_not_better_than_default');
  }
  if (declarationReplay.status !== 'validated') {
    reasons.push('declaration_replay_unavailable');
  }
  if (declarationOptimizer.status === 'rejected') {
    reasons.push('declaration_optimizer_rejected');
  }
  if (declarationOptimizer.status === 'insufficient_history') {
    reasons.push('declaration_optimizer_unavailable');
  }
  if (costStatus !== 'validated') reasons.push('strategy_savings_unavailable');

  const overallStatus =
    priceStatus === 'validated' && costStatus === 'validated'
      ? 'validated'
      : 'not_validated';

  return {
    generatedAt: backtestReport.generatedAt || new Date().toISOString(),
    overallStatus,
    operatingMode,
    reviewRecommendationAllowed: true,
    executionAllowed: false,
    priceModel: {
      status: priceStatus,
      baselineModelId: baseline?.modelId || 'naive_same_slot',
      candidateModelId: candidate?.modelId || 'rolling_same_slot_median',
      preferredModelId: preferred?.modelId || null,
      sampleCount: priceSampleCount,
      baselineMae,
      candidateMae,
      preferredMae: numeric(preferred?.mae),
      candidateImprovementPct,
    },
    sampleCoverage: {
      evaluationDateCount: Array.isArray(backtestReport.evaluationDates)
        ? backtestReport.evaluationDates.length
        : 0,
      pricePointCount: priceSampleCount,
    },
    costStrategy: {
      status: costStatus,
      baseline: strategyComparison.baseline || 'no_action',
      estimatedSavingsYuan: costStatus === 'validated' ? estimatedSavings : null,
      warnings: Array.isArray(strategyComparison.warnings)
        ? strategyComparison.warnings
        : [],
    },
    declarationReplay,
    declarationOptimizer,
    reasons: [...new Set(reasons)],
  };
}

export function computeStrategyBacktest(featureStore = {}, modelReport = {}, options = {}) {
  const rows = Array.isArray(featureStore.rows) ? featureStore.rows : [];
  const hasActualLoad = rows.some((row) => numeric(row.actualKwh) !== null);
  const hasSettlement = rows.some((row) => numeric(row.settleAmount) !== null);
  const hasAlignedActualSettlement = rows.some(
    (row) => numeric(row.actualKwh) !== null && numeric(row.settleAmount) !== null
  );
  const strategyActions = Array.isArray(options.strategyActions)
    ? options.strategyActions
    : rows.filter(
        (row) =>
          numeric(row.strategyMwh) !== null ||
          numeric(row.proposedMwh) !== null ||
          numeric(row.executedMwh) !== null
      );
  const hasStrategyActions = strategyActions.length > 0;
  const warnings = [];

  if (!hasActualLoad) {
    warnings.push('actual_load_missing');
  }
  if (!hasSettlement) {
    warnings.push('settlement_missing');
  }
  if (hasActualLoad && hasSettlement && !hasAlignedActualSettlement) {
    warnings.push('aligned_actual_settlement_missing');
  }
  if (!hasStrategyActions) {
    warnings.push('strategy_action_missing');
  }

  if (!hasActualLoad || !hasSettlement || !hasAlignedActualSettlement) {
    return {
      status: 'insufficient_actuals',
      baseline: 'no_action',
      estimatedSavings: null,
      modelStatus: modelReport.status || 'unknown',
      warnings,
    };
  }

  if (!hasStrategyActions) {
    return {
      status: 'savings_unavailable',
      baseline: 'no_action',
      estimatedSavings: null,
      modelStatus: modelReport.status || 'unknown',
      warnings,
    };
  }

  return {
    status: 'savings_unavailable',
    baseline: 'no_action',
    estimatedSavings: null,
    modelStatus: modelReport.status || 'unknown',
    warnings: [...warnings, 'settlement_formula_version_missing'],
  };
}

export function runForecastBacktest(featureStore = {}, options = {}) {
  const rows = Array.isArray(featureStore.rows) ? featureStore.rows : [];
  const minHistoryDates = Number(options.minHistoryDates || 5);
  const dates = uniqueSorted(rows.map((row) => row.date));
  const evaluationDates = dates.filter((date) => dates.filter((candidate) => candidate < date).length >= minHistoryDates);
  const warnings = [];

  if (!evaluationDates.length) {
    return {
      generatedAt: new Date().toISOString(),
      status: 'insufficient_history',
      evaluationDates: [],
      metrics: Object.fromEntries(TARGET_FIELDS.map((field) => [field, computeRegressionMetrics([], [])])),
      modelComparison: [],
      strategyComparison: computeStrategyBacktest(featureStore, { status: 'insufficient_history' }, options),
      warnings: ['historical_dates_below_minimum'],
    };
  }

  const modelComparison = TARGET_FIELDS.flatMap((targetField) => [
    compareModel(rows, evaluationDates, 'naive_same_slot', forecastNaiveSameSlot, targetField),
    compareModel(rows, evaluationDates, 'rolling_same_slot_median', forecastRollingSameSlot, targetField),
  ]);

  const metrics = Object.fromEntries(
    TARGET_FIELDS.map((targetField) => {
      const preferred = bestModel(
        modelComparison.filter((item) => item.target === targetField)
      );
      return [targetField, preferred || computeRegressionMetrics([], [])];
    })
  );
  const strategyComparison = computeStrategyBacktest(featureStore, { status: 'ready' }, options);
  warnings.push(...strategyComparison.warnings);

  return {
    generatedAt: new Date().toISOString(),
    status: 'ready',
    evaluationDates,
    metrics,
    modelComparison,
    strategyComparison,
    warnings: [...new Set(warnings)],
  };
}
