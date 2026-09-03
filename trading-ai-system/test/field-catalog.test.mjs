import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadFieldCatalog, getFieldDefinition, validateCanonicalValue } from '../lib/field-catalog.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('declaration, clearing and actual load use distinct canonical fields', async () => {
  const catalog = await loadFieldCatalog(path.join(root, 'config/field-catalog.json'));
  const ids = ['userDeclaredPowerMw', 'defaultDeclaredPowerMw', 'dayAheadUserClearedPowerMw', 'actualIntervalEnergyKwh', 'actualAverageLoadMw'];
  assert.equal(new Set(ids.map((id) => getFieldDefinition(catalog, id)?.fieldId)).size, ids.length);
});

test('temporary, final and effective day-ahead prices are separate fields', async () => {
  const catalog = await loadFieldCatalog(path.join(root, 'config/field-catalog.json'));
  assert.ok(getFieldDefinition(catalog, 'dayAheadUserPriceTemporaryYuanPerMwh'));
  assert.ok(getFieldDefinition(catalog, 'dayAheadUserPriceFinalYuanPerMwh'));
  assert.ok(getFieldDefinition(catalog, 'dayAheadUserPriceEffectiveYuanPerMwh'));
});

test('canonical values preserve zero, normalize numeric text, and recognize null tokens', async () => {
  const catalog = await loadFieldCatalog(path.join(root, 'config/field-catalog.json'));
  const definition = getFieldDefinition(catalog, 'dayAheadUserClearedPowerMw');
  assert.deepEqual(validateCanonicalValue(definition, '1,234.5'), { ok: true, normalizedValue: 1234.5, errors: [] });
  assert.deepEqual(validateCanonicalValue(definition, 0), { ok: true, normalizedValue: 0, errors: [] });
  assert.deepEqual(validateCanonicalValue(definition, '-'), { ok: true, normalizedValue: null, errors: [] });
  assert.equal(validateCanonicalValue(definition, 'not-a-number').ok, false);
});
