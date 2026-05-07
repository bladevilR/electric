export function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function quantile(values, ratio) {
  const clean = values.map(numeric).filter((value) => value !== null).sort((a, b) => a - b);
  if (!clean.length) {
    return null;
  }
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(clean.length * ratio) - 1));
  return clean[index];
}

export function windowLabel(rows) {
  return rows.map((row) => row.timePoint).filter(Boolean).join('、') || '暂无窗口';
}

function rowsForDate(dataset, date) {
  const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
  return date ? rows.filter((row) => row.date === date) : rows;
}

function priceRows(dataset, date) {
  return rowsForDate(dataset, date)
    .filter((row) => numeric(row.realTimeAvgPrice) !== null)
    .sort((left, right) => Number(left.pointIndex ?? 0) - Number(right.pointIndex ?? 0));
}

function lowPriceSuggestion(rows) {
  const threshold = quantile(
    rows.map((row) => row.realTimeAvgPrice),
    0.25
  );
  if (threshold === null) {
    return null;
  }

  const windowRows = rows.filter((row) => numeric(row.realTimeAvgPrice) <= threshold).slice(0, 6);
  return {
    type: 'low_price',
    severity: 'info',
    title: '低价窗口补足',
    description: `${windowLabel(windowRows)} 为低价观察窗口，适合做缺口补足和低风险增配。`,
    action: '增配买入',
    confidence: 0.62,
    points: windowRows.map((row) => row.pointIndex),
  };
}

function highPriceRiskSuggestion(rows) {
  const threshold = quantile(
    rows.map((row) => row.realTimeAvgPrice),
    0.8
  );
  if (threshold === null) {
    return null;
  }

  const windowRows = rows.filter((row) => numeric(row.realTimeAvgPrice) >= threshold).slice(0, 6);
  return {
    type: 'high_price_risk',
    severity: 'warning',
    title: '晚高峰风险控制',
    description: `${windowLabel(windowRows)} 为高价风险窗口，建议先锁定申报偏差和负荷异常。`,
    action: '控制暴露',
    confidence: 0.58,
    points: windowRows.map((row) => row.pointIndex),
  };
}

function dataGapSuggestion(dataset) {
  const completeness = dataset?.quality?.fieldCompleteness ?? {};
  const missing = [];
  if (!completeness.actualKwh) {
    missing.push('实际负荷');
  }
  if (!completeness.settleAmount) {
    missing.push('日结算');
  }
  if (!missing.length) {
    return null;
  }

  return {
    type: 'data_gap',
    severity: 'warning',
    title: '数据补齐优先级',
    description: `${missing.join('、')} 当前为空；系统可做策略试算，但收益归因与偏差考核需要补齐。`,
    action: '补齐数据',
    confidence: 1,
    points: [],
  };
}

export function buildStrategySuggestions(dataset, options = {}) {
  const rows = priceRows(dataset, options.date);
  return [lowPriceSuggestion(rows), highPriceRiskSuggestion(rows), dataGapSuggestion(dataset)].filter(
    Boolean
  );
}
