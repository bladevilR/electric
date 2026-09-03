import { createHash } from 'node:crypto';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function fieldDefinition(catalog, fieldId) {
  return catalog?.fields?.find((field) => field.fieldId === fieldId) ?? null;
}

function latest(left, right) {
  return Date.parse(left.availableAt) - Date.parse(right.availableAt) ||
    Date.parse(left.capturedAt) - Date.parse(right.capturedAt) ||
    String(left.sourceRevision).localeCompare(String(right.sourceRevision));
}

export function buildFeatureSnapshot({ facts = [], catalog, targetDate, decisionCutoffAt, requiredFields = [] } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate || '')) throw new Error('target_date_invalid');
  const cutoffMs = Date.parse(decisionCutoffAt);
  if (!Number.isFinite(cutoffMs)) throw new Error('decision_cutoff_invalid');
  const definitions = new Map(requiredFields.map((fieldId) => {
    const definition = fieldDefinition(catalog, fieldId);
    if (!definition) throw new Error(`field_definition_missing:${fieldId}`);
    if (!definition.temporalBehavior) throw new Error(`temporal_behavior_missing:${fieldId}`);
    return [fieldId, definition];
  }));
  for (const fact of facts) {
    if (!Number.isFinite(Date.parse(fact.availableAt))) throw new Error(`available_at_invalid:${fact.factId ?? fact.fieldId}`);
  }

  const candidates = facts
    .filter((fact) => definitions.has(fact.fieldId))
    .filter((fact) => Date.parse(fact.availableAt) <= cutoffMs)
    .filter((fact) => {
      const behavior = definitions.get(fact.fieldId).temporalBehavior;
      if (behavior === 'static_with_effective_period') {
        return (!fact.effectiveFrom || fact.effectiveFrom <= targetDate) && (!fact.effectiveTo || fact.effectiveTo >= targetDate);
      }
      return fact.businessDate === targetDate;
    });

  const selected = new Map();
  for (const fact of candidates) {
    const rowKey = fact.pointIndex ?? fact.eventKey ?? fact.entityKey ?? 'global';
    const key = `${rowKey}|${fact.fieldId}`;
    const previous = selected.get(key);
    if (!previous || latest(previous, fact) < 0) selected.set(key, fact);
  }

  const rowsByKey = new Map();
  for (const fact of selected.values()) {
    const rowKey = fact.pointIndex ?? fact.eventKey ?? fact.entityKey ?? 'global';
    if (!rowsByKey.has(rowKey)) {
      rowsByKey.set(rowKey, {
        businessDate: targetDate,
        ...(fact.pointIndex === undefined ? { entityKey: String(rowKey) } : { pointIndex: Number(fact.pointIndex) }),
        fields: {},
        selectedFactIds: [],
      });
    }
    const row = rowsByKey.get(rowKey);
    row.fields[fact.fieldId] = fact.value;
    row.selectedFactIds.push(fact.factId);
  }
  const rows = [...rowsByKey.values()]
    .map((row) => ({ ...row, fields: stableValue(row.fields), selectedFactIds: row.selectedFactIds.sort() }))
    .sort((left, right) => Number(left.pointIndex ?? Number.MAX_SAFE_INTEGER) - Number(right.pointIndex ?? Number.MAX_SAFE_INTEGER) || String(left.entityKey ?? '').localeCompare(String(right.entityKey ?? '')));
  const present = new Set([...selected.values()].map((fact) => fact.fieldId));
  const missingFields = requiredFields.filter((fieldId) => !present.has(fieldId)).sort();
  const warnings = missingFields.map((fieldId) => `required_field_missing:${fieldId}`);
  const hashInput = { targetDate, decisionCutoffAt, catalogVersion: catalog.version, rows, missingFields, warnings };
  const contentHash = createHash('sha256').update(stableJson(hashInput)).digest('hex');
  return {
    featureSnapshotId: `fs-${contentHash.slice(0, 24)}`,
    targetDate,
    decisionCutoffAt,
    catalogVersion: catalog.version,
    rows,
    missingFields,
    warnings,
    contentHash,
  };
}
