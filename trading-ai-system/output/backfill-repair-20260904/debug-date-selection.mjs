import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1500,height:1050}});
  page.on('pageerror',error=>console.log('PAGEERROR',error.message));
  page.on('request',request=>{if(request.url().includes('/api/workbench')) console.log('WORKBENCH',request.url());});
  await page.goto('http://127.0.0.1:5301/?view=data-sources',{waitUntil:'networkidle'});
  for(const date of ['2026-01-01','2026-02-27','2026-09-05']) {
    await page.locator('[data-foundation-date]').fill(date);
    await page.locator('[data-foundation-date]').press('Tab');
    await page.waitForLoadState('networkidle');
    console.log('STATE',date,await page.evaluate(()=>({date:document.querySelector('[data-foundation-date]')?.value,headers:[...document.querySelectorAll('[data-foundation-root] h2')].map(e=>e.textContent),series:[...document.querySelectorAll('#foundationForecastPanel polyline')].map(e=>({role:e.dataset.seriesRole,count:e.getAttribute('points').trim().split(/\s+/).length}))})));
    await page.screenshot({path:`output/human-ui-audit-20260904/date-before-${date}.png`});
  }
} finally {await browser.close();}
