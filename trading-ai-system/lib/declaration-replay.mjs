const DEFAULT_INTERVAL_HOURS = 0.25;
const DEFAULT_MIN_COMPARABLE_POINTS = 96;

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

export function buildDeclarationReplay(featureStore = {}, options = {}) {
  const intervalHours = Number(options.intervalHours || DEFAULT_INTERVAL_HOURS);
  const minComparablePoints = Number(
    options.minComparablePoints || DEFAULT_MIN_COMPARABLE_POINTS
  );
  const comparable = (Array.isArray(featureStore.rows) ? featureStore.rows : [])
    .map((row) => {
      const submittedPowerMw = numeric(row.declarationPower);
      const baselinePowerMw = numeric(row.defaultDeclarationPower);
      const actualKwh = numeric(row.actualKwh);
      if (
        !row.date ||
        submittedPowerMw === null ||
        baselinePowerMw === null ||
        actualKwh === null
      ) {
        return null;
      }
      const actualMwh = actualKwh / 1000;
      const submittedMwh = submittedPowerMw * intervalHours;
      const baselineMwh = baselinePowerMw * intervalHours;
      const submittedErrorMwh = Math.abs(submittedMwh - actualMwh);
      const baselineErrorMwh = Math.abs(baselineMwh - actualMwh);
      return {
        date: String(row.date),
        submittedErrorMwh,
        baselineErrorMwh,
        improved: submittedErrorMwh < baselineErrorMwh,
      };
    })
    .filter(Boolean);

  const comparablePointCount = comparable.length;
  const dateCount = new Set(comparable.map((row) => row.date)).size;
  const submittedMaeMwh = comparablePointCount
    ? comparable.reduce((sum, row) => sum + row.submittedErrorMwh, 0) /
      comparablePointCount
    : null;
  const baselineMaeMwh = comparablePointCount
    ? comparable.reduce((sum, row) => sum + row.baselineErrorMwh, 0) /
      comparablePointCount
    : null;
  const improvementPct =
    baselineMaeMwh !== null && baselineMaeMwh > 0 && submittedMaeMwh !== null
      ? ((baselineMaeMwh - submittedMaeMwh) / baselineMaeMwh) * 100
      : null;
  const winRatePct = comparablePointCount
    ? (comparable.filter((row) => row.improved).length / comparablePointCount) * 100
    : null;
  const status =
    comparablePointCount >= minComparablePoints
      ? 'validated'
      : 'insufficient_evidence';
  const verdict =
    status !== 'validated'
      ? 'not_validated'
      : improvementPct !== null && improvementPct > 0
        ? 'improved'
        : 'not_improved';

  return {
    status,
    verdict,
    intervalHours,
    comparablePointCount,
    requiredComparablePoints: minComparablePoints,
    dateCount,
    submittedMaeMwh: round(submittedMaeMwh),
    baselineMaeMwh: round(baselineMaeMwh),
    improvementPct: round(improvementPct, 2),
    winRatePct: round(winRatePct, 2),
    costSavingsYuan: null,
    warnings: ['cost_attribution_unavailable'],
  };
}
