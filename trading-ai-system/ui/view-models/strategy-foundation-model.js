const POINT_COUNT = 96;

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, min, max, fallback) => {
  const number = numberOrNull(value);
  return Math.min(max, Math.max(min, number === null ? fallback : number));
};

const latestDate = (dates = []) =>
  [...dates].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date))).sort().at(-1) || '';

const pointValue = (row = {}) =>
  numberOrNull(
    row.value ??
      row.predictedValue ??
      row.prediction ??
      row.pointForecast ??
      row.p50 ??
      row.forecast ??
      row.forecastValue
  );

const normalizePoints = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({
      pointIndex: Math.min(POINT_COUNT, Math.max(1, Number(row.pointIndex || index + 1))),
      value: pointValue(row),
    }))
    .filter((row) => row.value !== null);

const seriesPoints = (source, keys = []) => {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) return normalizePoints(value);
    if (Array.isArray(value?.points)) return normalizePoints(value.points);
  }
  return [];
};

const metric = (source, keys = []) => {
  for (const key of keys) {
    const value = numberOrNull(source?.[key]);
    if (value !== null) return value;
  }
  return null;
};

function forecastTab({ id, label, unit, description, source, actualKeys, currentKeys, previousKeys }) {
  return {
    id,
    label,
    unit,
    description,
    series: [
      { id: 'actual', label: '实际值', role: 'actual', points: seriesPoints(source, actualKeys) },
      { id: 'current', label: '本次预测', role: 'forecast', points: seriesPoints(source, currentKeys) },
      { id: 'previous', label: '上一版预测', role: 'previous', points: seriesPoints(source, previousKeys) },
    ],
  };
}

const EXPLANATIONS = Object.freeze({
  mae: {
    id: 'mae',
    title: 'MAE 平均绝对误差',
    principle: '逐点计算预测值与实际值的绝对差，再取平均。',
    formula: 'MAE = 1/n × Σ |实际值 - 预测值|',
    caveat: '保留原始单位，越低越好，适合直接理解平均偏差。',
  },
  rmse: {
    id: 'rmse',
    title: 'RMSE 均方根误差',
    principle: '先平方再平均，因此对尖峰误差更敏感。',
    formula: 'RMSE = √(1/n × Σ(实际值 - 预测值)²)',
    caveat: '数值越低越好；明显高于 MAE 时说明存在较大的局部误差。',
  },
  mape: {
    id: 'mape',
    title: 'MAPE 平均绝对百分比误差',
    principle: '用实际值归一化逐点误差，便于跨日期比较。',
    formula: 'MAPE = 1/n × Σ |(实际值 - 预测值) / 实际值| × 100%',
    caveat: '越低越好；实际值接近 0 时需结合 MAE 判断。',
  },
  baselineSkill: {
    id: 'baselineSkill',
    title: '相对基线改善',
    principle: '比较当前模型与同一评估区间内基线模型的误差。',
    formula: '改善率 = (基线误差 - 当前误差) / 基线误差 × 100%',
    caveat: '只有使用相同目标、样本和截止时点的结果才能比较。',
  },
  optimizer: {
    id: 'optimizer',
    title: '依据说明 · 申报优化器',
    principle: '在预测负荷与价格信号之间寻找成本更低且满足业务边界的 96 点申报曲线。',
    formula: 'min Σ(申报电量ₜ × 预测价格ₜ) + λ₁偏差惩罚 + λ₂变化率惩罚',
    caveat: '结果仍受持仓边界、交易限额、爬坡约束和人工复核约束。',
    variables: [
      { name: '申报电量ₜ', meaning: '第 t 个 15 分钟时段的申报电量', unit: 'MWh' },
      { name: '预测价格ₜ', meaning: '第 t 个时段的预测结算价格', unit: '元/MWh' },
      { name: 'λ₁', meaning: '偏差风险惩罚权重', unit: '无量纲' },
      { name: 'λ₂', meaning: '曲线变化率惩罚权重', unit: '无量纲' },
    ],
  },
  risk: {
    id: 'risk',
    title: '依据说明 · 风险约束',
    principle: '在生成建议前先排除超过可买卖量、申报功率和变化率边界的候选。',
    formula: '下限ₜ ≤ 申报功率ₜ ≤ 上限ₜ，且 |功率ₜ - 功率ₜ₋₁| ≤ 爬坡上限',
    caveat: '缺少任一强约束时，页面只能展示不可执行的试算结果。',
  },
});

export function buildStrategyFoundationModel(input = {}) {
  const workbench = input.workbench || {};
  const ukeyStatus = input.ukeyStatus || {};
  const history = ukeyStatus.visibleHistory || {};
  const targetDate = String(input.targetDate || workbench.date || '');
  const currentCoverage = Math.min(
    POINT_COUNT,
    Math.max(0, Number(workbench.metrics?.marketPricePointCount || 0))
  );
  const historyDate = latestDate(history.dates || []);
  const historyCoverage = Math.min(POINT_COUNT, Math.max(0, Number(history.rowCount || 0)));
  const collectorState = String(ukeyStatus.collector?.state || 'stopped');
  const readinessStatus = String(workbench.readiness?.status || workbench.status || 'data_blocked');
  const forecastReport = input.forecastReport || {};
  const marketSeries = input.marketCockpit?.series || {};
  const accuracyReport = input.accuracyReport || {};
  const predictionRows = forecastReport.forecasts || forecastReport.rows || [];
  const previousRows = forecastReport.previousForecasts || forecastReport.previous || [];
  const actualPriceRows =
    forecastReport.actuals || marketSeries.price?.points || marketSeries.realtimePrice?.points || [];
  const formalRows =
    workbench.declarationRecommendation?.rows ||
    workbench.recommendation?.rows ||
    workbench.strategy?.rows ||
    [];

  const tabs = [
    forecastTab({
      id: 'price',
      label: '价格预测',
      unit: '元/MWh',
      description: '比较市场价格实际值、当前预测与上一版本预测。',
      source: { actual: actualPriceRows, current: predictionRows, previous: previousRows },
      actualKeys: ['actual'],
      currentKeys: ['current'],
      previousKeys: ['previous'],
    }),
    forecastTab({
      id: 'temperature',
      label: '温度预测',
      unit: '°C',
      description: '查看温度及相关气象因素如何影响用电需求。',
      source: marketSeries,
      actualKeys: ['temperatureActual', 'temperature'],
      currentKeys: ['temperatureForecast'],
      previousKeys: ['temperaturePrevious'],
    }),
    forecastTab({
      id: 'load',
      label: '负荷预测',
      unit: 'MW',
      description: '比较实际负荷、当前负荷预测与上一版本预测。',
      source: marketSeries,
      actualKeys: ['loadActual', 'load'],
      currentKeys: ['loadForecast'],
      previousKeys: ['loadPrevious'],
    }),
  ];

  const accuracyForTarget = (targetId) => {
    const targetAccuracy = accuracyReport.byTarget?.[targetId] || {};
    const targetForecast = forecastReport.byTarget?.[targetId] || {};
    const allowRootFallback = targetId === 'price';
    const accuracySource =
      targetAccuracy.metrics ||
      (allowRootFallback ? accuracyReport.metrics || accuracyReport : {}) ||
      targetForecast.metrics ||
      (allowRootFallback ? forecastReport.metrics || {} : {});
    return {
      metrics: {
        mae: metric(accuracySource, ['mae', 'MAE']),
        rmse: metric(accuracySource, ['rmse', 'RMSE']),
        mape: metric(accuracySource, ['mape', 'MAPE']),
        baselineSkill: metric(accuracySource, [
          'baselineSkill',
          'skillVsBaseline',
          'relativeImprovementPct',
        ]),
      },
      history: Array.isArray(targetAccuracy.history)
        ? targetAccuracy.history
        : allowRootFallback && Array.isArray(accuracyReport.history)
          ? accuracyReport.history
          : [],
      versions:
        targetAccuracy.versions ||
        targetForecast.versions ||
        (allowRootFallback
          ? accuracyReport.versions || forecastReport.versions || forecastReport.candidates || []
          : []),
      modelVersion:
        targetAccuracy.modelVersion ||
        targetForecast.modelVersion ||
        targetForecast.selectedModel?.id ||
        targetForecast.model?.id ||
        (allowRootFallback
          ? forecastReport.modelVersion ||
            forecastReport.selectedModel?.id ||
            forecastReport.model?.id ||
            null
          : null),
      sampleDays:
        metric(targetAccuracy, ['sampleDays', 'historyDateCount']) ??
        metric(targetForecast, ['sampleDays', 'historyDateCount']) ??
        (allowRootFallback ? metric(forecastReport, ['sampleDays', 'historyDateCount']) : null),
      lastBacktestAt:
        targetAccuracy.lastBacktestAt ||
        targetAccuracy.generatedAt ||
        targetForecast.lastBacktestAt ||
        (allowRootFallback
          ? forecastReport.lastBacktestAt || accuracyReport.generatedAt || null
          : null),
    };
  };
  const accuracyByTab = {
    price: accuracyForTarget('price'),
    temperature: accuracyForTarget('temperature'),
    load: accuracyForTarget('load'),
  };

  return {
    identity: {
      environment: input.mode === 'demo' ? '演示环境' : '真实环境',
      targetDate,
      now: input.now || new Date().toISOString(),
      dataCutoff:
        forecastReport.dataCutoff ||
        forecastReport.asOf ||
        input.marketCockpit?.identity?.asOf ||
        null,
    },
    collection: {
      current: {
        kind: 'current_real',
        label: '今日真实数据',
        date: targetDate,
        coverage: currentCoverage,
        complete: currentCoverage === POINT_COUNT,
        storagePath: ukeyStatus.visibleSnapshot?.storagePath || null,
      },
      history: {
        kind: 'historical_real',
        label: '历史真实数据',
        date: historyDate,
        coverage: historyCoverage,
        generatedAt: history.generatedAt || null,
        storagePath: history.storagePath || null,
      },
      simulation: { kind: 'simulation', label: '模拟方案' },
      collectorState,
      lastPageTitle: ukeyStatus.collector?.lastPageTitle || null,
      lastPageUrl: ukeyStatus.collector?.lastPageUrl || null,
      lastSampleAt: ukeyStatus.collector?.lastSampleAt || null,
      strategyExecutable:
        currentCoverage === POINT_COUNT && ['ready', 'review_ready'].includes(readinessStatus),
      readinessStatus,
    },
    forecastTabs: tabs,
    accuracy: { ...accuracyByTab.price, byTab: accuracyByTab },
    sandbox: {
      formalRows,
      defaults: {
        priceWeight: 0.7,
        temperatureWeight: 0.5,
        loadWeight: 0.6,
        riskProfile: 'balanced',
      },
    },
    derivation: {
      stages: [
        { id: 'sources', label: '数据来源' },
        { id: 'quality', label: '质量校验与时点快照' },
        { id: 'forecasts', label: '价格 / 温度 / 负荷预测' },
        { id: 'fusion', label: '特征融合' },
        { id: 'optimizer', label: '申报优化器', explanationId: 'optimizer' },
        { id: 'risk', label: '风险约束', explanationId: 'risk' },
        { id: 'review', label: '人工复核' },
      ],
      evidenceStages: input.strategyTrace?.stages || [],
    },
    explanations: EXPLANATIONS,
  };
}

export function applyFoundationSandbox(model, controls = {}) {
  const defaults = model?.sandbox?.defaults || {};
  const normalized = {
    priceWeight: clamp(controls.priceWeight, 0, 1, defaults.priceWeight ?? 0.7),
    temperatureWeight: clamp(
      controls.temperatureWeight,
      0,
      1,
      defaults.temperatureWeight ?? 0.5
    ),
    loadWeight: clamp(controls.loadWeight, 0, 1, defaults.loadWeight ?? 0.6),
    riskProfile: ['conservative', 'balanced', 'active'].includes(controls.riskProfile)
      ? controls.riskProfile
      : defaults.riskProfile || 'balanced',
  };
  const riskFactor = { conservative: 0.65, balanced: 1, active: 1.2 }[normalized.riskProfile];
  const baseSignal =
    (normalized.loadWeight - 0.5) * 0.09 -
    (normalized.priceWeight - 0.5) * 0.07 +
    (normalized.temperatureWeight - 0.5) * 0.04;
  const formalRows = Array.isArray(model?.sandbox?.formalRows) ? model.sandbox.formalRows : [];
  const series = formalRows.map((row, index) => {
    const formalMw =
      numberOrNull(
        row.recommendedPowerMw ?? row.recommendedMw ?? row.powerMw ?? row.value
      ) ?? 0;
    const intradayShape = Math.sin(((index + 1) / POINT_COUNT) * Math.PI * 2) * 0.025;
    const adjustmentRatio = Math.min(0.12, Math.max(-0.12, (baseSignal + intradayShape) * riskFactor));
    return {
      pointIndex: Number(row.pointIndex || index + 1),
      formalMw,
      adjustedMw: Number((formalMw * (1 + adjustmentRatio)).toFixed(3)),
      adjustmentRatio,
    };
  });

  if (!series.length) {
    return {
      kind: 'simulation',
      persisted: false,
      submitAllowed: false,
      controls: normalized,
      series: [],
      estimatedCostChangeYuan: null,
      peakValleyShiftMwh: null,
      riskExposureChangePct: null,
    };
  }

  const netPowerShift = series.reduce((sum, row) => sum + row.adjustedMw - row.formalMw, 0);
  return {
    kind: 'simulation',
    persisted: false,
    submitAllowed: false,
    controls: normalized,
    series,
    estimatedCostChangeYuan: null,
    peakValleyShiftMwh: Number((Math.abs(netPowerShift) * 0.25).toFixed(2)),
    riskExposureChangePct: Number(((riskFactor - 1) * 10).toFixed(1)),
  };
}

export { EXPLANATIONS as FOUNDATION_EXPLANATIONS };
