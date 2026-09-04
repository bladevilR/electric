import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const systemRoot = fileURLToPath(new URL('..', import.meta.url));
const chromeExecutable = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const firstDate = '2026-06-24';
const targetDate = '2026-06-29';

function mockBusinessPage() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>模拟电力交易平台</title></head>
  <body data-jspec-page="business"><h1>电力交易工作台</h1>
  <label>交易日期 <input id="tradeDate" type="date" min="${firstDate}" max="${targetDate}" value="${targetDate}"></label>
  <button id="queryButton" type="button">查询</button><p>查询日期：<output id="queryDate">${targetDate}</output></p><div id="result"></div>
  <script>
    function render(){
      const day=Number(tradeDate.value.slice(-2));
      const load=location.hash.includes('dayElectricity');
      result.innerHTML=load
        ? '<table><thead><tr><th>点位</th><th>实际负荷（MW）</th><th>负荷预测（MW）</th></tr></thead><tbody><tr><td>1</td><td>'+(980+day)+'</td><td>'+(1000+day)+'</td></tr><tr><td>2</td><td>'+(990+day)+'</td><td>'+(1015+day)+'</td></tr></tbody></table>'
        : '<table><thead><tr><th>点位</th><th>统一结算点电价最终结果</th></tr></thead><tbody><tr><td>1</td><td>'+(300+day)+'</td></tr><tr><td>2</td><td>'+(320+day)+'</td></tr></tbody></table>';
    }
    queryButton.addEventListener('click',()=>{queryDate.value=tradeDate.value;render();});
    addEventListener('hashchange',render);render();
  </script></body></html>`;
}

async function startMockPlatform() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/weather/')) {
      const date = url.searchParams.get('start_date');
      const isForecast = url.pathname.endsWith('/forecast');
      const field = isForecast ? 'temperature_2m_previous_day1' : 'temperature_2m';
      const times = Array.from({ length: 24 }, (_, hour) => `${date}T${String(hour).padStart(2, '0')}:00`);
      const values = Array.from({ length: 24 }, (_, hour) => 20 + hour * 0.2 + (isForecast ? 0 : 0.4));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ hourly: { time: times, [field]: values } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(mockBusinessPage());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() { server.close(); await once(server, 'close'); },
  };
}

async function startApplication(directory, platform) {
  // Let Windows choose an available non-reserved port instead of guessing a
  // port from a range that may be reserved by Hyper-V / system services.
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const args = [
    '--no-warnings', 'server.mjs', '--port', String(port),
    '--standard', path.join(systemRoot, 'data', 'standard-96.sample.json'),
    '--evidence-store', path.join(directory, 'evidence.sqlite'),
    '--collector-profile', path.join(directory, 'chrome-profile'),
    '--collector-launch-url', platform.baseUrl,
    '--collector-executable', chromeExecutable,
    '--collector-headless', 'true',
    '--collector-query-delay-ms', '0',
    '--expected-point-count', '2',
    '--weather-earliest', firstDate,
    '--weather-latest', targetDate,
    '--weather-forecast-endpoint', `${platform.baseUrl}/weather/forecast`,
    '--weather-archive-endpoint', `${platform.baseUrl}/weather/archive`,
    '--audit', path.join(directory, 'audit.ndjson'),
    '--visible-snapshot', path.join(directory, 'visible.json'),
    '--visible-history', path.join(directory, 'history.json'),
    '--point-in-time-store', path.join(directory, 'point.json'),
    '--forecast-ledger', path.join(directory, 'forecast.json'),
    '--outcome-ledger', path.join(directory, 'outcome.json'),
  ];
  const child = spawn(process.execPath, args, { cwd: systemRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdout.on('data', (chunk) => { if (chunk.toString().includes('Trading AI System running at')) resolve(); });
    child.on('exit', (code) => reject(new Error(`application exited ${code}: ${stderr}`)));
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await fetch(`http://127.0.0.1:${port}/api/collector/browser/stop`, { method: 'POST' }).catch(() => {});
      child.kill();
      await once(child, 'exit').catch(() => {});
    },
  };
}

async function json(response) {
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
}

async function waitForJob(baseUrl, jobId) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const body = await json(await fetch(`${baseUrl}/api/collector/jobs/${encodeURIComponent(jobId)}`));
    if (body.job.state === 'completed') return body.job;
    if (body.job.state === 'paused' || body.job.state === 'failed') throw new Error(`job stopped: ${JSON.stringify(body.job)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('collection job timeout');
}

test('Playwright collects history, publishes a forecast, evaluates actuals, and renders the evidence workbench', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'playwright-evidence-loop-'));
  const platform = await startMockPlatform();
  let application;
  let browser;
  try {
    application = await startApplication(directory, platform);
    const backfill = await json(await fetch(`${application.baseUrl}/api/collector/jobs/backfill`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    const completed = await waitForJob(application.baseUrl, backfill.job.id);
    assert.equal(completed.progressPct, 100);

    const published = await json(await fetch(`${application.baseUrl}/api/forecast/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetDate }),
    }));
    assert.equal(published.run.rows.length, 2);
    await json(await fetch(`${application.baseUrl}/api/forecast/outcomes/backfill`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: targetDate, to: targetDate }),
    }));
    const accuracy = await json(await fetch(`${application.baseUrl}/api/forecast/accuracy?from=${targetDate}&to=${targetDate}`));
    assert.equal(accuracy.sampleCoverage.pairs, 2);
    assert.ok(Number.isFinite(accuracy.metrics.mae));

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${application.baseUrl}/?view=data-sources`, { waitUntil: 'networkidle' });
    await page.locator('[data-foundation-date]').fill(targetDate);
    await page.locator('[data-foundation-date]').dispatchEvent('change');
    await page.waitForSelector('[data-series-role="forecast"]');
    assert.match(await page.locator('[data-foundation-root]').innerText(), /Open-Meteo/);
    assert.match(await page.locator('[data-foundation-root]').innerText(), /基础数据历史/);
    assert.ok(await page.locator('.foundation-history-table tbody tr').count() > 0);
    assert.notEqual((await page.locator('.foundation-metric > strong').first().innerText()).trim(), '—');
  } finally {
    if (browser) await browser.close();
    await application?.close();
    await platform.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('live status refresh preserves the selected tab, unsaved filters and focus, and recovers from disconnects', {timeout:60000}, async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'collector-poll-browser-'));
  const platform=await startMockPlatform();
  let application, browser;
  try {
    application=await startApplication(directory,platform);
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    let processed=1, offline=false;
    await page.route('**/api/collector/status',async route=>{
      if(offline) return route.abort('connectionrefused');
      return route.fulfill({json:{observedAt:new Date().toISOString(),browser:{state:'ready'},jobs:[{id:'ui-job',state:'running',totalChunks:1,completedChunks:0,progressPct:processed,
        dayProgress:{total:100,processed,accepted:processed,noData:0,unverified:0},currentDate:'2026-07-02',currentSourceId:'JSPEC-LOAD',scheduler:{phase:'collecting'}}]}});
    });
    await page.goto(`${application.baseUrl}/?view=data-sources`,{waitUntil:'networkidle'});
    await page.getByRole('tab',{name:'负荷预测'}).click();
    const input=page.locator('[data-foundation-date]');
    // Set without a change event, as a user who has not yet submitted an edit.
    await input.evaluate(element=>{element.value='2026-07-13';element.focus();});
    processed=2;
    await page.waitForFunction(()=>document.querySelector('.foundation-truth-strip')?.textContent.includes('已查询 2/100'),{},{timeout:12000});
    assert.equal(await input.inputValue(),'2026-07-13');
    assert.equal(await input.evaluate(element=>document.activeElement===element),true);
    assert.equal(await page.getByRole('tab',{name:'负荷预测'}).getAttribute('aria-selected'),'true');
    offline=true;
    await page.waitForFunction(()=>document.querySelector('.foundation-collector-freshness')?.textContent.includes('状态更新失败'),{},{timeout:12000});
    offline=false; processed=3;
    await page.waitForFunction(()=>document.querySelector('.foundation-truth-strip')?.textContent.includes('已查询 3/100'),{},{timeout:12000});
    assert.doesNotMatch(await page.locator('.foundation-collector-freshness').innerText(),/状态更新失败/);
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await application?.close();await platform.close();await rm(directory,{recursive:true,force:true});}
});
