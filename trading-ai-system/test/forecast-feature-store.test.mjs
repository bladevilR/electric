import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDataAssetInventory } from '../lib/data-assets.mjs';
import {
  buildForecastFeatureStore,
  buildPointKey,
  normalizeAssetRows,
  normalizeSettlementReferenceRows,
} from '../lib/forecast-feature-store.mjs';

const capture = (fileName, url, data) => ({
  fileName,
  meta: { capturedAt: '2026-06-29T01:00:00.000Z', url },
  bodyJson: { status: 0, data },
});

test('buildPointKey creates stable date-point keys', () => {
  assert.equal(buildPointKey('2026-06-29', 1), '2026-06-29#001');
  assert.equal(buildPointKey('2026-06-29', '12'), '2026-06-29#012');
});

test('buildForecastFeatureStore merges raw price, declaration, and system rows into 96-point features', () => {
  const inventory = buildDataAssetInventory([
    capture(
      'rt.json',
      'https://www.jspec.com.cn/px-spotgoods-province/realTimeClearingRelease/queryRealTimeMarAvePricePublic',
      [
        { dataTime: '2026-06-29', timePoint: '00:15', avgPrice: 320 },
        { dataTime: '2026-06-29', timePoint: '00:30', avgPrice: 500 },
      ]
    ),
    capture(
      'dayahead.json',
      'https://www.jspec.com.cn/px-spotgoods-province/dayClearingResult/queryTableXrdOnlyJiesuan',
      [
        { dataTime: '2026-06-29', timePoint: '00:15', unitPrice: 350 },
        { dataTime: '2026-06-29', timePoint: '00:30', unitPrice: 360 },
      ]
    ),
    capture(
      'user-clearing.json',
      'https://www.jspec.com.cn/px-spotgoods-province/Dd2jyUserClearingResult/queryDd2jyRqClearing',
      [{ dataTime: '2026-06-29', timePoint: '00:15', unitPrice: 355 }]
    ),
    capture(
      'default-bid.json',
      'https://www.jspec.com.cn/px-spotgoods-province/mosEnergyBidInfoUser/getMosEnergyBidInfoUserDefault',
      { dataTime: '2026-06-29', mosDeratePendParamList: [{ timeSlot: '00:15', power: 21 }] }
    ),
    capture(
      'system-forecast.json',
      'https://www.jspec.com.cn/px-spotgoods-province/glbecoParamvalue/getCurve',
      { 4: ['80100', '80200'] }
    ),
    capture(
      'actual-system.json',
      'https://www.jspec.com.cn/px-spotgoods-province/afterDiscloseInformation/queryTableActualSystemLoad',
      [{ dataTime: '2026-06-29', value1: 81100, value2: 81200 }]
    ),
  ]);

  const store = buildForecastFeatureStore({ rows: [] }, { assets: inventory });
  const row = store.rows.find((item) => item.date === '2026-06-29' && item.pointIndex === 1);

  assert.equal(row.realTimeAvgPrice, 320);
  assert.equal(row.dayAheadPublicPrice, 350);
  assert.equal(row.dayAheadUserPrice, 355);
  assert.equal(row.defaultDeclarationPower, 21);
  assert.equal(row.systemLoadForecast, 80100);
  assert.equal(row.actualSystemLoad, 81100);
  assert.equal(row.actualKwh, null);
  assert.equal(row.priceSpread, -30);
  assert.equal(row.missingFields.includes('actualKwh'), true);
  assert.equal(row.missingFields.includes('settleAmount'), true);
  assert.equal(store.summary.rowCount, 2);
  assert.equal(store.summary.fieldCompleteness.realTimeAvgPrice, 2);
});

test('buildForecastFeatureStore filters output date without losing source history summary', () => {
  const inventory = buildDataAssetInventory([
    capture(
      'rt-1.json',
      'https://www.jspec.com.cn/px-spotgoods-province/realTimeClearingRelease/queryRealTimeMarAvePricePublic',
      [{ dataTime: '2026-06-28', timePoint: '00:15', avgPrice: 300 }]
    ),
    capture(
      'rt-2.json',
      'https://www.jspec.com.cn/px-spotgoods-province/realTimeClearingRelease/queryRealTimeMarAvePricePublic',
      [{ dataTime: '2026-06-29', timePoint: '00:15', avgPrice: 320 }]
    ),
  ]);

  const normalized = normalizeAssetRows(inventory);
  const store = buildForecastFeatureStore({ rows: [] }, { assets: inventory, date: '2026-06-29' });

  assert.equal(normalized.length, 2);
  assert.deepEqual(store.rows.map((row) => row.date), ['2026-06-29']);
  assert.deepEqual(store.summary.sourceDates, ['2026-06-28', '2026-06-29']);
});

test('buildForecastFeatureStore merges historical reconciliation labels', () => {
  const settlementReference = {
    featureRows: [
      {
        date: '2026-01-01',
        pointIndex: 1,
        timePoint: '00:15',
        actualKwh: 20163,
        settleAmount: 6579.17,
        settlementPrice: 326.299,
        dayAheadForecastMwh: 9.275,
        dayAheadActualRatio: 0.46,
        outOfBandMwh: 9.87985,
        totalTradeSavingYuan: 111.296,
        sourceFile: '4、2026年1月现货核对单 .xlsx',
        sourceSheet: '1',
      },
    ],
  };

  const normalized = normalizeSettlementReferenceRows(settlementReference);
  const store = buildForecastFeatureStore({ rows: [] }, { settlementReference });
  const row = store.rows.find((item) => item.date === '2026-01-01' && item.pointIndex === 1);

  assert.equal(normalized.length, 1);
  assert.equal(row.actualKwh, 20163);
  assert.equal(row.settleAmount, 6579.17);
  assert.equal(row.dayAheadForecastMwh, 9.275);
  assert.equal(row.dayAheadActualRatio, 0.46);
  assert.equal(row.outOfBandMwh, 9.87985);
  assert.equal(row.totalTradeSavingYuan, 111.296);
  assert.equal(row.sourceFiles.includes('4、2026年1月现货核对单 .xlsx'), true);
  assert.equal(row.sourceEndpoints.includes('settlement-reference'), true);
  assert.equal(row.missingFields.includes('actualKwh'), false);
  assert.equal(row.missingFields.includes('settleAmount'), false);
  assert.equal(store.summary.fieldCompleteness.actualKwh, 1);
  assert.equal(store.summary.fieldCompleteness.settleAmount, 1);
});

test('buildForecastFeatureStore merges transaction calculation usage and submission labels', () => {
  const settlementReference = {
    featureRows: [
      {
        date: '2026-03-31',
        pointIndex: 1,
        timePoint: '00:15',
        actualKwh: 17845,
        sourceFile: 'customer_usage_96.csv',
        sourceEndpoint: 'transaction-calculation-standardized',
      },
      {
        date: '2026-03-31',
        pointIndex: 1,
        timePoint: '00:15',
        declarationPower: 42.6,
        sourceFile: 'submission_power_96.csv',
        sourceEndpoint: 'transaction-calculation-standardized',
      },
    ],
  };

  const normalized = normalizeSettlementReferenceRows(settlementReference);
  const store = buildForecastFeatureStore({ rows: [] }, { settlementReference });
  const row = store.rows.find((item) => item.date === '2026-03-31' && item.pointIndex === 1);

  assert.equal(normalized.length, 2);
  assert.equal(row.actualKwh, 17845);
  assert.equal(row.declarationPower, 42.6);
  assert.equal(row.sourceFiles.includes('customer_usage_96.csv'), true);
  assert.equal(row.sourceFiles.includes('submission_power_96.csv'), true);
  assert.equal(row.sourceEndpoints.includes('transaction-calculation-standardized'), true);
  assert.equal(store.summary.fieldCompleteness.actualKwh, 1);
  assert.equal(store.summary.fieldCompleteness.declarationPower, 1);
});
