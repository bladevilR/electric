import { readFile } from 'node:fs/promises';
import { normalizeSupplyNetworkSnapshot } from '../lib/supply-network-snapshot.mjs';
import { appendFact, readPointInTimeStore, writePointInTimeStoreAtomic } from '../lib/point-in-time-store.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, all) => item.startsWith('--') ? [...pairs, [item.slice(2), all[index + 1]]] : pairs, []));
if (!args.input || !args.catalog || !args.facts) throw new Error('usage: --input <file> --catalog <file> --facts <path>');
const payload = JSON.parse(await readFile(args.input, 'utf8')), catalog = JSON.parse(await readFile(args.catalog, 'utf8')), result = normalizeSupplyNetworkSnapshot(payload, catalog);
let store = await readPointInTimeStore(args.facts); for (const fact of result.facts) store = appendFact(store, fact); await writePointInTimeStoreAtomic(args.facts, store);
console.log(JSON.stringify({ acceptedFacts: result.facts.length, blockedFields: result.blockedFields, unmappedHeaders: result.unmappedHeaders, nullFacts: result.facts.filter((fact) => fact.value === null).length, sourceRevision: payload.sourceRevision }));
