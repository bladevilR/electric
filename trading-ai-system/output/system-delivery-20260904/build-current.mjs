import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
const delivery=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(delivery,'../..');
const stage=path.join(delivery,'staging','电力交易AI系统');
await fs.mkdir(stage,{recursive:true});
const names=['server.mjs','index.html','app.js','styles.css','workbench.js','workbench.css','workbench-motion.js','package.json','package-lock.json','build-data.mjs','一分钟上手.html','lib','ui','config','schemas','vendor','assets','python','node_modules','test'];
for(const name of names) await fs.cp(path.join(root,name),path.join(stage,name),{recursive:true,filter:src=>!/(?:__pycache__|\.pyc$|\.env(?:$|\.)|storageState|credential[^/\\]*\.json)/i.test(src)});
for(const name of ['standard-96.sample.json','standard-96.js','integration-summary.json','ukey-visible-history.json','business-inputs'])await fs.cp(path.join(root,'data',name),path.join(stage,'data',name),{recursive:true});
for(const name of ['build-integration-summary.py','build-settlement-reference.py','import-local-load-history.mjs','export-model-dataset.mjs','import-weather-snapshot.mjs','import-supply-network-snapshot.mjs'])await fs.cp(path.join(root,'tools',name),path.join(stage,'tools',name));
const live='C:/Users/R/AppData/Local/ElectricTradingAI/data';
const snapshot=path.join(stage,'data','runtime-snapshot');await fs.mkdir(snapshot,{recursive:true});
const source=new DatabaseSync(path.join(live,'trading-evidence.sqlite'),{readOnly:true});
await backup(source,path.join(snapshot,'trading-evidence.sqlite'));source.close();
const db=new DatabaseSync(path.join(snapshot,'trading-evidence.sqlite'));
db.exec("UPDATE collection_jobs SET state='paused' WHERE state NOT IN ('completed','cancelled'); UPDATE collection_chunks SET state='pending', next_attempt_at=NULL WHERE state IN ('running','collecting');");
const counts=db.prepare('SELECT field_id,COUNT(DISTINCT business_date) AS days,MIN(business_date) AS first,MAX(business_date) AS last,COUNT(*) AS points FROM facts GROUP BY field_id').all();
const integrity=db.prepare('PRAGMA integrity_check').get();
if(integrity.integrity_check!=='ok')throw new Error('SQLite snapshot integrity failed');
// Inspect every textual database column without printing sensitive values.
const secret=/(?:\"(?:access_token|refresh_token|password|passwd|authorization|cookie|client_secret)\"\s*:\s*\"(?!\[REDACTED\]|redacted|\*+)[^\"]{4,})|Bearer\s+[A-Za-z0-9_.-]{20,}/i;
let scannedRows=0;
for(const {name}of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()){
 const table='"'+name.replaceAll('"','""')+'"';
 for(const row of db.prepare(`SELECT * FROM ${table}`).iterate()){
  scannedRows++;for(const val of Object.values(row))if(typeof val==='string'&&secret.test(val))throw new Error(`Sensitive content detected in snapshot table ${name}`);
 }
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();
for(const name of ['local-load-history.json','ukey-visible-history.json','point-in-time-facts.json','forecast-ledger.json','outcome-ledger.json']){
 try{await fs.copyFile(path.join(live,name),path.join(snapshot,name));}catch(e){if(e.code!=='ENOENT')throw e;}
}
await fs.mkdir(path.join(stage,'runtime','node'),{recursive:true});
await fs.copyFile('C:/Program Files/nodejs/node.exe',path.join(stage,'runtime','node','node.exe'));
await fs.copyFile('C:/Program Files/nodejs/LICENSE',path.join(stage,'runtime','node','LICENSE'));
await fs.copyFile(path.join(delivery,'portable-launch.ps1'),path.join(stage,'portable-launch.ps1'));
await fs.copyFile(path.join(delivery,'启动系统.bat'),path.join(stage,'启动系统.bat'));
await fs.copyFile(path.join(delivery,'使用说明.md'),path.join(stage,'使用说明.md'));
await fs.writeFile(path.join(stage,'数据范围.json'),JSON.stringify({snapshotAt:new Date().toISOString(),integrity:'ok',counts},null,2));
console.log(JSON.stringify({stage,counts,scannedRows,integrity}));
