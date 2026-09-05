// One owner for the dedicated browser. A rate-limit checkpoint is a real timer,
// never a tight polling loop and never permission to query another month/source.
export function createCollectionJobScheduler({ runner, store }) {
  let owner = null;
  let inFlight = null;
  let timer = null;
  let stopping = false;
  let stopPromise = null;
  let opening = null;
  const discoveries = new Set();

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function status(jobId) {
    if (owner !== jobId) return { phase: 'idle' };
    if (runner.status(jobId).state === 'paused') return { phase: inFlight ? 'draining' : 'idle' };
    return { phase: timer !== null ? 'waiting' : inFlight ? 'collecting' : 'idle' };
  }

  function kick() {
    if (!owner || inFlight || timer !== null) return;
    const jobId = owner;
    const before = runner.status(jobId);
    if (before.state !== 'running') { owner = null; return; }
    if (stopping) return;
    const delay = before.nextAttemptAt ? Date.parse(before.nextAttemptAt) - Date.now() : 0;
    if (delay > 0) {
      timer = setTimeout(() => { timer = null; kick(); }, delay);
      timer.unref?.();
      return;
    }
    inFlight = Promise.resolve().then(() => runner.runNext(jobId)).catch(() => {
      // The runner persists classified errors and retry deadlines atomically.
      // An unclassified error with no checkpoint must not leave a fake running job.
    }).finally(() => {
      inFlight = null;
      const after = runner.status(jobId);
      if (after.state === 'running' && !after.nextAttemptAt && after.dayProgress.processed === before.dayProgress.processed) {
        store.updateCollectionJob(jobId, { state:'paused', lastErrorCode:after.lastErrorCode || 'collection_stalled',
          lastErrorMessage:after.lastErrorMessage || '采集没有推进检查点，已暂停以避免重复请求。' });
      }
      kick();
    });
  }

  function assertOwner(jobId) {
    if (stopping) throw Object.assign(new Error('collector_stopping'), {code:'collector_stopping'});
    if (owner && owner !== jobId) throw Object.assign(new Error('collection_job_active'), {code:'collection_job_active'});
  }

  function start(jobId) {
    assertOwner(jobId);
    if (runner.status(jobId).state !== 'running') return runner.status(jobId);
    owner = jobId;
    kick();
    return runner.status(jobId);
  }

  function pause(jobId) {
    const result = runner.pause(jobId);
    if (owner === jobId) {
      clearTimer();
      if (!inFlight) owner = null;
    }
    return result;
  }

  function resume(jobId) {
    assertOwner(jobId);
    runner.resume(jobId);
    return start(jobId);
  }

  async function createBackfill(input) {
    if (stopping) throw Object.assign(new Error('collector_stopping'), {code:'collector_stopping'});
    if (opening) await opening;
    if (stopping) throw Object.assign(new Error('collector_stopping'), {code:'collector_stopping'});
    const discovery = runner.createFullBackfill(input).then(job => {
      if (stopping) {
        runner.pause(job.id);
        throw Object.assign(new Error('collector_stopping'), {code:'collector_stopping'});
      }
      start(job.id);
      return job;
    });
    discoveries.add(discovery);
    try { return await discovery; } finally { discoveries.delete(discovery); }
  }

  async function openBrowser(launchBrowser) {
    if (stopping) throw Object.assign(new Error('collector_stopping'), {code:'collector_stopping'});
    if (!opening) opening=Promise.resolve().then(launchBrowser).finally(()=>{opening=null;});
    return opening;
  }

  async function stop(closeBrowser) {
    if (stopPromise) return stopPromise;
    stopping = true;
    if (owner) pause(owner);
    stopPromise = (async () => {
      await opening?.catch(()=>{});
      await Promise.allSettled([...discoveries]);
      if (owner) pause(owner);
      await inFlight;
      return await closeBrowser?.();
    })().finally(() => { stopping=false; stopPromise=null; });
    return stopPromise;
  }

  function recoverInterrupted() {
    // Opening a server does not silently restart an old authenticated collection.
    // Keep every checkpoint and require the existing Continue action once.
    for (const job of store.listCollectionJobs({state:'running'})) {
      store.updateCollectionJob(job.id, {state:'paused', lastErrorCode:'collector_restarted',
        lastErrorMessage:'服务已重启，检查点已保存；确认专用 Chrome 后可继续回填。'});
    }
  }

  return { start, pause, resume, stop, status, recoverInterrupted, createBackfill, openBrowser };
}
