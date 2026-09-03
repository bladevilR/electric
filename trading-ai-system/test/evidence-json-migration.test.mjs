import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { migrateLegacyEvidence } from '../lib/evidence-json-migration.mjs';
import { openTradingEvidenceStore } from '../lib/trading-evidence-store.mjs';

const generatedAt = '2026-06-29T07:55:02.693Z';

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evidence-json-migration-'));
  const paths = {
    visibleHistoryPath: path.join(directory, 'visible-history.json'),
    pointInTimePath: path.join(directory, 'point-in-time.json'),
    forecastLedgerPath: path.join(directory, 'forecast-ledger.json'),
    outcomeLedgerPath: path.join(directory, 'outcome-ledger.json'),
  };
  await writeJson(paths.visibleHistoryPath, {
    version: 1,
    generatedAt,
    source: 'jspec_managed_browser_auto_sweep',
    rows: [
      {
        date: '2026-06-29',
        pointIndex: 1,
        realTimeAvgPrice: 342.3,
        actualKwh: 1200,
        sourceTargets: ['realtime_average_price', 'actual_load_96'],
      },
    ],
  });
  await writeJson(paths.pointInTimePath, {
    version: 1,
    facts: [{
      factId: 'legacy-fact-1',
      sourceId: 'WEATHER-LOCAL',
      fieldId: 'temperatureC',
      businessDate: '2026-06-29',
      pointIndex: 1,
      value: 31.5,
      unit: '°C',
      availableAt: '2026-06-28T08:00:00.000Z',
      capturedAt: generatedAt,
      sourceRevision: 'weather-v1',
    }],
  });
  await writeJson(paths.forecastLedgerPath, {
    version: 1,
    runs: [{
      forecastRunId: 'legacy-run-1',
      forecastRunType: 'live_issued',
      targetField: 'dayAheadPriceYuanPerMwh',
      targetTradingDate: '2026-06-30',
      forecastGeneratedAt: '2026-06-29T08:00:00.000Z',
      decisionCutoffAt: '2026-06-29T07:30:00.000Z',
      featureSnapshotId: 'legacy-snapshot-1',
      featureVersion: 'v1',
      modelId: 'median',
      modelVersion: '1',
      codeCommitSha: 'abc1234',
      trainingStartDate: '2026-06-01',
      trainingEndDate: '2026-06-28',
      backtestSplitLabel: 'live',
      inputCompletenessPct: 100,
      rows: [{ pointIndex: 1, pointForecast: 350, inputCompletenessPct: 100 }],
    }],
  });
  await writeJson(paths.outcomeLedgerPath, {
    version: 1,
    outcomes: [{
      targetField: 'dayAheadPriceYuanPerMwh',
      businessDate: '2026-06-30',
      pointIndex: 1,
      actualValue: 355,
      actualLabelVersion: 'final',
      sourceId: 'JSPEC-DAYAHEAD',
      sourceRevision: 'final-v1',
      publishedAt: '2026-07-01T00:00:00.000Z',
      actualBackfilledAt: '2026-07-01T01:00:00.000Z',
    }],
  });
  const store = openTradingEvidenceStore({
    filePath: path.join(directory, 'evidence.sqlite'),
    clock: () => '2026-09-03T10:00:00.000Z',
  });
  return {
    directory,
    paths,
    store,
    async close() {
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('legacy migration imports each logical record once and preserves versions', async () => {
  const context = await fixture();
  try {
    const first = await migrateLegacyEvidence({ store: context.store, ...context.paths });
    const second = await migrateLegacyEvidence({ store: context.store, ...context.paths });

    assert.deepEqual(first, {
      importedFacts: 3,
      importedForecastRuns: 1,
      importedOutcomes: 1,
      skippedFiles: 0,
      missingFiles: 0,
      sourceFiles: 4,
    });
    assert.deepEqual(second, {
      importedFacts: 0,
      importedForecastRuns: 0,
      importedOutcomes: 0,
      skippedFiles: 4,
      missingFiles: 0,
      sourceFiles: 4,
    });
    assert.equal(context.store.queryFacts({}).length, 3);
    assert.equal(context.store.queryFacts({ fieldId: 'realTimeAvgPrice' })[0].unit, '元/MWh');
    assert.equal(context.store.queryForecastRuns({ forecastRunType: 'live_issued' })[0].forecastRunId, 'legacy-run-1');
    assert.equal(context.store.queryOutcomes({ actualLabelVersion: 'final' })[0].actualValue, 355);
  } finally {
    await context.close();
  }
});

test('migration reports optional files that do not exist without creating records', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evidence-json-missing-'));
  const store = openTradingEvidenceStore({ filePath: path.join(directory, 'evidence.sqlite') });
  try {
    const result = await migrateLegacyEvidence({
      store,
      visibleHistoryPath: path.join(directory, 'missing-history.json'),
      pointInTimePath: path.join(directory, 'missing-facts.json'),
    });
    assert.deepEqual(result, {
      importedFacts: 0,
      importedForecastRuns: 0,
      importedOutcomes: 0,
      skippedFiles: 0,
      missingFiles: 2,
      sourceFiles: 0,
    });
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('changed legacy content is imported as a new source revision', async () => {
  const context = await fixture();
  try {
    await migrateLegacyEvidence({ store: context.store, visibleHistoryPath: context.paths.visibleHistoryPath });
    await writeJson(context.paths.visibleHistoryPath, {
      version: 1,
      generatedAt: '2026-06-29T08:30:00.000Z',
      source: 'jspec_managed_browser_auto_sweep',
      rows: [{
        date: '2026-06-29',
        pointIndex: 1,
        realTimeAvgPrice: 343.1,
        sourceTargets: ['realtime_average_price'],
      }],
    });
    const result = await migrateLegacyEvidence({ store: context.store, visibleHistoryPath: context.paths.visibleHistoryPath });
    assert.equal(result.importedFacts, 1);
    assert.deepEqual(context.store.queryFacts({ fieldId: 'realTimeAvgPrice' }).map((row) => row.value), [342.3, 343.1]);
  } finally {
    await context.close();
  }
});
