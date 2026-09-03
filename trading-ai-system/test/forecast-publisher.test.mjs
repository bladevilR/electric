import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createForecastPublisher } from '../lib/forecast-publisher.mjs';
import { openTradingEvidenceStore } from '../lib/trading-evidence-store.mjs';

const now = '2026-09-02T10:00:00.000Z';
const targetDate = '2026-09-03';

async function withPublisher(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forecast-publisher-'));
  const store = openTradingEvidenceStore({ filePath: path.join(directory, 'evidence.sqlite'), clock: () => now });
  const publisher = createForecastPublisher({ store, clock: () => now, codeCommitSha: 'abc1234', expectedPointCount: 2 });
  try {
    await run({ store, publisher });
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function dateAt(day) {
  return `2026-08-${String(day).padStart(2, '0')}`;
}

function seedDates(store, fromDay, count, { includeDrivers = true } = {}) {
  const facts = [];
  for (let day = fromDay; day < fromDay + count; day += 1) {
    for (let pointIndex = 1; pointIndex <= 2; pointIndex += 1) {
      const date = dateAt(day);
      const temperature = 18 + day * 0.3 + pointIndex;
      const load = 900 + day * day + pointIndex * 15;
      facts.push({
        sourceId: 'JSPEC-PRICE', fieldId: 'dayAheadUserPriceFinalYuanPerMwh', businessDate: date,
        pointIndex, value: 60 + temperature * 3 + load * 0.2, unit: '元/MWh',
        availableAt: `${date}T01:00:00.000Z`, capturedAt: `${date}T01:05:00.000Z`, sourceRevision: `${date}-price-v1`,
      });
      if (includeDrivers) {
        facts.push({
          sourceId: 'OPEN-METEO-PREVIOUS-RUNS', fieldId: 'temperatureForecastC', businessDate: date,
          pointIndex, value: temperature, unit: '°C', availableAt: `${date}T00:00:00.000Z`,
          capturedAt: `${date}T00:05:00.000Z`, sourceRevision: `${date}-weather-v1`,
        }, {
          sourceId: 'JSPEC-LOAD', fieldId: 'loadForecastMw', businessDate: date,
          pointIndex, value: load, unit: 'MW', availableAt: `${date}T00:00:00.000Z`,
          capturedAt: `${date}T00:05:00.000Z`, sourceRevision: `${date}-load-v1`,
        });
      }
    }
  }
  store.appendFacts(facts);
}

function seedTargetDrivers(store) {
  const facts = [];
  for (let pointIndex = 1; pointIndex <= 2; pointIndex += 1) {
    facts.push({
      sourceId: 'OPEN-METEO-PREVIOUS-RUNS', fieldId: 'temperatureForecastC', businessDate: targetDate,
      pointIndex, value: 27 + pointIndex, unit: '°C', availableAt: '2026-09-02T08:00:00.000Z',
      capturedAt: '2026-09-02T08:05:00.000Z', sourceRevision: `target-weather-${pointIndex}-v1`,
    }, {
      sourceId: 'JSPEC-LOAD', fieldId: 'loadForecastMw', businessDate: targetDate,
      pointIndex, value: 1250 + pointIndex * 10, unit: 'MW', availableAt: '2026-09-02T08:00:00.000Z',
      capturedAt: '2026-09-02T08:05:00.000Z', sourceRevision: `target-load-${pointIndex}-v1`,
    });
  }
  store.appendFacts(facts);
}

test('publisher blocks fewer than five complete price dates and labels 5-29 as baseline', async () => {
  await withPublisher(({ store, publisher }) => {
    seedDates(store, 1, 4, { includeDrivers: false });
    assert.equal(publisher.readiness(targetDate).status, 'blocked');
    seedDates(store, 5, 1, { includeDrivers: false });
    assert.equal(publisher.readiness(targetDate).status, 'baseline_only');
    seedDates(store, 6, 25);
    seedTargetDrivers(store);
    const readiness = publisher.readiness(targetDate);
    assert.equal(readiness.status, 'model_allowed');
    assert.equal(readiness.historicalCompleteDateCount, 30);
    assert.equal(readiness.targetDriverCompletenessPct, 100);
  });
});

test('publication freezes as-of inputs, exposes driver contributions, and is immutable', async () => {
  await withPublisher(({ store, publisher }) => {
    seedDates(store, 1, 30);
    seedTargetDrivers(store);
    store.appendFacts([{
      sourceId: 'OPEN-METEO-PREVIOUS-RUNS', fieldId: 'temperatureForecastC', businessDate: targetDate,
      pointIndex: 1, value: 99, unit: '°C', availableAt: '2026-09-02T12:00:00.000Z',
      capturedAt: '2026-09-02T12:05:00.000Z', sourceRevision: 'late-weather-correction',
    }]);

    const run = publisher.publishLiveForecast(targetDate);
    assert.equal(run.forecastRunType, 'live_issued');
    assert.equal(run.rows.length, 2);
    assert.equal(run.forecastEvidenceByPoint['1'].inputs.temperatureForecastC, 28);
    assert.ok(Math.abs(run.forecastEvidenceByPoint['1'].contributions.temperatureYuanPerMwh) > 0);
    assert.throws(() => publisher.publishLiveForecast(targetDate), /forecast_run_already_exists/);

    const snapshot = store.queryFeatureSnapshots({ targetTradingDate: targetDate })[0];
    assert.equal(snapshot.payload.rows.find((row) => row.date === targetDate && row.pointIndex === 1).temperatureForecastC, 28);
  });
});

test('actual price revisions are backfilled and evaluated only against live issued runs', async () => {
  await withPublisher(({ store, publisher }) => {
    seedDates(store, 1, 30);
    seedTargetDrivers(store);
    publisher.publishLiveForecast(targetDate);
    const actualFacts = [1, 2].map((pointIndex) => ({
      sourceId: 'JSPEC-PRICE', fieldId: 'dayAheadUserPriceFinalYuanPerMwh', businessDate: targetDate,
      pointIndex, value: 360 + pointIndex, unit: '元/MWh', availableAt: '2026-09-04T01:00:00.000Z',
      capturedAt: '2026-09-04T01:05:00.000Z', sourceRevision: `target-final-${pointIndex}`,
    }));
    store.appendFacts(actualFacts);

    assert.deepEqual(publisher.backfillOutcomes({ from: targetDate, to: targetDate }), { inserted: 2, skipped: 0 });
    const report = publisher.evaluate({ from: targetDate, to: targetDate, actualLabelVersion: 'final' });
    assert.equal(report.forecastRunType, 'live_issued');
    assert.equal(report.sampleCoverage.pairs, 2);
    assert.ok(Number.isFinite(report.metrics.mae));
    assert.ok(Number.isFinite(report.quantileMetrics.interval80.meanWidth));
    assert.equal(store.queryAccuracyMetrics({ runType: 'live_issued' }).length, 1);
  });
});
