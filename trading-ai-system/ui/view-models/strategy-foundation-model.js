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
    if (Array.isArray(value)) {
      const points = normalizePoints(value);
      if (points.length) return points;
    }
    if (Array.isArray(value?.points)) {
      const points = normalizePoints(value.points);
      if (points.length) return points;
    }
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

const rowsForTarget = (rows = [], target) =>
  (Array.isArray(rows) ? rows : []).filter((row) => {
    const rowTarget = row?.target || row?.targetId || row?.fieldId;
    return !rowTarget || rowTarget === target;
  });

const percentageMetric = (source = {}) => {
  const explicitPercent = metric(source, ['baselineSkill', 'relativeImprovementPct']);
  if (explicitPercent !== null) return explicitPercent;
  const ratio = metric(source, ['skillVsBaseline']);
  return ratio === null ? null : Number((ratio * 100).toFixed(4));
};

const uniqueValues = (values = []) => [
  ...new Set(values.flat().filter((value) => value !== null && value !== undefined && value !== '')),
];

function nodeEvidence(stages = [], stageIds = []) {
  const selected = (Array.isArray(stages) ? stages : []).filter((stage) =>
    stageIds.includes(stage?.id)
  );
  return {
    stageStatus: selected.map((stage) => `${stage.title || stage.id}：${stage.status || 'unavailable'}`),
    conclusionIds: uniqueValues(selected.map((stage) => stage.conclusion?.conclusionId)),
    inputRefs: uniqueValues(selected.map((stage) => stage.conclusion?.inputRefs || [])),
    featureSnapshotIds: uniqueValues(
      selected.map((stage) => stage.conclusion?.featureSnapshotId)
    ),
    forecastRunIds: uniqueValues(selected.map((stage) => stage.conclusion?.forecastRunIds || [])),
    modelVersions: uniqueValues(selected.map((stage) => stage.conclusion?.modelVersions || [])),
    constraintRefs: uniqueValues(selected.map((stage) => stage.conclusion?.constraintRefs || [])),
    warnings: uniqueValues(
      selected.flatMap((stage) => [
        ...(stage.missingFields || []),
        ...(stage.conclusion?.warnings || []),
      ])
    ),
  };
}

function forecastTab({ id, label, unit, description, source, actualKeys, currentKeys, previousKeys }) {
  const actual = seriesPoints(source, actualKeys);
  const current = seriesPoints(source, currentKeys);
  const previous = seriesPoints(source, previousKeys);
  return {
    id,
    label,
    unit,
    description,
    series: [
      { id: 'actual', label: '实际值', role: 'actual', points: actual },
      { id: 'current', label: '预测 P50', role: 'forecast', points: current },
      { id: 'previous', label: '上一版预测', role: 'previous', points: previous },
    ],
  };
}

function fieldPoints(rows = [], fieldIds = [], targetDate = '') {
  const allowed = new Set(fieldIds);
  const latest = new Map();
  for (const fact of Array.isArray(rows) ? rows : []) {
    if (!allowed.has(fact.fieldId) || (targetDate && fact.businessDate !== targetDate)) continue;
    const pointIndex = Number(fact.pointIndex);
    const value = numberOrNull(fact.value);
    if (!Number.isInteger(pointIndex) || value === null) continue;
    const key = `${fact.fieldId}|${pointIndex}`;
    const old = latest.get(key);
    if (!old || Date.parse(fact.availableAt || 0) >= Date.parse(old.availableAt || 0)) latest.set(key, fact);
  }
  for (const fieldId of fieldIds) {
    const points = [...latest.values()]
      .filter((fact) => fact.fieldId === fieldId)
      .map((fact) => ({ pointIndex: Number(fact.pointIndex), value: Number(fact.value) }))
      .sort((left, right) => left.pointIndex - right.pointIndex);
    if (points.length) return points;
  }
  return [];
}

function runFieldPoints(rows = [], field = 'p50') {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ pointIndex: Number(row.pointIndex), value: numberOrNull(row[field] ?? (field === 'p50' ? row.pointForecast : null)) }))
    .filter((row) => Number.isInteger(row.pointIndex) && row.value !== null)
    .sort((left, right) => left.pointIndex - right.pointIndex);
}

const EXPLANATIONS = Object.freeze({
  sources: {
    id: 'sources',
    title: '依据说明 · 数据来源',
    principle: '只使用能标明业务日期、点位、发布时间和来源页面的数据进入策略链。',
    formula: '可用输入 = 来源已确认 ∩ 业务日期匹配 ∩ 点位口径一致',
    caveat: '页面查询时间不是数据发布时间；缺少来源证据时保持为空。',
  },
  quality: {
    id: 'quality',
    title: '依据说明 · 质量校验与时点快照',
    principle: '先按 96 个 15 分钟点检查覆盖、重复、空值和时间穿越，再冻结本次决策快照。',
    formula: '覆盖率 = 有效唯一点位数 / 96；事实可用条件 = availableAt ≤ 决策截止',
    caveat: '覆盖完整仍不等于可执行，数据新鲜度和生产就绪状态也必须通过。',
  },
  forecasts: {
    id: 'forecasts',
    title: '依据说明 · 三类预测',
    principle: '价格、温度和负荷分别建模、分别回测，只有同一目标和单位的序列才能比较。',
    formula: 'ŷₜ = f(同点位历史、日历、气象、负荷与市场特征)',
    caveat: '没有真实温度接口时温度曲线保持空白，不用其他序列代替。',
  },
  fusion: {
    id: 'fusion',
    title: '依据说明 · 特征融合',
    principle: '将三类预测对齐到相同交易日和 96 点网格，形成可供优化器使用的特征快照。',
    formula: 'xₜ = [价格预测ₜ, 温度预测ₜ, 负荷预测ₜ, 持仓ₜ, 交易边界ₜ]',
    caveat: '任何特征都必须保留自身版本和截止时间，不能用后验实际值参与当时决策。',
  },
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
  review: {
    id: 'review',
    title: '依据说明 · 人工复核',
    principle: '复核人查看关键变化、约束命中、回退原因和证据完整性后再决定是否采用。',
    formula: '可采用 = 数据就绪 ∧ 约束通过 ∧ 证据完整 ∧ 人工确认',
    caveat: '当前页面的模拟微调不会写入正式策略，也不会提交交易。',
  },
});

export function buildStrategyFoundationModel(input = {}) {
  const workbench = input.workbench || {};
  const ukeyStatus = input.ukeyStatus || {};
  const collectorStatus = input.collectorStatus || {};
  const canonicalFacts = input.historyFacts?.rows || [];
  const canonicalCoverage = input.historyCoverage?.coverage || input.historyCoverage || {};
  const history = ukeyStatus.visibleHistory || {};
  const targetDate = String(input.targetDate || workbench.date || '');
  const currentCoverage = Math.min(
    POINT_COUNT,
    Math.max(0, Number(workbench.metrics?.marketPricePointCount || 0))
  );
  const historyDate = latestDate(history.dates || []);
  const historyCoverageRaw = historyDate
    ? history.coverageByDate?.[historyDate] ??
      (Array.isArray(history.dates) && history.dates.length === 1 ? history.rowCount : 0)
    : 0;
  const historyCoverage = Math.min(POINT_COUNT, Math.max(0, Number(historyCoverageRaw || 0)));
  const readinessStatus = String(workbench.readiness?.status || workbench.status || 'data_blocked');
  const dataReady = ['ready', 'review_ready', 'review_required', 'verified'].includes(
    readinessStatus
  );
  const isDemo = input.mode === 'demo';
  const collectorError =
    collectorStatus.browser?.lastErrorMessage ||
    ukeyStatus.collector?.lastError ||
    ukeyStatus.browserWindow?.lastError ||
    ukeyStatus.loadError ||
    null;
  const collectorState = String(
    isDemo
      ? 'simulation'
      : collectorStatus.browser?.state
        ? collectorStatus.browser.state
      : ukeyStatus.loadError
        ? 'unavailable'
        : ukeyStatus.browserWindow?.available === false
          ? 'unavailable'
        : ukeyStatus.collector?.state === 'running' && collectorError
          ? 'running_with_error'
          : ukeyStatus.collector?.state || 'stopped'
  );
  const latestCollectionJob = [...(collectorStatus.jobs || [])]
    .sort((left, right) =>
      (Date.parse(right?.createdAt || '') || 0) - (Date.parse(left?.createdAt || '') || 0)
    )[0] || null;
  const completedChunks = Number(latestCollectionJob?.completedChunks || 0);
  const totalChunks = Number(latestCollectionJob?.totalChunks || 0);
  const backfillProgressPct = totalChunks
    ? Math.round((completedChunks / totalChunks) * 100)
    : Number(latestCollectionJob?.progressPct || 0);
  const forecastReport = input.forecastReport || {};
  const marketSeries = input.marketCockpit?.series || {};
  const accuracyReport = input.accuracyReport || {};
  const priceRuns = (input.forecastRuns?.runs || [])
    .filter(
      (run) =>
        ['realTimeAvgPrice', 'dayAheadUserPriceFinalYuanPerMwh'].includes(run?.targetField) &&
        (!run.forecastRunType || run.forecastRunType === 'live_issued')
    )
    .sort(
      (left, right) =>
        Date.parse(right.forecastGeneratedAt || 0) - Date.parse(left.forecastGeneratedAt || 0)
    );
  const latestPriceRun = priceRuns[0] || null;
  const previousPriceRun = priceRuns[1] || null;
  const predictionRows = latestPriceRun?.rows?.length
    ? latestPriceRun.rows
    : rowsForTarget(forecastReport.forecasts || forecastReport.rows || [], 'realTimeAvgPrice');
  const previousRows = previousPriceRun?.rows?.length
    ? previousPriceRun.rows
    : rowsForTarget(
        forecastReport.previousForecasts || forecastReport.previous || [],
        'realTimeAvgPrice'
      );
  const issuedVersions = priceRuns.map((run) => ({
    id: run.forecastRunId,
    modelVersion: run.modelVersion || run.modelId,
    issuedAt: run.forecastGeneratedAt,
    sampleCount: Array.isArray(run.rows) ? run.rows.length : null,
    mae: null,
    baselineSkill: null,
    status: run.forecastRunType === 'point_in_time_replay' ? '时点回放' : '已发布',
  }));
  const actualPriceRows = fieldPoints(canonicalFacts, [
    'dayAheadUserPriceFinalYuanPerMwh',
    'realTimeAvgPriceFinalYuanPerMwh',
  ], targetDate).length
    ? fieldPoints(canonicalFacts, ['dayAheadUserPriceFinalYuanPerMwh', 'realTimeAvgPriceFinalYuanPerMwh'], targetDate)
    : rowsForTarget(forecastReport.actuals || [], 'realTimeAvgPrice').length
      ? rowsForTarget(forecastReport.actuals || [], 'realTimeAvgPrice')
      : marketSeries.realTimePriceFinalYuanPerMwh?.points || marketSeries.realTimePriceCurrentYuanPerMwh?.points || [];
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
      source: {
        ...marketSeries,
        evidenceActual: fieldPoints(canonicalFacts, ['temperatureActualC'], targetDate),
        evidenceForecast: fieldPoints(canonicalFacts, ['temperatureForecastC'], targetDate),
      },
      actualKeys: ['evidenceActual', 'temperatureActualC'],
      currentKeys: ['evidenceForecast', 'temperatureForecastC'],
      previousKeys: ['temperaturePreviousForecastC'],
    }),
    forecastTab({
      id: 'load',
      label: '负荷预测',
      unit: 'MW',
      description: '比较实际负荷、当前负荷预测与上一版本预测。',
      source: {
        ...marketSeries,
        evidenceActual: fieldPoints(canonicalFacts, ['actualLoadMw', 'actualAverageLoadMw'], targetDate),
        evidenceForecast: fieldPoints(canonicalFacts, ['loadForecastMw', 'systemLoadForecastMw'], targetDate),
      },
      actualKeys: ['evidenceActual', 'actualAverageLoadMw'],
      currentKeys: ['evidenceForecast', 'systemLoadForecastMw', 'netLoadForecastMw'],
      previousKeys: ['previousSystemLoadForecastMw'],
    }),
  ];
  const priceIntervalLower = runFieldPoints(latestPriceRun?.rows, 'p10');
  const priceIntervalUpper = runFieldPoints(latestPriceRun?.rows, 'p90');
  if (priceIntervalLower.length && priceIntervalUpper.length) {
    tabs[0].series.push({
      id: 'interval',
      label: 'P10–P90 区间',
      role: 'interval',
      points: [],
      lowerPoints: priceIntervalLower,
      upperPoints: priceIntervalUpper,
    });
  }

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
        baselineSkill: percentageMetric(accuracySource),
      },
      history: Array.isArray(targetAccuracy.history)
        ? targetAccuracy.history
        : allowRootFallback && Array.isArray(accuracyReport.history)
          ? accuracyReport.history
          : [],
      versions: (
        targetAccuracy.versions ||
        targetForecast.versions ||
        (allowRootFallback
          ? accuracyReport.versions ||
            forecastReport.versions ||
            forecastReport.candidates ||
            issuedVersions
          : [])
      ).map((version) => ({ ...version, baselineSkill: percentageMetric(version) })),
      modelVersion:
        targetAccuracy.modelVersion ||
        targetForecast.modelVersion ||
        (allowRootFallback && (latestPriceRun?.modelId || latestPriceRun?.modelVersion)
          ? [latestPriceRun.modelId, latestPriceRun.modelVersion].filter(Boolean).join(' · ')
          : null) ||
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
        (allowRootFallback ? metric(latestPriceRun?.readiness, ['historicalCompleteDateCount']) : null) ??
        (allowRootFallback ? metric(forecastReport, ['sampleDays', 'historyDateCount']) : null),
      lastBacktestAt:
        targetAccuracy.lastBacktestAt ||
        targetAccuracy.generatedAt ||
        targetForecast.lastBacktestAt ||
        (allowRootFallback
          ? forecastReport.lastBacktestAt ||
            accuracyReport.evaluationAsOf ||
            accuracyReport.generatedAt ||
            null
          : null),
    };
  };
  const accuracyByTab = {
    price: accuracyForTarget('price'),
    temperature: accuracyForTarget('temperature'),
    load: accuracyForTarget('load'),
  };
  const priceReadiness = latestPriceRun?.readiness || {};
  const priceMissingReasonLabels = {
    historical_complete_dates_below_30: '完整历史少于 30 天，暂不启用多因素模型',
    multivariate_training_dates_below_5: '温度与负荷联合样本少于 5 天',
    target_weather_or_load_forecast_incomplete: '目标日温度或负荷预测不完整',
  };
  const priceEvidence = {
    source: priceReadiness.status === 'baseline_only'
      ? 'JSPEC 最终日前电价（同点历史；未使用缺失的温度和负荷）'
      : `JSPEC 历史价格 + ${collectorStatus.weather?.provider || '天气预报源'} 温度预报 + JSPEC 负荷预测`,
    formula: latestPriceRun?.algorithm?.formula || '价格 = 同点基线 + 温度贡献 + 负荷贡献',
    caveat: (priceReadiness.missingReasons || [])
      .map((reason) => priceMissingReasonLabels[reason] || reason)
      .join('；') || null,
  };
  const traceStages = input.strategyTrace?.stages || [];
  const evidenceByExplanation = {
    sources: nodeEvidence(traceStages, ['evidence']),
    quality: nodeEvidence(traceStages, ['evidence']),
    forecasts: nodeEvidence(traceStages, ['load', 'price']),
    fusion: nodeEvidence(traceStages, ['load', 'price', 'supplyNetwork']),
    optimizer: nodeEvidence(traceStages, ['objectiveConstraints', 'recommendation']),
    risk: nodeEvidence(traceStages, ['positionLimits', 'objectiveConstraints']),
    review: nodeEvidence(traceStages, ['recommendation']),
  };

  return {
    identity: {
      environment: isDemo ? '演示环境' : '真实环境',
      targetDate,
      now: input.now || null,
      dataCutoff:
        latestPriceRun?.decisionCutoffAt ||
        forecastReport.dataCutoff ||
        forecastReport.decisionCutoffAt ||
        null,
    },
    collection: {
      current: {
        kind: isDemo ? 'current_simulation' : 'current_real',
        label: isDemo ? '今日模拟数据' : '今日真实数据',
        date: targetDate,
        coverage: currentCoverage,
        complete: currentCoverage === POINT_COUNT && dataReady,
        storagePath: ukeyStatus.visibleSnapshot?.storagePath || null,
      },
      history: {
        kind: isDemo ? 'historical_simulation' : 'historical_real',
        label: isDemo ? '历史模拟数据' : '历史真实数据',
        date: historyDate,
        coverage: historyCoverage,
        generatedAt: history.generatedAt || null,
        storagePath: history.storagePath || null,
      },
      simulation: { kind: 'simulation', label: '模拟方案' },
      collectorState,
      collectorError,
      lastPageTitle: collectorStatus.browser?.lastPageTitle || ukeyStatus.collector?.lastPageTitle || null,
      lastPageUrl: collectorStatus.browser?.lastPageUrl || ukeyStatus.collector?.lastPageUrl || null,
      lastSampleAt: ukeyStatus.collector?.lastSampleAt || null,
      strategyExecutable: !isDemo && currentCoverage === POINT_COUNT && dataReady,
      readinessStatus,
      dedicatedChrome: {
        state: collectorState,
        connected: ['ready', 'collecting', 'paused', 'rate_limited'].includes(collectorState),
      },
      ukey: {
        state: ['ready', 'collecting', 'paused', 'rate_limited'].includes(collectorState)
          ? 'logged_in'
          : ['login_required', 'login_expired'].includes(collectorState)
            ? collectorState
            : 'unknown',
      },
      backfill: {
        id: latestCollectionJob?.id || null,
        state: latestCollectionJob?.state || 'not_started',
        progressPct: backfillProgressPct,
        completedChunks,
        totalChunks,
      },
      range: {
        dateCount: Number(canonicalCoverage.dateCount || 0),
        earliestDate: canonicalCoverage.earliestDate || null,
        latestDate: canonicalCoverage.latestDate || null,
      },
      weather: collectorStatus.weather || { provider: null },
      storagePath: collectorStatus.storage?.path || ukeyStatus.visibleHistory?.storagePath || null,
      storageEngine: collectorStatus.storage?.engine || (ukeyStatus.visibleHistory?.storagePath ? 'JSON' : null),
    },
    forecastTabs: tabs,
    forecast: {
      evidenceByTab: {
        price: priceEvidence,
      },
      tabs: tabs.map((tab) => {
        const interval = tab.series.find((series) => series.role === 'interval');
        return {
          id: tab.id,
          label: tab.label,
          unit: tab.unit,
          description: tab.description,
          series: {
            actual: tab.series.find((series) => series.role === 'actual')?.points || [],
            p50: tab.series.find((series) => series.role === 'forecast')?.points || [],
            previous: tab.series.find((series) => series.role === 'previous')?.points || [],
            p10: interval?.lowerPoints || [],
            p90: interval?.upperPoints || [],
          },
        };
      }),
    },
    historyExplorer: {
      rows: canonicalFacts,
      range: {
        earliestDate: canonicalCoverage.earliestDate || null,
        latestDate: canonicalCoverage.latestDate || null,
      },
      storagePath: collectorStatus.storage?.path || null,
    },
    accuracy: { ...accuracyByTab.price, byTab: accuracyByTab },
    failures: {
      forecast: forecastReport.loadError || null,
      accuracy: accuracyReport.loadError || null,
      versions: input.forecastRuns?.loadError || null,
    },
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
        { id: 'sources', label: '数据来源', explanationId: 'sources' },
        { id: 'quality', label: '质量校验与时点快照', explanationId: 'quality' },
        { id: 'forecasts', label: '价格 / 温度 / 负荷预测', explanationId: 'forecasts' },
        { id: 'fusion', label: '特征融合', explanationId: 'fusion' },
        { id: 'optimizer', label: '申报优化器', explanationId: 'optimizer' },
        { id: 'risk', label: '风险约束', explanationId: 'risk' },
        { id: 'review', label: '人工复核', explanationId: 'review' },
      ],
      evidenceStages: traceStages,
      evidenceByExplanation,
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

  return {
    kind: 'simulation',
    persisted: false,
    submitAllowed: false,
    controls: normalized,
    series,
    estimatedCostChangeYuan: null,
    peakValleyShiftMwh: null,
    riskExposureChangePct: null,
  };
}

export { EXPLANATIONS as FOUNDATION_EXPLANATIONS };
