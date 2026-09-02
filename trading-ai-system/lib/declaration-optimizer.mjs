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

function targetBaselineRows(featureStore, targetDate) {
  const byPoint = new Map();
  (Array.isArray(featureStore?.rows) ? featureStore.rows : []).forEach((row) => {
    const pointIndex = numeric(row.pointIndex);
    const baselinePowerMw = numeric(row.defaultDeclarationPower);
    if (
      String(row.date || '') !== targetDate ||
      pointIndex === null ||
      baselinePowerMw === null ||
      baselinePowerMw < 0
    ) {
      return;
    }
    byPoint.set(pointIndex, {
      date: targetDate,
      pointIndex,
      timePoint: row.timePoint || '',
      baselinePowerMw,
    });
  });
  return [...byPoint.values()].sort(
    (left, right) => left.pointIndex - right.pointIndex
  );
}

function completeActualHistory(featureStore, targetDate, expectedPointsPerDay) {
  const byDatePoint = new Map();
  (Array.isArray(featureStore?.rows) ? featureStore.rows : []).forEach((row) => {
    const date = String(row.date || '');
    const pointIndex = numeric(row.pointIndex);
    const actualKwh = numeric(row.actualKwh);
    if (
      !date ||
      date >= targetDate ||
      pointIndex === null ||
      actualKwh === null
    ) {
      return;
    }
    byDatePoint.set(`${date}:${pointIndex}`, {
      date,
      pointIndex,
      actualMw: actualKwh / 250,
    });
  });
  const rowsByDate = new Map();
  [...byDatePoint.values()].forEach((row) => {
    if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, []);
    rowsByDate.get(row.date).push(row);
  });
  const completeDates = [...rowsByDate.entries()]
    .filter(([, rows]) => rows.length === expectedPointsPerDay)
    .map(([date]) => date)
    .sort();
  const completeDateSet = new Set(completeDates);
  return {
    dates: completeDates,
    rows: [...byDatePoint.values()]
      .filter((row) => completeDateSet.has(row.date))
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.pointIndex - right.pointIndex
      ),
  };
}

function dateAgeHours(earlierDate, laterDate) {
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  if (!Number.isFinite(earlier) || !Number.isFinite(later)) return Infinity;
  return Math.max(0, (later - earlier) / 3_600_000);
}

function baselineRecommendation(targetRows, reason, requiredPointCount) {
  return {
    status: 'baseline_ready',
    operatingMode: 'baseline_fallback',
    coverage: {
      baselinePointCount: targetRows.length,
      recommendedPointCount: targetRows.length,
      requiredPointCount,
      optimizerPointCount: 0,
      fallbackPointCount: targetRows.length,
    },
    rows: targetRows.map((row) => ({
      ...row,
      recommendedPowerMw: row.baselinePowerMw,
      deltaPowerMw: 0,
      sourceModel: 'default_declaration',
      fallbackUsed: true,
    })),
    fallbackReasons: [reason],
    costSavingsYuan: null,
  };
}

function declarationPowerLimitReason(powerMw, subject, limits = {}) {
  if (
    limits.minDeclarationPowerMw !== null &&
    powerMw < limits.minDeclarationPowerMw
  ) {
    return `${subject}_below_min_declaration_power_mw`;
  }
  if (
    limits.maxDeclarationPowerMw !== null &&
    powerMw > limits.maxDeclarationPowerMw
  ) {
    return `${subject}_above_max_declaration_power_mw`;
  }
  return null;
}

function blockedByDeclarationPowerLimits(coverage, reason) {
  return {
    status: 'declaration_limit_violation',
    operatingMode: 'baseline_fallback',
    coverage,
    rows: [],
    fallbackReasons: [reason],
    costSavingsYuan: null,
  };
}

export function buildDeclarationRecommendation(
  featureStore = {},
  targetDate = '',
  validation = {},
  options = {}
) {
  const expectedPointsPerDay = Number(options.expectedPointsPerDay || 96);
  const maxActualAgeHours = Number(options.maxActualAgeHours || 48);
  const targetRows = targetBaselineRows(featureStore, String(targetDate || ''));
  const emptyCoverage = {
    baselinePointCount: targetRows.length,
    recommendedPointCount: 0,
    requiredPointCount: expectedPointsPerDay,
    optimizerPointCount: 0,
    fallbackPointCount: 0,
  };
  const minDeclarationPowerMw = numeric(options.minDeclarationPowerMw);
  const maxDeclarationPowerMw = numeric(options.maxDeclarationPowerMw);
  const declarationPowerLimits = {
    minDeclarationPowerMw,
    maxDeclarationPowerMw,
  };
  const hasConfiguredMinimum =
    options.minDeclarationPowerMw !== null &&
    options.minDeclarationPowerMw !== undefined;
  const hasConfiguredMaximum =
    options.maxDeclarationPowerMw !== null &&
    options.maxDeclarationPowerMw !== undefined;
  const declarationPowerLimitsMissing =
    !hasConfiguredMinimum && !hasConfiguredMaximum;
  const declarationPowerLimitsInvalid = [
    [options.minDeclarationPowerMw, minDeclarationPowerMw],
    [options.maxDeclarationPowerMw, maxDeclarationPowerMw],
  ].some(
    ([configuredValue, parsedValue]) =>
      configuredValue !== null &&
      configuredValue !== undefined &&
      (parsedValue === null || parsedValue < 0)
  );

  if (!targetDate || targetRows.length !== expectedPointsPerDay) {
    return {
      status: 'missing_baseline',
      operatingMode: 'baseline_fallback',
      coverage: emptyCoverage,
      rows: [],
      fallbackReasons: ['target_default_declaration_incomplete'],
      costSavingsYuan: null,
    };
  }

  if (
    declarationPowerLimitsMissing ||
    declarationPowerLimitsInvalid ||
    (declarationPowerLimits.minDeclarationPowerMw !== null &&
      declarationPowerLimits.maxDeclarationPowerMw !== null &&
      declarationPowerLimits.minDeclarationPowerMw >
        declarationPowerLimits.maxDeclarationPowerMw)
  ) {
    return blockedByDeclarationPowerLimits(
      emptyCoverage,
      declarationPowerLimitsMissing
        ? 'declaration_power_limits_missing'
        : 'declaration_power_limits_invalid'
    );
  }

  const baselineLimitReason = targetRows
    .map((row) =>
      declarationPowerLimitReason(
        row.baselinePowerMw,
        'baseline',
        declarationPowerLimits
      )
    )
    .find(Boolean);
  if (baselineLimitReason) {
    return blockedByDeclarationPowerLimits(
      emptyCoverage,
      baselineLimitReason
    );
  }

  if (validation?.status !== 'validated' || !validation?.selectedModel) {
    return baselineRecommendation(
      targetRows,
      'optimizer_not_validated',
      expectedPointsPerDay
    );
  }

  const actualHistory = completeActualHistory(
    featureStore,
    String(targetDate),
    expectedPointsPerDay
  );
  const latestActualDate = actualHistory.dates.at(-1) || '';
  if (!latestActualDate) {
    return {
      status: 'stale_inputs',
      operatingMode: 'baseline_fallback',
      coverage: emptyCoverage,
      rows: [],
      fallbackReasons: ['actual_history_missing'],
      costSavingsYuan: null,
    };
  }
  if (dateAgeHours(latestActualDate, String(targetDate)) > maxActualAgeHours) {
    return {
      status: 'stale_inputs',
      operatingMode: 'baseline_fallback',
      coverage: emptyCoverage,
      rows: [],
      fallbackReasons: ['actual_history_stale'],
      costSavingsYuan: null,
    };
  }

  const model = validation.selectedModel;
  const minHistoryPerPoint = Number(model.minHistoryPerPoint || 7);
  const windowDays = Number(model.windowDays || 0);
  const weight = Number(model.weight);
  const historyByPoint = new Map();
  actualHistory.rows.forEach((row) => {
    if (!historyByPoint.has(row.pointIndex)) {
      historyByPoint.set(row.pointIndex, []);
    }
    historyByPoint.get(row.pointIndex).push(row.actualMw);
  });
  let optimizerPointCount = 0;
  let fallbackPointCount = 0;
  const fallbackReasons = [];
  const rows = targetRows.map((row) => {
    const history = (historyByPoint.get(row.pointIndex) || []).slice(-windowDays);
    const canOptimize = history.length >= minHistoryPerPoint;
    const historyMean = canOptimize ? mean(history) : null;
    const candidate =
      historyMean === null
        ? row.baselinePowerMw
        : row.baselinePowerMw * (1 - weight) + historyMean * weight;
    const validCandidate = Number.isFinite(candidate) && candidate >= 0;
    const candidateLimitReason =
      canOptimize && validCandidate
        ? declarationPowerLimitReason(
            candidate,
            'candidate',
            declarationPowerLimits
          )
        : null;
    const recommendedPowerMw =
      canOptimize && validCandidate && !candidateLimitReason
        ? candidate
        : row.baselinePowerMw;
    const fallbackUsed = !canOptimize || !validCandidate || !!candidateLimitReason;
    if (!canOptimize || !validCandidate) {
      fallbackReasons.push('point_history_insufficient');
    }
    if (candidateLimitReason) fallbackReasons.push(candidateLimitReason);
    optimizerPointCount += Number(!fallbackUsed);
    fallbackPointCount += Number(fallbackUsed);
    return {
      ...row,
      recommendedPowerMw: round(recommendedPowerMw),
      deltaPowerMw: round(recommendedPowerMw - row.baselinePowerMw),
      sourceModel: fallbackUsed ? 'default_declaration' : model.id,
      fallbackUsed,
      ...(candidateLimitReason ? { fallbackReason: candidateLimitReason } : {}),
    };
  });

  return {
    status: fallbackPointCount ? 'ready_with_fallback' : 'ready',
    operatingMode: 'validated_optimizer',
    coverage: {
      baselinePointCount: targetRows.length,
      recommendedPointCount: rows.length,
      requiredPointCount: expectedPointsPerDay,
      optimizerPointCount,
      fallbackPointCount,
    },
    rows,
    fallbackReasons: [
      ...new Set(
        fallbackReasons.length
          ? fallbackReasons
          : fallbackPointCount
            ? ['point_history_insufficient']
            : []
      ),
    ],
    latestActualDate,
    costSavingsYuan: null,
  };
}
