import test from 'node:test';
import assert from 'node:assert/strict';
import { appendOutcomeRevision, selectOutcomeForEvaluation } from '../lib/outcome-ledger.mjs';

const temporary = { targetField:'dayAheadUserPriceFinalYuanPerMwh',businessDate:'2026-08-24',pointIndex:1,actualValue:318.5,actualLabelVersion:'temporary',sourceId:'JSPEC-P0-3',sourceRevision:'temp-r1',publishedAt:'2026-08-23T10:05:00+08:00',actualBackfilledAt:'2026-08-23T10:06:00+08:00' };

test('temporary and final outcomes coexist without fallback', () => {
  const final = { ...temporary, actualValue:319.8,actualLabelVersion:'final',sourceRevision:'final-r1',publishedAt:'2026-08-25T09:00:00+08:00' };
  const ledger = appendOutcomeRevision(appendOutcomeRevision({version:1,outcomes:[]},temporary),final);
  assert.equal(ledger.outcomes.length,2);
  assert.equal(selectOutcomeForEvaluation(ledger,{businessDate:'2026-08-24',pointIndex:1,targetField:temporary.targetField,actualLabelVersion:'final'}).actualValue,319.8);
  assert.equal(selectOutcomeForEvaluation({version:1,outcomes:[temporary]},{businessDate:'2026-08-24',pointIndex:1,targetField:temporary.targetField,actualLabelVersion:'final'}),null);
});

test('outcome ledger rejects duplicate revisions and unknown labels', () => {
  const ledger=appendOutcomeRevision({version:1,outcomes:[]},temporary);
  assert.throws(()=>appendOutcomeRevision(ledger,temporary),/outcome_revision_already_exists/);
  assert.throws(()=>appendOutcomeRevision({version:1,outcomes:[]},{...temporary,actualLabelVersion:'maybe'}),/outcome_label_invalid/);
});
