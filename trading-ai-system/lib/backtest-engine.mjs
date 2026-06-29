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
    status: 'ready',
    baseline: 'no_action',
    estimatedSavings: 0,
    modelStatus: modelReport.status || 'unknown',
    warnings,
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
      const preferred = modelComparison.find(
        (item) => item.target === targetField && item.modelId === 'rolling_same_slot_median'
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
