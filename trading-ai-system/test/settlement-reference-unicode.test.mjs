import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildSettlementReference} from '../lib/settlement-reference.mjs';
test('settlement evidence preserves Chinese file names split across process output chunks',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'settlement-unicode-'));
  try {
    const script=path.join(dir,'source.mjs');
    await writeFile(script,'const bytes=Buffer.from(JSON.stringify({fileName:"核对单.xlsx"})); const cut=bytes.indexOf(Buffer.from("核"))+1; process.stdout.write(bytes.subarray(0,cut)); setTimeout(()=>process.stdout.write(bytes.subarray(cut)),100);');
    const result=await buildSettlementReference({projectRoot:dir,pythonPath:process.execPath,scriptPath:script});
    assert.equal(result.fileName,'核对单.xlsx');
  } finally {await rm(dir,{recursive:true,force:true});}
});
