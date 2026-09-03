import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createCollectionJobRunner } from '../lib/collection-job-runner.mjs';
import { openTradingEvidenceStore } from '../lib/trading-evidence-store.mjs';

const now = '2026-09-03T10:00:00.000Z';

function adapter({ id, sourceId, earliestDate, latestDate, errorCode = null }) {
  return {
    id,
    sourceId,
    async navigate() {},
    async discoverBounds() { return { earliestDate, latestDate }; },
    async setQuery(_page, query) { this.query = query; },
    async submit() {},
    async waitForResult() {
      if (errorCode) {
        const error = new Error(errorCode);
        error.code = errorCode;
        throw error;
      }
    },
    async extract(_page, options) {
      const fieldId = id === 'price' ? 'dayAheadUserPriceFinalYuanPerMwh' : 'loadForecastMw';
      const value = id === 'price' ? 350 : 1200;
      return {
        adapterId: id,
        sourceId,
        pageUrl: `https://example.test/${id}`,
        pageTitle: id,
        queryDate: options.businessDate,
        headers: ['点位', fieldId],
        mappedFields: [fieldId],
        facts: [{
          sourceId,
          fieldId,
          businessDate: options.businessDate,
          pointIndex: 1,
          value,
          unit: id === 'price' ? '元/MWh' : 'MW',
          availableAt: options.capturedAt,
          capturedAt: options.capturedAt,
          sourceRevision: `visible:${id}:${options.businessDate}`,
        }],
        structureFingerprint: 'a'.repeat(64),
        contentSha256: 'b'.repeat(64),
        capturedAt: options.capturedAt,
        evidence: { provider: `${id}-provider`, alignmentMethod: 'source_native' },
      };
    },
    validate(result) { return { ...result, accepted: true, coverageByField: { [result.mappedFields[0]]: 1 } }; },
    async nextPage() { return false; },
  };
}

function runtime() {
  let state = 'ready';
  return {
    async start() { return { state }; },
    async healthCheck() { return { state }; },
    async getPage() { return {}; },
    transition(nextState) { state = nextState; return { state }; },
    status() { return { state }; },
  };
}

async function fixture(adapters) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'collection-job-runner-'));
  const store = openTradingEvidenceStore({ filePath: path.join(directory, 'evidence.sqlite'), clock: () => now });
  const browserRuntime = runtime();
  const dependencies = {
    store,
    runtime: browserRuntime,
    adapters,
    clock: () => now,
    random: () => 0.5,
    sleep: async () => {},
    queryDelayMs: 0,
  };
  return {
    directory,
    store,
    runtime: browserRuntime,
    dependencies,
    runner: createCollectionJobRunner(dependencies),
    async close() {
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('full backfill creates source-month chunks and resumes from the committed next date', async () => {
  const context = await fixture([
    adapter({ id: 'price', sourceId: 'JSPEC-PRICE', earliestDate: '2026-05-30', latestDate: '2026-07-02' }),
    adapter({ id: 'load', sourceId: 'JSPEC-LOAD', earliestDate: '2026-06-01', latestDate: '2026-06-30' }),
  ]);
  try {
    const job = await context.runner.createFullBackfill({ id: 'job-1' });
    assert.equal(job.totalChunks, 4);
    assert.deepEqual(job.monthKeys, ['2026-05', '2026-06', '2026-07']);
    assert.deepEqual(context.store.listCollectionChunks(job.id).map((chunk) => ({
      sourceId: chunk.sourceId,
      monthKey: chunk.monthKey,
      startDate: chunk.startDate,
      endDate: chunk.endDate,
      cursorDate: chunk.cursorDate,
    })), [
      { sourceId: 'JSPEC-PRICE', monthKey: '2026-05', startDate: '2026-05-30', endDate: '2026-05-31', cursorDate: '2026-05-30' },
      { sourceId: 'JSPEC-LOAD', monthKey: '2026-06', startDate: '2026-06-01', endDate: '2026-06-30', cursorDate: '2026-06-01' },
      { sourceId: 'JSPEC-PRICE', monthKey: '2026-06', startDate: '2026-06-01', endDate: '2026-06-30', cursorDate: '2026-06-01' },
      { sourceId: 'JSPEC-PRICE', monthKey: '2026-07', startDate: '2026-07-01', endDate: '2026-07-02', cursorDate: '2026-07-01' },
    ]);

    await context.runner.runNext(job.id);
    assert.equal(context.store.queryFacts({ businessDate: '2026-05-30' }).length, 1);
    assert.equal(context.store.queryCaptures({ businessDate: '2026-05-30' }).length, 1);
    assert.deepEqual(context.store.queryCaptures({ businessDate: '2026-05-30' })[0].evidence.sourceEvidence, {
      provider: 'price-provider',
      alignmentMethod: 'source_native',
    });

    const restarted = createCollectionJobRunner(context.dependencies);
    const status = restarted.status(job.id);
    const firstChunk = status.chunks.find((chunk) => chunk.monthKey === '2026-05');
    assert.equal(firstChunk.cursorDate, '2026-05-31');
    assert.equal(firstChunk.state, 'running');
  } finally {
    await context.close();
  }
});

test('pause and resume persist job state instead of relying on process memory', async () => {
  const context = await fixture([
    adapter({ id: 'price', sourceId: 'JSPEC-PRICE', earliestDate: '2026-07-01', latestDate: '2026-07-01' }),
  ]);
  try {
    const job = await context.runner.createFullBackfill({ id: 'job-2' });
    assert.equal(context.runner.pause(job.id).state, 'paused');
    assert.equal(createCollectionJobRunner(context.dependencies).status(job.id).state, 'paused');
    assert.equal(context.runner.resume(job.id).state, 'running');
  } finally {
    await context.close();
  }
});

test('login expiry pauses the job and rate limiting checkpoints a delayed retry', async () => {
  const loginContext = await fixture([
    adapter({ id: 'price', sourceId: 'JSPEC-PRICE', earliestDate: '2026-07-01', latestDate: '2026-07-01', errorCode: 'login_expired' }),
  ]);
  try {
    const job = await loginContext.runner.createFullBackfill({ id: 'job-login' });
    await assert.rejects(() => loginContext.runner.runNext(job.id), (error) => error.code === 'login_expired');
    assert.equal(loginContext.runner.status(job.id).state, 'paused');
    assert.equal(loginContext.runtime.status().state, 'login_expired');
  } finally {
    await loginContext.close();
  }

  const rateContext = await fixture([
    adapter({ id: 'price', sourceId: 'JSPEC-PRICE', earliestDate: '2026-07-01', latestDate: '2026-07-01', errorCode: 'rate_limited' }),
  ]);
  try {
    const job = await rateContext.runner.createFullBackfill({ id: 'job-rate' });
    await assert.rejects(() => rateContext.runner.runNext(job.id), (error) => error.code === 'rate_limited');
    const chunk = rateContext.runner.status(job.id).chunks[0];
    assert.equal(chunk.state, 'rate_limited');
    assert.equal(chunk.attemptCount, 1);
    assert.equal(chunk.nextAttemptAt, '2026-09-03T10:01:00.000Z');
  } finally {
    await rateContext.close();
  }
});
