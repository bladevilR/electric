import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeatureSnapshot } from '../lib/feature-snapshot.mjs';

const catalog = {
  version: 3,
  fields: [
    { fieldId: 'systemLoadForecastMw', temporalBehavior: 'forecast_vintage' },
    { fieldId: 'temperatureC', temporalBehavior: 'forecast_vintage' },
  ],
};

const facts = [
  { factId: 'load-r1', sourceId: 'LOAD', fieldId: 'systemLoadForecastMw', businessDate: '2026-09-04', pointIndex: 1, value: 80100, availableAt: '2026-09-03T09:00:00+08:00', capturedAt: '2026-09-03T09:01:00+08:00', sourceRevision: 'r1' },
  { factId: 'load-r2', sourceId: 'LOAD', fieldId: 'systemLoadForecastMw', businessDate: '2026-09-04', pointIndex: 1, value: 99999, availableAt: '2026-09-03T13:00:00+08:00', capturedAt: '2026-09-03T13:01:00+08:00', sourceRevision: 'r2' },
];

test('snapshot is stable and excludes post-cutoff revisions', () => {
  const input = { facts, catalog, targetDate: '2026-09-04', decisionCutoffAt: '2026-09-03T12:00:00+08:00', requiredFields: ['systemLoadForecastMw', 'temperatureC'] };
  const a = buildFeatureSnapshot(input);
  const b = buildFeatureSnapshot(input);
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.featureSnapshotId, b.featureSnapshotId);
  assert.deepEqual(a.rows, b.rows);
  assert.equal(a.rows[0].fields.systemLoadForecastMw, 80100);
  assert.deepEqual(a.rows[0].selectedFactIds, ['load-r1']);
  assert.deepEqual(a.missingFields, ['temperatureC']);
});

test('snapshot rejects unknown fields and facts without availability evidence', () => {
  assert.throws(() => buildFeatureSnapshot({ facts, catalog, targetDate: '2026-09-04', decisionCutoffAt: '2026-09-03T12:00:00+08:00', requiredFields: ['unknown'] }), /field_definition_missing/);
  assert.throws(() => buildFeatureSnapshot({ facts: [{ ...facts[0], availableAt: '' }], catalog, targetDate: '2026-09-04', decisionCutoffAt: '2026-09-03T12:00:00+08:00', requiredFields: ['systemLoadForecastMw'] }), /available_at_invalid/);
});
