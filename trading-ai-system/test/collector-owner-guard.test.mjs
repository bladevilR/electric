import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCollectorOwnerAvailable } from '../lib/collector-owner-guard.mjs';

const profileDir='C:\\Users\\R\\collector';
const now='2026-09-04T10:00:00.000Z';
const missing=()=>{throw Object.assign(new Error('Process exited'),{code:'ESRCH'});};
test('a dead or released owner cannot erase a future platform cooldown',()=>{
  for(const phase of ['paused','released']) {
    assert.throws(()=>assertCollectorOwnerAvailable({profileDir,workerPid:123,phase,nextAttemptAt:'2026-09-04T11:00:00.000Z'},
      {profileDir,platform:'win32',now,probe:missing}),error=>error.code==='rate_limited'&&error.details.retryAt==='2026-09-04T11:00:00.000Z');
  }
});
test('Windows profile comparison is case insensitive before checking the live owner',()=>{
  assert.throws(()=>assertCollectorOwnerAvailable({profileDir:'c:/users/r/collector',workerPid:123,phase:'collecting'},
    {profileDir,platform:'win32',now,probe:()=>{}}),error=>error.code==='collector_in_use');
});
test('expired cooldowns and exited owners permit recovery while another profile is unrelated',()=>{
  assert.doesNotThrow(()=>assertCollectorOwnerAvailable({profileDir,workerPid:123,nextAttemptAt:'2026-09-04T09:00:00.000Z'},
    {profileDir,platform:'win32',now,probe:missing}));
  assert.doesNotThrow(()=>assertCollectorOwnerAvailable({profileDir:'C:/another',workerPid:123,nextAttemptAt:'2026-09-04T11:00:00.000Z'},
    {profileDir,platform:'win32',now,probe:()=>{throw new Error('Unrelated owner must not be probed');}}));
});
test('invalid owner state and unexpected process errors fail closed',()=>{
  assert.throws(()=>assertCollectorOwnerAvailable({profileDir,workerPid:0},{profileDir,platform:'win32',now}),/需要核查/);
  assert.throws(()=>assertCollectorOwnerAvailable({profileDir,workerPid:123},{profileDir,platform:'win32',now,probe:()=>{throw Object.assign(new Error('denied'),{code:'EPERM'});}}),error=>error.code==='EPERM');
});
