import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { openTradingEvidenceStore } from '../lib/trading-evidence-store.mjs';

const fixedNow = '2026-09-03T10:00:00.000Z';

test('a supplemental collector cooldown also blocks regular jobs', async()=>withStore(store=>{
  store.appendCapture({sourceId:'PRICE',businessDate:'2026-07-01',pageUrl:'https://example.test',capturedAt:fixedNow,rowCount:0,accepted:false,contentSha256:'a'.repeat(64),
    evidence:{reasonCode:'rate_limited',retryAt:'2026-09-03T11:00:00.000Z'}});
  assert.equal(store.collectionRetryAt(fixedNow),'2026-09-03T11:00:00.000Z');
  assert.equal(store.collectionRetryAt('2026-09-03T12:00:00.000Z'),null);
}));

async function withStore(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'trading-evidence-store-'));
  const filePath = path.join(directory, 'evidence.sqlite');
  const store = openTradingEvidenceStore({ filePath, clock: () => fixedNow });
  try {
    await run(store, filePath);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const priceFact = {
  sourceId: 'JSPEC-DAYAHEAD',
  fieldId: 'dayAheadPriceYuanPerMwh',
  businessDate: '2026-06-29',
  pointIndex: 1,
  value: 362.5,
  unit: '元/MWh',
  availableAt: '2026-06-28T10:00:00.000Z',
  capturedAt: '2026-06-29T01:00:00.000Z',
  sourceRevision: 'page-20260629-v1',
};

function liveRun() {
  return {
    forecastRunId: 'live-2026-07-01-v1',
    forecastRunType: 'live_issued',
    targetField: 'dayAheadPriceYuanPerMwh',
    targetTradingDate: '2026-07-01',
    forecastGeneratedAt: '2026-06-30T08:00:00.000Z',
    decisionCutoffAt: '2026-06-30T07:30:00.000Z',
    featureSnapshotId: 'snapshot-1',
    featureVersion: 'v1',
    modelId: 'median-baseline',
    modelVersion: '1',
    codeCommitSha: 'abc1234',
    trainingStartDate: '2026-06-01',
    trainingEndDate: '2026-06-29',
    backtestSplitLabel: 'rolling-origin',
    inputCompletenessPct: 100,
    rows: [
      { pointIndex: 1, pointForecast: 365, p10: 340, p50: 365, p90: 390, inputCompletenessPct: 100 },
    ],
  };
}

test('facts are idempotent, versioned, and queryable with literal coverage', async () => {
  await withStore((store) => {
    assert.deepEqual(store.appendFacts([priceFact]), { inserted: 1, skipped: 0 });
    assert.deepEqual(store.appendFacts([priceFact]), { inserted: 0, skipped: 1 });
    assert.deepEqual(store.appendFacts([{ ...priceFact, value: 370, sourceRevision: 'page-20260629-v2' }]), {
      inserted: 1,
      skipped: 0,
    });

    const rows = store.queryFacts({ fieldId: 'dayAheadPriceYuanPerMwh', from: '2026-06-01', to: '2026-06-30' });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].value, 362.5);
    assert.equal(rows[1].value, 370);
    assert.deepEqual(store.getCoverage({ fieldId: 'dayAheadPriceYuanPerMwh' }), {
      dateCount: 1,
      earliestDate: '2026-06-29',
      latestDate: '2026-06-29',
      pointsByDate: { '2026-06-29': 1 },
    });
  });
});

test('as-of fact queries exclude revisions published after the decision cutoff', async () => {
  await withStore((store) => {
    store.appendFacts([
      priceFact,
      {
        ...priceFact,
        value: 399,
        availableAt: '2026-06-30T12:00:00.000Z',
        capturedAt: '2026-06-30T12:05:00.000Z',
        sourceRevision: 'page-20260629-late-correction',
      },
    ]);
    const visible = store.queryFacts({
      fieldId: priceFact.fieldId,
      asOf: '2026-06-30T10:00:00.000Z',
    });
    assert.deepEqual(visible.map((fact) => fact.value), [362.5]);
  });
});

test('a repeated capture of identical content keeps its first availability while conflicting content is rejected',async()=>{
  await withStore(store=>{
    store.appendFacts([priceFact]);
    const later={...priceFact,availableAt:fixedNow,capturedAt:fixedNow};
    assert.deepEqual(store.appendFacts([later]),{inserted:0,skipped:1});
    assert.equal(store.queryFacts({})[0].availableAt,priceFact.availableAt);
    assert.throws(()=>store.appendFacts([{...later,value:999}]),/fact_revision_conflict/);
    assert.throws(()=>store.appendFacts([{...priceFact,availableAt:'2026-06-01T00:00:00.000Z'}]),/fact_revision_conflict/);
  });
});

test('collection jobs and chunks keep restart checkpoints', async () => {
  await withStore((store) => {
    const job = store.createCollectionJob({
      id: 'job-1',
      mode: 'full_backfill',
      state: 'running',
      earliestDate: '2026-05-01',
      latestDate: '2026-06-30',
      totalChunks: 2,
    });
    store.upsertCollectionChunk({
      id: 'job-1-price-2026-05',
      jobId: job.id,
      sourceId: 'JSPEC-DAYAHEAD',
      monthKey: '2026-05',
      state: 'running',
      cursorDate: '2026-05-17',
      attemptCount: 1,
    });

    assert.equal(store.getCollectionJob('job-1').mode, 'full_backfill');
    assert.equal(store.listCollectionJobs()[0].id, 'job-1');
    assert.deepEqual(store.listCollectionChunks('job-1').map((chunk) => ({
      id: chunk.id,
      cursorDate: chunk.cursorDate,
      attemptCount: chunk.attemptCount,
    })), [{ id: 'job-1-price-2026-05', cursorDate: '2026-05-17', attemptCount: 1 }]);

    const paused = store.updateCollectionJob('job-1', {
      state: 'paused',
      completedChunks: 1,
      lastErrorCode: 'operator_paused',
    });
    assert.equal(paused.state, 'paused');
    assert.equal(paused.completedChunks, 1);
    assert.equal(paused.lastErrorCode, 'operator_paused');
  });
});

test('captures, facts, and checkpoints roll back together on transaction failure', async () => {
  await withStore((store) => {
    assert.throws(() => store.transaction(() => {
      store.appendCapture({
        id: 'capture-1',
        sourceId: 'JSPEC-DAYAHEAD',
        businessDate: '2026-06-29',
        pageUrl: 'https://www.jspec.com.cn/#/price',
        capturedAt: fixedNow,
        rowCount: 1,
        accepted: true,
        contentSha256: 'a'.repeat(64),
        evidence: { queryDate: '2026-06-29' },
      });
      store.appendFacts([priceFact]);
      throw new Error('simulate_write_failure');
    }), /simulate_write_failure/);

    assert.equal(store.queryCaptures({ sourceId: 'JSPEC-DAYAHEAD' }).length, 0);
    assert.equal(store.queryFacts({ sourceId: 'JSPEC-DAYAHEAD' }).length, 0);
  });
});

test('feature snapshots, forecast runs, outcomes, and accuracy metrics round trip without overwrite', async () => {
  await withStore((store) => {
    store.appendFeatureSnapshot({
      id: 'snapshot-1',
      targetTradingDate: '2026-07-01',
      cutoffAt: '2026-06-30T07:30:00.000Z',
      completenessPct: 100,
      payload: { fieldIds: ['dayAheadPriceYuanPerMwh'] },
      createdAt: '2026-06-30T08:00:00.000Z',
    });
    store.appendForecastRun(liveRun());
    assert.throws(() => store.appendForecastRun(liveRun()), /forecast_run_already_exists/);

    store.appendOutcomes([{
      targetField: 'dayAheadPriceYuanPerMwh',
      businessDate: '2026-07-01',
      pointIndex: 1,
      actualValue: 367,
      actualLabelVersion: 'final',
      sourceId: 'JSPEC-DAYAHEAD',
      sourceRevision: 'final-v1',
      publishedAt: '2026-07-02T00:00:00.000Z',
      actualBackfilledAt: '2026-07-02T01:00:00.000Z',
    }]);
    store.upsertAccuracyMetric({
      id: 'metric-1',
      runType: 'live_issued',
      modelId: 'median-baseline',
      targetField: 'dayAheadPriceYuanPerMwh',
      fromDate: '2026-07-01',
      toDate: '2026-07-01',
      actualLabelVersion: 'final',
      metrics: { mae: 2, rmse: 2, bias: -2 },
      computedAt: fixedNow,
    });

    assert.equal(store.queryFeatureSnapshots({ targetTradingDate: '2026-07-01' })[0].id, 'snapshot-1');
    assert.equal(store.queryForecastRuns({ forecastRunType: 'live_issued' })[0].rows[0].p50, 365);
    assert.equal(store.queryOutcomes({ actualLabelVersion: 'final' })[0].actualValue, 367);
    assert.deepEqual(store.queryAccuracyMetrics({ runType: 'live_issued' })[0].metrics, {
      mae: 2,
      rmse: 2,
      bias: -2,
    });
  });
});

test('import markers are content-addressed and sensitive properties are rejected', async () => {
  await withStore((store) => {
    assert.equal(store.hasImportMarker({ sourcePath: 'data/history.json', sourceSha256: 'b'.repeat(64) }), false);
    store.recordImportMarker({
      id: 'import-history-v1',
      sourcePath: 'data/history.json',
      sourceSha256: 'b'.repeat(64),
      summary: { importedFacts: 79 },
    });
    assert.equal(store.hasImportMarker({ sourcePath: 'data/history.json', sourceSha256: 'b'.repeat(64) }), true);
    assert.throws(() => store.appendCapture({
      id: 'bad-capture',
      sourceId: 'JSPEC',
      pageUrl: 'https://www.jspec.com.cn',
      capturedAt: fixedNow,
      rowCount: 0,
      accepted: false,
      contentSha256: 'c'.repeat(64),
      evidence: { cookie: 'forbidden' },
    }), /sensitive_key_rejected/);
  });
});
