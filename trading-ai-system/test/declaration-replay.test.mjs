import test from 'node:test';
import assert from 'node:assert/strict';

async function replayModule() {
  return import('../lib/declaration-replay.mjs').catch(() => null);
}

test('buildDeclarationReplay converts interval units and measures improvement over default declaration', async () => {
  const module = await replayModule();
  assert.equal(typeof module?.buildDeclarationReplay, 'function');

  const result = module.buildDeclarationReplay(
    {
      rows: [
        {
          date: '2026-01-01',
          pointIndex: 1,
          declarationPower: 40,
          defaultDeclarationPower: 32,
          actualKwh: 10000,
        },
        {
          date: '2026-01-01',
          pointIndex: 2,
          declarationPower: 44,
          defaultDeclarationPower: 32,
          actualKwh: 10000,
        },
        {
          date: '2026-01-01',
          pointIndex: 3,
          declarationPower: '',
          defaultDeclarationPower: 32,
          actualKwh: 10000,
        },
      ],
    },
    { minComparablePoints: 2 }
  );

  assert.equal(result.status, 'validated');
  assert.equal(result.verdict, 'improved');
  assert.equal(result.comparablePointCount, 2);
  assert.equal(result.dateCount, 1);
  assert.equal(result.submittedMaeMwh, 0.5);
  assert.equal(result.baselineMaeMwh, 2);
  assert.equal(result.improvementPct, 75);
  assert.equal(result.winRatePct, 100);
  assert.equal(result.costSavingsYuan, null);
});

test('buildDeclarationReplay rejects a declaration that increases load deviation', async () => {
  const module = await replayModule();
  assert.equal(typeof module?.buildDeclarationReplay, 'function');

  const result = module.buildDeclarationReplay(
    {
      rows: [
        {
          date: '2026-01-01',
          pointIndex: 1,
          declarationPower: 48,
          defaultDeclarationPower: 36,
          actualKwh: 10000,
        },
      ],
    },
    { minComparablePoints: 1 }
  );

  assert.equal(result.status, 'validated');
  assert.equal(result.verdict, 'not_improved');
  assert.equal(result.submittedMaeMwh, 2);
  assert.equal(result.baselineMaeMwh, 1);
  assert.equal(result.improvementPct, -100);
  assert.equal(result.winRatePct, 0);
  assert.ok(result.warnings.includes('cost_attribution_unavailable'));
});

test('buildDeclarationReplay requires enough comparable evidence', async () => {
  const module = await replayModule();
  assert.equal(typeof module?.buildDeclarationReplay, 'function');

  const result = module.buildDeclarationReplay({
    rows: [
      {
        date: '2026-01-01',
        pointIndex: 1,
        declarationPower: 40,
        defaultDeclarationPower: 36,
        actualKwh: 10000,
      },
    ],
  });

  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.verdict, 'not_validated');
  assert.equal(result.requiredComparablePoints, 96);
});
