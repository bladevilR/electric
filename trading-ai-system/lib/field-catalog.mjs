import { readFile } from 'node:fs/promises';
import { SOURCE_STATUSES } from './data-source-registry.mjs';

function validateCatalog(catalog) {
  if (!catalog || !Number.isInteger(catalog.version) || !Array.isArray(catalog.fields)) {
    throw new Error('field_catalog_invalid');
  }
  const ids = new Set();
  for (const field of catalog.fields) {
    if (!field?.fieldId) throw new Error('field_id_missing');
    if (ids.has(field.fieldId)) throw new Error(`duplicate_field_id:${field.fieldId}`);
    ids.add(field.fieldId);
    if (!Array.isArray(field.nullTokens)) throw new Error(`null_tokens_missing:${field.fieldId}`);
    if (!Object.hasOwn(field, 'substitutionPolicy')) throw new Error(`substitution_policy_missing:${field.fieldId}`);
    if (!SOURCE_STATUSES.has(field.confirmationStatus)) throw new Error(`unknown_confirmation_status:${field.fieldId}`);
  }
  return catalog;
}

export async function loadFieldCatalog(filePath) {
  return validateCatalog(JSON.parse(await readFile(filePath, 'utf8')));
}

export function getFieldDefinition(catalog, fieldId) {
  return catalog?.fields?.find((field) => field.fieldId === fieldId) ?? null;
}

export function validateCanonicalValue(definition, value) {
  const errors = [];
  if (!definition) return { ok: false, normalizedValue: null, errors: ['field_definition_missing'] };
  if (definition.nullTokens.some((item) => Object.is(item, value) || (item !== null && value !== null && String(item) === String(value)))) {
    return { ok: true, normalizedValue: null, errors };
  }
  if (definition.dataType === 'number') {
    const normalizedValue = Number(String(value).replace(/,/g, '').trim());
    if (!Number.isFinite(normalizedValue)) errors.push('number_invalid');
    return { ok: errors.length === 0, normalizedValue: errors.length ? null : normalizedValue, errors };
  }
  if (definition.dataType === 'integer') {
    const normalizedValue = Number(String(value).trim());
    if (!Number.isInteger(normalizedValue)) errors.push('integer_invalid');
    return { ok: errors.length === 0, normalizedValue: errors.length ? null : normalizedValue, errors };
  }
  if (definition.dataType === 'boolean') {
    if (value === true || value === false) return { ok: true, normalizedValue: value, errors };
    return { ok: false, normalizedValue: null, errors: ['boolean_invalid'] };
  }
  return { ok: true, normalizedValue: String(value).trim(), errors };
}
