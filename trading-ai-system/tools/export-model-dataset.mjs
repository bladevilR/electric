import { createHash } from 'node:crypto'; import { readFile, writeFile } from 'node:fs/promises';
import { buildModelDataset } from '../lib/model-dataset.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, all) => item.startsWith('--') ? [...pairs, [item.slice(2), all[index + 1]]] : pairs, []));
if (!args.snapshots || !args.outcomes || !args.target || !args.output) throw new Error('usage: --snapshots <json> --outcomes <json> --target <field> --output <jsonl>');
const dataset = buildModelDataset({ snapshots: JSON.parse(await readFile(args.snapshots, 'utf8')), outcomes: JSON.parse(await readFile(args.outcomes, 'utf8')), targetField: args.target, task: args.task, splitConfig: args.splits ? JSON.parse(await readFile(args.splits, 'utf8')) : {} });
const jsonl = dataset.rows.map((row) => JSON.stringify(row)).join('\n') + '\n'; await writeFile(args.output, jsonl, 'utf8');
const manifest = { version: 1, sha256: createHash('sha256').update(jsonl).digest('hex'), target: args.target, featureList: dataset.featureList, rowCount: dataset.rows.length, splitCounts: Object.fromEntries(['train','validation','holdout','shadow'].map((split) => [split, dataset.rows.filter((row) => row.split === split).length])), excludedFields: dataset.excludedFieldsPattern };
await writeFile(`${args.output}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); console.log(JSON.stringify({ status: 'exported', rowCount: dataset.rows.length, sha256: manifest.sha256 }));
