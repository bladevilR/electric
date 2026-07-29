import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSavingsWorkbench } from '../lib/savings-workbench.mjs';

const today = '2026-07-27';
const now = '2026-07-27T02:00:00.000Z';

function points(date, overrides = {}) {
  return Array.from({ length: 96 }, (_, index) => ({
    date,
    pointIndex: index + 1,
    timePoint: `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`,
    realTimeAvgPrice: 320 + index / 10,
    ...overrides,
  }));
}

function completeBusinessInputs() {
  return {
    forecastLoad96: {
      rows: points(today).map((row) => ({
        date: row.date,
        pointIndex: row.pointIndex,
        forecastKwh: 1200,
      })),
    },
    position96: {
      rows: points(today).map((row) => ({
        date: row.date,
        pointIndex: row.pointIndex,
        availableBuyMwh: 2,
        availableSellMwh: 1,
      })),
    },
    tradeLimits: {
      values: {
        minQuantityMwh: 1,
        maxDraftQuantityMwh: 20,
        buyPriceCeilingYuanPerMwh: 380,
        sellPriceFloorYuanPerMwh: 280,
      },
    },
  };
}

test('historical rows and a stale snapshot cannot be presented as today-ready data', () => {
  const result = buildSavingsWorkbench({
    now,
    dataset: {
      generatedAt: '2026-05-07T02:45:41.700Z',
      rows: points('2026-05-07'),
    },
    businessInputs: completeBusinessInputs(),
    ukeyStatus: {
      visibleSnapshot: {
        accepted: true,
        rowCount: 79,
        generatedAt: '2026-06-29T07:55:02.693Z',
      },
    },
  });

  assert.equal(result.date, today);
  assert.equal(result.status, 'blocked');
  assert.equal(result.execution.allowed, false);
  assert.equal(result.savings.estimatedNetYuan, null);
  assert.equal(result.savings.realizedNetYuan, null);
  assert.equal(result.dataEvidence.find((item) => item.id === 'market_price').status, 'missing');
  assert.equal(result.dataEvidence.find((item) => item.id === 'visible_snapshot').status, 'stale');
  assert.equal(result.primaryAction.id, 'collect_today_data');
});

test('complete current-day decision inputs unlock review but do not invent savings', () => {
  const result = buildSavingsWorkbench({
    date: today,
    now,
    dataset: {
      generatedAt: '2026-07-27T01:50:00.000Z',
      rows: points(today),
    },
    businessInputs: completeBusinessInputs(),
    ukeyStatus: {
      visibleSnapshot: {
        accepted: true,
        rowCount: 96,
        generatedAt: '2026-07-27T01:50:00.000Z',
      },
    },
  });

  assert.equal(result.status, 'review_required');
  assert.equal(result.currentStage, 'execute');
  assert.equal(result.execution.allowed, false);
  assert.equal(result.execution.dataReady, true);
  assert.equal(result.savings.estimatedNetYuan, null);
  assert.equal(result.primaryAction.id, 'review_strategy');
  assert.equal(result.stages.find((stage) => stage.id === 'validate').status, 'complete');
});

test('realized savings use the complete cost formula only after settlement evidence exists', () => {
  const result = buildSavingsWorkbench({
    date: today,
    now,
    dataset: {
      generatedAt: '2026-07-27T01:50:00.000Z',
      rows: points(today, { actualKwh: 1200, settleAmount: 10100 }),
    },
    businessInputs: completeBusinessInputs(),
    ukeyStatus: {
      visibleSnapshot: {
        accepted: true,
        rowCount: 96,
        generatedAt: '2026-07-27T01:50:00.000Z',
      },
    },
    costs: {
      baselineCostYuan: 1_000_000,
      actualSettlementCostYuan: 970_000,
      transactionFeesYuan: 3_000,
      deviationCostYuan: 2_000,
      systemOperatingCostYuan: 1_000,
    },
  });

  assert.equal(result.status, 'verified');
  assert.equal(result.currentStage, 'settle');
  assert.equal(result.savings.realizedNetYuan, 24_000);
  assert.equal(result.savings.formulaComplete, true);
  assert.equal(result.stages.find((stage) => stage.id === 'settle').status, 'complete');
});

test('partial cost evidence remains null instead of becoming zero', () => {
  const result = buildSavingsWorkbench({
    date: today,
    now,
    dataset: {
      generatedAt: '2026-07-27T01:50:00.000Z',
      rows: points(today, { actualKwh: 1200, settleAmount: 10100 }),
    },
    businessInputs: completeBusinessInputs(),
    costs: {
      baselineCostYuan: 1_000_000,
      actualSettlementCostYuan: 970_000,
    },
  });

  assert.equal(result.savings.realizedNetYuan, null);
  assert.equal(result.savings.formulaComplete, false);
  assert.ok(result.blockers.some((item) => item.id === 'cost_formula_incomplete'));
});
