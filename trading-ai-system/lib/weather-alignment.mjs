export function radiationEnergyToIrradiance({ joulesPerSquareMetre, intervalSeconds }) { return Number(joulesPerSquareMetre) / Number(intervalSeconds); }
function pointIndex(time, date) { const start = Date.parse(`${date}T00:00:00+08:00`); return Math.round((Date.parse(time) - start) / 900000) + 1; }
export function alignWeatherSeriesTo96(series = [], options = {}) {
  const normalized = series.map((row) => ({ ...row, pointIndex: row.pointIndex || pointIndex(row.targetTime, options.businessDate) })), by = new Map(normalized.map((row) => [row.pointIndex, Number(row.value)])), output = [];
  for (let point = 1; point <= 96; point++) {
    let value = by.get(point) ?? null, method = by.has(point) ? 'native' : null;
    if (value === null && (options.semantic === 'instantaneous' || options.method === 'linear_interpolate')) { const left = normalized.filter((row) => row.pointIndex < point).at(-1), right = normalized.find((row) => row.pointIndex > point); if (left && right) { value = left.value + (right.value - left.value) * (point - left.pointIndex) / (right.pointIndex - left.pointIndex); method = 'linear_interpolate'; } }
    if (options.semantic === 'accumulated') { const owner = normalized.find((row) => point > row.pointIndex - (options.accumulationMinutes || 60) / 15 && point <= row.pointIndex); value = owner ? Number(owner.value) / ((options.accumulationMinutes || 60) / 15) : null; method = owner ? 'accumulation_split' : null; }
    output.push({ pointIndex: point, value, alignmentMethod: method || 'missing' });
  }
  return output;
}
export function aggregateWeatherLocations(series = [], set = {}) {
  const groups = Map.groupBy(series, (row) => row.pointIndex), configured = set.members || [], totalWeight = configured.reduce((sum, item) => sum + Number(item.weight || 0), 0) || Object.values(set.weights || {}).reduce((sum, weight) => sum + Number(weight), 0) || 1;
  return [...groups].map(([pointIndex, rows]) => { const weighted = rows.map((row) => [Number(row.value), Number(set.weights?.[row.locationId] ?? configured.find((item) => item.locationId === row.locationId)?.weight ?? 0)]).filter(([value, weight]) => Number.isFinite(value) && weight > 0), available = weighted.reduce((sum, [, weight]) => sum + weight, 0), coverage = available / totalWeight * 100, threshold = set.minimumAvailableWeightPct ?? 80; return { pointIndex, value: coverage >= threshold && available ? weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) / available : null, availableWeightPct: coverage, weightVersion: set.version || 'explicit', warnings: coverage >= threshold ? [] : ['spatial_coverage_insufficient'] }; });
}
