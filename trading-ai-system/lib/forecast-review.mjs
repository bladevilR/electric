const DAY = 86400000;
const PRICE = 'dayAheadUserPriceFinalYuanPerMwh';
const REALTIME = 'realTimeSettlementPriceYuanPerMwh';
const CONFIG = {
  price: { actual: [PRICE], fields: [PRICE, REALTIME], unit: '元/MWh' },
  temperature: { actual: ['temperatureActualC'], fields: ['temperatureActualC', 'temperatureForecastC'], unit: '°C' },
  load: { actual: ['actualAverageLoadMw', 'actualLoadMw'], fields: ['actualAverageLoadMw', 'actualLoadMw'], unit: 'MW' },
};
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const shift = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
const gap = (a, b) => (Date.parse(a) - Date.parse(b)) / DAY;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const finiteValue = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));

function normalizeOptions({ month, targetDate, type = 'price', now = new Date().toISOString() } = {}) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`)) throw new Error('month_invalid');
  targetDate ??= `${month}-01`;
  if (!validDate(targetDate) || !targetDate.startsWith(`${month}-`)) throw new Error('target_date_invalid');
  if (!Object.hasOwn(CONFIG, type)) throw new Error('review_type_invalid');
  if (!Number.isFinite(Date.parse(now))) throw new Error('now_invalid');
  const start = `${month}-01`;
  const end = shift(start, 32).slice(0, 7) + '-01';
  return { month, targetDate, type, now, start, end: shift(end, -1) };
}

function indexFacts(facts, config, now) {
  const latest = new Map();
  for (const fact of facts) {
    if (!fact || !config.fields.includes(fact.fieldId) || !validDate(fact.businessDate)
      || !Number.isInteger(fact.pointIndex) || fact.pointIndex < 1 || fact.pointIndex > 96
      || !finiteValue(fact.value) || !(fact.unit === config.unit || (config.unit === '°C' && fact.unit === 'C'))
      || (config.unit === 'MW' && Number(fact.value) < 0)
      || !Number.isFinite(Date.parse(fact.availableAt)) || Date.parse(fact.availableAt) > Date.parse(now)) continue;
    const key = `${fact.fieldId}|${fact.businessDate}|${fact.pointIndex}`;
    const old = latest.get(key);
    if (!old || Date.parse(fact.availableAt) >= Date.parse(old.availableAt)) latest.set(key, fact);
  }
  const fields = new Map();
  for (const fact of latest.values()) {
    if (!fields.has(fact.fieldId)) fields.set(fact.fieldId, new Map());
    const dates = fields.get(fact.fieldId);
    if (!dates.has(fact.businessDate)) dates.set(fact.businessDate, new Map());
    dates.get(fact.businessDate).set(fact.pointIndex, fact);
  }
  return fields;
}

function mergeActuals(fields, names) {
  const dates = new Map();
  for (const name of names) for (const [date, points] of fields.get(name) || []) {
    if (!dates.has(date)) dates.set(date, new Map());
    for (const [point, fact] of points) {
      const old = dates.get(date).get(point);
      if (!old || Date.parse(fact.availableAt) > Date.parse(old.availableAt)) dates.get(date).set(point, fact);
    }
  }
  return dates;
}

function metrics(rows) {
  const paired = rows.filter(row => row.difference !== null);
  const nonzero = paired.filter(row => row.actual !== 0);
  return {
    pairedCount: paired.length,
    mae: mean(paired.map(row => row.absoluteError)),
    rmse: paired.length ? Math.sqrt(mean(paired.map(row => row.difference ** 2))) : null,
    mape: nonzero.length ? 100 * mean(nonzero.map(row => row.absoluteError / Math.abs(row.actual))) : null,
    bias: mean(paired.map(row => row.difference)),
    maxAbsoluteError: paired.length ? Math.max(...paired.map(row => row.absoluteError)) : null,
  };
}

function eligibleRun(runs, date, now) {
  const start = Date.parse(`${date}T00:00:00+08:00`);
  return runs.filter(run => run?.forecastRunType === 'live_issued' && run.targetField === PRICE
    && run.targetTradingDate === date && Boolean(run.featureSnapshotId)
    && Date.parse(run.forecastGeneratedAt) < start && Date.parse(run.forecastGeneratedAt) <= Date.parse(now)
    && Date.parse(run.decisionCutoffAt) <= Date.parse(run.forecastGeneratedAt)
    && (run.availableAt == null || Date.parse(run.availableAt) <= Date.parse(now))
    && Array.isArray(run.rows) && run.rows.length === 96
    && run.rows.every(row => Number.isInteger(row.pointIndex) && row.pointIndex >= 1 && row.pointIndex <= 96 && Number.isFinite(row.p50))
    && new Set(run.rows.map(row => row.pointIndex)).size === 96)
    .sort((a, b) => Date.parse(b.forecastGeneratedAt) - Date.parse(a.forecastGeneratedAt))[0];
}

function historyPrediction(dates, date, { load = false } = {}) {
  const preceding = [...dates.keys()].filter(day => day < date).sort();
  const complete = preceding.filter(day => dates.get(day).size === 96 && (!load || gap(date, day) <= 42)).slice(-28);
  const sampleDates = load || complete.length ? complete : preceding.slice(-28);
  const ready = !load || (complete.length >= 5 && gap(date, complete.at(-1)) <= 7);
  const last = preceding.at(-1);
  const fallback = last ? mean([...dates.get(last).values()].map(fact => Number(fact.value))) : null;
  const values = Array.from({ length: 96 }, (_, i) => {
    if (!ready) return null;
    const sameSlot = sampleDates.map(day => dates.get(day).get(i + 1)?.value).filter(finiteValue).map(Number);
    return median(sameSlot) ?? fallback;
  });
  // Freshness follows the selected training dates, not an ignored partial curve.
  return { values, sampleDates, last: sampleDates.at(-1), completeCount: complete.length, ready };
}

export function buildForecastReview({ facts = [], runs = [], ...options } = {}) {
  const { month, targetDate, type, now, start, end } = normalizeOptions(options);
  const config = CONFIG[type];
  const fields = indexFacts(facts, config, now), actuals = mergeActuals(fields, config.actual);
  const today = new Date(Date.parse(now) + 8 * 3600000).toISOString().slice(0, 10);
  const days = [];
  for (let date = start; date <= end; date = shift(date, 1)) {
    const caveats = [];
    let values = Array(96).fill(null), sampleDays = 0;
    let forecastKind = date <= today ? 'historical_backtest' : 'current_estimate';
    let methodLabel;
    if (type === 'temperature') {
      forecastKind = date <= today ? 'weather_archive' : 'weather_forecast';
      methodLabel = '归档天气预报与历史气温再分析对照';
      values = values.map((_, i) => fields.get('temperatureForecastC')?.get(date)?.get(i + 1)?.value ?? null).map(v => v === null ? null : Number(v));
      caveats.push('历史实际气温来自再分析，小时数据插值至15分钟；并非现场逐点观测。');
      if (values.every(v => v === null)) caveats.push('该日无归档天气预报，不事后补造预测。');
    } else if (type === 'price') {
      const run = eligibleRun(runs, date, now);
      if (run) {
        forecastKind = 'live_issued'; methodLabel = '交易日前正式发布的不可变价格预测';
        for (const row of run.rows) values[row.pointIndex - 1] = row.p50;
        caveats.push('采用该交易日前发布的归档预测，未用本日实际价格重新拟合。');
      } else {
        const priceDates = fields.get(PRICE) || new Map();
        const useRealtime = ![...priceDates.keys()].some(day => day < date);
        const history = historyPrediction(useRealtime ? fields.get(REALTIME) || new Map() : priceDates, date);
        values = history.values; sampleDays = history.sampleDates.length;
        methodLabel = useRealtime && sampleDays ? '历史实时价格参考（非日前实际价）' : '前28个完整价格日同点滚动中位数';
        caveats.push('仅使用目标日前的价格历史，未使用天气或负荷；缺少辅助数据不阻断价格参考。');
        caveats.push(date <= today ? '真实历史数据的事后回测，不是当时发布的预测。' : '当前估算尚未正式发布。');
        if (!sampleDays) caveats.push('目标日前无可用价格证据，无法生成预测；仍展示已有实际价格。');
        else {
          if (history.completeCount < 5) caveats.push('完整价格历史不足5天：使用已有同点价格，缺点以最近历史日实际价格均值补足。');
          if (gap(date, history.last) > 7) caveats.push('最近价格历史距目标日超过7天，参考陈旧，需谨慎使用。');
          if (useRealtime) caveats.push('无此前日前价格，改用实时结算价格参考；实际曲线仍只显示日前用户最终价格。');
        }
      }
    } else {
      const history = historyPrediction(actuals, date, { load: true });
      values = history.values; sampleDays = history.sampleDates.length;
      methodLabel = '用户实际负荷同点滚动中位数';
      caveats.push('仅使用目标日前42天内最近28个完整用户负荷日，不使用全省系统负荷，也未拟合天气影响。');
      caveats.push(date <= today ? '真实历史数据的事后回测，不是当时发布的预测。' : '当前估算尚未正式发布。');
      if (!history.ready) caveats.push('近42天不足5个完整日或最近完整日距目标日超过7天，暂不生成预测，仍展示实际负荷。');
    }
    const rows = values.map((predicted, i) => {
      const actual = actuals.get(date)?.get(i + 1)?.value;
      const actualValue = actual === undefined ? null : Number(actual);
      const difference = predicted === null || actualValue === null ? null : predicted - actualValue;
      return { pointIndex: i + 1, predicted, actual: actualValue, difference, absoluteError: difference === null ? null : Math.abs(difference) };
    });
    const dayMetrics = metrics(rows);
    const forecastValues = values.filter(v => v !== null), actualValues = rows.map(row => row.actual).filter(v => v !== null);
    const forecastMean = mean(forecastValues), actualMean = mean(actualValues);
    const display = value => value === null ? '暂无' : `${value.toFixed(2)} ${config.unit}`;
    const analysis = [`当日预测均值${display(forecastMean)}，实际均值${display(actualMean)}。`];
    if (dayMetrics.pairedCount) {
      const peak = rows.find(row => row.absoluteError === dayMetrics.maxAbsoluteError);
      const minutes = peak.pointIndex * 15;
      const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      const direction = peak.difference > 0 ? '偏高' : peak.difference < 0 ? '偏低' : '相差';
      analysis.push(`已匹配${dayMetrics.pairedCount}个时点，平均绝对误差${display(dayMetrics.mae)}；最大误差时刻${time}，预测${display(peak.predicted)}、实际${display(peak.actual)}，${direction}${display(peak.absoluteError)}。`);
    } else analysis.push('尚无预测与实际同时存在的时点，不能评估误差。');
    analysis.push(type === 'price' && forecastKind !== 'live_issued'
      ? `${sampleDays ? `价格参考使用${sampleDays}个历史日，` : '价格参考依赖此前价格历史，'}未使用天气和负荷；偏低或偏高仅反映历史基线未跟上或高估本日变化，不代表已查明原因。`
      : '以上为观测到的差异，不据此推断天气等因素的因果影响。');
    days.push({ date, rows, forecastMean, actualMean, forecastCount: forecastValues.length, actualCount: actualValues.length,
      ...dayMetrics, forecastKind, methodLabel, caveats, analysis, sampleDays });
  }
  const { maxAbsoluteError: _max, ...pooled } = metrics(days.flatMap(day => day.rows));
  const summary = { pairedDays: days.filter(d => d.pairedCount).length, forecastDays: days.filter(d => d.forecastCount).length,
    actualDays: days.filter(d => d.actualCount).length, ...pooled };
  const availableMonths = [...new Set([month, ...[...actuals.keys()].map(date => date.slice(0, 7))])].sort();
  return { month, targetDate, type, unit: config.unit, generatedAt: now, days, selected: days.find(day => day.date === targetDate), summary, availableMonths };
}

export function readForecastReview(store, options = {}) {
  const normalized = normalizeOptions(options), config = CONFIG[normalized.type];
  return store.transaction(() => {
    const facts = [];
    for (const fieldId of config.fields) {
      const from = normalized.type === 'price' ? undefined : normalized.type === 'load' ? shift(normalized.start, -42) : normalized.start;
      for (let offset = 0; ; offset += 10000) {
        const page = store.queryFacts({ fieldId, ...(from ? { from } : {}), to: normalized.end, asOf: normalized.now, limit: 10000, offset });
        facts.push(...page);
        if (page.length < 10000) break;
      }
    }
    const runs = normalized.type === 'price' ? store.queryForecastRuns({ forecastRunType: 'live_issued', targetField: PRICE, from: normalized.start, to: normalized.end })
      .filter(run => run.targetTradingDate >= normalized.start && run.targetTradingDate <= normalized.end) : [];
    const report = buildForecastReview({ ...normalized, facts, runs });
    const coverageDates = config.actual.flatMap(fieldId => Object.keys(store.getCoverage({ fieldId }).pointsByDate || {})).filter(validDate);
    report.availableMonths = [...new Set([normalized.month, ...coverageDates.map(date => date.slice(0, 7))])].sort();
    return report;
  });
}
