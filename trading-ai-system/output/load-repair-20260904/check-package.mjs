import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
const root=process.cwd(),stage=path.join(root,'output/load-repair-20260904/package-staging/trading-ai-system');
const check=await mkdtemp(path.join(os.tmpdir(),'electric-package-check-'));
for(const file of ['trading-evidence.sqlite','local-load-history.json'])await copyFile(path.join(stage,'data/runtime-snapshot',file),path.join(check,file));
const runtime=path.join(stage,'runtime/node/node.exe');
const args=['--no-warnings','server.mjs','--port','5318','--evidence-store',path.join(check,'trading-evidence.sqlite'),'--local-load-history',path.join(check,'local-load-history.json')];
for(const flag of ['point-in-time-store','forecast-ledger','outcome-ledger','visible-history','visible-snapshot','audit'])args.push('--'+flag,path.join(check,flag+'.json'));
args.push('--collector-profile',path.join(check,'browser'));
const child=spawn(runtime,args,{cwd:stage,windowsHide:true,stdio:['ignore','pipe','pipe']});
try {
 await new Promise((resolve,reject)=>{let err='';child.stderr.on('data',c=>err+=c);child.stdout.on('data',c=>{if(c.toString().includes('Trading AI System running at'))resolve();});child.on('exit',c=>reject(new Error(`package server exit ${c} ${err}`)));});
 console.log(execFileSync(runtime,['--no-warnings','tools/verify-local-load-workbench.mjs','http://127.0.0.1:5318',path.join(root,'output/load-repair-20260904/package-verification')],{cwd:stage,windowsHide:true,encoding:'utf8',timeout:45000}));
 console.log(JSON.stringify({packageNode:runtime,isolatedCheck:check,passed:true}));
}finally {child.kill();if(child.exitCode===null)await once(child,'exit');}
