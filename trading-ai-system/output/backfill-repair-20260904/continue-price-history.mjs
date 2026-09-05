import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const defaultProgressPath = new URL('./collection-progress-20260904.json', import.meta.url);
const activePages = new WeakSet();
const hash = text => createHash('sha256').update(text).digest('hex');
const dayBefore = day => new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

export async function continuePriceHistory(options) {
  if (activePages.has(options.page)) throw new Error('已有采集正在使用这个页面');
  activePages.add(options.page);
  try { return await collectRange(options); } finally { activePages.delete(options.page); }
}

async function collectRange({page, store, adapter, fromDate, toDate, control = {stop: false}, intervalMs = 45000, ownerPath, profileDir,
  progressPath = defaultProgressPath, sleep = ms => new Promise(resolve=>setTimeout(resolve,ms))}) {
  let previous;
  try { previous = JSON.parse(await readFile(progressPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.nextAttemptAt && Date.parse(previous.nextAttemptAt) > Date.now()) return previous;
  const state = {
    workerPid: process.pid, profileDir, phase: 'collecting', source: '日前电价', fromDate, toDate,
    startedAt: new Date().toISOString(), updatedAt: null, currentDate: toDate,
    collectedDays: 0, skippedCoveredDays: 0, emptyDates: [], error: null, nextAttemptAt: null,
  };
  async function checkpoint() {
    state.updatedAt = new Date().toISOString();
    const temporary = progressPath instanceof URL ? new URL(`${progressPath.href}.partial`) : `${progressPath}.partial`;
    await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
    await rename(temporary, progressPath);
    if (ownerPath) {
      await writeFile(`${ownerPath}.partial`, JSON.stringify(state), 'utf8');
      await rename(`${ownerPath}.partial`, ownerPath);
    }
  }
  await checkpoint();
  for (let date = toDate; date >= fromDate; date = dayBefore(date)) {
    state.currentDate = date;
    if (control.stop) { state.phase = 'paused'; break; }
    const existing = store.queryFacts({fieldId:'dayAheadUserPriceFinalYuanPerMwh',businessDate:date,limit:10000});
    if (new Set(existing.filter(f=>Number.isInteger(f.pointIndex)&&f.pointIndex>=1&&f.pointIndex<=96&&Number.isFinite(f.value)).map(f=>f.pointIndex)).size === 96) {
      state.skippedCoveredDays += 1;
      await checkpoint();
      continue;
    }
    const cooldown = store.collectionRetryAt(new Date().toISOString());
    if (cooldown) {
      state.phase = 'waiting'; state.nextAttemptAt = cooldown; await checkpoint(); return state;
    }
    await sleep(Math.max(intervalMs, 45000));
    if (control.stop) { state.phase = 'paused'; break; }
    try {
      await adapter.setQuery(page, {businessDate:date});
      await adapter.submit(page);
      await adapter.waitForResult(page);
      const result = adapter.validate(await adapter.extract(page, {businessDate:date}), {businessDate:date});
      store.transaction(() => {
        store.appendCapture({sourceId:result.sourceId,businessDate:date,pageUrl:result.pageUrl,capturedAt:result.capturedAt,
          rowCount:result.facts.length,accepted:true,structureFingerprint:result.structureFingerprint,contentSha256:result.contentSha256,
          evidence:{operationId:'full-collection-20260904-evening',queryDate:date,headers:result.headers,coverageByField:result.coverageByField}});
        store.appendFacts(result.facts);
      });
      state.collectedDays += 1;
      console.log('PRICE_COLLECTED', date, 96);
    } catch (error) {
      const reasonCode = error.code || 'collection_failed';
      const reason = {
        login_expired:'登录已失效，暂停等待重新验证。', access_denied:'平台拒绝访问，停止请求并等待核查。',
        rate_limited:'平台要求降低频率，等待冷却后再检查。', service_unavailable:'平台服务维护中，当前日期尚未取得。',
        no_data:'平台明确返回本次查询无记录。', coverage_incomplete:'返回数据不完整，保留原始日期等待核查。',
      }[reasonCode] || '查询未能确认成功，停止请求等待核查。';
      if (reasonCode !== 'no_data') {
        state.phase = reasonCode === 'rate_limited' ? 'waiting' : 'paused';
        state.error = {date,reasonCode,reason};
        if (['rate_limited','service_unavailable'].includes(reasonCode)) {
          state.nextAttemptAt = new Date(Math.max(Date.now()+1800000,Date.parse(error.details?.retryAt)||0)).toISOString();
        }
        // Preserve a stop/cooldown even if the database is locked or unavailable.
        await checkpoint();
      }
      const capturedAt = new Date().toISOString();
      store.appendCapture({sourceId:adapter.sourceId,businessDate:date,pageUrl:page.url(),capturedAt,rowCount:0,accepted:false,
        contentSha256:hash(`${date}|${reasonCode}|${capturedAt}`),evidence:{operationId:'full-collection-20260904-evening',queryDate:date,reasonCode,reason,
          ...(state.nextAttemptAt ? {retryAt:state.nextAttemptAt} : {})}});
      if (reasonCode === 'no_data') state.emptyDates.push(date);
      else return state;
    }
    await checkpoint();
  }
  if (!control.stop) state.phase = 'range_checked';
  await checkpoint();
  return state;
}
