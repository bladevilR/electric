import { numeric, quantile } from './strategy-engine.mjs';

const FEATURE_FIELDS = [
  'realTimeAvgPrice',
  'dayAheadPublicPrice',
  'dayAheadUserPrice',
  'realTimePointPriceCurrent',
  'declarationPower',
  'defaultDeclarationPower',
  'systemLoadForecast',
  'actualSystemLoad',
  'actualKwh',
  'settleAmount',
];

function cleanString(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function numberOrNull(value) {
  return numeric(value);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeDate(value) {
  const text = cleanString(value);
  const match = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) {
    return '';
  }
  return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;
}

function pointFromTime(value) {
  const text = cleanString(value);
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour === 24 && minute === 0) {
    return 96;
  }
  if (hour < 0 || hour > 23 || ![0, 15, 30, 45].includes(minute)) {
    return null;
  }
  const point = hour * 4 + Math.ceil(minute / 15);
  return point >= 1 && point <= 96 ? point : null;
}

function timeFromPoint(pointIndex) {
  const point = Number(pointIndex);
  if (!Number.isFinite(point) || point < 1 || point > 96) {
    return '';
  }
  if (point === 96) {
    return '24:00';
  }
  const totalMinutes = point * 15;
  return `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`;
}

function dateFromRaw(raw = {}) {
  return (
    normalizeDate(raw.date) ||
    normalizeDate(raw.dataTime) ||
    normalizeDate(raw.parentDataTime) ||
    normalizeDate(raw.mktMonth) ||
    ''
  );
}

function pointFromRaw(raw = {}) {
  return (
    numberOrNull(raw.pointIndex) ||
    numberOrNull(raw.timeSlot) ||
    pointFromTime(raw.timePoint) ||
    pointFromTime(raw.timeSlot) ||
    pointFromTime(raw.dataTimes) ||
    null
  );
}

function weekdayOf(date) {
  if (!date) {
    return null;
  }
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getDay();
}

function deriveTimeFeatures(date, pointIndex) {
  const point = Number(pointIndex);
  if (!Number.isFinite(point)) {
    return { weekday: weekdayOf(date), hour: null, quarterIndex: null };
  }
  const normalizedPoint = Math.max(1, Math.min(96, point));
  const totalMinutes = normalizedPoint === 96 ? 24 * 60 : normalizedPoint * 15;
  return {
    weekday: weekdayOf(date),
    hour: normalizedPoint === 96 ? 24 : Math.floor(totalMinutes / 60),
    quarterIndex: normalizedPoint,
  };
}

export function buildPointKey(date, pointIndex) {
  return `${date}#${String(Number(pointIndex)).padStart(3, '0')}`;
}

function sourceInfo(record = {}) {
  return {
    sourceFile: record.sourceFile,
    endpoint: record.endpoint,
  };
}

function normalizedRecord(kind, record, fieldValues) {
  const raw = record.raw || {};
  const pointIndex = pointFromRaw(raw);
  return {
    kind,
    date: dateFromRaw(raw),
    pointIndex,
    timePoint: cleanString(raw.timePoint || raw.timeSlot || raw.dataTimes) || timeFromPoint(pointIndex),
    fields: Object.fromEntries(
      Object.entries(fieldValues).map(([key, value]) => [key, numberOrNull(value)])
    ),
    source: sourceInfo(record),
  };
}

function normalizeSystemForecast(record) {
  const raw = record.raw || {};
  const value = numberOrNull(raw.value ?? raw.pointValue ?? raw.realTimeMarketEnergy ?? raw.dayBeforeEnergy);
  return normalizedRecord('systemLoadForecasts', record, { systemLoadForecast: value });
}

function normalizeActualSystemLoad(record) {
  const raw = record.raw || {};
  return normalizedRecord('actualSystemLoads', record, { actualSystemLoad: raw.pointValue });
}

export function normalizeAssetRows(inventory = {}) {
  const assets = inventory.assets || {};
  const rows = [];

  (assets.realtimeAveragePrices || []).forEach((record) => {
    const raw = record.raw || {};
    rows.push(
      normalizedRecord('realtimeAveragePrices', record, {
        realTimeAvgPrice: raw.avgPrice ?? raw.realTimeAvgPrice,
        realTimePointPriceCurrent: raw.pointPriceCurrent ?? raw.realTimePointPriceCurrent,
      })
    );
  });

  (assets.dayAheadPublicClearing || []).forEach((record) => {
    const raw = record.raw || {};
    rows.push(normalizedRecord('dayAheadPublicClearing', record, { dayAheadPublicPrice: raw.unitPrice ?? raw.dayAheadPublicPrice }));
  });

  (assets.dayAheadUserClearing || []).forEach((record) => {
    const raw = record.raw || {};
    rows.push(normalizedRecord('dayAheadUserClearing', record, { dayAheadUserPrice: raw.unitPrice ?? raw.dayAheadUserPrice }));
  });

  (assets.realtimePublicClearing || []).forEach((record) => {
    const raw = record.raw || {};
    rows.push(
      normalizedRecord('realtimePublicClearing', record, {
        realTimePointPriceCurrent: raw.northPrice ?? raw.southPrice ?? raw.realTimePointPriceCurrent,
      })
    );
  });

  (assets.userBid96 || []).forEach((record) => {
    rows.push(normalizedRecord('userBid96', record, { declarationPower: record.raw?.power }));
  });

  (assets.userDefaultBid96 || []).forEach((record) => {
    rows.push(normalizedRecord('userDefaultBid96', record, { defaultDeclarationPower: record.raw?.power }));
  });

  (assets.systemLoadForecasts || []).forEach((record) => rows.push(normalizeSystemForecast(record)));
  (assets.actualSystemLoads || []).forEach((record) => rows.push(normalizeActualSystemLoad(record)));

  (assets.actualUserLoads || []).forEach((record) => {
    const raw = record.raw || {};
    rows.push(normalizedRecord('actualUserLoads', record, { actualKwh: raw.actualKwh ?? raw.pointValue }));
  });

  return rows.filter((row) => row.pointIndex !== null && row.pointIndex !== undefined);
}

function emptyFeature(date, pointIndex, timePoint = '') {
  const time = timePoint || timeFromPoint(pointIndex);
  const { weekday, hour, quarterIndex } = deriveTimeFeatures(date, pointIndex);
  return {
    date,
    pointIndex: Number(pointIndex),
    timePoint: time,
    weekday,
    hour,
    quarterIndex,
    realTimeAvgPrice: null,
    dayAheadPublicPrice: null,
    dayAheadUserPrice: null,
    realTimePointPriceCurrent: null,
    declarationPower: null,
    defaultDeclarationPower: null,
    systemLoadForecast: null,
    actualSystemLoad: null,
    actualKwh: null,
    settleAmount: null,
    priceSpread: null,
    highPriceRiskLabel: null,
    sourceFiles: [],
    sourceEndpoints: [],
    missingFields: [],
  };
}

function mergeFeature(row, normalized) {
  Object.entries(normalized.fields || {}).forEach(([field, value]) => {
    if (value !== null && value !== undefined) {
      row[field] = value;
    }
  });
  if (normalized.timePoint && !row.timePoint) {
    row.timePoint = normalized.timePoint;
  }
  if (normalized.source?.sourceFile && !row.sourceFiles.includes(normalized.source.sourceFile)) {
    row.sourceFiles.push(normalized.source.sourceFile);
  }
  if (normalized.source?.endpoint && !row.sourceEndpoints.includes(normalized.source.endpoint)) {
    row.sourceEndpoints.push(normalized.source.endpoint);
  }
}

function normalizedDatasetRows(dataset = {}) {
  return (Array.isArray(dataset.rows) ? dataset.rows : []).map((row) => ({
    kind: 'standardDataset',
    date: normalizeDate(row.date),
    pointIndex: numberOrNull(row.pointIndex),
    timePoint: cleanString(row.timePoint) || timeFromPoint(row.pointIndex),
    fields: Object.fromEntries(FEATURE_FIELDS.map((field) => [field, numberOrNull(row[field])])),
    source: {
      sourceFile: 'standard-dataset',
      endpoint: 'standard-dataset',
    },
  }));
}

function finalizeRows(rows) {
  const byDate = Map.groupBy(rows, (row) => row.date);
  rows.forEach((row) => {
    row.priceSpread =
      row.realTimeAvgPrice !== null && row.dayAheadPublicPrice !== null
        ? Number((row.realTimeAvgPrice - row.dayAheadPublicPrice).toFixed(6))
        : null;
    row.missingFields = FEATURE_FIELDS.filter((field) => row[field] === null || row[field] === undefined);
  });

  byDate.forEach((dateRows) => {
    const prices = dateRows.map((row) => row.realTimeAvgPrice).filter((value) => numberOrNull(value) !== null);
    const highThreshold = prices.length >= 2 ? quantile(prices, 0.8) : null;
    dateRows.forEach((row) => {
      row.highPriceRiskLabel =
        highThreshold === null || row.realTimeAvgPrice === null ? null : row.realTimeAvgPrice >= highThreshold ? 1 : 0;
    });
  });

  return rows.sort((left, right) => left.date.localeCompare(right.date) || left.pointIndex - right.pointIndex);
}

function buildSummary(allRows, outputRows) {
  const fieldCompleteness = Object.fromEntries(
    FEATURE_FIELDS.map((field) => [
      field,
      outputRows.filter((row) => row[field] !== null && row[field] !== undefined).length,
    ])
  );
  return {
    generatedAt: new Date().toISOString(),
    rowCount: outputRows.length,
    sourceRowCount: allRows.length,
    sourceDates: [...new Set(allRows.map((row) => row.date).filter(Boolean))].sort(),
    dates: [...new Set(outputRows.map((row) => row.date).filter(Boolean))].sort(),
    fieldCompleteness,
  };
}

export function buildForecastFeatureStore(dataset = {}, options = {}) {
  const normalized = [
    ...normalizedDatasetRows(dataset),
    ...normalizeAssetRows(options.assets || {}),
  ].filter((row) => row.pointIndex !== null && row.pointIndex !== undefined);

  const datedRows = normalized.filter((row) => row.date);
  const undatedRows = normalized.filter((row) => !row.date);
  const dates = [...new Set(datedRows.map((row) => row.date))];
  const byKey = new Map();

  datedRows.forEach((item) => {
    const key = buildPointKey(item.date, item.pointIndex);
    if (!byKey.has(key)) {
      byKey.set(key, emptyFeature(item.date, item.pointIndex, item.timePoint));
    }
    mergeFeature(byKey.get(key), item);
  });

  undatedRows.forEach((item) => {
    dates.forEach((date) => {
      const key = buildPointKey(date, item.pointIndex);
      if (!byKey.has(key)) {
        byKey.set(key, emptyFeature(date, item.pointIndex, item.timePoint));
      }
      mergeFeature(byKey.get(key), item);
    });
  });

  const allRows = finalizeRows([...byKey.values()]);
  const outputRows = options.date ? allRows.filter((row) => row.date === options.date) : allRows;

  return {
    generatedAt: new Date().toISOString(),
    date: options.date || '',
    summary: buildSummary(allRows, outputRows),
    rows: outputRows,
  };
}
