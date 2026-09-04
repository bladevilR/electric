import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
const verified=[];
try {
  const page=await browser.newPage({viewport:{width:1560,height:1080}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{if(route.request().method()!=='GET')throw new Error('Read-only verification attempted a write');await route.continue();});
  async function ready(date,type='price') {
    await page.waitForFunction(({date,type})=>{
      const el=document.querySelector('[data-review-report]');
      return el?.dataset.reviewSelectedDate===date&&el?.dataset.reviewType===type&&el?.getAttribute('aria-busy')==='false';
    },{date,type},{timeout:30000});
    assert.equal(await page.locator('[data-foundation-date]').inputValue(),date);
    assert.match(await page.locator('#reviewDayTitle').innerText(),new RegExp(date));
    assert.equal(await page.locator('[data-review-point]').count(),96);
    assert.equal(await page.locator('[data-result-preview]').count(),0);
    const report=await page.request.get(`http://127.0.0.1:5301/api/forecast/review?month=${date.slice(0,7)}&date=${date}&type=${type}`).then(r=>r.json());
    const number=v=>v==null?'暂无':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
    const cells=await page.locator('[data-review-point="1"] td').allTextContents();
    assert.equal(cells[1],number(report.selected.rows[0].predicted));
    assert.equal(cells[2],number(report.selected.rows[0].actual));
    verified.push({date,type,first:report.selected.rows[0],mae:report.selected.mae});
  }
  await page.goto('http://127.0.0.1:5301/?view=data-sources&date=2026-02-03&dimension=price&v=daily-review',{waitUntil:'networkidle'});
  await ready('2026-02-03');
  assert.equal(await page.locator('.review-day-card').count(),28);
  assert.equal(await page.locator('#foundationForecastPanel [data-series-role="actual"]').count(),1);
  assert.equal(await page.locator('#foundationForecastPanel [data-series-role="forecast"]').count(),1);
  await page.screenshot({path:'output/human-ui-audit-20260904/14-price-month-comparison.png'});
  for(const date of ['2026-02-04','2026-02-20','2026-02-03']) {
    await page.locator(`.review-day-card[data-review-date="${date}"]`).click();
    await ready(date);
  }
  await page.locator('#reviewPointDetails > summary').click();
  await page.evaluate(()=>document.querySelector('#foundationForecastPanel').scrollIntoView({block:'start'}));
  await page.screenshot({path:'output/human-ui-audit-20260904/15-price-day-96-comparison.png'});
  await page.getByRole('tab',{name:'温度预测',exact:true}).click();await ready('2026-02-03','temperature');
  await page.getByRole('tab',{name:'负荷预测',exact:true}).click();await ready('2026-02-03','load');
  await page.getByRole('tab',{name:'价格预测',exact:true}).click();await ready('2026-02-03');
  await page.locator('[data-review-month]').fill('2026-01');await page.locator('[data-review-month]').press('Tab');
  await ready('2026-01-03');assert.equal(await page.locator('.review-day-card').count(),31);
  await page.locator('[data-foundation-date]').fill('2026-02-07');
  await page.locator('[data-foundation-date]').fill('2026-02-08');
  await page.locator('[data-foundation-date]').press('Tab');await ready('2026-02-08');
  await page.locator('[data-foundation-date]').fill('2026-09-05');await page.locator('[data-foundation-date]').press('Tab');
  await ready('2026-09-05');
  assert.equal(await page.locator('#foundationForecastPanel [data-series-role="actual"]').count(),0);
  assert.equal(await page.locator('#foundationForecastPanel [data-series-role="forecast"]').count(),1);
  await page.locator('[data-foundation-date]').fill('2026-02-03');await page.locator('[data-foundation-date]').press('Tab');await ready('2026-02-03');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert.ok(overflow<=0,`Mobile page overflows by ${overflow}px`);
  await page.screenshot({path:'output/human-ui-audit-20260904/16-price-review-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',verified,mobileOverflow:overflow,pageErrors:errors}));
} finally {await browser.close();}
