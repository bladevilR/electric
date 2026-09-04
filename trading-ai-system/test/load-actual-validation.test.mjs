import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadAdapter} from '../lib/jspec-adapters/load.mjs';
const date='2026-09-02';
const result=(fieldId,count=96)=>({queryDate:date,mappedFields:[fieldId],facts:Array.from({length:count},(_,i)=>({fieldId,pointIndex:i+1,value:100,unit:fieldId==='actualKwh'?'kWh':'MW'}))});
test('actual electricity is accepted without a forecast column',()=>{
  assert.equal(createLoadAdapter().validate(result('actualKwh'),{businessDate:date}).accepted,true);
});
test('actual power is accepted without a forecast column',()=>{
  assert.equal(createLoadAdapter().validate(result('actualLoadMw'),{businessDate:date}).accepted,true);
});
test('forecast-only and incomplete actual curves cannot masquerade as actual load',()=>{
  assert.throws(()=>createLoadAdapter().validate(result('loadForecastMw'),{businessDate:date}),/actual/);
  assert.throws(()=>createLoadAdapter().validate(result('actualKwh',95),{businessDate:date}),/96/);
});

test('actual load rejects out-of-range points, negative values and incorrect units',()=>{
  for(const change of [{pointIndex:97},{value:-100},{unit:'MWh'}]) {
    const invalid=result('actualKwh');Object.assign(invalid.facts[0],change);
    assert.throws(()=>createLoadAdapter().validate(invalid,{businessDate:date}),/invalid_actual_load/);
  }
});

test('confirmed 15-minute electricity curves also produce load MW with conversion evidence',()=>{
  const input={...result('actualKwh'),intervalMinutes:15};
  const accepted=createLoadAdapter().validate(input,{businessDate:date});
  const derived=accepted.facts.filter(f=>f.fieldId==='actualAverageLoadMw');
  assert.equal(derived.length,96);assert.equal(derived[0].value,0.4);assert.equal(derived[0].unit,'MW');
  assert.match(accepted.evidence.conversion,/0.25/);
  assert.equal(createLoadAdapter().validate(result('actualKwh'),{businessDate:date}).facts.length,96);
});
