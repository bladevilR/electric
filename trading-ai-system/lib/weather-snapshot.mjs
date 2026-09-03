const CREDENTIAL_KEY = /cookie|token|authorization|password|secret|private.?key|pin/i;
const FIELD_MAP = {
  temperatureC: ['temperatureC'], dewPointC: ['dewPointC'],
  temperatureK: ['temperatureC', (value) => Math.round((value - 273.15) * 100) / 100, 'K', 'kelvin-to-celsius-v1'],
  dewPointK: ['dewPointC', (value) => Math.round((value - 273.15) * 100) / 100, 'K', 'kelvin-to-celsius-v1'],
  relativeHumidityPct: ['relativeHumidityPct'], windU10Mps: ['windU10Mps'], windV10Mps: ['windV10Mps'],
  precipitationM: ['precipitationAmountMm', (value) => value * 1000, 'm', 'metres-to-millimetres-v1'],
  totalCloudCoverFraction: ['totalCloudCoverPct', (value) => value * 100, 'fraction', 'fraction-to-percent-v1'], surfaceSolarRadiationJm2: ['surfaceSolarRadiationJm2'],
};
function scan(value) { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { if (CREDENTIAL_KEY.test(key)) throw new Error(`credential_property_forbidden:${key}`); scan(child); } }
export function validateWeatherSnapshot(payload = {}) {
  const errors = [], kind = payload.dataClass || 'forecast';
  if (!['forecast', 'observation', 'reanalysis'].includes(kind)) errors.push('data_class_invalid');
  if (kind === 'forecast' && !payload.forecastIssuedAt) errors.push('forecast_issued_at_required');
  if (kind !== 'forecast' && payload.forecastIssuedAt) errors.push('reanalysis_forecast_label_forbidden');
  if (kind !== 'forecast' && !payload.publishedAt) errors.push('published_at_required');
  if (!payload.targetTime && !Array.isArray(payload.rows)) errors.push('target_time_or_rows_required');
  return { ok: errors.length === 0, errors };
}
export function normalizeWeatherSnapshot(payload = {}, sourceDefinition = {}) {
  scan(payload); const checked = validateWeatherSnapshot(payload); if (!checked.ok) throw new Error(checked.errors[0]);
  const rows = payload.rows || [{ pointIndex: payload.pointIndex, targetTime: payload.targetTime, locationId: payload.locationId, values: payload.values }];
  const facts = [], unmapped = new Set(), capturedAt = payload.capturedAt || new Date().toISOString();
  for (const row of rows) for (const [rawKey, rawValue] of Object.entries(row.values || row)) {
    if (['pointIndex', 'targetTime', 'locationId'].includes(rawKey)) continue;
    const mapping = FIELD_MAP[rawKey]; if (!mapping) { unmapped.add(rawKey); continue; }
    const [fieldId, convert = (v) => v, rawUnit, conversionVersion] = mapping, targetTime = row.targetTime || payload.targetTime;
    facts.push({ sourceId: payload.sourceId || sourceDefinition.sourceId, fieldId, businessDate: payload.targetDate || targetTime?.slice(0, 10), ...(row.pointIndex ? { pointIndex: row.pointIndex } : { entityKey: `${row.locationId || payload.locationId}:${targetTime}` }), value: rawValue === null ? null : convert(Number(rawValue)), rawValue, ...(rawUnit ? { rawUnit } : {}), ...(conversionVersion ? { conversionVersion } : {}), eventTime: targetTime, forecastIssuedAt: payload.forecastIssuedAt, availableAt: payload.availableAt || payload.forecastIssuedAt || payload.publishedAt, capturedAt, sourceRevision: payload.sourceRevision || payload.forecastIssuedAt || payload.publishedAt, locationId: row.locationId || payload.locationId, dataClass: payload.dataClass || 'forecast' });
  }
  return { facts, warnings: [...unmapped].map((key) => `unmapped_key:${key}`), unmappedKeys: [...unmapped] };
}
