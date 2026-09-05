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

test('full backfill can be safely limited to an explicit verification range', async () => {
  const context = await fixture([
    adapter({ id: 'price', sourceId: 'JSPEC-PRICE', earliestDate: '2024-01-01', latestDate: '2026-09-03' }),
    adapter({ id: 'load', sourceId: 'JSPEC-LOAD', earliestDate: '2025-01-01', latestDate: '2026-09-02' }),
  ]);
  try {
    const job = await context.runner.createFullBackfill({
      id: 'job-bounded',
      fromDate: '2026-09-02',
      toDate: '2026-09-02',
    });
    assert.equal(job.earliestDate, '2026-09-02');
    assert.equal(job.latestDate, '2026-09-02');
    assert.deepEqual(context.store.listCollectionChunks(job.id).map((chunk) => ({
      sourceId: chunk.sourceId,
      startDate: chunk.startDate,
      endDate: chunk.endDate,
    })), [
      { sourceId: 'JSPEC-LOAD', startDate: '2026-09-02', endDate: '2026-09-02' },
      { sourceId: 'JSPEC-PRICE', startDate: '2026-09-02', endDate: '2026-09-02' },
    ]);
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

test('a no-data trading date is recorded as rejected evidence and does not stall full backfill', async () => {
  const context = await fixture([
    adapter({ id: 'price', sourceId: 'JSPEC-PRICE', earliestDate: '2026-07-04', latestDate: '2026-07-04', errorCode: 'no_data' }),
  ]);
  try {
    const job = await context.runner.createFullBackfill({ id: 'job-no-data' });
    const status = await context.runner.runNext(job.id);
    assert.equal(status.state, 'completed');
    const captures = context.store.queryCaptures({ businessDate: '2026-07-04' });
    assert.equal(captures.length, 1);
    assert.equal(captures[0].accepted, false);
    assert.equal(captures[0].evidence.reasonCode, 'no_data');
    assert.equal(context.store.queryFacts({ businessDate: '2026-07-04' }).length, 0);
  } finally {
    await context.close();
  }
});

test('platform Retry-After survives checkpoints and resume without early requests', async () => {
  const source = adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-01'});
  let calls = 0;
  source.submit = async () => {
    calls += 1;
    throw Object.assign(new Error('平台限流'), {code:'rate_limited',details:{retryAt:'2026-09-03T11:00:00.000Z'}});
  };
  const context = await fixture([source]);
  try {
    const job = await context.runner.createFullBackfill({id:'retry-after'});
    await assert.rejects(context.runner.runNext(job.id), error => error.code === 'rate_limited');
    assert.equal(context.runner.status(job.id).nextAttemptAt, '2026-09-03T11:00:00.000Z');
    context.runner.pause(job.id);
    context.runner.resume(job.id);
    await context.runner.runNext(job.id);
    assert.equal(calls, 1);
  } finally { await context.close(); }
});

test('service maintenance preserves the date checkpoint and records failed evidence without claiming no data',async()=>{
  const context=await fixture([adapter({id:'load',sourceId:'JSPEC-LOAD',earliestDate:'2026-07-04',latestDate:'2026-07-04',errorCode:'service_unavailable'})]);
  try {
    const job=await context.runner.createFullBackfill({id:'job-maintenance'});
    await assert.rejects(context.runner.runNext(job.id),error=>error.code==='service_unavailable');
    assert.equal(context.runner.status(job.id).state,'paused');
    assert.equal(context.runner.status(job.id).completedChunks,0);
    assert.equal(context.store.queryCaptures({})[0].evidence.reasonCode,'service_unavailable');
    assert.equal(context.store.queryFacts({}).length,0);
    context.runner.resume(job.id);
    assert.equal(context.runner.status(job.id).chunks[0].state,'pending');
    await assert.rejects(context.runner.runNext(job.id),error=>error.code==='service_unavailable');
  }finally {await context.close();}
});

test('day progress advances within a month and separates accepted evidence from empty dates', async () => {
  const source = adapter({ id: 'price', sourceId: 'JSPEC-PRICE', earliestDate: '2026-07-01', latestDate: '2026-07-04' });
  const context = await fixture([source]);
  try {
    const job = await context.runner.createFullBackfill({ id: 'day-progress' });
    await context.runner.runNext(job.id);
    source.waitForResult = async () => { throw Object.assign(new Error('empty'), { code: 'no_data' }); };
    await context.runner.runNext(job.id);
    const result = context.runner.status(job.id);
    assert.equal(result.completedChunks, 0);
    assert.equal(result.progressPct, 50);
    assert.deepEqual(result.dayProgress, { total: 4, processed: 2, accepted: 1, noData: 1, unverified: 0 });
    assert.equal(result.currentDate, '2026-07-03');
    assert.equal(result.currentSourceId, 'JSPEC-PRICE');
    assert.deepEqual(createCollectionJobRunner(context.dependencies).status(job.id).dayProgress, result.dayProgress);
  } finally { await context.close(); }
});

test('empty dates use the same query pacing as dates with data', async () => {
  const context = await fixture([adapter({ id:'price', sourceId:'JSPEC-PRICE', earliestDate:'2026-07-01', latestDate:'2026-07-02', errorCode:'no_data' })]);
  try {
    let waits = [];
    const runner = createCollectionJobRunner({ ...context.dependencies, queryDelayMs: 20000, sleep: async ms => { waits.push(ms); } });
    const job = await runner.createFullBackfill();
    await runner.runNext(job.id);
    assert.deepEqual(waits, [20000]);
  } finally { await context.close(); }
});

test('global rate-limit cooldown prevents querying another source or month', async () => {
  const context = await fixture([
    adapter({ id:'price', sourceId:'A-PRICE', earliestDate:'2026-07-01', latestDate:'2026-08-01', errorCode:'rate_limited' }),
    adapter({ id:'load', sourceId:'Z-LOAD', earliestDate:'2026-07-01', latestDate:'2026-07-02' }),
  ]);
  try {
    const job = await context.runner.createFullBackfill();
    await assert.rejects(context.runner.runNext(job.id), { code:'rate_limited' });
    context.runner.resume(job.id);
    const status = await context.runner.runNext(job.id);
    assert.equal(context.store.queryFacts({}).length, 0);
    assert.equal(status.nextAttemptAt, '2026-09-03T10:01:00.000Z');
  } finally { await context.close(); }
});

test('simultaneous start requests reuse a single persistent job without competing browser navigation', async () => {
  const context = await fixture([adapter({ id:'price', sourceId:'JSPEC-PRICE', earliestDate:'2026-07-01', latestDate:'2026-07-02' })]);
  try {
    const [first, second] = await Promise.all([context.runner.createFullBackfill(), context.runner.createFullBackfill()]);
    assert.equal(first.id, second.id);
    assert.equal(context.store.listCollectionJobs().length, 1);
    assert.equal((await context.runner.createFullBackfill()).id, first.id);
    await assert.rejects(context.runner.createFullBackfill({ fromDate:'2026-07-02', toDate:'2026-07-02' }), { code:'collection_job_active' });
  } finally { await context.close(); }
});

test('pausing an in-flight query keeps its committed data but never returns to running state', async () => {
  const source = adapter({ id:'price', sourceId:'JSPEC-PRICE', earliestDate:'2026-07-01', latestDate:'2026-07-02' });
  const context = await fixture([source]);
  try {
    let finish;
    let started;
    const reached = new Promise(resolve => { started = resolve; });
    source.waitForResult = () => { started(); return new Promise(resolve => { finish = resolve; }); };
    const job = await context.runner.createFullBackfill();
    const running = context.runner.runNext(job.id);
    await reached;
    context.runner.pause(job.id);
    finish();
    const result = await running;
    assert.equal(result.state, 'paused');
    assert.equal(context.runtime.status().state, 'paused');
    assert.equal(result.chunks[0].cursorDate, '2026-07-02');
    assert.equal(context.store.queryFacts({}).length, 1);
    await assert.rejects(context.runner.runNext(job.id), { code:'collection_job_paused' });
  } finally { await context.close(); }
});

async function schedulerFor(context) {
  const module = await import('../lib/collection-job-scheduler.mjs').catch(() => ({}));
  assert.equal(typeof module.createCollectionJobScheduler, 'function', 'persistent collection must have an automatic retry scheduler');
  return module.createCollectionJobScheduler({ runner: context.runner, store: context.store });
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('scheduler retries after cooldown automatically without spinning or querying before the deadline', async t => {
  t.mock.timers.enable({ apis:['setTimeout','Date'], now: new Date(now) });
  const source = adapter({ id:'price', sourceId:'JSPEC-PRICE', earliestDate:'2026-07-01', latestDate:'2026-07-01' });
  let attempts = 0;
  source.waitForResult = async () => { if (++attempts === 1) throw Object.assign(new Error('rate limit'), {code:'rate_limited'}); };
  const context = await fixture([source]);
  context.runtime.healthCheck = async () => ({state:'ready'});
  context.runner = createCollectionJobRunner({...context.dependencies, clock:()=>new Date().toISOString()});
  let scheduler;
  try {
    scheduler = await schedulerFor(context);
    const job = await context.runner.createFullBackfill();
    scheduler.start(job.id);
    await settle();
    assert.equal(context.runner.status(job.id).chunks[0].state, 'rate_limited');
    assert.equal(scheduler.status(job.id).phase, 'waiting');
    t.mock.timers.tick(59999);
    await settle();
    assert.equal(attempts, 1);
    t.mock.timers.tick(1);
    await settle();
    assert.equal(context.runner.status(job.id).state, 'completed');
    assert.equal(context.store.queryFacts({}).length, 1);
    assert.equal(attempts, 2);
  } finally { await scheduler?.stop(); await context.close(); }
});

test('pause cancels scheduled work and immediate resume still respects the persisted cooldown', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date'], now:new Date(now)});
  const context = await fixture([adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-01',errorCode:'rate_limited'})]);
  context.runner = createCollectionJobRunner({...context.dependencies,clock:()=>new Date().toISOString()});
  let scheduler;
  try {
    scheduler = await schedulerFor(context);
    const job = await context.runner.createFullBackfill();
    scheduler.start(job.id);
    await settle();
    scheduler.pause(job.id);
    scheduler.resume(job.id);
    await settle();
    assert.equal(scheduler.status(job.id).phase,'waiting');
    assert.equal(context.runner.status(job.id).chunks[0].attemptCount,1);
    scheduler.pause(job.id);
    t.mock.timers.tick(120000);
    await settle();
    assert.equal(context.runner.status(job.id).state,'paused');
    assert.equal(context.runner.status(job.id).chunks[0].attemptCount,1);
  } finally {await scheduler?.stop(); await context.close();}
});

test('server restart marks abandoned running jobs interrupted without discarding checkpoints', async () => {
  const context = await fixture([adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-02'})]);
  let scheduler;
  try {
    const job = await context.runner.createFullBackfill();
    await context.runner.runNext(job.id);
    scheduler = await schedulerFor(context);
    scheduler.recoverInterrupted();
    const recovered = context.runner.status(job.id);
    assert.equal(recovered.state,'paused');
    assert.equal(recovered.lastErrorCode,'collector_restarted');
    assert.equal(recovered.dayProgress.processed,1);
    assert.equal(scheduler.status(job.id).phase,'idle');
  } finally {await scheduler?.stop(); await context.close();}
});

test('rapid pause and resume never runs two queries against the shared page', async () => {
  const source = adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-02'});
  let release;
  let attempts = 0;
  source.waitForResult = async () => { if (++attempts === 1) await new Promise(resolve => {release=resolve;}); };
  const context = await fixture([source]);
  let scheduler;
  try {
    scheduler = await schedulerFor(context);
    const job = await context.runner.createFullBackfill();
    scheduler.start(job.id);
    await settle();
    scheduler.pause(job.id);
    scheduler.resume(job.id);
    scheduler.start(job.id);
    await settle();
    assert.equal(attempts,1);
    release();
    await settle();
    await settle();
    assert.equal(context.runner.status(job.id).state,'completed');
    assert.equal(context.store.queryFacts({}).length,2);
  } finally {release?.(); await scheduler?.stop(); await context.close();}
});

test('a paused rate-limited job cannot be bypassed by creating a different range', async () => {
  const context=await fixture([adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-02',errorCode:'rate_limited'})]);
  context.runtime.healthCheck=async()=>({state:'ready'});
  try {
    const job=await context.runner.createFullBackfill();
    await assert.rejects(context.runner.runNext(job.id),{code:'rate_limited'});
    context.runner.pause(job.id);
    await assert.rejects(context.runner.createFullBackfill({id:'bypass',fromDate:'2026-07-02',toDate:'2026-07-02'}),{code:'collection_job_active'});
    assert.equal(context.store.listCollectionJobs().length,1);
  }finally {await context.close();}
});

test('resuming a different persisted job still honors the original session cooldown', async () => {
  const source=adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-02',errorCode:'rate_limited'});
  const context=await fixture([source]);
  try {
    const job=await context.runner.createFullBackfill();
    await assert.rejects(context.runner.runNext(job.id),{code:'rate_limited'});
    context.runner.pause(job.id);
    context.store.createCollectionJob({id:'older',mode:'full_backfill',state:'paused',totalChunks:1});
    context.store.upsertCollectionChunk({id:'older-chunk',jobId:'older',sourceId:'JSPEC-PRICE',state:'pending',monthKey:'2026-07',startDate:'2026-07-02',endDate:'2026-07-02',cursorDate:'2026-07-02'});
    source.waitForResult=async()=>{};
    context.runner.resume('older');
    const result=await context.runner.runNext('older');
    assert.equal(result.nextAttemptAt,'2026-09-03T10:01:00.000Z');
    assert.equal(context.store.queryFacts({}).length,0);
  }finally {await context.close();}
});

test('an in-flight paused query prevents another persisted job from resuming against its page', async () => {
  const source=adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-02'});
  const context=await fixture([source]);
  let release, pending;
  try {
    source.waitForResult=()=>new Promise(resolve=>{release=resolve;});
    const job=await context.runner.createFullBackfill();
    pending=context.runner.runNext(job.id);
    await settle();
    context.runner.pause(job.id);
    context.store.createCollectionJob({id:'older',mode:'full_backfill',state:'paused',totalChunks:1});
    assert.throws(()=>context.runner.resume('older'),{code:'collection_job_active'});
  }finally {release?.();await pending;await context.close();}
});

test('outcome counts never borrow evidence from another job whose ID shares a prefix',async()=>{
  const context=await fixture([adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-01'})]);
  try {
    const job=await context.runner.createFullBackfill({id:'job'});
    const chunk=context.store.listCollectionChunks(job.id)[0];
    context.store.upsertCollectionChunk({...chunk,state:'completed'});
    context.store.appendCapture({id:'job:another:JSPEC-PRICE:2026-07-01:'+'b'.repeat(64),sourceId:'JSPEC-PRICE',businessDate:'2026-07-01',pageUrl:'https://example.test',contentSha256:'b'.repeat(64),accepted:true,rowCount:1,capturedAt:now});
    assert.deepEqual(context.runner.status(job.id).dayProgress,{total:1,processed:1,accepted:0,noData:0,unverified:1});
  }finally{await context.close();}
});

test('browser shutdown rejects resume until the active query and browser closure are drained', async () => {
  const source=adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-02'});
  let releaseQuery, releaseBrowser, attempts=0;
  source.waitForResult=async()=>{if(++attempts===1) await new Promise(resolve=>{releaseQuery=resolve;});};
  const context=await fixture([source]);
  let scheduler, closing;
  try {
    scheduler=await schedulerFor(context);
    const job=await context.runner.createFullBackfill();
    scheduler.start(job.id);await settle();
    closing=scheduler.stop(()=>new Promise(resolve=>{releaseBrowser=resolve;}));
    assert.throws(()=>scheduler.resume(job.id),{code:'collector_stopping'});
    releaseQuery();await settle();
    assert.equal(attempts,1);
    assert.throws(()=>scheduler.start(job.id),{code:'collector_stopping'});
    assert.equal(context.runner.status(job.id).state,'paused');
    releaseBrowser();await closing;
  }finally{releaseQuery?.();releaseBrowser?.();await closing;await scheduler?.stop();await context.close();}
});

test('a shutdown during initial discovery saves a paused job and never starts it',async()=>{
  const source=adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-02'});
  let release;
  source.discoverBounds=async()=>{await new Promise(resolve=>{release=resolve;});return {earliestDate:'2026-07-01',latestDate:'2026-07-02'};};
  const context=await fixture([source]);
  let scheduler, creating, closing;
  try {
    scheduler=await schedulerFor(context);
    assert.equal(typeof scheduler.createBackfill,'function','discovery must participate in shutdown ownership');
    creating=scheduler.createBackfill({id:'discovery'});
    const rejected=assert.rejects(creating,{code:'collector_stopping'});
    await settle();
    closing=scheduler.stop();
    await assert.rejects(scheduler.createBackfill(),{code:'collector_stopping'});
    release();await rejected;await closing;
    assert.equal(context.runner.status('discovery').state,'paused');
    assert.equal(context.store.queryCaptures({}).length,0);
  }finally{release?.();await creating?.catch(()=>{});await closing;await scheduler?.stop();await context.close();}
});

test('browser launch is single-flight and shutdown waits for it before closing',async()=>{
  const context=await fixture([adapter({id:'price',sourceId:'JSPEC-PRICE',earliestDate:'2026-07-01',latestDate:'2026-07-02'})]);
  let scheduler, release, opening, closing;
  try {
    scheduler=await schedulerFor(context);
    assert.equal(typeof scheduler.openBrowser,'function','browser start and stop must share ownership');
    const events=[];
    opening=scheduler.openBrowser(async()=>{events.push('launch');await new Promise(resolve=>{release=resolve;});events.push('opened');return {state:'ready'};});
    const duplicate=scheduler.openBrowser(async()=>{events.push('duplicate');return {state:'ready'};});
    await settle();
    closing=scheduler.stop(async()=>{events.push('closed');return {state:'stopped'};});
    await assert.rejects(scheduler.openBrowser(async()=>({state:'ready'})),{code:'collector_stopping'});
    release();await opening;await duplicate;await closing;
    assert.deepEqual(events,['launch','opened','closed']);
  }finally{release?.();await opening;await closing;await scheduler?.stop();await context.close();}
});
