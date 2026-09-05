import path from 'node:path';

export function assertCollectorOwnerAvailable(owner, {profileDir, platform=process.platform, now=new Date().toISOString(), probe=pid=>process.kill(pid,0)}={}) {
  const paths=platform==='win32' ? path.win32 : path;
  const normalize=value=>platform==='win32' ? paths.resolve(value).toLowerCase() : paths.resolve(value);
  if(!owner?.profileDir || normalize(owner.profileDir)!==normalize(profileDir)) return;
  if(Date.parse(owner.nextAttemptAt)>Date.parse(now)) {
    throw Object.assign(new Error('平台要求等待后重试，已保留进度，请勿重复启动。'),
      {code:'rate_limited',details:{retryAt:owner.nextAttemptAt}});
  }
  if(owner.phase==='released') return;
  if(!Number.isInteger(owner.workerPid)||owner.workerPid<=0) throw new Error('采集连接状态需要核查，未启动第二个窗口。');
  try { probe(owner.workerPid); }
  catch(error) { if(error.code==='ESRCH') return; throw error; }
  throw Object.assign(new Error('现有采集窗口正在使用此连接，请勿重复启动。'),{code:'collector_in_use'});
}
