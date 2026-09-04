import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const launch=()=>chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
async function freePort(){let port=0;do{port=await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const candidate=s.address().port;s.close(e=>e?reject(e):resolve(candidate));});});}while(port<12000);return port;}
async function start(){
  const port=await freePort(),temp=await mkdtemp(path.join(os.tmpdir(),'cockpit-browser-'));
  const child=spawn(process.execPath,['server.mjs','--port',String(port),'--evidence-store',path.join(temp,'evidence.sqlite'),'--audit',path.join(temp,'audit.ndjson'),'--visible-snapshot',path.join(temp,'snapshot.json'),'--visible-history',path.join(temp,'history.json'),'--point-in-time-store',path.join(temp,'facts.json'),'--forecast-ledger',path.join(temp,'forecasts.json'),'--outcome-ledger',path.join(temp,'outcomes.json')],{cwd:root,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let err='';child.stderr.on('data',c=>err+=c);child.stdout.on('data',c=>String(c).includes('Trading AI System running at')&&resolve());child.on('exit',code=>reject(new Error(`server ${code}: ${err}`)));});
  return{url:`http://127.0.0.1:${port}`,async close(){child.kill();await once(child,'exit').catch(()=>{});await rm(temp,{recursive:true,force:true});}};
}

test('six cockpit views fit desktop tablet and mobile without browser errors',async()=>{
  const server=await start(),browser=await launch();
  try{for(const width of [1440,1024,768,390,320]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(server.url,{waitUntil:'networkidle'});
    for(const id of ['data-sources','market-cockpit','price-forecast','declaration-strategy','history-review','model-governance']){
      await page.locator(`nav [data-cockpit-view="${id}"]`).click();
      await page.locator(`[data-view="${id}"]`).waitFor();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      assert.ok(overflow<=0,`${id} overflows ${width}px by ${overflow}px`);
      assert.ok(await page.locator(`[data-view="${id}"] .mode-identity`).isVisible());
    }
    assert.deepEqual(errors,[]);await page.close();
  }}finally{await browser.close();await server.close();}
});

test('foundation keyboard, drawers, simulation controls and demo safety work together',async()=>{
  const server=await start(),browser=await launch();
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{if(route.request().method()==='POST'){writes.push(route.request().url());await route.fulfill({status:200,contentType:'application/json',body:'{}'});}else await route.continue();});
    await page.goto(`${server.url}/?demo=submission&view=data-sources`,{waitUntil:'networkidle'});
    assert.match(await page.locator('.foundation-truth-strip').innerText(),/演示数据/);
    await page.getByRole('tab',{name:'价格预测',exact:true}).focus();await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab',{name:'温度预测',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#foundationForecastPanel polyline[data-series-role="forecast"]').count(),1);
    const trigger=page.locator('[data-foundation-trigger="derivation-optimizer"]');await trigger.click();
    const drawer=page.locator('#foundationEvidenceDrawer');await drawer.waitFor();
    assert.match(await drawer.innerText(),/怎样计算或判断/);assert.doesNotMatch(await drawer.innerText(),/demo:constraint|fact:|featureSnapshot/);
    const buttons=drawer.getByRole('button');assert.equal(await buttons.first().evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Shift+Tab');assert.equal(await buttons.last().evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'});
    assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
    const source=page.locator('[data-foundation-trigger="storage-location"]');await source.click();
    assert.doesNotMatch(await page.locator('#foundationProvenance').innerText(),/[A-Z]:\\|\.json|数据血缘/);
    await page.keyboard.press('Escape');assert.equal(await source.evaluate(el=>el===document.activeElement),true);
    await page.locator('.foundation-sandbox > summary').click();
    await page.locator('[data-sandbox-control="priceWeight"]').evaluate(el=>{el.value='0.9';el.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.equal(await page.locator('.foundation-sandbox').evaluate(el=>el.open),true);
    assert.match(await page.locator('[data-sandbox-control="priceWeight"] + output').innerText(),/90%/);
    await page.locator('[data-risk-profile="active"]').click();
    assert.equal(await page.locator('[data-risk-profile="active"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.foundation-sandbox').evaluate(el=>el.open),true);
    await page.locator('[data-foundation-action="apply-simulation"]').click();
    assert.match(await page.locator('.toast').innerText(),/正式策略和交易数据未被修改/);
    await page.locator('[data-foundation-action="focus-versions"]').click();
    assert.equal(await page.locator('#foundationVersionPanel').evaluate(el=>el.open&&el===document.activeElement),true);
    await page.locator('[data-collection-details] > summary').click();
    await page.locator('[data-foundation-action="start-browser"]').click();
    await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('演示环境不会连接真实交易平台'));
    await page.locator('[data-foundation-action="start-backfill"]').click();
    assert.equal(writes.length,0);assert.deepEqual(errors,[]);
  }finally{await browser.close();await server.close();}
});

test('foundation source explanation stays usable and returns focus on narrow screens',async()=>{
  const server=await start(),browser=await launch();
  try{for(const width of [1024,390]){
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.goto(`${server.url}/?demo=submission&view=data-sources`,{waitUntil:'networkidle'});
    await page.getByRole('tab',{name:'负荷预测',exact:true}).click();
    assert.match(await page.locator('#foundationForecastPanel').innerText(),/负荷预测曲线/);
    const stage=page.locator('[data-foundation-trigger="derivation-sources"]');await stage.click();
    await page.locator('#foundationEvidenceDrawer').waitFor();
    assert.match(await page.locator('#foundationEvidenceDrawer').innerText(),/电价来自交易平台/);
    await page.keyboard.press('Escape');assert.equal(await stage.evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
    await page.close();
  }}finally{await browser.close();await server.close();}
});
