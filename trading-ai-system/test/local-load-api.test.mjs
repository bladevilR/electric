import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildLocalLoadHistory} from '../lib/local-load-history.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('server loads the portable real-load snapshot and serves history, provenance and backtest',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'load-api-'));
  const port=9800+Math.floor(Math.random()*100);
  const featureRows=Array.from({length:6},(_,day)=>Array.from({length:96},(_,i)=>({date:`2026-02-0${day+1}`,pointIndex:i+1,timePoint:i===95?'24:00':`${String(Math.floor((i+1)/4)).padStart(2,'0')}:${String((i+1)%4*15).padStart(2,'0')}`,actualKwh:2500+day*250,sourceFile:'real.xlsx',sourceSheet:String(day+1)}))).flat();
  await writeFile(path.join(dir,'local-load-history.json'),JSON.stringify(buildLocalLoadHistory({featureRows},{sources:[{fileName:'real.xlsx',kind:'spot_reconciliation',sha256:'a'.repeat(64)}],generatedAt:'2026-09-04T00:00:00Z'})));
  const child=spawn(process.execPath,['--no-warnings','server.mjs','--port',String(port),'--evidence-store',path.join(dir,'evidence.sqlite'),'--point-in-time-store',path.join(dir,'point.json'),'--forecast-ledger',path.join(dir,'forecast.json'),'--outcome-ledger',path.join(dir,'outcome.json'),'--visible-history',path.join(dir,'visible.json')],{cwd:root,env:{...process.env,JSPEC_MANAGED_BROWSER_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{child.stdout.on('data',c=>{if(c.toString().includes('Trading AI System running at'))resolve();});child.on('exit',c=>reject(new Error(`server exited ${c}`)));});
    const coverage=await fetch(`http://127.0.0.1:${port}/api/history/coverage?fieldId=actualAverageLoadMw`).then(r=>r.json());
    assert.equal(coverage.coverage.dateCount,6);
    const facts=await fetch(`http://127.0.0.1:${port}/api/history/facts?date=2026-02-06&fieldId=actualAverageLoadMw&limit=1000`).then(r=>r.json());
    assert.equal(facts.rows.length,96);assert.equal(facts.rows[0].value,15);
    const response=await fetch(`http://127.0.0.1:${port}/api/forecast/load?date=2026-02-06`);
    assert.equal(response.status,200);
    const report=await response.json();assert.equal(report.rows.length,96);assert.equal(report.metrics.mae,3);
    const captures=await fetch(`http://127.0.0.1:${port}/api/history/captures?date=2026-02-06`).then(r=>r.json());
    assert.equal(captures.captures[0].evidence.sourceFile,'real.xlsx');
    const range=await fetch(`http://127.0.0.1:${port}/api/history/captures?from=2026-02-02&to=2026-02-03`).then(r=>r.json());
    assert.deepEqual(range.captures.map(c=>c.businessDate).sort(),['2026-02-02','2026-02-03']);
  } finally {child.kill();if(child.exitCode===null)await once(child,'exit');await rm(dir,{recursive:true,force:true});}
});
