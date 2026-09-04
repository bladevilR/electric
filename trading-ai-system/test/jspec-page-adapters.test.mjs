import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { chromium } from 'playwright';
import { buildManagedBrowserLaunch } from '../lib/ukey-browser-collector.mjs';
import { createPriceAdapter } from '../lib/jspec-adapters/price.mjs';
import { createWeatherAdapter } from '../lib/jspec-adapters/weather.mjs';
import { createLoadAdapter } from '../lib/jspec-adapters/load.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(rootDir, 'test', 'fixtures', 'jspec-pages');
const executablePath = buildManagedBrowserLaunch({ rootDir }).executablePath;

function fixtureUrl(name) {
  return pathToFileURL(path.join(fixtureDir, name)).href;
}

async function withPage(run) {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  try {
    await run(page);
  } finally {
    await browser.close();
  }
}

test('load collection reports service maintenance instead of misclassifying it as no data',async()=>{
  await withPage(async page=>{
    await page.setContent('<p>您访问的服务正在维护中，请稍后再试！</p><table><tbody><tr><td>暂无数据</td></tr></tbody></table>');
    const adapter=createLoadAdapter();
    assert.equal((await adapter.detect(page)).state,'service_unavailable');
    await assert.rejects(adapter.extract(page),error=>error.code==='service_unavailable');
  });
});

test('load extraction confirms time intervals and source units and never erases a negative sign',async()=>{
  await withPage(async page=>{
    const adapter=createLoadAdapter();
    const html=(unit,value)=>`<input type="date" value="2026-02-28"><table><thead><tr><th>时间</th><th>实际电量${unit}</th></tr></thead><tbody>${Array.from({length:96},(_,i)=>`<tr><td>${i===95?'24:00':`${String(Math.floor((i+1)/4)).padStart(2,'0')}:${String((i+1)%4*15).padStart(2,'0')}`}</td><td>${value}</td></tr>`).join('')}</tbody></table>`;
    for(const [unit,value,mw] of [['(kWh)',250,1],['(MWh)',2,8]]) {
      await page.setContent(html(unit,value));
      const result=adapter.validate(await adapter.extract(page),{businessDate:'2026-02-28'});
      assert.equal(result.facts.find(f=>f.fieldId==='actualAverageLoadMw')?.value,mw);
    }
    await page.setContent(html('(kWh)',-20));
    const negative=await adapter.extract(page);
    assert.equal(negative.facts[0].value,-20);
    assert.throws(()=>adapter.validate(negative,{businessDate:'2026-02-28'}),/invalid_actual_load/);
    await page.setContent(html('',20));
    const unknownUnit=await adapter.extract(page);
    assert.throws(()=>adapter.validate(unknownUnit,{businessDate:'2026-02-28'}));
  });
});

test('production JSPEC adapters navigate through their micro-frontend base paths', async () => {
  const visited = [];
  const page = {
    url: () => 'https://www.jspec.com.cn/#/dashboard',
    goto: async (url) => visited.push(url),
  };
  await createPriceAdapter().navigate(page);
  await createLoadAdapter().navigate(page);
  assert.deepEqual(visited, [
    'https://www.jspec.com.cn/pxf-spotgoods-province-extranet/#/pxf-spotgoods-province-extranet/Dd2jyUserClearingResult/Dd2jyRqClearing',
    'https://www.jspec.com.cn/pxf-js-outer-deferrableload/#/pxf-js-outer-deferrableload/dayElectricity',
  ]);
});

test('adapter waits for a date control rendered asynchronously inside a micro-frontend frame', async () => {
  await withPage(async (page) => {
    await page.setContent(`<!doctype html><html><body>
      <iframe srcdoc="<main id='root'></main><script>setTimeout(() => { const input = document.createElement('input'); input.placeholder = '交易日期'; input.min = '2026-05-01'; input.max = '2026-07-31'; document.querySelector('#root').appendChild(input); }, 80);<\/script>"></iframe>
    </body></html>`);
    const adapter = createPriceAdapter({ dateControlTimeoutMs: 1000 });
    assert.deepEqual(await adapter.discoverBounds(page), {
      earliestDate: '2026-05-01',
      latestDate: '2026-07-31',
    });
  });
});

test('adapter supports Element Plus date controls, spaced query labels, and split tables', async () => {
  await withPage(async (page) => {
    await page.setContent(`<!doctype html><html><body>
      <input class="el-input__inner" placeholder="日期" value="2026-09-04">
      <button onclick="document.querySelector('output').textContent=document.querySelector('input').value">查 询</button>
      <output data-query-date></output>
      <div class="el-table">
        <div class="el-table__header-wrapper"><table><thead><tr>
          <th>时间</th><th>出清电力</th><th>统一结算点电价临时结果</th><th>统一结算点电价最终结果</th>
        </tr></thead></table></div>
        <div class="el-table__body-wrapper"><table><tbody>
          <tr><td>00:15</td><td>59.8</td><td>366.4</td><td>366.4</td></tr>
          <tr><td>00:30</td><td>59.8</td><td>361.4</td><td>361.4</td></tr>
        </tbody></table></div>
      </div>
    </body></html>`);
    const adapter = createPriceAdapter({
      expectedPointCount: 2,
      earliestDate: '2024-01-01',
      latestDate: '2026-09-03',
    });
    assert.deepEqual(await adapter.discoverBounds(page), {
      earliestDate: '2024-01-01',
      latestDate: '2026-09-03',
    });
    await adapter.setQuery(page, { businessDate: '2026-09-02' });
    await adapter.submit(page);
    const result = adapter.validate(await adapter.extract(page, {
      businessDate: '2026-09-02',
      capturedAt: '2026-09-03T10:00:00.000Z',
    }), { businessDate: '2026-09-02' });
    assert.equal(result.queryDate, '2026-09-02');
    assert.equal(result.facts.filter((fact) => fact.fieldId === 'dayAheadUserPriceFinalYuanPerMwh').length, 2);
    assert.equal(result.facts[0].pointIndex, 1);
  });
});

test('visible result rows take precedence over a stale empty-state message', async () => {
  await withPage(async (page) => {
    await page.setContent(`<!doctype html><html><body>
      <div class="el-table__empty-text">暂无数据</div>
      <table><tbody><tr><td>00:15</td><td>366.4</td></tr></tbody></table>
    </body></html>`);
    const adapter = createPriceAdapter({ resultTimeoutMs: 100 });
    assert.deepEqual(await adapter.waitForResult(page), { state: 'ready' });
  });
});

test('price submit waits for the JSPEC query response before extraction', async () => {
  await withPage(async (page) => {
    await page.route('https://fixture.test/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.setContent(`<!doctype html><html><body>
      <button onclick="fetch('https://fixture.test/px-spotgoods-province/Dd2jyUserClearingResult/queryDd2jyRqClearing').then(() => setTimeout(() => document.querySelector('output').textContent='done', 80))">查 询</button>
      <output></output>
    </body></html>`);
    const adapter = createPriceAdapter({
      responseUrlPattern: /Dd2jyUserClearingResult\/queryDd2jyRqClearing/i,
      postSubmitSettleMs: 120,
    });
    await adapter.submit(page);
    assert.equal(await page.locator('output').textContent(), 'done');
  });
});

test('price submit rejects an HTTP-200 JSPEC response that contains a rate-limit warning', async () => {
  await withPage(async (page) => {
    await page.route('https://fixture.test/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"message":"API访问频率过高，请稍后重试"}',
    }));
    await page.setContent(`<!doctype html><html><body>
      <button onclick="fetch('https://fixture.test/px-spotgoods-province/Dd2jyUserClearingResult/queryDd2jyRqClearing')">查 询</button>
    </body></html>`);
    const adapter = createPriceAdapter({
      responseUrlPattern: /Dd2jyUserClearingResult\/queryDd2jyRqClearing/i,
    });
    await assert.rejects(() => adapter.submit(page), (error) => error.code === 'rate_limited');
  });
});

test('load adapter sets both start and end date controls for a one-day query', async () => {
  await withPage(async (page) => {
    await page.setContent(`<!doctype html><html><body>
      <label>开始时间：<input placeholder="选择日期"></label>
      <label>结束时间：<input placeholder="选择日期"></label>
    </body></html>`);
    const adapter = createLoadAdapter();
    await adapter.setQuery(page, { businessDate: '2026-09-02' });
    assert.deepEqual(await page.locator('input').evaluateAll((inputs) => inputs.map((input) => input.value)), [
      '2026-09-02',
      '2026-09-02',
    ]);
  });
});

test('price, weather, and load adapters query dates and extract typed facts', async () => {
  await withPage(async (page) => {
    const cases = [
      {
        adapter: createPriceAdapter({ url: fixtureUrl('price.html'), expectedPointCount: 4 }),
        fieldId: 'dayAheadUserPriceFinalYuanPerMwh',
        firstValue: 342.3,
        unit: '元/MWh',
      },
      {
        adapter: createWeatherAdapter({ url: fixtureUrl('weather.html'), expectedPointCount: 4 }),
        fieldId: 'temperatureForecastC',
        firstValue: 29.1,
        unit: '°C',
      },
      {
        adapter: createLoadAdapter({ url: fixtureUrl('load.html'), expectedPointCount: 4 }),
        fieldId: 'loadForecastMw',
        firstValue: 1165,
        unit: 'MW',
      },
    ];

    for (const item of cases) {
      await item.adapter.navigate(page);
      assert.deepEqual(await item.adapter.discoverBounds(page), {
        earliestDate: '2026-05-01',
        latestDate: '2026-07-31',
      });
      await item.adapter.setQuery(page, { businessDate: '2026-07-31' });
      await item.adapter.submit(page);
      await item.adapter.waitForResult(page);
      const result = await item.adapter.extract(page, {
        businessDate: '2026-07-31',
        capturedAt: '2026-09-03T10:00:00.000Z',
      });
      const validated = item.adapter.validate(result, { businessDate: '2026-07-31' });
      const fact = validated.facts.find((row) => row.fieldId === item.fieldId && row.pointIndex === 1);
      assert.equal(fact.value, item.firstValue);
      assert.equal(fact.unit, item.unit);
      assert.equal(validated.coverageByField[item.fieldId], 4);
      assert.match(validated.structureFingerprint, /^[a-f0-9]{64}$/);
    }
  });
});

test('adapter rejects a result whose visible query date differs from the requested date', async () => {
  await withPage(async (page) => {
    const adapter = createPriceAdapter({ url: fixtureUrl('price.html'), expectedPointCount: 4 });
    await adapter.navigate(page);
    const result = await adapter.extract(page, {
      businessDate: '2026-07-31',
      capturedAt: '2026-09-03T10:00:00.000Z',
    });
    assert.throws(() => adapter.validate(result, { businessDate: '2026-07-31' }), (error) => {
      assert.equal(error.code, 'query_date_mismatch');
      return true;
    });
  });
});

test('adapter identifies login expiry, rate limiting, and required column changes', async () => {
  await withPage(async (page) => {
    const adapter = createPriceAdapter({ expectedPointCount: 1 });

    await page.goto(fixtureUrl('login.html'));
    await assert.rejects(() => adapter.waitForResult(page), (error) => error.code === 'login_expired');

    await page.goto(fixtureUrl('rate-limit.html'));
    await assert.rejects(() => adapter.waitForResult(page), (error) => error.code === 'rate_limited');

    await page.goto(fixtureUrl('missing-column.html'));
    const result = await adapter.extract(page, {
      businessDate: '2026-07-30',
      capturedAt: '2026-09-03T10:00:00.000Z',
    });
    assert.throws(() => adapter.validate(result, { businessDate: '2026-07-30' }), (error) => {
      assert.equal(error.code, 'required_column_missing');
      return true;
    });
  });
});

test('adapter advances visible pagination without treating a disabled button as another page', async () => {
  await withPage(async (page) => {
    const adapter = createPriceAdapter({ url: fixtureUrl('pagination.html'), expectedPointCount: 2 });
    await adapter.navigate(page);
    const first = adapter.validate(await adapter.extract(page, {
      businessDate: '2026-07-30',
      capturedAt: '2026-09-03T10:00:00.000Z',
    }), { businessDate: '2026-07-30' });
    assert.deepEqual(first.facts.map((fact) => fact.pointIndex), [1, 2]);
    assert.equal(await adapter.nextPage(page), true);
    const second = adapter.validate(await adapter.extract(page, {
      businessDate: '2026-07-30',
      capturedAt: '2026-09-03T10:00:00.000Z',
    }), { businessDate: '2026-07-30' });
    assert.deepEqual(second.facts.map((fact) => fact.pointIndex), [3, 4]);
    assert.equal(await adapter.nextPage(page), false);
  });
});
