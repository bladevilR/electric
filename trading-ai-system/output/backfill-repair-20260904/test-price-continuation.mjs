import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openTradingEvidenceStore} from '../../lib/trading-evidence-store.mjs';
import {continuePriceHistory} from './continue-price-history.mjs';

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(),'electric-continuation-'));
  const store = openTradingEvidenceStore({filePath:path.join(directory,'test.sqlite')});
  const options = {page:{url:()=> 'https://example.test/prices'},store,fromDate:'2026-07-01',toDate:'2026-07-01',
    progressPath:path.join(directory,'progress.json'),sleep:async()=>{},adapter:{sourceId:'PRICE',setQuery:async()=>{},submit:async()=>{},waitForResult:async()=>{}}};
  try { await run(options); } finally { store.close(); await rm(directory,{recursive:true,force:true}); }
}

test('complete dates are skipped without any browser query', async()=> fixture(async options=>{
  const now = new Date().toISOString();
  options.store.appendFacts(Array.from({length:96},(_,i)=>({sourceId:'PRICE',fieldId:'dayAheadUserPriceFinalYuanPerMwh',businessDate:'2026-07-01',pointIndex:i+1,value:300,availableAt:now,capturedAt:now,sourceRevision:'v1'})));
  options.adapter.setQuery = async()=>{throw new Error('Must not query');};
  const state = await continuePriceHistory(options);
  assert.equal(state.phase,'range_checked');
  assert.equal(state.skippedCoveredDays,1);
}));

test('expired authentication stops with rejected evidence and no facts', async()=> fixture(async options=>{
  options.adapter.submit=async()=>{throw Object.assign(new Error('Expired'),{code:'login_expired'});};
  const state=await continuePriceHistory(options);
  assert.equal(state.phase,'paused');
  assert.equal(state.currentDate,'2026-07-01');
  assert.equal(options.store.queryFacts({}).length,0);
  assert.equal(options.store.queryCaptures({})[0].accepted,false);
  assert.equal(JSON.parse(await readFile(options.progressPath,'utf8')).error.reasonCode,'login_expired');
}));

test('platform cooldown is persisted and restarting cannot send an early query', async()=> fixture(async options=>{
  let calls=0;
  const retryAt=new Date(Date.now()+3600000).toISOString();
  options.adapter.submit=async()=>{calls++;throw Object.assign(new Error('Slow down'),{code:'rate_limited',details:{retryAt}});};
  const state=await continuePriceHistory(options);
  assert.equal(state.nextAttemptAt,retryAt);
  await continuePriceHistory(options);
  assert.equal(calls,1);
}));

test('an evidence write failure cannot erase a platform throttle deadline', async()=> fixture(async options=>{
  let calls=0;
  const retryAt=new Date(Date.now()+3600000).toISOString();
  options.adapter.submit=async()=>{calls++;throw Object.assign(new Error('Slow down'),{code:'rate_limited',details:{retryAt}});};
  options.store.appendCapture=()=>{throw new Error('SQLITE_BUSY');};
  await continuePriceHistory(options).catch(()=>{});
  const saved=JSON.parse(await readFile(options.progressPath,'utf8'));
  assert.equal(saved.nextAttemptAt,retryAt);
  await continuePriceHistory(options);
  assert.equal(calls,1);
}));

test('confirmed empty dates remain empty evidence, not accepted coverage', async()=> fixture(async options=>{
  options.adapter.submit=async()=>{throw Object.assign(new Error('No rows'),{code:'no_data'});};
  const state=await continuePriceHistory(options);
  assert.deepEqual(state.emptyDates,['2026-07-01']);
  assert.equal(state.collectedDays,0);
  assert.equal(options.store.queryFacts({}).length,0);
}));

test('only one loop can own the same page', async()=> fixture(async options=>{
  let release;
  options.sleep=()=>new Promise(resolve=>{release=resolve;});
  const first=continuePriceHistory(options);
  await assert.rejects(continuePriceHistory(options),/已有采集/);
  while(!release) await new Promise(resolve=>setTimeout(resolve,5));
  options.adapter.submit=async()=>{throw Object.assign(new Error('Empty'),{code:'no_data'});};
  release();
  await first;
}));
