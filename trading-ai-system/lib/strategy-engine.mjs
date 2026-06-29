import { buildCostStrategy } from './cost-optimizer.mjs';

export function numeric(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
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

function dependency(id, name, status, note) {
  return { id, name, status, note };
}

function trialOnly(base, requiredData, blockingReasons) {
  return {
    ...base,
    executable: false,
    requiredData,
    blockingReasons,
  };
}

function priceExecutionDependencies() {
  return [
    dependency('forecast_load_96', '预测负荷 96 点', '已登记约束', '用于把价格窗口换算成建议电量。'),
    dependency('position_96', '当前持仓曲线', '已登记约束', '用于判断可买、可卖和缺口规模。'),
    dependency('trade_limits', '交易限额与安全边界', '已登记约束', '用于校验最小申报量、可交易时段和运营安全约束。'),
    dependency('manual_confirmation', '人工确认记录', '已登记流程', '用于形成可追溯复核记录。'),
  ];
}

function priceExecutionBlockers() {
  return [
    '预测负荷未接入，无法计算建议电量',
    '当前持仓曲线未接入，无法判断可买可卖边界',
    '交易限额和人工确认记录未接入，不能生成执行单',
  ];
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
  return trialOnly(
    {
      type: 'low_price',
      severity: 'info',
      title: '低价窗口补足',
      description: `${windowLabel(windowRows)} 为低价观察窗口，适合做缺口补足和低风险增配。`,
      action: '增配买入',
      confidence: 0.62,
      points: windowRows.map((row) => row.pointIndex),
    },
    priceExecutionDependencies(),
    priceExecutionBlockers()
  );
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
  return trialOnly(
    {
      type: 'high_price_risk',
      severity: 'warning',
      title: '高价风险控制',
      description: `${windowLabel(windowRows)} 为高价风险窗口，建议先锁定申报偏差和负荷异常。`,
      action: '控制暴露',
      confidence: 0.58,
      points: windowRows.map((row) => row.pointIndex),
    },
    priceExecutionDependencies(),
    priceExecutionBlockers()
  );
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

  const requiredData = [];
  const blockingReasons = [];
  if (!completeness.actualKwh) {
    requiredData.push(
      dependency('actual_load_96', '实际负荷 96 点', '源返回空', '用于偏差考核、负荷预测评分和收益归因。')
    );
    blockingReasons.push('实际负荷未接入，不能校验策略对负荷偏差的影响');
  }
  if (!completeness.settleAmount) {
    requiredData.push(dependency('settle_day', '日结算', '源返回空', '用于核算实际收益与偏差考核结果。'));
    blockingReasons.push('日结算未接入，不能形成收益归因和结算复盘');
  }

  return trialOnly(
    {
      type: 'data_gap',
      severity: 'warning',
      title: '数据补齐优先级',
      description: `${missing.join('、')} 当前为空；系统可做策略试算，但收益归因与偏差考核需要补齐。`,
      action: '补齐数据',
      confidence: 1,
      points: [],
    },
    requiredData,
    blockingReasons
  );
}

export function buildStrategySuggestions(dataset, options = {}) {
  const rows = priceRows(dataset, options.date);
  return [lowPriceSuggestion(rows), highPriceRiskSuggestion(rows), dataGapSuggestion(dataset)].filter(
    Boolean
  );
}

function roundNumber(value, digits = 3) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = numeric(value);
  if (numericValue === null) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(numericValue * factor) / factor;
}

function average(values) {
  const clean = values.map(numeric).filter((value) => value !== null);
  if (!clean.length) {
    return null;
  }
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function uniqDependencies(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

export function buildStrategyAdvice(dataset, options = {}) {
  const rows = priceRows(dataset, options.date);
  const suggestions = buildStrategySuggestions(dataset, options);
  const costStrategy = buildCostStrategy(dataset, {
    date: options.date,
    assets: options.assets,
    modelReport: options.modelReport,
    backtestReport: options.backtestReport,
  });
  const prices = rows.map((row) => row.realTimeAvgPrice);
  const lowThreshold = quantile(prices, 0.25);
  const highThreshold = quantile(prices, 0.8);
  const hasRealtimePrice = rows.length > 0;
  const nextDataNeeds = uniqDependencies([
    ...(!hasRealtimePrice
      ? [
          dependency(
            'realtime_average_price',
            'Real-time average price snapshot',
            'missing',
            'Required to identify low-price and high-price observation windows.'
          ),
        ]
      : []),
    ...suggestions.flatMap((item) => item.requiredData || []),
  ]);

  return {
    status: hasRealtimePrice ? 'observation_ready' : 'waiting_for_realtime_price',
    date: options.date || '',
    generatedAt: new Date().toISOString(),
    realtimePrice: {
      required: true,
      status: hasRealtimePrice ? 'available_snapshot' : 'missing',
      pointCount: rows.length,
      requiredFor: ['low_price_window', 'high_price_risk', 'intraday_refresh'],
      note: hasRealtimePrice
        ? 'A price snapshot is available for trial-only observation. Intraday advice still needs refreshed realtime prices.'
        : 'Realtime price is required before the AI advice panel can identify price windows.',
    },
    priceSignal: {
      pointCount: rows.length,
      averageRealTimePrice: roundNumber(average(prices), 3),
      lowThreshold,
      highThreshold,
      minRealTimePrice: rows.length ? Math.min(...prices.map(Number)) : null,
      maxRealTimePrice: rows.length ? Math.max(...prices.map(Number)) : null,
      lowWindowPoints: lowThreshold === null
        ? []
        : rows.filter((row) => numeric(row.realTimeAvgPrice) <= lowThreshold).map((row) => row.pointIndex),
      highWindowPoints: highThreshold === null
        ? []
        : rows.filter((row) => numeric(row.realTimeAvgPrice) >= highThreshold).map((row) => row.pointIndex),
    },
    executionBoundary: {
      mode: 'trial_only',
      executable: false,
      canCreateDraft: false,
      reason: 'Forecast load, position, trade limits, and human review are required before creating an executable draft.',
    },
    nextDataNeeds,
    suggestionCount: suggestions.length,
    costStrategy,
  };
}
