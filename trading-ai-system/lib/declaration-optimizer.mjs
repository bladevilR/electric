const DEFAULT_WINDOWS = [7, 14, 21, 28, 42, 56];
const DEFAULT_WEIGHTS = [0.5, 0.75, 1];
const DEFAULT_SPLIT_RATIOS = [0.6, 0.2, 0.2];
const INTERVAL_HOURS = 0.25;

function numeric(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function modelId(windowDays, weight) {
  return `same_slot_mean_w${windowDays}_a${String(weight).replace(/^0\./, '')}`;
}

function normalizedComparableRows(featureStore) {
  const byKey = new Map();
  (Array.isArray(featureStore?.rows) ? featureStore.rows : []).forEach((row) => {
    const pointIndex = numeric(row.pointIndex);
    const baselineMw = numeric(row.defaultDeclarationPower);
    const actualKwh = numeric(row.actualKwh);
    if (!row.date || pointIndex === null || baselineMw === null || actualKwh === null) {
      return;
    }
    const date = String(row.date);
    byKey.set(`${date}:${pointIndex}`, {
      date,
      pointIndex,
      baselineMw,
      actualMw: actualKwh / 250,
    });
  });
  return [...byKey.values()].sort(
    (left, right) =>
      left.date.localeCompare(right.date) || left.pointIndex - right.pointIndex
  );
}

function completeDataset(featureStore, expectedPointsPerDay) {
  const rows = normalizedComparableRows(featureStore);
  const rowsByDate = new Map();
  rows.forEach((row) => {
    if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, []);
    rowsByDate.get(row.date).push(row);
  });
  const dates = [...rowsByDate.entries()]
    .filter(([, dateRows]) => dateRows.length === expectedPointsPerDay)
    .map(([date]) => date)
    .sort();
  const dateSet = new Set(dates);
  return {
    dates,
    rows: rows.filter((row) => dateSet.has(row.date)),
  };
}

function evaluateCandidate(rows, evaluationDates, candidate, minHistoryPerPoint) {
  const evaluationSet = new Set(evaluationDates);
  const historyByPoint = new Map();
  const daily = new Map();
  let baselineAbsoluteErrorMw = 0;
  let modelAbsoluteErrorMw = 0;
  let pointWins = 0;
  let pointCount = 0;

  rows.forEach((row) => {
    const history = historyByPoint.get(row.pointIndex) || [];
    if (evaluationSet.has(row.date)) {
      const recent = history.slice(-candidate.windowDays);
      const historyMean =
        recent.length >= minHistoryPerPoint ? mean(recent) : null;
      const forecastMw =
        historyMean === null
          ? row.baselineMw
          : row.baselineMw * (1 - candidate.weight) +
            historyMean * candidate.weight;
      const baselineErrorMw = Math.abs(row.baselineMw - row.actualMw);
      const modelErrorMw = Math.abs(forecastMw - row.actualMw);
      baselineAbsoluteErrorMw += baselineErrorMw;
      modelAbsoluteErrorMw += modelErrorMw;
      pointWins += Number(modelErrorMw < baselineErrorMw);
      pointCount += 1;
      const dateMetrics = daily.get(row.date) || {
        baselineAbsoluteErrorMw: 0,
        modelAbsoluteErrorMw: 0,
      };
      dateMetrics.baselineAbsoluteErrorMw += baselineErrorMw;
      dateMetrics.modelAbsoluteErrorMw += modelErrorMw;
      daily.set(row.date, dateMetrics);
    }
    history.push(row.actualMw);
    historyByPoint.set(row.pointIndex, history);
  });

  const baselineMaeMwh = pointCount
    ? (baselineAbsoluteErrorMw / pointCount) * INTERVAL_HOURS
    : null;
  const modelMaeMwh = pointCount
    ? (modelAbsoluteErrorMw / pointCount) * INTERVAL_HOURS
    : null;
  const improvementPct =
    baselineMaeMwh !== null && baselineMaeMwh > 0 && modelMaeMwh !== null
      ? ((baselineMaeMwh - modelMaeMwh) / baselineMaeMwh) * 100
      : null;
  const dailyValues = [...daily.values()];

  return {
    pointCount,
    dateCount: daily.size,
    baselineMaeMwh: round(baselineMaeMwh),
    modelMaeMwh: round(modelMaeMwh),
    improvementPct: round(improvementPct, 2),
    pointWinRatePct: pointCount
      ? round((pointWins / pointCount) * 100, 2)
      : null,
    dailyWinRatePct: dailyValues.length
      ? round(
          (dailyValues.filter(
            (item) =>
              item.modelAbsoluteErrorMw < item.baselineAbsoluteErrorMw
          ).length /
            dailyValues.length) *
            100,
          2
        )
      : null,
  };
}

export function backtestDeclarationOptimizer(featureStore = {}, options = {}) {
  const expectedPointsPerDay = Number(options.expectedPointsPerDay || 96);
  const splitRatios = Array.isArray(options.splitRatios)
    ? options.splitRatios
    : DEFAULT_SPLIT_RATIOS;
  const candidateWindows = Array.isArray(options.candidateWindows)
    ? options.candidateWindows
    : DEFAULT_WINDOWS;
  const candidateWeights = Array.isArray(options.candidateWeights)
    ? options.candidateWeights
    : DEFAULT_WEIGHTS;
  const minHistoryPerPoint = Number(options.minHistoryPerPoint || 7);
  const minHoldoutDays = Number(options.minHoldoutDays || 30);
  const minHoldoutPoints = Number(options.minHoldoutPoints || 2880);
  const minImprovementPct = Number(options.minImprovementPct || 3);
  const minDailyWinRatePct = Number(options.minDailyWinRatePct || 60);
  const dataset = completeDataset(featureStore, expectedPointsPerDay);
  const trainingEnd = Math.floor(dataset.dates.length * Number(splitRatios[0] || 0));
  const validationEnd = Math.floor(
    dataset.dates.length *
      (Number(splitRatios[0] || 0) + Number(splitRatios[1] || 0))
  );
  const trainingDates = dataset.dates.slice(0, trainingEnd);
  const validationDates = dataset.dates.slice(trainingEnd, validationEnd);
  const holdoutDates = dataset.dates.slice(validationEnd);
  const candidates = candidateWindows.flatMap((windowDays) =>
    candidateWeights.map((weight) => ({
      id: modelId(windowDays, weight),
      windowDays: Number(windowDays),
      weight: Number(weight),
      minHistoryPerPoint,
    }))
  );

  if (
    !trainingDates.length ||
    !validationDates.length ||
    !holdoutDates.length ||
    !candidates.length
  ) {
    return {
      status: 'insufficient_history',
      selectedModel: null,
      split: {
        totalDateCount: dataset.dates.length,
        trainingDateCount: trainingDates.length,
        validationDateCount: validationDates.length,
        holdoutDateCount: holdoutDates.length,
      },
      validation: null,
      holdout: null,
      promotion: {
        eligible: false,
        reasons: ['optimizer_evidence_unavailable'],
      },
      costSavingsYuan: null,
      warnings: ['cost_attribution_unavailable'],
    };
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      metrics: evaluateCandidate(
        dataset.rows,
        validationDates,
        candidate,
        minHistoryPerPoint
      ),
    }))
    .filter((item) => item.metrics.modelMaeMwh !== null)
    .sort(
      (left, right) =>
        left.metrics.modelMaeMwh - right.metrics.modelMaeMwh ||
        left.candidate.windowDays - right.candidate.windowDays ||
        left.candidate.weight - right.candidate.weight
    );
  const selected = ranked[0] || null;

  if (!selected) {
    return {
      status: 'insufficient_history',
      selectedModel: null,
      split: {
        totalDateCount: dataset.dates.length,
        trainingDateCount: trainingDates.length,
        validationDateCount: validationDates.length,
        holdoutDateCount: holdoutDates.length,
      },
      validation: null,
      holdout: null,
      promotion: {
        eligible: false,
        reasons: ['optimizer_evidence_unavailable'],
      },
      costSavingsYuan: null,
      warnings: ['cost_attribution_unavailable'],
    };
  }

  const holdout = evaluateCandidate(
    dataset.rows,
    holdoutDates,
    selected.candidate,
    minHistoryPerPoint
  );
  const reasons = [];
  if (holdout.dateCount < minHoldoutDays) {
    reasons.push('holdout_days_insufficient');
  }
  if (holdout.pointCount < minHoldoutPoints) {
    reasons.push('holdout_points_insufficient');
  }
  if (
    holdout.improvementPct === null ||
    holdout.improvementPct < minImprovementPct
  ) {
    reasons.push('mae_improvement_below_threshold');
  }
  if (
    holdout.dailyWinRatePct === null ||
    holdout.dailyWinRatePct < minDailyWinRatePct
  ) {
    reasons.push('daily_win_rate_below_threshold');
  }

  return {
    status: reasons.length ? 'rejected' : 'validated',
    selectedModel: selected.candidate,
    split: {
      totalDateCount: dataset.dates.length,
      trainingDateCount: trainingDates.length,
      validationDateCount: validationDates.length,
      holdoutDateCount: holdoutDates.length,
    },
    validation: selected.metrics,
    holdout,
    promotion: {
      eligible: reasons.length === 0,
      reasons,
    },
    costSavingsYuan: null,
    warnings: ['cost_attribution_unavailable'],
  };
}
