import { randomUUID } from 'node:crypto';

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const round = (value) => (value === null ? null : Number(value.toFixed(8)));

export function evaluatePointForecast(pairs = []) {
  const comparable = pairs.filter((pair) => [pair.forecast, pair.actual].every(Number.isFinite));
  if (!comparable.length) {
    return { sampleCount: 0, mae: null, rmse: null, bias: null, mape: null, mase: null, skillVsBaseline: null };
  }
  const errors = comparable.map((pair) => pair.forecast - pair.actual);
  const mae = mean(errors.map(Math.abs));
  const percentagePairs = comparable.filter((pair) => pair.actual !== 0);
  const baselineMae = mean(comparable.filter((pair) => Number.isFinite(pair.baseline)).map((pair) => Math.abs(pair.baseline - pair.actual)));
  const scale = mean(comparable.filter((pair) => Number.isFinite(pair.naiveScale) && pair.naiveScale > 0).map((pair) => pair.naiveScale));
  return {
    sampleCount: comparable.length,
    mae: round(mae),
    rmse: round(Math.sqrt(mean(errors.map((error) => error ** 2)))),
    bias: round(mean(errors)),
    mape: percentagePairs.length ? round(100 * mean(percentagePairs.map((pair) => Math.abs((pair.forecast - pair.actual) / pair.actual)))) : null,
    mase: scale ? round(mae / scale) : null,
    skillVsBaseline: baselineMae ? round(1 - mae / baselineMae) : null,
  };
}

function pinball(actual, forecast, quantile) {
  const error = actual - forecast;
  return Math.max(quantile * error, (quantile - 1) * error);
}

export function evaluateQuantiles(pairs = [], quantiles = [0.1, 0.5, 0.9]) {
  const comparable = pairs.filter((pair) => Number.isFinite(pair.actual));
  const losses = {};
  for (const quantile of quantiles) {
    const key = `p${Math.round(quantile * 100)}`;
    const valid = comparable.filter((pair) => Number.isFinite(pair[key]));
    losses[key] = valid.length ? round(mean(valid.map((pair) => pinball(pair.actual, pair[key], quantile)))) : null;
  }
  const intervalPairs = comparable.filter((pair) => Number.isFinite(pair.p10) && Number.isFinite(pair.p90));
  return {
    sampleCount: comparable.length,
    pinballLoss: losses,
    interval80: {
      sampleCount: intervalPairs.length,
      coveragePct: intervalPairs.length ? round(100 * mean(intervalPairs.map((pair) => (pair.actual >= pair.p10 && pair.actual <= pair.p90 ? 1 : 0)))) : null,
      meanWidth: intervalPairs.length ? round(mean(intervalPairs.map((pair) => pair.p90 - pair.p10))) : null,
    },
  };
}

export function evaluateEventProbability(pairs = [], options = {}) {
  const threshold = options.threshold ?? 0.5;
  const comparable = pairs.filter((pair) => Number.isFinite(pair.probability) && [0, 1].includes(pair.actualLabel));
  if (!comparable.length) {
    return { sampleCount: 0, brierScore: null, truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, precision: null, recall: null };
  }
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  for (const pair of comparable) {
    const predicted = pair.probability >= threshold ? 1 : 0;
    if (predicted && pair.actualLabel) truePositive += 1;
    else if (predicted) falsePositive += 1;
    else if (pair.actualLabel) falseNegative += 1;
    else trueNegative += 1;
  }
  return {
    sampleCount: comparable.length,
    brierScore: round(mean(comparable.map((pair) => (pair.probability - pair.actualLabel) ** 2))),
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision: truePositive + falsePositive ? round(truePositive / (truePositive + falsePositive)) : null,
    recall: truePositive + falseNegative ? round(truePositive / (truePositive + falseNegative)) : null,
  };
}

export function groupEvaluationPairs(pairs = [], dimensions = []) {
  const groups = {};
  for (const pair of pairs) {
    const key = dimensions.map((dimension) => pair[dimension] ?? 'unknown').join('|') || 'all';
    (groups[key] ??= []).push(pair);
  }
  return Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, evaluatePointForecast(value)]));
}

export function buildAccuracyReport({ runs = [], outcomes = [], config = {} } = {}) {
  const selectedRuns = runs.filter((run) => !config.runType || run.forecastRunType === config.runType);
  const pairs = [];
  for (const run of selectedRuns) {
    for (const row of run.rows || []) {
      const outcome = outcomes.filter((candidate) => candidate.targetField === run.targetField
        && candidate.businessDate === run.targetTradingDate
        && candidate.pointIndex === row.pointIndex
        && (!config.actualLabelVersion || candidate.actualLabelVersion === config.actualLabelVersion)).at(-1);
      if (!outcome) continue;
      pairs.push({
        forecast: row.pointForecast ?? row.p50,
        actual: outcome.actualValue,
        p10: row.p10,
        p50: row.p50,
        p90: row.p90,
        probability: row.spikeProbability,
        actualLabel: Number.isFinite(config.spikeThreshold) ? (outcome.actualValue >= config.spikeThreshold ? 1 : 0) : undefined,
        baseline: row.baseline,
        naiveScale: row.naiveScale,
        pointIndex: row.pointIndex,
        ...Object.fromEntries((config.dimensions || []).map((dimension) => [dimension, row[dimension] ?? run[dimension]])),
      });
    }
  }
  return {
    evaluationRunId: `eval-${randomUUID()}`,
    evaluationAsOf: new Date().toISOString(),
    evaluationConfigVersion: config.version || '1',
    forecastRunType: config.runType || null,
    actualLabelVersion: config.actualLabelVersion || null,
    sampleCoverage: { runs: selectedRuns.length, pairs: pairs.length },
    metrics: evaluatePointForecast(pairs),
    quantileMetrics: evaluateQuantiles(pairs),
    eventMetrics: evaluateEventProbability(pairs, { threshold: config.probabilityThreshold }),
    groupedMetrics: groupEvaluationPairs(pairs, config.dimensions || []),
    warnings: pairs.length ? [] : ['no_comparable_outcomes'],
  };
}
