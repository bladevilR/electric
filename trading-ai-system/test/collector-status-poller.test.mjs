import test from 'node:test';
import assert from 'node:assert/strict';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function create(options) {
  const module = await import('../ui/collector-status-poller.js').catch(() => ({}));
  assert.equal(typeof module.createCollectorStatusPoller, 'function', 'status polling must exist');
  return module.createCollectorStatusPoller(options);
}

test('status polling retries failures, publishes fresh status and never overlaps requests', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0, release;
  const statuses=[], errors=[];
  const poller=await create({intervalMs:3000,read:async()=>{
    calls++;
    if(calls===1) return await new Promise(resolve=>{release=resolve;});
    if(calls===2) throw new Error('offline');
    return {progress:3};
  },onStatus:value=>statuses.push(value),onError:error=>errors.push(error.message)});
  try {
    poller.start(); poller.start();
    await settle();
    t.mock.timers.tick(5000); await settle();
    assert.equal(calls,1);
    release({progress:1}); await settle();
    t.mock.timers.tick(3000); await settle();
    assert.deepEqual(errors,['offline']);
    t.mock.timers.tick(3000); await settle();
    assert.deepEqual(statuses,[{progress:1},{progress:3}]);
  } finally {poller.stop();}
});

test('stopping aborts and ignores an obsolete response, even after restarting', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let release, signal, calls=0;
  const statuses=[];
  const poller=await create({read:async input=>{if(++calls===1){signal=input.signal;return new Promise(resolve=>{release=resolve;});}return {progress:2};},
    onStatus:status=>statuses.push(status),onError:()=>{}});
  poller.start(); await settle();
  poller.stop();
  assert.equal(signal.aborted,true);
  poller.start(); await settle();
  release({progress:1}); await settle();
  assert.deepEqual(statuses,[{progress:2}]);
  poller.stop();
  t.mock.timers.tick(10000);await settle();
  assert.equal(calls,2);
});
