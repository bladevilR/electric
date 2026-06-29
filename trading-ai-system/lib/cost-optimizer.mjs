function numeric(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function quantile(values, ratio) {
  const clean = values.map(numeric).filter((value) => value !== null).sort((a, b) => a - b);
  if (!clean.length) {
    return null;
  }
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(clean.length * ratio) - 1));
  return clean[index];
}

function rowsForDate(dataset = {}, date = '') {
  const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
  return date ? rows.filter((row) => row.date === date) : rows;
}

function completenessValue(dataset, field) {
  const explicit = numeric(dataset?.quality?.fieldCompleteness?.[field]);
  if (explicit !== null) {
    return explicit;
  }
  return (Array.isArray(dataset?.rows) ? dataset.rows : []).filter((row) => numeric(row[field]) !== null).length;
}

function penalty(id, points, reason) {
  return { id, points, reason };
}

function addPenalty(penalties, condition, id, points, reason) {
  if (condition) {
    penalties.push(penalty(id, points, reason));
  }
}

export function computePriceSpreadRows(rows = []) {
  return rows.map((row) => {
    const realtime = numeric(row.realTimeAvgPrice);
    const dayahead = numeric(row.dayAheadPublicPrice);
    return {
      ...row,
      priceSpread: realtime !== null && dayahead !== null ? Number((realtime - dayahead).toFixed(6)) : null,
    };
  });
}

function modelMode(modelReport = {}, backtestReport = {}) {
  if (modelReport.status === 'baseline_ready' && backtestReport.status === 'ready') {
    return 'baseline_ready';
  }
  if (modelReport.status === 'insufficient_history' || backtestReport.status === 'insufficient_history') {
    return 'insufficient_history';
  }
  return 'heuristic_fallback';
}

export function buildDataConfidence(dataset = {}, assets = {}, modelReport = {}, backtestReport = {}) {
  const summary = assets?.summary || {};
  const penalties = [];
  const realtimePoints = completenessValue(dataset, 'realTimeAvgPrice');
  const contractTotal =
    numeric(summary.contractCurrentTotal) ||
    numeric(summary.contractCurrentCount) ||
    0;
  const contractCaptured =
    numeric(summary.contractCurrentCapturedRows) ||
    numeric(summary.contractCurrentCount) ||
    0;
  const tradeSequenceRows = numeric(summary.tradeSequenceRows) || numeric(summary.tradeSequenceCount) || 0;
  const systemForecastRows = numeric(summary.systemLoadForecastRows) || numeric(summary.systemLoadForecastCount) || 0;

  addPenalty(penalties, completenessValue(dataset, 'actualKwh') === 0, 'actual_load_missing', 25, '用户实际负荷为空，不能验证移峰影响。');
  addPenalty(penalties, completenessValue(dataset, 'settleAmount') === 0, 'settlement_missing', 20, '结算金额为空，不能核算真实节省金额。');
  addPenalty(penalties, contractTotal === 0, 'contract_missing', 15, '合同资产缺失，无法判断合约覆盖。');
  addPenalty(penalties, contractTotal > contractCaptured, 'contract_partial', 10, '合同接口显示还有分页未抓取。');
  addPenalty(penalties, tradeSequenceRows === 0, 'trade_sequence_missing', 10, '交易序列缺失，无法判断当前可交易背景。');
  addPenalty(penalties, systemForecastRows === 0, 'system_load_forecast_missing', 10, '系统负荷预测缺失，市场压力解释不足。');
  addPenalty(penalties, realtimePoints < 48, 'realtime_points_low', 10, '实时均价点数少于 48。');
  addPenalty(penalties, modelReport.status === 'insufficient_history', 'forecast_history_insufficient', 15, '历史样本不足，预测模型不能优先使用。');
  addPenalty(penalties, backtestReport.status !== 'ready', 'backtest_unavailable', 15, '回测不可用，不能声明模型优于基线。');

  const score = Math.max(0, 100 - penalties.reduce((sum, item) => sum + item.points, 0));
  return { score, penalties };
}

function windowRecord(row, reason) {
  return {
    date: row.date || '',
    pointIndex: row.pointIndex,
    timePoint: row.timePoint || '',
    realTimeAvgPrice: numeric(row.realTimeAvgPrice),
    dayAheadPublicPrice: numeric(row.dayAheadPublicPrice),
    priceSpread: numeric(row.priceSpread),
    reason,
  };
}

function buildSignals(rows = [], modelReport = {}) {
  const spreadRows = computePriceSpreadRows(rows).filter((row) => numeric(row.realTimeAvgPrice) !== null);
  const prices = spreadRows.map((row) => row.realTimeAvgPrice);
  const lowThreshold = quantile(prices, 0.25);
  const highThreshold = quantile(prices, 0.8);
  const lowPriceWindows = [];
  const highPriceExposureWindows = [];

  spreadRows.forEach((row) => {
    const realtime = numeric(row.realTimeAvgPrice);
    const spread = numeric(row.priceSpread);
    if (realtime !== null && lowThreshold !== null && (realtime <= lowThreshold || (spread !== null && spread <= -30))) {
      lowPriceWindows.push(windowRecord(row, spread !== null && spread <= -30 ? 'negative_spread' : 'low_quantile'));
    }
    if (realtime !== null && highThreshold !== null && (realtime >= highThreshold || (spread !== null && spread >= 80))) {
      highPriceExposureWindows.push(windowRecord(row, spread !== null && spread >= 80 ? 'positive_spread' : 'high_quantile'));
    }
  });

  const forecastSignals = (Array.isArray(modelReport.forecasts) ? modelReport.forecasts : []).filter(
    (item) => ['realTimeAvgPrice', 'priceSpread', 'highPriceRiskLabel'].includes(item.target)
  );

  return {
    pricePointCount: spreadRows.length,
    lowThreshold,
    highThreshold,
    lowPriceWindows: lowPriceWindows.slice(0, 8),
    highPriceExposureWindows: highPriceExposureWindows.slice(0, 8),
    forecastSignals: forecastSignals.slice(0, 12),
  };
}

function policyTier(id, title, enabled, executable, action, blockers = []) {
  return { id, title, enabled, executable, action, blockers };
}

function nextBestData(dataset = {}, assets = {}, modelReport = {}, backtestReport = {}) {
  const summary = assets?.summary || {};
  const needs = [];
  if (completenessValue(dataset, 'realTimeAvgPrice') < 96) {
    needs.push({ id: 'realtime_average_price', reason: '实时均价不足 96 点。' });
  }
  if (completenessValue(dataset, 'actualKwh') === 0) {
    needs.push({ id: 'actual_load_96', reason: '用户实际负荷为空。' });
  }
  if (completenessValue(dataset, 'settleAmount') === 0) {
    needs.push({ id: 'settle_day', reason: '日结算为空。' });
  }
  if ((numeric(summary.contractCurrentTotal) || 0) > (numeric(summary.contractCurrentCapturedRows) || 0)) {
    needs.push({ id: 'current_contract', reason: '当前合同还有未抓取分页。' });
  }
  if ((numeric(summary.systemLoadForecastRows) || numeric(summary.systemLoadForecastCount) || 0) === 0) {
    needs.push({ id: 'short_system_load_forecast', reason: '系统负荷预测缺失。' });
  }
  if (modelReport.status === 'insufficient_history' || backtestReport.status === 'insufficient_history') {
    needs.push({ id: 'historical_price_samples', reason: '连续历史样本不足。' });
  }
  return needs;
}

export function buildCostStrategy(dataset = {}, options = {}) {
  const date = options.date || '';
  const rows = rowsForDate(dataset, date);
  const modelReport = options.modelReport || {};
  const backtestReport = options.backtestReport || {};
  const dataConfidence = buildDataConfidence(dataset, options.assets, modelReport, backtestReport);
  const signals = buildSignals(rows, modelReport);
  const hasWindows = signals.lowPriceWindows.length > 0 && signals.highPriceExposureWindows.length > 0;
  const executionBlockers = [
    '用户实际负荷为空',
    '持仓/可交易电量为空',
    '交易限额为空',
    '人工复核未完成',
  ];

  return {
    generatedAt: new Date().toISOString(),
    status: signals.pricePointCount ? 'ready' : 'waiting_for_realtime_price',
    date,
    modelMode: modelMode(modelReport, backtestReport),
    signals,
    dataConfidence,
    policyTiers: [
      policyTier('conservative', '保守：观察并规避高价暴露', true, false, '只提示低价/高价窗口，不给出电量。', executionBlockers),
      policyTier(
        'neutral',
        '中性：有条件地考虑移峰',
        hasWindows,
        false,
        hasWindows ? '低价和高价窗口同时存在，可人工评估柔性负荷移峰。' : '需要同时具备低价窗口和高价暴露窗口。',
        executionBlockers
      ),
      policyTier('aggressive', '激进：模型优先的大幅移峰', false, false, '当前数据不足，禁用激进档。', [
        ...executionBlockers,
        '需要实际负荷、结算和有效回测后才能启用',
      ]),
    ],
    nextBestData: nextBestData(dataset, options.assets, modelReport, backtestReport),
  };
}
