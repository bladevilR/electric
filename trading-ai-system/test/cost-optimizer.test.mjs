import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCostStrategy,
  buildDataConfidence,
  computePriceSpreadRows,
} from '../lib/cost-optimizer.mjs';

const dataset = {
  rows: [
    { date: '2026-06-29', pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: 200, dayAheadPublicPrice: 260, defaultDeclarationPower: 20 },
    { date: '2026-06-29', pointIndex: 2, timePoint: '00:30', realTimeAvgPrice: 210, dayAheadPublicPrice: 250, defaultDeclarationPower: 20 },
    { date: '2026-06-29', pointIndex: 3, timePoint: '00:45', realTimeAvgPrice: 410, dayAheadPublicPrice: 280, defaultDeclarationPower: 20 },
    { date: '2026-06-29', pointIndex: 4, timePoint: '01:00', realTimeAvgPrice: 430, dayAheadPublicPrice: 290, defaultDeclarationPower: 20 },
  ],
  quality: {
    fieldCompleteness: {
      realTimeAvgPrice: 4,
      defaultDeclarationPower: 4,
      actualKwh: 0,
      settleAmount: 0,
    },
  },
};

const assets = {
  summary: {
    contractCurrentTotal: 176,
    contractCurrentCapturedRows: 10,
    contractHistoryTotal: 88,
    contractHistoryCapturedRows: 10,
    tradeSequenceRows: 421,
    systemLoadForecastRows: 96,
  },
};

test('computePriceSpreadRows calculates realtime minus day-ahead spread', () => {
  const rows = computePriceSpreadRows(dataset.rows);

  assert.equal(rows[0].priceSpread, -60);
  assert.equal(rows[3].priceSpread, 140);
});

test('buildDataConfidence records missing actuals and partial contract penalties', () => {
  const confidence = buildDataConfidence(dataset, assets, { status: 'insufficient_history' }, { status: 'insufficient_history' });

  assert.ok(confidence.score < 100);
  assert.ok(confidence.penalties.some((item) => item.id === 'actual_load_missing'));
  assert.ok(confidence.penalties.some((item) => item.id === 'settlement_missing'));
  assert.ok(confidence.penalties.some((item) => item.id === 'contract_partial'));
});

test('buildCostStrategy returns three non-executable policy tiers with fallback model mode', () => {
  const strategy = buildCostStrategy(dataset, {
    date: '2026-06-29',
    assets,
    modelReport: { status: 'insufficient_history' },
    backtestReport: { status: 'insufficient_history' },
  });

  assert.equal(strategy.status, 'ready');
  assert.equal(strategy.modelMode, 'insufficient_history');
  assert.equal(strategy.policyTiers.length, 3);
  assert.equal(strategy.policyTiers[0].id, 'conservative');
  assert.ok(strategy.signals.lowPriceWindows.length > 0);
  assert.ok(strategy.signals.highPriceExposureWindows.length > 0);
  assert.ok(strategy.policyTiers.every((item) => item.executable === false));
  assert.equal(strategy.policyTiers.find((item) => item.id === 'aggressive')?.enabled, false);
  assert.ok(strategy.nextBestData.some((item) => item.id === 'actual_load_96'));
});
