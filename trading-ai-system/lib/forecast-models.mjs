import { numeric, quantile } from './strategy-engine.mjs';

const TARGET_FIELDS = ['realTimeAvgPrice', 'priceSpread', 'highPriceRiskLabel'];
const MIN_HISTORY_DATES = 5;

function cleanDate(value) {
  return value ? String(value) : '';
}

function sortedRows(rows = []) {
  return [...rows].sort((left, right) => {
    const dateCompare = cleanDate(left.date).localeCompare(cleanDate(right.date));
    return dateCompare || Number(left.pointIndex || 0) - Number(right.pointIndex || 0);
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function historicalRows(rows, targetDate, targetField) {
  return sortedRows(rows).filter(
    (row) =>
      cleanDate(row.date) < targetDate &&
      numeric(row.pointIndex) !== null &&
      numeric(row[targetField]) !== null
  );
}

function targetPointIndices(rows, targetDate) {
  const targetPoints = rows
    .filter((row) => cleanDate(row.date) === targetDate && numeric(row.pointIndex) !== null)
    .map((row) => Number(row.pointIndex));
  if (targetPoints.length) {
    return [...new Set(targetPoints)].sort((a, b) => a - b);
  }
  return [...new Set(rows.map((row) => Number(row.pointIndex)).filter((value) => Number.isFinite(value)))].sort(
    (a, b) => a - b
  );
}

function median(values) {
  const clean = values.map(numeric).filter((value) => value !== null).sort((a, b) => a - b);
  if (!clean.length) {
    return null;
  }
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function forecastRecord({ modelId, target, targetDate, pointIndex, values, evidenceRows }) {
  if (!values.length) {
    return null;
  }
  return {
    modelId,
    target,
    targetDate,
    pointIndex,
    pointForecast: median(values),
    p10: quantile(values, 0.1),
    p50: median(values),
    p90: quantile(values, 0.9),
    evidenceRows,
  };
}

export function forecastNaiveSameSlot(rows = [], targetDate = '', targetField = 'realTimeAvgPrice') {
  const points = targetPointIndices(rows, targetDate);
  const history = historicalRows(rows, targetDate, targetField);
  return points
    .map((pointIndex) => {
      const pointRows = history.filter((row) => Number(row.pointIndex) === Number(pointIndex));
      const latest = pointRows.at(-1);
      if (!latest) {
        return null;
      }
      return forecastRecord({
        modelId: 'naive_same_slot',
        target: targetField,
        targetDate,
        pointIndex,
        values: [latest[targetField]],
        evidenceRows: 1,
      });
    })
    .filter(Boolean);
}

export function forecastRollingSameSlot(rows = [], targetDate = '', targetField = 'realTimeAvgPrice', windowSize = 7) {
  const points = targetPointIndices(rows, targetDate);
  const history = historicalRows(rows, targetDate, targetField);
  return points
    .map((pointIndex) => {
      const pointRows = history.filter((row) => Number(row.pointIndex) === Number(pointIndex)).slice(-windowSize);
      const values = pointRows.map((row) => row[targetField]).filter((value) => numeric(value) !== null);
      return forecastRecord({
        modelId: 'rolling_same_slot_median',
        target: targetField,
        targetDate,
        pointIndex,
        values,
        evidenceRows: values.length,
      });
    })
    .filter(Boolean);
}

function shiftDate(date, days) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
export function forecastPreviousDaySameSlot(rows=[],targetDate='',targetField='realTimeAvgPrice'){const wanted=shiftDate(targetDate,-1);return targetPointIndices(rows,targetDate).map(pointIndex=>{const row=rows.find(item=>item.date===wanted&&Number(item.pointIndex)===pointIndex&&numeric(item[targetField])!==null);return row?forecastRecord({modelId:'naive_previous_day_same_slot',target:targetField,targetDate,pointIndex,values:[row[targetField]],evidenceRows:1}):null;}).filter(Boolean);}
export function forecastPreviousWeekSameSlot(rows=[],targetDate='',targetField='realTimeAvgPrice'){const wanted=shiftDate(targetDate,-7);return targetPointIndices(rows,targetDate).map(pointIndex=>{const row=rows.find(item=>item.date===wanted&&Number(item.pointIndex)===pointIndex&&numeric(item[targetField])!==null);return row?forecastRecord({modelId:'naive_previous_week_same_slot',target:targetField,targetDate,pointIndex,values:[row[targetField]],evidenceRows:1}):null;}).filter(Boolean);}
export function forecastWeekdayClassMedian(rows=[],targetDate='',targetField='realTimeAvgPrice'){const weekday=new Date(`${targetDate}T00:00:00Z`).getUTCDay(),history=historicalRows(rows,targetDate,targetField).filter(row=>new Date(`${row.date}T00:00:00Z`).getUTCDay()===weekday);return targetPointIndices(rows,targetDate).map(pointIndex=>{const values=history.filter(row=>Number(row.pointIndex)===pointIndex).map(row=>row[targetField]);return forecastRecord({modelId:'seasonal_same_slot_median_weekday_class',target:targetField,targetDate,pointIndex,values,evidenceRows:values.length});}).filter(Boolean);}

export function summarizeForecastReadiness(featureStore = {}, targetDate = '') {
  const rows = Array.isArray(featureStore.rows) ? featureStore.rows : [];
  const date = targetDate || uniqueSorted(rows.map((row) => row.date)).at(-1) || '';
  const historicalDates = uniqueSorted(
    rows
      .filter(
        (row) =>
          cleanDate(row.date) &&
          cleanDate(row.date) < date &&
          numeric(row.realTimeAvgPrice) !== null
      )
      .map((row) => cleanDate(row.date))
  );
  const targetRows = rows.filter((row) => cleanDate(row.date) === date);
  const comparablePointCount = targetPointIndices(rows, date).filter((pointIndex) =>
    historicalRows(rows, date, 'realTimeAvgPrice').some((row) => Number(row.pointIndex) === Number(pointIndex))
  ).length;
  const missingReasons = [];

  if (!date) {
    missingReasons.push('target_date_missing');
  }
  if (!targetRows.length) {
    missingReasons.push('target_date_rows_missing');
  }
  if (historicalDates.length < MIN_HISTORY_DATES) {
    missingReasons.push('historical_dates_below_5');
  }
  if (comparablePointCount === 0) {
    missingReasons.push('comparable_points_missing');
  }

  let status = 'baseline_ready';
  if (!date || !targetRows.length) {
    status = 'heuristic_fallback';
  } else if (historicalDates.length < MIN_HISTORY_DATES || comparablePointCount === 0) {
    status = 'insufficient_history';
  }

  return {
    status,
    targetDate: date,
    historicalDateCount: historicalDates.length,
    comparablePointCount,
    missingReasons,
  };
}

export function buildForecastModelReport(featureStore = {}, options = {}) {
  const rows = Array.isArray(featureStore.rows) ? featureStore.rows : [];
  const targetDate = options.targetDate || featureStore.date || uniqueSorted(rows.map((row) => row.date)).at(-1) || '';
  const readiness = summarizeForecastReadiness(featureStore, targetDate);
  const models = [
    {
      id: 'naive_same_slot',
      label: 'Previous same-slot baseline',
      enabled: readiness.status === 'baseline_ready',
    },
    {
      id: 'rolling_same_slot_median',
      label: 'Rolling same-slot median baseline',
      enabled: readiness.status === 'baseline_ready',
    },
    ...[
      ['naive_previous_day_same_slot','Previous-day same-slot baseline'],
      ['naive_previous_week_same_slot','Previous-week same-slot baseline'],
      ['seasonal_same_slot_median_weekday_class','Weekday-class same-slot median'],
      ['rolling_same_slot_median_7','Rolling 7-day same-slot median'],
      ['rolling_same_slot_median_28','Rolling 28-day same-slot median'],
    ].map(([id,label])=>({id,label,enabled:readiness.status==='baseline_ready'})),
  ];

  const forecasts =
    readiness.status === 'baseline_ready'
      ? TARGET_FIELDS.flatMap((target) => forecastRollingSameSlot(rows, targetDate, target, 28).map(row=>({...row,modelId:'rolling_same_slot_median_28'})))
      : [];

  return {
    generatedAt: new Date().toISOString(),
    status: readiness.status,
    targetDate,
    models,
    strongestBaselineId: readiness.status === 'baseline_ready' ? 'rolling_same_slot_median_28' : null,
    forecasts,
    readiness,
  };
}
