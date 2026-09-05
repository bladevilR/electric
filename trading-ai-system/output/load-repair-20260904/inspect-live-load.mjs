import {createPlaywrightCollectorRuntime} from '../../lib/playwright-collector-runtime.mjs';
import {createLoadAdapter} from '../../lib/jspec-adapters/load.mjs';
import {execFileSync} from 'node:child_process';
const runtime=createPlaywrightCollectorRuntime({rootDir:process.cwd(),profileDir:'C:/Users/R/AppData/Local/ElectricTradingAI/data/jspec-playwright-profile'});
try {
 const state=await runtime.start(); console.log(JSON.stringify({state:state.state,url:state.lastPageUrl}));
 const page=await runtime.getPage();
 await page.waitForTimeout(4000);
 if (/login|outNet/i.test(page.url())) {
  for(const button of await page.locator('.el-dialog__headerbtn, .el-message-box__headerbtn').all()) if(await button.isVisible()) await button.click();
  const credential=JSON.parse(execFileSync('powershell',['-NoProfile','-File','output/load-repair-20260904/read-credential.ps1'],{encoding:'utf8'}));
  await page.getByPlaceholder('请输入账号',{exact:true}).fill(credential.username);
  await page.getByPlaceholder('请输入密码',{exact:true}).fill(credential.password);
  await page.getByRole('button',{name:'登 录',exact:true}).click();
  await page.waitForTimeout(5000);
  console.log(JSON.stringify({loginResult:page.url(),text:(await page.locator('body').innerText()).slice(0,5000)}));
  if((await page.locator('body').innerText()).includes('请完成安全验证')) {
   console.log('Waiting for the user to complete the security verification in Chrome.');
   await page.waitForURL(url=>/#\/(?:dashboard|pxf-)/.test(url.href),{timeout:600000});
  }
 }
 const adapter=createLoadAdapter();
 if(!/login|outNet/i.test(page.url())) await adapter.navigate(page);
 await page.waitForTimeout(3000);
 console.log(JSON.stringify({url:page.url(),text:(await page.locator('body').innerText()).slice(0,9000),inputs:await page.locator('input').evaluateAll(es=>es.map(e=>({type:e.type,placeholder:e.placeholder,value:e.type==='password'?'[hidden]':e.value}))),buttons:await page.getByRole('button').allTextContents()}));
 await page.screenshot({path:'output/load-repair-20260904/online-load-initial.png',fullPage:true});
 if(!/login|outNet/i.test(page.url())) {
  page.on('response',response=>{if(response.request().resourceType()==='xhr'||response.request().resourceType()==='fetch')console.log(JSON.stringify({response:new URL(response.url()).pathname,status:response.status()}));});
  await adapter.setQuery(page,{businessDate:'2026-02-28'});
  await adapter.submit(page); await page.waitForTimeout(2500);
  console.log(JSON.stringify({queriedText:(await page.locator('body').innerText()).slice(0,12000)}));
  await page.screenshot({path:'output/load-repair-20260904/online-load-query.png',fullPage:true});
 }
}finally {await runtime.stop();}
