const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 320;
const DEFAULT_PADDING = Object.freeze({
  top: 20,
  right: 18,
  bottom: 36,
  left: 44,
});

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatInteger(value) {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value, includePositiveSign = true) {
  const numeric = numberOrNull(value);
  if (numeric === null) {
    return null;
  }

  const sign = includePositiveSign && numeric > 0 ? '+' : '';
  return `${sign}${numeric.toFixed(2)}%`;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => {
      const pointIndex = numberOrNull(row?.pointIndex);
      const baselinePowerMw = numberOrNull(row?.baselinePowerMw);
      const recommendedPowerMw = numberOrNull(row?.recommendedPowerMw);
      const deltaPowerMw = numberOrNull(row?.deltaPowerMw);

      if (
        pointIndex === null ||
        baselinePowerMw === null ||
        recommendedPowerMw === null
      ) {
        return null;
      }

      return {
        ...row,
        pointIndex,
        baselinePowerMw,
        recommendedPowerMw,
        deltaPowerMw:
          deltaPowerMw === null
            ? recommendedPowerMw - baselinePowerMw
            : deltaPowerMw,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.pointIndex - right.pointIndex);
}

function mergePadding(padding = {}) {
  return {
    top: numberOrNull(padding.top) ?? DEFAULT_PADDING.top,
    right: numberOrNull(padding.right) ?? DEFAULT_PADDING.right,
    bottom: numberOrNull(padding.bottom) ?? DEFAULT_PADDING.bottom,
    left: numberOrNull(padding.left) ?? DEFAULT_PADDING.left,
  };
}

function pathFromPoints(points, yKey) {
  return points
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L';
      return `${command} ${point.x.toFixed(2)} ${point[yKey].toFixed(2)}`;
    })
    .join(' ');
}

export function buildDeclarationCurveGeometry(rows, options = {}) {
  const normalizedRows = normalizeRows(rows);
  const width = Math.max(1, numberOrNull(options.width) ?? DEFAULT_WIDTH);
  const height = Math.max(1, numberOrNull(options.height) ?? DEFAULT_HEIGHT);
  const padding = mergePadding(options.padding);
  const innerWidth = Math.max(1, width - padding.left - padding.right);
  const innerHeight = Math.max(1, height - padding.top - padding.bottom);

  if (normalizedRows.length === 0) {
    return {
      width,
      height,
      padding,
      domain: null,
      baselinePath: '',
      recommendedPath: '',
      points: [],
    };
  }

  const values = normalizedRows.flatMap((row) => [
    row.baselinePowerMw,
    row.recommendedPowerMw,
  ]);
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);

  if (minimum === maximum) {
    const halfRange = Math.max(Math.abs(minimum) * 0.08, 1);
    minimum -= halfRange;
    maximum += halfRange;
  } else {
    const domainPadding = (maximum - minimum) * 0.08;
    minimum -= domainPadding;
    maximum += domainPadding;
  }

  const firstIndex = normalizedRows[0].pointIndex;
  const lastIndex = normalizedRows.at(-1).pointIndex;
  const indexRange = lastIndex - firstIndex;
  const yRange = maximum - minimum;

  const points = normalizedRows.map((row, index) => {
    const x =
      normalizedRows.length === 1 || indexRange === 0
        ? padding.left + innerWidth / 2
        : padding.left +
          ((row.pointIndex - firstIndex) / indexRange) * innerWidth;
    const mapY = (value) =>
      padding.top + ((maximum - value) / yRange) * innerHeight;

    return {
      x,
      baselineY: mapY(row.baselinePowerMw),
      recommendedY: mapY(row.recommendedPowerMw),
      row,
      index,
    };
  });

  return {
    width,
    height,
    padding,
    domain: { minimum, maximum },
    baselinePath: pathFromPoints(points, 'baselineY'),
    recommendedPath: pathFromPoints(points, 'recommendedY'),
    points,
  };
}

export function summarizeAdjustmentWindows(rows, options = {}) {
  const threshold = Math.max(0, numberOrNull(options.threshold) ?? 0);
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const pointIndex = numberOrNull(row?.pointIndex);
      const deltaPowerMw = numberOrNull(row?.deltaPowerMw);
      if (
        pointIndex === null ||
        deltaPowerMw === null ||
        Math.abs(deltaPowerMw) <= threshold
      ) {
        return null;
      }
      return { ...row, pointIndex, deltaPowerMw };
    })
    .filter(Boolean)
    .sort((left, right) => left.pointIndex - right.pointIndex);

  const windows = [];
  for (const row of normalized) {
    const direction = row.deltaPowerMw > 0 ? 'up' : 'down';
    const current = windows.at(-1);
    const isContiguous =
      current &&
      current.direction === direction &&
      row.pointIndex === current.endPointIndex + 1;

    if (isContiguous) {
      current.endPointIndex = row.pointIndex;
      current.endTime = row.timePoint || String(row.pointIndex);
      current.totalDeltaPowerMw += row.deltaPowerMw;
      current.pointCount += 1;
      continue;
    }

    windows.push({
      direction,
      startPointIndex: row.pointIndex,
      endPointIndex: row.pointIndex,
      startTime: row.timePoint || String(row.pointIndex),
      endTime: row.timePoint || String(row.pointIndex),
      totalDeltaPowerMw: row.deltaPowerMw,
      pointCount: 1,
    });
  }

  return windows.map((window) => ({
    ...window,
    label:
      window.startTime === window.endTime
        ? window.startTime
        : `${window.startTime}–${window.endTime}`,
  }));
}

export function buildDeclarationDashboardView(payload = {}) {
  const optimizer =
    payload.strategyValidation?.declarationOptimizer &&
    typeof payload.strategyValidation.declarationOptimizer === 'object'
      ? payload.strategyValidation.declarationOptimizer
      : {};
  const holdout =
    optimizer.holdout && typeof optimizer.holdout === 'object'
      ? optimizer.holdout
      : {};
  const recommendation =
    payload.declarationRecommendation &&
    typeof payload.declarationRecommendation === 'object'
      ? payload.declarationRecommendation
      : {};
  const rows = normalizeRows(recommendation.rows);
  const improvement = formatPercent(holdout.improvementPct);
  const winRate = formatPercent(holdout.dailyWinRatePct, false);
  const pointCount = numberOrNull(holdout.pointCount);
  const dateCount = numberOrNull(holdout.dateCount);
  const confidence = numberOrNull(payload.costStrategy?.dataConfidence?.score);

  return {
    optimizerStatus: optimizer.status || 'not_validated',
    metrics: {
      improvement: {
        value: numberOrNull(holdout.improvementPct),
        display: improvement ?? '待验证',
      },
      winRate: {
        value: numberOrNull(holdout.dailyWinRatePct),
        display: winRate ?? '待验证',
      },
      coverage: {
        pointCount,
        dateCount,
        display:
          pointCount === null || dateCount === null
            ? '待验证'
            : `${formatInteger(pointCount)} 点 / ${formatInteger(dateCount)} 日`,
      },
      confidence: {
        value: confidence,
        display: confidence === null ? '待校验' : `${Math.round(confidence)}/100`,
      },
    },
    curve: {
      rows,
      geometry: buildDeclarationCurveGeometry(rows),
    },
    windows: summarizeAdjustmentWindows(rows),
    recommendation: {
      status: recommendation.status || 'unavailable',
      canReview:
        recommendation.status === 'ready' &&
        Boolean(payload.execution?.dataReady),
      coverage:
        recommendation.coverage &&
        typeof recommendation.coverage === 'object'
          ? recommendation.coverage
          : {},
      fallbackReasons: Array.isArray(recommendation.fallbackReasons)
        ? recommendation.fallbackReasons
        : [],
    },
  };
}
