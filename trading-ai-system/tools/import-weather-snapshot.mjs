import { readFile } from 'node:fs/promises';
import { normalizeWeatherSnapshot } from '../lib/weather-snapshot.mjs';
import { appendFact, readPointInTimeStore, writePointInTimeStoreAtomic } from '../lib/point-in-time-store.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, all) => item.startsWith('--') ? [...pairs, [item.slice(2), all[index + 1]]] : pairs, []));
if (!args.input || !args['source-id'] || !args.facts) throw new Error('usage: --input <file> --source-id <id> --facts <path>');
const payload = JSON.parse(await readFile(args.input, 'utf8')), result = normalizeWeatherSnapshot({ ...payload, sourceId: args['source-id'] }, { sourceId: args['source-id'] });
let store = await readPointInTimeStore(args.facts); for (const fact of result.facts) store = appendFact(store, fact); await writePointInTimeStoreAtomic(args.facts, store);
console.log(JSON.stringify({ status: 'imported', acceptedFacts: result.facts.length, warningCount: result.warnings.length }));
