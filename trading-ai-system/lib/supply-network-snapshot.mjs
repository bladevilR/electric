const READY = new Set(['confirmed_visible','confirmed_export','captured_nonempty']);
export function normalizeSupplyNetworkSnapshot(payload = {}, catalog = {}) {
  const facts = [], blockedFields = [], unmappedHeaders = [], capturedAt = payload.capturedAt || new Date().toISOString();
  for (const record of payload.records || payload.rows || []) {
    if (!record.rawHeader && !record.fieldId) { for (const [fieldId, value] of Object.entries(record)) { if (['pointIndex','eventTime'].includes(fieldId)) continue; const nested = normalizeSupplyNetworkSnapshot({ ...payload, rows: undefined, records: [{ ...record, fieldId, value }] }, catalog); facts.push(...nested.facts); blockedFields.push(...nested.blockedFields); unmappedHeaders.push(...nested.unmappedHeaders); } continue; }
    const definition = (catalog.fields || []).find((field) => field.fieldId === record.fieldId || field.sourceKeys?.includes(record.rawHeader) || field.rawHeaders?.includes(record.rawHeader));
    if (!definition) { unmappedHeaders.push(record.rawHeader || record.fieldId); continue; }
    if (!READY.has(definition.confirmationStatus) || (definition.sourceIds?.length && !definition.sourceIds.includes(payload.sourceId))) { blockedFields.push(definition.fieldId); continue; }
    const raw = record.rawValue ?? record.value, value = raw === '' || raw === undefined ? null : raw;
    facts.push({ sourceId: payload.sourceId, fieldId: definition.fieldId, businessDate: payload.businessDate || record.eventTime?.slice(0, 10), ...(record.pointIndex ? { pointIndex: record.pointIndex } : { entityKey: `${record.entityType || 'region'}:${record.entityId || record.regionId || 'unknown'}` }), value, rawValue: raw, rawUnit: record.rawUnit, qualityFlags: value === null ? ['source_blank'] : [], eventTime: record.eventTime, effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo, availableAt: record.availableAt || payload.availableAt || record.publishedAt, capturedAt, sourceRevision: record.sourceRevision || payload.sourceRevision, entityType: record.entityType });
  }
  return { facts, warnings: unmappedHeaders.map((header) => `unmapped_header:${header}`), blockedFields: [...new Set(blockedFields)], unmappedHeaders: [...new Set(unmappedHeaders)] };
}
