import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REQUIRED = ['sourceId', 'fieldId', 'businessDate', 'value', 'availableAt', 'capturedAt', 'sourceRevision'];
const CREDENTIAL_KEY = /cookie|token|ticket|authorization|password|passwd|secret|credential|cert|private.?key|pin/i;

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

function assertNoCredentials(value, location = 'fact') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) throw new Error(`credential_property_forbidden:${location}.${key}`);
    assertNoCredentials(child, `${location}.${key}`);
  }
}

function assertIso(value, field) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field}_invalid`);
}

function normalizeFact(fact) {
  for (const field of REQUIRED) {
    if (!Object.hasOwn(fact ?? {}, field) || fact[field] === undefined) throw new Error(`fact_${field}_missing`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fact.businessDate)) throw new Error('business_date_invalid');
  if (fact.pointIndex === undefined && !fact.eventKey && !fact.entityKey) throw new Error('fact_point_or_entity_key_missing');
  if (fact.pointIndex !== undefined && (!Number.isInteger(Number(fact.pointIndex)) || Number(fact.pointIndex) < 1 || Number(fact.pointIndex) > 96)) {
    throw new Error('point_index_invalid');
  }
  assertIso(fact.availableAt, 'available_at');
  assertIso(fact.capturedAt, 'captured_at');
  assertNoCredentials(fact);
  const normalized = { ...fact, ...(fact.pointIndex === undefined ? {} : { pointIndex: Number(fact.pointIndex) }) };
  const key = [normalized.sourceId, normalized.fieldId, normalized.businessDate, normalized.pointIndex ?? normalized.eventKey ?? normalized.entityKey, normalized.sourceRevision].join('|');
  return {
    ...normalized,
    factId: normalized.factId || createHash('sha256').update(`${key}|${stableJson(normalized)}`).digest('hex'),
  };
}

export function emptyStore() {
  return { version: 1, facts: [] };
}

export function appendFact(store, fact) {
  const current = store ?? emptyStore();
  if (!Array.isArray(current.facts)) throw new Error('point_in_time_store_invalid');
  const normalized = normalizeFact(fact);
  const sameKey = current.facts.find((item) =>
    item.sourceId === normalized.sourceId && item.fieldId === normalized.fieldId &&
    item.businessDate === normalized.businessDate && (item.pointIndex ?? item.eventKey ?? item.entityKey) === (normalized.pointIndex ?? normalized.eventKey ?? normalized.entityKey) &&
    item.sourceRevision === normalized.sourceRevision
  );
  if (sameKey?.factId === normalized.factId) return current;
  if (sameKey) throw new Error('fact_revision_conflict');
  return { ...current, facts: [...current.facts, normalized] };
}

function matches(fact, query, key) {
  return query[key] === undefined || fact[key] === query[key] || (key === 'pointIndex' && Number(fact[key]) === Number(query[key]));
}

export function factsAvailableAt(store, query = {}) {
  const asOfMs = Date.parse(query.asOf);
  if (!Number.isFinite(asOfMs)) throw new Error('as_of_invalid');
  return (store?.facts ?? [])
    .filter((fact) => Date.parse(fact.availableAt) <= asOfMs)
    .filter((fact) => ['sourceId', 'fieldId', 'businessDate', 'pointIndex', 'eventKey', 'entityKey'].every((key) => matches(fact, query, key)))
    .sort((left, right) =>
      Date.parse(left.availableAt) - Date.parse(right.availableAt) ||
      Date.parse(left.capturedAt) - Date.parse(right.capturedAt) ||
      String(left.sourceRevision).localeCompare(String(right.sourceRevision))
    );
}

export function currentFactAt(store, query = {}) {
  return factsAvailableAt(store, query).at(-1) ?? null;
}

export async function readPointInTimeStore(filePath) {
  try {
    const store = JSON.parse(await readFile(filePath, 'utf8'));
    if (!Number.isInteger(store?.version) || !Array.isArray(store?.facts)) throw new Error('point_in_time_store_invalid');
    return store;
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

export async function writePointInTimeStoreAtomic(filePath, store) {
  if (!Number.isInteger(store?.version) || !Array.isArray(store?.facts)) throw new Error('point_in_time_store_invalid');
  assertNoCredentials(store, 'store');
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}
