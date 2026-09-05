import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expectedTime = (point) => point === 96 ? '24:00' : `${String(Math.floor(point / 4)).padStart(2, '0')}:${String((point % 4) * 15).padStart(2, '0')}`;

// Only confirmed, complete 15-minute source curves enter the canonical store.
// Availability is the import time, never fabricated from the historical business date.
export function buildLocalLoadHistory(reference, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('load_history_timestamp_invalid');
  const sources = (options.sources || []).map((source) => {
    if (!source.fileName || !/^[a-f0-9]{64}$/i.test(source.sha256 || '')) throw new Error('load_source_hash_required');
    if (!['spot_reconciliation', 'transaction_calculation'].includes(source.kind)) throw new Error('load_source_kind_unconfirmed');
    return { ...source, sourceId: `LOCAL-LOAD:${source.fileName}` };
  });
  const byName = new Map(sources.map((source) => [source.fileName, source]));
  const grouped = new Map();
  for (const row of reference.featureRows || []) {
    if (row.actualKwh === null || row.actualKwh === undefined || row.actualKwh === '') continue;
    const source = byName.get(row.sourceFile);
    if (!source) throw new Error(`load_source_missing:${row.sourceFile}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date) throw new Error('load_date_invalid');
    const pointIndex = Number(row.pointIndex), actualKwh = Number(row.actualKwh);
    if (!Number.isFinite(actualKwh) || actualKwh < 0) throw new Error('load_value_negative_or_invalid');
    if (!Number.isInteger(pointIndex) || pointIndex < 1 || pointIndex > 96) throw new Error('load_point_invalid');
    const timePoint = String(row.timePoint || '').trim();
    if (timePoint !== expectedTime(pointIndex) && !(pointIndex === 96 && timePoint === '00:00')) throw new Error('load_interval_unconfirmed');
    const key = `${source.sourceId}|${row.date}|${row.sourceSheet || ''}`;
    const curve = grouped.get(key) || { businessDate: row.date, sourceId: source.sourceId, sourceSheet: row.sourceSheet || '', rows: [] };
    if (curve.rows.some((point) => point.pointIndex === pointIndex)) throw new Error('load_duplicate_point');
    curve.rows.push({ pointIndex, timePoint: expectedTime(pointIndex), actualKwh });
    grouped.set(key, curve);
  }
  const selected = new Map(), excluded = [];
  const rank = (curve) => sources.find((source) => source.sourceId === curve.sourceId)?.kind === 'spot_reconciliation' ? 2 : 1;
  for (const curve of grouped.values()) {
    curve.rows.sort((a, b) => a.pointIndex - b.pointIndex);
    if (curve.rows.length !== 96) throw new Error(`load_curve_incomplete:${curve.businessDate}`);
    const prior = selected.get(curve.businessDate);
    if (!prior) selected.set(curve.businessDate, curve);
    else if (rank(prior) === rank(curve) && digest(prior.rows) !== digest(curve.rows)) throw new Error(`load_source_conflict:${curve.businessDate}`);
    else {
      const keep = rank(curve) > rank(prior) ? curve : prior;
      excluded.push({ businessDate: curve.businessDate, sourceId: keep === curve ? prior.sourceId : curve.sourceId, reason: 'complete_settlement_curve_preferred_without_double_counting' });
      selected.set(curve.businessDate, keep);
    }
  }
  return { version: 1, kind: 'local_historical_load', generatedAt, intervalMinutes: 15, timezone: 'Asia/Shanghai', sources, curves: [...selected.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)), excluded };
}

export async function importLocalLoadHistory({ store, filePath }) {
  let document;
  try { document = JSON.parse(await readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { state: 'not_configured', importedFacts: 0 }; throw error; }
  if (document.version !== 1 || document.kind !== 'local_historical_load' || document.intervalMinutes !== 15 || document.timezone !== 'Asia/Shanghai') throw new Error('load_history_contract_invalid');
  const names = new Map(document.sources.map((source) => [source.sourceId, source.fileName]));
  const verified = buildLocalLoadHistory({ featureRows: document.curves.flatMap((curve) => curve.rows.map((point) => ({ ...point, date: curve.businessDate, sourceFile: names.get(curve.sourceId), sourceSheet: curve.sourceSheet }))) }, document);
  const sha256 = digest({ sources: verified.sources, curves: verified.curves, intervalMinutes: 15 });
  const marker = { sourcePath: 'local-load-history-v1', sourceSha256: sha256 };
  const summary = { state: 'completed', dateCount: verified.curves.length, earliestDate: verified.curves[0]?.businessDate || null, latestDate: verified.curves.at(-1)?.businessDate || null, filePath, importedFacts: 0 };
  if (store.hasImportMarker(marker)) return { ...summary, skipped: true };
  store.transaction(() => {
    for (const curve of verified.curves) {
      const source = verified.sources.find((item) => item.sourceId === curve.sourceId);
      const sourceRevision = `local:${source.sha256}:${digest(curve.rows)}`;
      const facts = curve.rows.flatMap((point) => [
        { fieldId: 'actualKwh', value: point.actualKwh, unit: 'kWh' },
        { fieldId: 'actualAverageLoadMw', value: Number((point.actualKwh / 250).toFixed(9)), unit: 'MW' },
      ].map((field) => ({ ...field, sourceId: source.sourceId, businessDate: curve.businessDate, pointIndex: point.pointIndex, availableAt: verified.generatedAt, capturedAt: verified.generatedAt, sourceRevision })));
      summary.importedFacts += store.appendFacts(facts).inserted;
      store.appendCapture({
        id: `local-load:${sha256}:${curve.businessDate}`, sourceId: source.sourceId, businessDate: curve.businessDate,
        pageUrl: `local-source:${source.fileName}`, capturedAt: verified.generatedAt, rowCount: 96, accepted: true, contentSha256: source.sha256,
        evidence: { sourceFile: source.fileName, sourceSheet: curve.sourceSheet, originalSha256: source.sha256, intervalMinutes: 15, conversion: 'MW = kWh / 1000 / 0.25', origin: 'local_historical_export', availabilityBasis: 'first_import_time_not_historical_publication' },
      });
    }
    store.recordImportMarker({ ...marker, id: `local-load-import:${sha256}`, summary });
  });
  return summary;
}
