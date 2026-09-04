import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openTradingEvidenceStore } from '../lib/trading-evidence-store.mjs';

const stamp = '2026-09-04T02:00:00.000Z';
const rows = (sourceFile, value) => Array.from({length:96}, (_,i) => ({
  date:'2026-02-28', pointIndex:i+1, timePoint:i===95?'24:00':`${String(Math.floor((i+1)/4)).padStart(2,'0')}:${String(((i+1)%4)*15).padStart(2,'0')}`,
  actualKwh:value, sourceFile, sourceSheet:'28',
}));
const sources = [
  {fileName:'settlement.xlsx',sha256:'a'.repeat(64),kind:'spot_reconciliation'},
  {fileName:'customer_usage_96.csv',sha256:'b'.repeat(64),kind:'transaction_calculation'},
];

test('real local load bridge imports complete curves once, converts 15-minute kWh and preserves evidence time', async()=>{
  const {buildLocalLoadHistory, importLocalLoadHistory}=await import('../lib/local-load-history.mjs');
  const dir=await mkdtemp(path.join(os.tmpdir(),'local-load-'));
  const store=openTradingEvidenceStore({filePath:path.join(dir,'evidence.sqlite')});
  try {
    const document=buildLocalLoadHistory({featureRows:[...rows('customer_usage_96.csv',100),...rows('settlement.xlsx',12500)]},{sources,generatedAt:stamp});
    assert.equal(document.curves.length,1);
    assert.equal(document.curves[0].rows[0].actualKwh,12500);
    const filePath=path.join(dir,'history.json');
    await writeFile(filePath,JSON.stringify(document));
    const result=await importLocalLoadHistory({store,filePath});
    assert.equal(result.importedFacts,192);
    assert.equal(result.dateCount,1);
    assert.equal(store.queryFacts({fieldId:'actualAverageLoadMw'})[0].value,50);
    assert.equal(store.queryFacts({fieldId:'actualAverageLoadMw'})[0].unit,'MW');
    assert.equal(store.queryFacts({asOf:'2026-03-01T00:00:00.000Z'}).length,0);
    assert.equal(store.queryCaptures({})[0].evidence.conversion,'MW = kWh / 1000 / 0.25');
    assert.equal(store.queryCaptures({})[0].evidence.sourceFile,'settlement.xlsx');
    assert.equal((await importLocalLoadHistory({store,filePath})).importedFacts,0);
    assert.equal(store.queryFacts({}).length,192);
  } finally {store.close();await rm(dir,{recursive:true,force:true});}
});

test('load import rejects duplicate points, negative values and unconfirmed intervals', async()=>{
  const {buildLocalLoadHistory}=await import('../lib/local-load-history.mjs');
  assert.throws(()=>buildLocalLoadHistory({featureRows:[...rows('settlement.xlsx',10),rows('settlement.xlsx',10)[0]]},{sources,generatedAt:stamp}),/duplicate/);
  assert.throws(()=>buildLocalLoadHistory({featureRows:rows('settlement.xlsx',-1)},{sources,generatedAt:stamp}),/negative/);
  const wrong=rows('settlement.xlsx',10);wrong[0].timePoint='01:00';
  assert.throws(()=>buildLocalLoadHistory({featureRows:wrong},{sources,generatedAt:stamp}),/interval/);
});
