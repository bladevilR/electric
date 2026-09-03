const FORBIDDEN = /^(actual|settlement)|Backfilled|LabelVersion/i;
const TASK_FEATURES = { user_load: ['pointIndex','dayOfWeek','historicalUserLoadMw','temperatureC','relativeHumidityPct','windSpeed10Mps','operationsPlanMw'], day_ahead_price: ['pointIndex','dayOfWeek','priceLag1','priceLag96','systemLoadForecastMw','windForecastMw','solarForecastMw','availableCapacityMw','sectionUtilizationPct','temperatureC'], real_time_spread: ['pointIndex','dayAheadPublicPriceYuanPerMwh','loadForecastErrorMw','renewableForecastErrorMw','unplannedOutageCapacityMw','sectionUtilizationPct'] };
export function buildModelDataset({ snapshots = [], outcomes = [], targetField, task = 'day_ahead_price', splitConfig = {} } = {}) {
  const allow = new Set(TASK_FEATURES[task] || []), rows = [];
  for (const snapshot of snapshots) for (const sourceRow of snapshot.rows || []) {
    const outcome = outcomes.find((item) => item.businessDate === snapshot.targetDate && item.pointIndex === sourceRow.pointIndex && (!item.targetField || item.targetField === targetField)); if (!outcome) continue;
    const fields = sourceRow.fields || sourceRow, features = Object.fromEntries(Object.entries(fields).filter(([key]) => allow.has(key) && !FORBIDDEN.test(key) && key !== targetField));
    if (sourceRow.pointIndex && !Object.hasOwn(features, 'pointIndex')) features.pointIndex = sourceRow.pointIndex;
    const date = snapshot.targetDate, named = Object.entries(splitConfig).find(([, dates]) => Array.isArray(dates) && dates.includes(date))?.[0] || 'shadow', split = named.replace(/Dates$/, '');
    rows.push({ date, pointIndex: sourceRow.pointIndex, decisionCutoffAt: snapshot.decisionCutoffAt, features, featureSnapshotId: snapshot.featureSnapshotId, featureVersion: snapshot.catalogVersion || snapshot.featureVersion || 1, target: outcome.actualValue ?? outcome.value, actualLabelVersion: outcome.actualLabelVersion || outcome.outcomeVersion || 'unknown', split: ['train','validation','holdout','shadow'].includes(split) ? split : 'shadow', sourceCoverage: snapshot.sourceCoverage || {} });
  }
  return { version: 1, task, targetField, featureList: [...new Set(rows.flatMap((row) => Object.keys(row.features)))].sort(), excludedFieldsPattern: FORBIDDEN.source, rows };
}
