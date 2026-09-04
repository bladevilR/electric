import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const out=path.join(path.dirname(fileURLToPath(import.meta.url)),'screenshots');await fs.mkdir(out,{recursive:true});
const origin=process.argv[2]||'http://127.0.0.1:5301';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1});
const errors=[];const manifest=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.url().startsWith(origin+'/api/')&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
await page.route('**/*',async route=>{if(!['GET','HEAD'].includes(route.request().method()))return route.abort();await route.continue()});
async function snap(name,fullPage=true){await page.screenshot({path:path.join(out,name+'.png'),fullPage});manifest.push({name:name+'.png',url:page.url(),title:await page.title(),capturedAt:new Date().toISOString()});console.log(name)}
async function open(view,type='price'){
 await page.goto(`${origin}/?view=${view}&date=2026-02-03&dimension=${type}&v=delivery-20260904`,{waitUntil:'networkidle'});
 if(view==='data-sources')await page.waitForFunction(type=>document.querySelector('[data-review-report]')?.dataset.reviewType===type&&document.querySelector('[data-review-report]')?.getAttribute('aria-busy')==='false',type);
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(400);
}
try{
 await open('data-sources');await snap('01-数据与预测-价格月度总览');
 await page.locator('#reviewPointDetails > summary').click();
 await page.evaluate(()=>window.scrollTo(0,document.querySelector('#foundationForecastPanel').getBoundingClientRect().top+window.scrollY-80));await snap('02-价格预测与实际-每日96点',false);
 for(const [type,label,n]of [['temperature','温度预测与实际',3],['load','负荷预测与实际',4]]){await open('data-sources',type);await snap(`0${n}-${label}`)}
 for(const [view,label,n]of [['market-cockpit','市场概览',5],['price-forecast','价格预测',6],['declaration-strategy','申报策略',7],['history-review','历史复盘',8],['model-governance','预测方法',9]]){await open(view);await snap(`0${n}-${label}`)}
 await page.goto(`${origin}/${encodeURIComponent('一分钟上手.html')}`,{waitUntil:'networkidle'});await snap('10-一分钟上手');
 await open('data-sources');
 const evidence=page.locator('[data-action="open-evidence"]');
 if(await evidence.count()){await evidence.first().click();await page.locator('.evidence-drawer').waitFor();await snap('11-依据与审计说明',false)}
 for(const [id,label,n]of [['optimize','申报优化工作台',12],['forecast','价格预测工作台',13],['evolution','策略进化工作台',14],['review','复盘回顾工作台',15]]){
  await open('market-cockpit');await page.locator(`[data-dashboard-nav="${id}"]`).click();await page.waitForTimeout(900);await page.evaluate(()=>window.scrollTo(0,0));await snap(`${n}-${label}`);
 }
 await fs.writeFile(path.join(out,'截图清单.json'),JSON.stringify({manifest,errors},null,2));
 if(errors.length)throw new Error(JSON.stringify(errors));
 console.log(JSON.stringify({screenshots:manifest.length,errors}));
}finally{await browser.close()}
