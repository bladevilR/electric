import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendFact,
  currentFactAt,
  emptyStore,
  factsAvailableAt,
  readPointInTimeStore,
  writePointInTimeStoreAtomic,
} from '../lib/point-in-time-store.mjs';

const temporary = {
  sourceId: 'JSPEC-P0-3', fieldId: 'dayAheadUserPriceTemporaryYuanPerMwh',
  businessDate: '2026-08-24', pointIndex: 1, value: 318.5,
  availableAt: '2026-08-23T10:00:00+08:00', capturedAt: '2026-08-23T10:01:00+08:00', sourceRevision: 'r1'
};
const final = {
  sourceId: 'JSPEC-P0-3', fieldId: 'dayAheadUserPriceFinalYuanPerMwh',
  businessDate: '2026-08-24', pointIndex: 1, value: 319.8,
  availableAt: '2026-08-25T09:00:00+08:00', capturedAt: '2026-08-25T09:01:00+08:00', sourceRevision: 'r2'
};

test('appendFact keeps preliminary and final revisions', () => {
  const store = appendFact(appendFact(emptyStore(), temporary), final);
  assert.equal(store.facts.length, 2);
  assert.notEqual(store.facts[0].factId, store.facts[1].factId);
});

test('as-of query excludes facts published after the decision cutoff', () => {
  const store = appendFact(appendFact(emptyStore(), temporary), final);
  const visible = factsAvailableAt(store, { asOf: '2026-08-23T12:00:00+08:00', businessDate: '2026-08-24' });
  assert.deepEqual(visible.map((fact) => fact.sourceRevision), ['r1']);
});

test('currentFactAt deterministically returns the latest available revision', () => {
  let store = appendFact(emptyStore(), { ...temporary, fieldId: 'price', sourceRevision: 'r1' });
  store = appendFact(store, { ...temporary, fieldId: 'price', value: 320, availableAt: '2026-08-23T11:00:00+08:00', sourceRevision: 'r2' });
  assert.equal(currentFactAt(store, { sourceId: 'JSPEC-P0-3', fieldId: 'price', businessDate: '2026-08-24', pointIndex: 1, asOf: '2026-08-23T12:00:00+08:00' }).value, 320);
});

test('store persists atomically and rejects credential-shaped data', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pit-store-'));
  const filePath = path.join(temp, 'nested', 'facts.json');
  try {
    const store = appendFact(emptyStore(), temporary);
    await writePointInTimeStoreAtomic(filePath, store);
    assert.deepEqual(await readPointInTimeStore(filePath), store);
    assert.throws(() => appendFact(store, { ...final, metadata: { password: 'forbidden' } }), /credential_property_forbidden/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
