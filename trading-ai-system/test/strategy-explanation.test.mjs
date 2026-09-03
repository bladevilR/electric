import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStrategyTrace } from '../lib/strategy-explanation.mjs';

test('strategy trace has seven stages', () => {
  assert.deepEqual(
    buildStrategyTrace({}).stages.map((stage) => stage.id),
    [
      'evidence',
      'load',
      'price',
      'supplyNetwork',
      'positionLimits',
      'objectiveConstraints',
      'recommendation',
    ]
  );
});

test('query metadata alone cannot create a supported strategy evidence node', () => {
  const trace = buildStrategyTrace({
    targetDate: '2026-09-03',
    evidence: { asOf: '2026-09-03T09:00:00+08:00' },
  });
  const evidence = trace.stages.find((stage) => stage.id === 'evidence');

  assert.equal(evidence.status, 'unavailable');
  assert.equal(evidence.conclusion.status, 'degraded');
  assert.equal(evidence.conclusion.conclusionId, null);
  assert.deepEqual(evidence.conclusion.inputRefs, []);
});
