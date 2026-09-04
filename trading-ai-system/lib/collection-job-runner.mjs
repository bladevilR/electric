import { createHash, randomUUID } from 'node:crypto';

const PAUSE_CODES = new Set(['login_expired', 'required_column_missing', 'query_date_mismatch', 'page_changed', 'date_control_missing', 'service_unavailable']);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function assertDate(value, field = 'business_date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) throw new Error(`${field}_invalid`);
  return String(value);
}

function dateMs(value) {
  return Date.parse(`${assertDate(value)}T00:00:00.000Z`);
}

function nextDate(value) {
  return new Date(dateMs(value) + 86400000).toISOString().slice(0, 10);
}

function laterDate(left, right) {
  return dateMs(left) >= dateMs(right) ? left : right;
}

function earlierDate(left, right) {
  return dateMs(left) <= dateMs(right) ? left : right;
}

function monthSegments(earliestDate, latestDate) {
  const start = assertDate(earliestDate, 'earliest_date');
  const end = assertDate(latestDate, 'latest_date');
  if (dateMs(start) > dateMs(end)) throw new Error('collection_range_invalid');
  const segments = [];
  let cursor = start;
  while (dateMs(cursor) <= dateMs(end)) {
    const monthKey = cursor.slice(0, 7);
    const [year, month] = monthKey.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const segmentEnd = earlierDate(monthEnd, end);
    segments.push({ monthKey, startDate: cursor, endDate: segmentEnd });
    cursor = nextDate(segmentEnd);
  }
  return segments;
}

function errorWithCode(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function operationalState(status) {
  return ['ready', 'collecting'].includes(status?.state);
}

function combinePages(results, businessDate) {
  const first = results[0] || {};
  const facts = results.flatMap((result) => result.facts || []);
  const mappedFields = [...new Set(results.flatMap((result) => result.mappedFields || []))];
  const headers = [...new Set(results.flatMap((result) => result.headers || []))];
  const signatures = results.map((result) => `${result.structureFingerprint}:${result.contentSha256}`).join('|');
  return {
    ...first,
    queryDate: first.queryDate || businessDate,
    headers,
    mappedFields,
    facts,
    structureFingerprint: sha256(results.map((result) => result.structureFingerprint).join('|')),
    contentSha256: sha256(signatures),
  };
}

export function createCollectionJobRunner(options = {}) {
  const store = options.store;
  const runtime = options.runtime;
  const adapters = Array.isArray(options.adapters) ? options.adapters : [];
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const sleep = typeof options.sleep === 'function' ? options.sleep : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const queryDelayMs = Math.max(Number(options.queryDelayMs ?? 20000), 0);
  if (!store || typeof store.createCollectionJob !== 'function') throw new Error('evidence_store_required');
  if (!runtime || typeof runtime.getPage !== 'function') throw new Error('collector_runtime_required');
  if (!adapters.length) throw new Error('collector_adapters_required');
  const adapterBySource = new Map(adapters.map((adapter) => [adapter.sourceId, adapter]));
  let creating = null;
  let executing = null;

  async function pace() {
    if (queryDelayMs > 0) {
      const jitter = Math.round(queryDelayMs * 0.2 * (random() * 2 - 1));
      await sleep(Math.max(0, queryDelayMs + jitter));
    }
  }

  async function requireReady() {
    const started = await runtime.start();
    const checked = operationalState(started) ? started : await runtime.healthCheck().catch(() => started);
    if (!operationalState(checked)) throw errorWithCode(checked?.state || 'collector_not_ready', `Collector is ${checked?.state || 'not ready'}.`);
    return runtime.getPage();
  }

  async function createFullBackfill(input = {}) {
    // Concurrent HTTP requests must not navigate the shared Chrome at the same time.
    if (creating) await creating;
    const unfinished = store.listCollectionJobs().filter(job => ['running', 'paused'].includes(job.state));
    const existing = unfinished.find(job => job.state === 'running') || unfinished[0];
    if (existing) {
      if ((!input.id || input.id === existing.id) && (!input.fromDate || input.fromDate === existing.earliestDate)
        && (!input.toDate || input.toDate === existing.latestDate)) return { ...status(existing.id), reused: true };
      throw errorWithCode('collection_job_active');
    }
    if (executing) throw errorWithCode('collection_job_active');
    creating = createJob(input);
    try { return await creating; } finally { creating = null; }
  }

  async function createJob(input) {
    const page = await requireReady();
    const requestedFrom = input.fromDate ? assertDate(input.fromDate, 'from_date') : null;
    const requestedTo = input.toDate ? assertDate(input.toDate, 'to_date') : null;
    if (requestedFrom && requestedTo && dateMs(requestedFrom) > dateMs(requestedTo)) {
      throw errorWithCode('collection_range_invalid');
    }
    const discovered = [];
    for (const adapter of adapters) {
      await adapter.navigate(page);
      const bounds = await adapter.discoverBounds(page);
      const earliestDate = requestedFrom ? laterDate(bounds.earliestDate, requestedFrom) : bounds.earliestDate;
      const latestDate = requestedTo ? earlierDate(bounds.latestDate, requestedTo) : bounds.latestDate;
      if (dateMs(earliestDate) > dateMs(latestDate)) throw errorWithCode('collection_range_invalid');
      discovered.push({ adapter, earliestDate, latestDate });
    }
    const earliestDate = discovered.map((item) => item.earliestDate).reduce(earlierDate);
    const latestDate = discovered.map((item) => item.latestDate).reduce(laterDate);
    const chunks = discovered.flatMap((item) => monthSegments(item.earliestDate, item.latestDate).map((segment) => ({
      ...segment,
      id: `${input.id || 'job'}:${item.adapter.id}:${segment.monthKey}`,
      sourceId: item.adapter.sourceId,
    })));
    const job = store.createCollectionJob({
      id: input.id || randomUUID(),
      mode: 'full_backfill',
      state: 'running',
      earliestDate,
      latestDate,
      totalChunks: chunks.length,
    });
    for (const chunk of chunks) {
      store.upsertCollectionChunk({
        ...chunk,
        id: `${job.id}:${chunk.sourceId}:${chunk.monthKey}`,
        jobId: job.id,
        state: 'pending',
        cursorDate: chunk.startDate,
      });
    }
    return {
      ...job,
      monthKeys: [...new Set(chunks.map((chunk) => chunk.monthKey))].sort(),
      sourceIds: [...new Set(chunks.map((chunk) => chunk.sourceId))].sort(),
    };
  }

  function status(jobId) {
    const job = store.getCollectionJob(jobId);
    if (!job) throw errorWithCode('collection_job_not_found');
    const chunks = store.listCollectionChunks(jobId);
    const completedChunks = chunks.filter((chunk) => chunk.state === 'completed').length;
    const failedChunks = chunks.filter((chunk) => chunk.state === 'failed').length;
    const dayProgress = { total: 0, processed: 0, accepted: 0, noData: 0, unverified: 0 };
    for (const chunk of chunks) {
      const days = Math.round((dateMs(chunk.endDate) - dateMs(chunk.startDate)) / 86400000) + 1;
      dayProgress.total += days;
      dayProgress.processed += chunk.state === 'completed' ? days
        : Math.min(days, Math.max(0, Math.round((dateMs(chunk.cursorDate || chunk.startDate) - dateMs(chunk.startDate)) / 86400000)));
    }
    for (const outcome of store.collectionDateOutcomes(jobId)) {
      const committed = chunks.some(chunk => chunk.sourceId === outcome.sourceId && outcome.businessDate >= chunk.startDate
        && outcome.businessDate <= chunk.endDate && (chunk.state === 'completed' || outcome.businessDate < chunk.cursorDate));
      if (!committed) continue;
      if (outcome.accepted) dayProgress.accepted += 1;
      else if (outcome.noData) dayProgress.noData += 1;
    }
    dayProgress.unverified = Math.max(0, dayProgress.processed - dayProgress.accepted - dayProgress.noData);
    const active = chunks.find(chunk => chunk.state === 'rate_limited')
      || chunks.find(chunk => chunk.state === 'paused') || chunks.find(chunk => !['completed', 'failed'].includes(chunk.state));
    const cooldown = [...chunks.filter(chunk => chunk.nextAttemptAt && Date.parse(chunk.nextAttemptAt) > Date.parse(clock()))
      .map(chunk => chunk.nextAttemptAt), store.collectionRetryAt(clock())].filter(Boolean).sort().at(-1) || null;
    return {
      ...job,
      completedChunks,
      failedChunks,
      progressPct: dayProgress.total ? Math.floor(dayProgress.processed / dayProgress.total * 10000) / 100 : 0,
      dayProgress,
      currentSourceId: active?.sourceId || null,
      currentDate: active?.cursorDate || active?.startDate || null,
      nextAttemptAt: cooldown,
      lastErrorCode: job.lastErrorCode || active?.lastErrorCode || null,
      lastErrorMessage: job.lastErrorMessage || active?.lastErrorMessage || null,
      chunks,
    };
  }

  function refreshProgress(jobId) {
    const current = status(jobId);
    const completed = current.completedChunks === current.totalChunks && current.totalChunks > 0;
    return store.updateCollectionJob(jobId, {
      state: completed ? 'completed' : current.state,
      completedChunks: current.completedChunks,
      failedChunks: current.failedChunks,
    });
  }

  async function runNext(jobId) {
    if (creating || executing) throw errorWithCode('collection_job_active');
    executing = jobId;
    try { return await runDay(jobId); } finally { executing = null; }
  }

  async function runDay(jobId) {
    const job = store.getCollectionJob(jobId);
    if (!job) throw errorWithCode('collection_job_not_found');
    if (job.state === 'paused') throw errorWithCode('collection_job_paused');
    if (job.state === 'completed') return status(jobId);
    // A platform throttle applies to the whole browser session, not just one date.
    const current = status(jobId);
    if (current.nextAttemptAt) return current;
    const now = clock();
    const chunk = store.listCollectionChunks(jobId).find((candidate) =>
      ['pending', 'running', 'rate_limited'].includes(candidate.state) &&
      (!candidate.nextAttemptAt || Date.parse(candidate.nextAttemptAt) <= Date.parse(now))
    );
    if (!chunk) {
      refreshProgress(jobId);
      return status(jobId);
    }
    const adapter = adapterBySource.get(chunk.sourceId);
    if (!adapter) throw errorWithCode('collection_adapter_missing', chunk.sourceId);
    const businessDate = chunk.cursorDate || chunk.startDate;
    let page;
    try {
      page = await requireReady();
      runtime.transition('collecting');
      await adapter.navigate(page);
      await adapter.setQuery(page, { businessDate });
      await adapter.submit(page);
      await adapter.waitForResult(page);
      const pageResults = [];
      for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
        pageResults.push(await adapter.extract(page, { businessDate, capturedAt: now }));
        if (!await adapter.nextPage(page)) break;
        if (pageIndex === 99) throw errorWithCode('pagination_limit_exceeded');
      }
      const validated = adapter.validate(combinePages(pageResults, businessDate), { businessDate });
      const followingDate = nextDate(businessDate);
      const isComplete = dateMs(followingDate) > dateMs(chunk.endDate);
      store.transaction(() => {
        store.appendCapture({
          id: `${jobId}:${chunk.sourceId}:${businessDate}:${validated.contentSha256}`,
          sourceId: chunk.sourceId,
          businessDate,
          pageUrl: validated.pageUrl,
          capturedAt: now,
          rowCount: validated.facts.length,
          accepted: true,
          structureFingerprint: validated.structureFingerprint,
          contentSha256: validated.contentSha256,
          evidence: {
            jobId,
            adapterId: adapter.id,
            pageTitle: validated.pageTitle,
            queryDate: validated.queryDate,
            headers: validated.headers,
            mappedFields: validated.mappedFields,
            coverageByField: validated.coverageByField,
            sourceEvidence: validated.evidence || null,
          },
        });
        store.appendFacts(validated.facts);
        store.upsertCollectionChunk({
          ...chunk,
          state: isComplete ? 'completed' : 'running',
          cursorDate: isComplete ? chunk.endDate : followingDate,
          attemptCount: 0,
          nextAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        });
      });
      refreshProgress(jobId);
      if (store.getCollectionJob(jobId).state === 'running') store.updateCollectionJob(jobId, {lastErrorCode:null,lastErrorMessage:null});
      runtime.transition(store.getCollectionJob(jobId).state === 'paused' ? 'paused' : 'ready');
      await pace();
      return status(jobId);
    } catch (error) {
      const code = error?.code || 'collection_failed';
      const message = error?.message || String(error);
      const attemptCount = Number(chunk.attemptCount || 0) + 1;
      if (code === 'no_data') {
        const followingDate = nextDate(businessDate);
        const isComplete = dateMs(followingDate) > dateMs(chunk.endDate);
        const pageUrl = typeof page?.url === 'function' ? page.url() : `collector-source:${chunk.sourceId}`;
        store.transaction(() => {
          store.appendCapture({
            id: `${jobId}:${chunk.sourceId}:${businessDate}:no-data`,
            sourceId: chunk.sourceId,
            businessDate,
            pageUrl,
            capturedAt: now,
            rowCount: 0,
            accepted: false,
            contentSha256: sha256(`${chunk.sourceId}|${businessDate}|no_data`),
            evidence: { jobId, adapterId: adapter.id, queryDate: businessDate, reasonCode: 'no_data' },
          });
          store.upsertCollectionChunk({
            ...chunk,
            state: isComplete ? 'completed' : 'running',
            cursorDate: isComplete ? chunk.endDate : followingDate,
            attemptCount: 0,
            nextAttemptAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          });
        });
        refreshProgress(jobId);
        if (store.getCollectionJob(jobId).state === 'running') store.updateCollectionJob(jobId, {lastErrorCode:null,lastErrorMessage:null});
        runtime.transition(store.getCollectionJob(jobId).state === 'paused' ? 'paused' : 'ready');
        await pace();
        return status(jobId);
      } else if (code === 'rate_limited') {
        const delayMs = Math.min(60000 * (2 ** (attemptCount - 1)), 1800000);
        store.upsertCollectionChunk({
          ...chunk,
          state: 'rate_limited',
          attemptCount,
          nextAttemptAt: new Date(Date.parse(clock()) + delayMs).toISOString(),
          lastErrorCode: code,
          lastErrorMessage: message,
        });
        runtime.transition(store.getCollectionJob(jobId).state === 'paused' ? 'paused' : 'rate_limited', { errorCode: code, errorMessage: message });
      } else if (PAUSE_CODES.has(code)) {
        if (code === 'service_unavailable') store.appendCapture({
          id: `${jobId}:${chunk.sourceId}:${businessDate}:service-unavailable:${attemptCount}`,
          sourceId:chunk.sourceId,businessDate,pageUrl:typeof page?.url === 'function' ? page.url() : `collector-source:${chunk.sourceId}`,
          capturedAt:now,rowCount:0,accepted:false,contentSha256:sha256(`${chunk.sourceId}|${businessDate}|${code}|${now}`),
          evidence:{jobId,adapterId:adapter.id,queryDate:businessDate,reasonCode:code,reason:'平台接口维护；未成功获取数据，不代表该日期无数据。'},
        });
        store.upsertCollectionChunk({ ...chunk, state: 'paused', attemptCount, lastErrorCode: code, lastErrorMessage: message });
        store.updateCollectionJob(jobId, { state: 'paused', lastErrorCode: code, lastErrorMessage: message });
        runtime.transition(code === 'login_expired' ? 'login_expired' : code === 'service_unavailable' ? 'error' : 'page_changed', { errorCode: code, errorMessage: message });
      } else {
        store.upsertCollectionChunk({
          ...chunk,
          state: 'pending',
          attemptCount,
          nextAttemptAt: new Date(Date.parse(now) + 60000).toISOString(),
          lastErrorCode: code,
          lastErrorMessage: message,
        });
        store.updateCollectionJob(jobId, { ...(attemptCount >= 3 ? {state:'paused'} : {}), lastErrorCode: code, lastErrorMessage: message });
        runtime.transition('error', { errorCode: code, errorMessage: message });
      }
      throw error;
    }
  }

  function pause(jobId) {
    if (['completed', 'failed'].includes(status(jobId).state)) return status(jobId);
    const updated = store.updateCollectionJob(jobId, { state: 'paused', lastErrorCode: 'operator_paused', lastErrorMessage: null });
    runtime.transition('paused');
    return { ...status(jobId), ...updated };
  }

  function resume(jobId) {
    if (creating || (executing && executing !== jobId)) throw errorWithCode('collection_job_active');
    if (['completed', 'failed'].includes(status(jobId).state)) return status(jobId);
    if (store.listCollectionJobs({state:'running'}).some(job => job.id !== jobId)) throw errorWithCode('collection_job_active');
    for (const chunk of store.listCollectionChunks(jobId)) {
      if (chunk.state === 'paused') store.upsertCollectionChunk({...chunk,state:'pending',nextAttemptAt:null,lastErrorCode:null,lastErrorMessage:null});
    }
    const updated = store.updateCollectionJob(jobId, { state: 'running', lastErrorCode: null, lastErrorMessage: null });
    runtime.transition('ready');
    return { ...status(jobId), ...updated };
  }

  return { createFullBackfill, runNext, pause, resume, status };
}

export { monthSegments };
