import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildForecastModelReport,
  forecastNaiveSameSlot,
  forecastRollingSameSlot,
  summarizeForecastReadiness,
} from '../lib/forecast-models.mjs';

const featureStore = (rows) => ({ rows, summary: { sourceDates: [...new Set(rows.map((row) => row.date))] } });

test('summarizeForecastReadiness reports insufficient history before modeling', () => {
  const readiness = summarizeForecastReadiness(
    featureStore([
      { date: '2026-06-27', pointIndex: 1, realTimeAvgPrice: 100, priceSpread: 10 },
      { date: '2026-06-28', pointIndex: 1, realTimeAvgPrice: 110, priceSpread: 15 },
      { date: '2026-06-29', pointIndex: 1, realTimeAvgPrice: 130, priceSpread: 20 },
    ]),
    '2026-06-29'
  );

  assert.equal(readiness.status, 'insufficient_history');
  assert.equal(readiness.historicalDateCount, 2);
  assert.ok(readiness.missingReasons.includes('historical_dates_below_5'));
});

test('summarizeForecastReadiness counts only historical dates with usable realtime prices', () => {
  const readiness = summarizeForecastReadiness(
    featureStore([
      { date: '2026-06-23', pointIndex: 1, declarationPower: 20 },
      { date: '2026-06-24', pointIndex: 1, realTimeAvgPrice: 100 },
      { date: '2026-06-25', pointIndex: 1, realTimeAvgPrice: 110 },
      { date: '2026-06-26', pointIndex: 1, realTimeAvgPrice: 120 },
      { date: '2026-06-27', pointIndex: 1, realTimeAvgPrice: 130 },
      { date: '2026-06-28', pointIndex: 1, realTimeAvgPrice: 140 },
      { date: '2026-06-29', pointIndex: 1, realTimeAvgPrice: 150 },
    ]),
    '2026-06-29'
  );

  assert.equal(readiness.historicalDateCount, 5);
  assert.equal(readiness.status, 'baseline_ready');
});

test('forecast baselines use prior same-slot data and exclude target date truth', () => {
  const rows = [
    { date: '2026-06-24', pointIndex: 1, realTimeAvgPrice: 100, priceSpread: 1 },
    { date: '2026-06-25', pointIndex: 1, realTimeAvgPrice: 110, priceSpread: 2 },
    { date: '2026-06-26', pointIndex: 1, realTimeAvgPrice: 120, priceSpread: 3 },
    { date: '2026-06-27', pointIndex: 1, realTimeAvgPrice: 130, priceSpread: 4 },
    { date: '2026-06-28', pointIndex: 1, realTimeAvgPrice: 140, priceSpread: 5 },
    { date: '2026-06-29', pointIndex: 1, realTimeAvgPrice: 999, priceSpread: 999 },
  ];

  const naive = forecastNaiveSameSlot(rows, '2026-06-29', 'realTimeAvgPrice');
  const rolling = forecastRollingSameSlot(rows, '2026-06-29', 'realTimeAvgPrice', 5);

  assert.equal(naive[0].pointForecast, 140);
  assert.equal(rolling[0].pointForecast, 120);
  assert.notEqual(rolling[0].pointForecast, 999);
});

test('buildForecastModelReport returns baseline forecasts when enough history exists', () => {
  const report = buildForecastModelReport(
    featureStore([
      { date: '2026-06-24', pointIndex: 1, realTimeAvgPrice: 100, priceSpread: 1, highPriceRiskLabel: 0 },
      { date: '2026-06-25', pointIndex: 1, realTimeAvgPrice: 110, priceSpread: 2, highPriceRiskLabel: 0 },
      { date: '2026-06-26', pointIndex: 1, realTimeAvgPrice: 120, priceSpread: 3, highPriceRiskLabel: 0 },
      { date: '2026-06-27', pointIndex: 1, realTimeAvgPrice: 130, priceSpread: 4, highPriceRiskLabel: 1 },
      { date: '2026-06-28', pointIndex: 1, realTimeAvgPrice: 140, priceSpread: 5, highPriceRiskLabel: 1 },
      { date: '2026-06-29', pointIndex: 1, realTimeAvgPrice: 999, priceSpread: 999, highPriceRiskLabel: 1 },
    ]),
    { targetDate: '2026-06-29' }
  );

  assert.equal(report.status, 'baseline_ready');
  assert.ok(report.models.some((item) => item.id === 'naive_same_slot'));
  assert.ok(report.models.some((item) => item.id === 'rolling_same_slot_median'));
  assert.ok(report.forecasts.some((item) => item.target === 'realTimeAvgPrice'));
  assert.equal(report.forecasts.find((item) => item.target === 'realTimeAvgPrice')?.pointForecast, 120);
});
