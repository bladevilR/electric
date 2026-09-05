import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1100}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    if(route.request().method()==='POST') throw new Error('Read-only verification attempted a write');
    await route.continue();
  });
  await page.goto('http://127.0.0.1:5301/?view=data-sources&v=collected-real-history',{waitUntil:'networkidle'});
  await page.locator('[data-foundation-date]').fill('2026-01-01');
  await page.locator('[data-foundation-date]').dispatchEvent('change');
  await page.getByRole('tab',{name:'价格预测',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#foundationForecastPanel polyline[data-series-role="actual"]')?.getAttribute('points').trim().split(/\s+/).length===96,{},{timeout:60000});
  await page.evaluate(()=>document.querySelector('#foundationForecastPanel').scrollIntoView({block:'start'}));
  await page.screenshot({path:'output/human-ui-audit-20260904/11-settlement-price-20260101.png'});
  await page.locator('[data-history-filter="from"]').fill('2026-01-01');
  await page.locator('[data-history-filter="from"]').dispatchEvent('change');
  await page.locator('[data-history-filter="to"]').fill('2026-01-01');
  await page.locator('[data-history-filter="to"]').dispatchEvent('change');
  await page.locator('[data-history-filter="field"]').selectOption('settledLongTermEnergyMwh');
  await page.locator('[data-history-filter="source"]').selectOption('SETTLEMENT-XLSX');
  await page.locator('[data-history-mode="detail"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.foundation-history-table tbody tr').length===96 && document.querySelector('.foundation-history-table tbody')?.textContent.includes('历史中长期合约结算电量'),{},{timeout:60000});
  const history=await page.locator('.foundation-history-table').innerText();
  assert.match(history,/6\.991/);
  assert.match(history,/结算核对单/);
  assert.doesNotMatch(history,/SETTLEMENT-XLSX|settledLongTermEnergyMwh|[A-Z]:\\/);
  await page.evaluate(()=>document.querySelector('.foundation-history').scrollIntoView({block:'start'}));
  await page.screenshot({path:'output/human-ui-audit-20260904/12-historical-contract-settlement.png'});
  await page.locator('[data-foundation-date]').fill('2026-09-05');
  await page.locator('[data-foundation-date]').dispatchEvent('change');
  await page.waitForFunction(()=>document.querySelector('#foundationForecastPanel polyline[data-series-role="forecast"]')?.getAttribute('points').trim().split(/\s+/).length===96 && !document.querySelector('#foundationForecastPanel polyline[data-series-role="actual"]'),{},{timeout:60000});
  await page.evaluate(()=>document.querySelector('#foundationForecastPanel').scrollIntoView({block:'start'}));
  await page.screenshot({path:'output/human-ui-audit-20260904/13-live-price-20260905.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: January 1 real price 96 points; historical contract 96 points with readable source; September 5 forecast 96 points with no fabricated actuals; no page errors.');
} finally { await browser.close(); }
