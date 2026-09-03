import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const LABELS = new Set(['temporary','current','final','settlement_initial','settlement_final','settlement_adjusted']);
const REQUIRED = ['targetField','businessDate','pointIndex','actualValue','actualLabelVersion','sourceId','sourceRevision','publishedAt','actualBackfilledAt'];

export function appendOutcomeRevision(ledger, outcome) {
  for (const field of REQUIRED) if (outcome?.[field] === undefined || outcome[field] === '') throw new Error(`outcome_field_required:${field}`);
  if (!LABELS.has(outcome.actualLabelVersion)) throw new Error('outcome_label_invalid');
  const key = ['targetField','businessDate','pointIndex','actualLabelVersion','sourceRevision'];
  if ((ledger?.outcomes || []).some((item)=>key.every((field)=>item[field]===outcome[field]))) throw new Error('outcome_revision_already_exists');
  return {version:ledger?.version||1,outcomes:[...(ledger?.outcomes||[]),{...outcome}].sort((a,b)=>Date.parse(a.publishedAt)-Date.parse(b.publishedAt)||String(a.sourceRevision).localeCompare(String(b.sourceRevision)))};
}

export function selectOutcomeForEvaluation(ledger, query={}) {
  return (ledger?.outcomes||[]).filter((item)=>Object.entries(query).every(([key,value])=>value===undefined||item[key]===value)).sort((a,b)=>Date.parse(a.publishedAt)-Date.parse(b.publishedAt)||Date.parse(a.actualBackfilledAt)-Date.parse(b.actualBackfilledAt)).at(-1)||null;
}

export async function readOutcomeLedger(filePath) { try{return JSON.parse(await readFile(filePath,'utf8'));}catch(error){if(error.code==='ENOENT')return{version:1,outcomes:[]};throw error;} }
export async function writeOutcomeLedgerAtomic(filePath,ledger){await mkdir(path.dirname(filePath),{recursive:true});const temporary=`${filePath}.${process.pid}.${randomUUID()}.tmp`;await writeFile(temporary,`${JSON.stringify(ledger,null,2)}\n`,'utf8');await rename(temporary,filePath);}

export function linkSettlementReference(reference={},metadata={}) {
  const required=['sourceFileName','sourceFileSha256','sourceSheetName','parserVersion','parsedAt','settlementRevision'];
  for(const field of required)if(!metadata[field])throw new Error(`settlement_metadata_required:${field}`);
  return (reference.featureRows||[]).map((row)=>({...metadata,targetField:row.targetField||'settlementPriceYuanPerMwh',businessDate:row.date,pointIndex:row.pointIndex,actualValue:row.settlementPrice,actualLabelVersion:metadata.actualLabelVersion||'settlement_final',sourceId:'SETTLEMENT-XLSX',sourceRevision:metadata.settlementRevision,publishedAt:metadata.parsedAt,actualBackfilledAt:metadata.parsedAt}));
}
