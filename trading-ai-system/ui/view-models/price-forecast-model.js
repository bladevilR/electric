function normalizedRole(run, assigned) {
  const explicit = run?.role || run?.modelRole;
  if (['baseline', 'champion', 'challenger'].includes(explicit)) return explicit;
  if (
    run?.readiness?.status === 'baseline_only' ||
    /baseline|median|naive/i.test(String(run?.modelId || ''))
  ) {
    return 'baseline';
  }
  if (!assigned.has('champion')) return 'champion';
  return 'challenger';
}

export function buildPriceForecastModel({
  forecastRuns = [],
  outcomes = [],
  accuracy = {},
  targetDate,
} = {}) {
  const runs = Array.isArray(forecastRuns)
    ? [...forecastRuns].sort(
        (left, right) =>
          (Date.parse(right?.forecastGeneratedAt || right?.issuedAt || '') || 0) -
          (Date.parse(left?.forecastGeneratedAt || left?.issuedAt || '') || 0)
      )
    : [];
  const assigned = new Map();
  for (const run of runs) {
    const role = normalizedRole(run, assigned);
    if (!assigned.has(role)) assigned.set(role, run);
  }
  const roles = ['baseline', 'champion', 'challenger'].map((role) => ({
    role,
    run: assigned.get(role) || null,
  }));
  return {
    targetDate: targetDate || runs[0]?.targetTradingDate || null,
    series: [
      ...roles,
      { role: 'actual', run: Array.isArray(outcomes) && outcomes.length ? { points: outcomes } : null },
    ],
    accuracy,
    labels: ['用户日前临时价', '用户日前最终价', '实时当前价', '实时最终价'],
    warnings: runs.some((run) => run.explainability === false)
      ? ['该模型未提供可复核贡献分解']
      : [],
  };
}
