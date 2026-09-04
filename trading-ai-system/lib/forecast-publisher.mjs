import { createHash } from 'node:crypto';

import { buildEvidencePriceForecast } from './evidence-price-model.mjs';
import { buildAccuracyReport } from './forecast-evaluation.mjs';
import { quantile } from './strategy-engine.mjs';

const PRICE_FIELD = 'dayAheadUserPriceFinalYuanPerMwh';
const DRIVER_FIELDS = ['temperatureForecastC', 'loadForecastMw'];

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function latestFacts(facts) {
  const latest = new Map();
  for (const fact of facts) {
    latest.set(`${fact.fieldId}|${fact.businessDate}|${fact.pointIndex}`, fact);
  }
  return [...latest.values()];
}

function factsToRows(facts) {
  const rows = new Map();
  for (const fact of facts) {
    if (!Number.isInteger(fact.pointIndex)) continue;
    const key = `${fact.businessDate}|${fact.pointIndex}`;
    const row = rows.get(key) || { date: fact.businessDate, pointIndex: fact.pointIndex };
    row[fact.fieldId] = fact.value;
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date) || left.pointIndex - right.pointIndex);
}

function completeDates(rows, targetDate, fields, expectedPointCount) {
  const byDate = new Map();
  for (const row of rows) {
    if (row.date >= targetDate || !fields.every((field) => Number.isFinite(Number(row[field])))) continue;
    (byDate.get(row.date) || byDate.set(row.date, new Set()).get(row.date)).add(row.pointIndex);
  }
  return [...byDate.entries()].filter(([, points]) => points.size === expectedPointCount).map(([date]) => date).sort();
}

function targetDriverCompleteness(rows, targetDate, expectedPointCount) {
  const target = rows.filter((row) => row.date === targetDate);
  const observed = target.reduce((count, row) => count + DRIVER_FIELDS.filter((field) => Number.isFinite(Number(row[field]))).length, 0);
  return Math.round((10000 * observed) / (expectedPointCount * DRIVER_FIELDS.length)) / 100;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildBaseline(rows, targetDate, expectedPointCount) {
  const forecasts = [];
  for (let pointIndex = 1; pointIndex <= expectedPointCount; pointIndex += 1) {
    const values = rows.filter((row) => row.date < targetDate
      && row.pointIndex === pointIndex
      && Number.isFinite(Number(row[PRICE_FIELD])))
      .slice(-28)
      .map((row) => Number(row[PRICE_FIELD]));
    if (!values.length) continue;
    const pointForecast = median(values);
    forecasts.push({
      pointIndex,
      pointForecast,
      p10: quantile(values, 0.1),
      p50: pointForecast,
      p90: quantile(values, 0.9),
      inputCompletenessPct: 100,
      evidenceRows: values.length,
      contributions: { slotBaselineYuanPerMwh: pointForecast, temperatureYuanPerMwh: 0, loadYuanPerMwh: 0 },
    });
  }
  return {
    status: forecasts.length === expectedPointCount ? 'ready' : 'insufficient_history',
    modelId: 'rolling_same_slot_median_28',
    modelVersion: '1.0.0',
    rows: forecasts,
    algorithm: {
      family: 'same_slot_rolling_median',
      formula: 'price = median(last_28_same_slot_prices)',
      inputs: [PRICE_FIELD],
      safeguards: ['as_of_cutoff', 'immutable_feature_snapshot'],
    },
  };
}

export function createForecastPublisher(options = {}) {
  const { store } = options;
  if (!store) throw new Error('evidence_store_required');
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
  const codeCommitSha = String(options.codeCommitSha || 'unknown');
  const expectedPointCount = Number(options.expectedPointCount || 96);
  const injectedModelBuilder = options.buildModelReport;

  function readAllFacts(query) {
    // Keep page boundaries stable if a collector writes historical dates concurrently.
    return store.transaction(() => {
      const facts = [];
      const pageSize = 10000;
      for (let offset = 0; ; offset += pageSize) {
        const page = store.queryFacts({ ...query, limit: pageSize, offset });
        facts.push(...page);
        if (page.length < pageSize) return facts;
      }
    });
  }

  function snapshotInputs(targetDate, cutoffAt = clock()) {
    const facts = latestFacts(store.transaction(() => [PRICE_FIELD, ...DRIVER_FIELDS]
      .flatMap(fieldId => readAllFacts({ fieldId, to: targetDate, asOf: cutoffAt }))));
    return { facts, rows: factsToRows(facts), cutoffAt };
  }

  function readiness(targetDate, readinessOptions = {}) {
    const inputs = snapshotInputs(targetDate, readinessOptions.decisionCutoffAt || clock());
    const priceDates = completeDates(inputs.rows, targetDate, [PRICE_FIELD], expectedPointCount);
    const multivariateDates = completeDates(inputs.rows, targetDate, [PRICE_FIELD, ...DRIVER_FIELDS], expectedPointCount);
    const driverCompleteness = targetDriverCompleteness(inputs.rows, targetDate, expectedPointCount);
    const reasons = [];
    if (priceDates.length < 5) reasons.push('historical_complete_dates_below_5');
    if (priceDates.length < 30) reasons.push('historical_complete_dates_below_30');
    if (multivariateDates.length < 5) reasons.push('multivariate_training_dates_below_5');
    if (driverCompleteness < 100) reasons.push('target_weather_or_load_forecast_incomplete');
    let status = 'model_allowed';
    if (priceDates.length < 5) status = 'blocked';
    else if (priceDates.length < 30 || multivariateDates.length < 5 || driverCompleteness < 100) status = 'baseline_only';
    return {
      status,
      targetDate,
      decisionCutoffAt: inputs.cutoffAt,
      historicalCompleteDateCount: priceDates.length,
      multivariateCompleteDateCount: multivariateDates.length,
      targetDriverCompletenessPct: driverCompleteness,
      expectedPointCount,
      missingReasons: reasons,
    };
  }

  function publishLiveForecast(targetDate, publishOptions = {}) {
    const decisionCutoffAt = publishOptions.decisionCutoffAt || clock();
    const forecastRunId = publishOptions.forecastRunId || `live-${targetDate}-v1`;
    if (store.queryForecastRuns({ forecastRunId }).length) throw new Error('forecast_run_already_exists');
    const state = readiness(targetDate, { decisionCutoffAt });
    if (state.status === 'blocked') throw new Error(`forecast_readiness_blocked:${state.missingReasons.join(',')}`);
    const inputs = snapshotInputs(targetDate, decisionCutoffAt);
    const featurePayload = {
      version: 'evidence-features-v1',
      targetDate,
      cutoffAt: decisionCutoffAt,
      fields: [PRICE_FIELD, ...DRIVER_FIELDS],
      facts: inputs.facts,
      rows: inputs.rows,
      readiness: state,
    };
    const featureSnapshotId = `snapshot-${targetDate}-${digest(featurePayload).slice(0, 16)}`;
    let modelReport;
    if (injectedModelBuilder) {
      modelReport = injectedModelBuilder({ date: targetDate, rows: inputs.rows }, { targetDate, expectedPointCount, readiness: state });
    } else if (state.status === 'model_allowed') {
      modelReport = buildEvidencePriceForecast({ rows: inputs.rows, targetDate, expectedPointCount });
    } else {
      modelReport = buildBaseline(inputs.rows, targetDate, expectedPointCount);
    }
    const forecastRows = modelReport.rows || modelReport.forecasts || [];
    if (modelReport.status !== 'ready' && modelReport.status !== 'baseline_ready') throw new Error(`forecast_model_not_ready:${modelReport.status}`);
    if (forecastRows.length !== expectedPointCount) throw new Error(`forecast_point_count_invalid:${forecastRows.length}`);
    for (const row of forecastRows) {
      if (![row.p10, row.p50, row.p90].every(Number.isFinite) || !(row.p10 <= row.p50 && row.p50 <= row.p90)) {
        throw new Error(`forecast_quantiles_invalid:${row.pointIndex}`);
      }
    }
    const priceDates = completeDates(inputs.rows, targetDate, [PRICE_FIELD], expectedPointCount);
    const forecastGeneratedAt = clock();
    const forecastEvidenceByPoint = Object.fromEntries(forecastRows.map((row) => [String(row.pointIndex), {
      inputs: row.inputs || {},
      contributions: row.contributions || {},
      coefficients: row.coefficients || {},
      evidenceRows: row.evidenceRows ?? null,
    }]));
    const run = {
      forecastRunId,
      forecastRunType: 'live_issued',
      targetField: PRICE_FIELD,
      targetTradingDate: targetDate,
      forecastGeneratedAt,
      decisionCutoffAt,
      featureSnapshotId,
      featureVersion: 'evidence-features-v1',
      modelId: modelReport.modelId,
      modelVersion: modelReport.modelVersion || '1.0.0',
      codeCommitSha,
      trainingStartDate: priceDates[0],
      trainingEndDate: priceDates.at(-1),
      backtestSplitLabel: state.status === 'model_allowed' ? 'live_multivariate' : 'live_baseline',
      inputCompletenessPct: state.status === 'model_allowed' ? state.targetDriverCompletenessPct : 100,
      algorithm: modelReport.algorithm || null,
      readiness: state,
      forecastEvidenceByPoint,
      rows: forecastRows,
    };
    store.transaction(() => {
      store.appendFeatureSnapshot({
        id: featureSnapshotId,
        targetTradingDate: targetDate,
        cutoffAt: decisionCutoffAt,
        completenessPct: run.inputCompletenessPct,
        payload: featurePayload,
        createdAt: forecastGeneratedAt,
      });
      store.appendForecastRun(run);
    });
    return run;
  }

  function backfillOutcomes(query = {}) {
    const facts = latestFacts(readAllFacts({
      fieldId: query.targetField || PRICE_FIELD,
      from: query.from,
      to: query.to,
    }));
    const actualLabelVersion = query.actualLabelVersion || 'final';
    return store.appendOutcomes(facts.map((fact) => ({
      targetField: query.targetField || PRICE_FIELD,
      businessDate: fact.businessDate,
      pointIndex: fact.pointIndex,
      actualValue: fact.value,
      actualLabelVersion,
      sourceId: fact.sourceId,
      sourceRevision: fact.sourceRevision,
      publishedAt: fact.availableAt,
      actualBackfilledAt: clock(),
    })));
  }

  function evaluate(query = {}) {
    const runType = query.runType || 'live_issued';
    const actualLabelVersion = query.actualLabelVersion || 'final';
    const runs = store.queryForecastRuns({
      forecastRunType: runType,
      targetField: query.targetField || PRICE_FIELD,
      from: query.from,
      to: query.to,
    });
    const outcomes = store.queryOutcomes({
      targetField: query.targetField || PRICE_FIELD,
      from: query.from,
      to: query.to,
      actualLabelVersion,
    });
    const report = buildAccuracyReport({
      runs,
      outcomes,
      config: {
        version: query.version || '1',
        runType,
        actualLabelVersion,
        spikeThreshold: query.spikeThreshold,
        probabilityThreshold: query.probabilityThreshold,
        dimensions: query.dimensions || [],
      },
    });
    report.evaluationAsOf = clock();
    if (report.sampleCoverage.pairs) {
      store.upsertAccuracyMetric({
        id: `metric-${digest({ runType, actualLabelVersion, from: query.from, to: query.to }).slice(0, 20)}`,
        runType,
        modelId: runs.length === 1 ? runs[0].modelId : '',
        targetField: query.targetField || PRICE_FIELD,
        fromDate: query.from,
        toDate: query.to,
        actualLabelVersion,
        metrics: {
          point: report.metrics,
          quantile: report.quantileMetrics,
          event: report.eventMetrics,
          sampleCoverage: report.sampleCoverage,
        },
        computedAt: report.evaluationAsOf,
      });
    }
    return report;
  }

  return { readiness, publishLiveForecast, backfillOutcomes, evaluate };
}
