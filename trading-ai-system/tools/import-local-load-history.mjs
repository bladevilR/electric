import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildSettlementReference } from '../lib/settlement-reference.mjs';
import { buildLocalLoadHistory, importLocalLoadHistory } from '../lib/local-load-history.mjs';
import { openTradingEvidenceStore } from '../lib/trading-evidence-store.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? '' : process.argv[i + 1]; };
const projectRoot = arg('--project-root'), output = arg('--output'), database = arg('--database');
if (!projectRoot || !output || !database) throw new Error('Required: --project-root <authorized source directory> --output <new JSON path> --database <SQLite path>');
const reference = await buildSettlementReference({ projectRoot, pythonPath: arg('--python') });
const names = [...new Set(reference.featureRows.filter((row) => row.actualKwh !== null && row.actualKwh !== undefined).map((row) => row.sourceFile))];
const sources = [];
for (const fileName of names) {
  const workbook = reference.workbooks.find((item) => item.fileName === fileName);
  const sourcePath = workbook?.path || path.join(projectRoot, 'data/jspec/standardized/transaction_calculation', fileName);
  sources.push({ fileName, kind: workbook ? 'spot_reconciliation' : 'transaction_calculation', sha256: createHash('sha256').update(await readFile(sourcePath)).digest('hex') });
}
const document = buildLocalLoadHistory(reference, { sources });
await mkdir(path.dirname(path.resolve(output)), { recursive: true });
await writeFile(output, `${JSON.stringify(document)}\n`, { encoding: 'utf8', flag: 'wx' });
const store = openTradingEvidenceStore({ filePath: path.resolve(database) });
try { console.log(JSON.stringify({ ...await importLocalLoadHistory({ store, filePath: path.resolve(output) }), sources: sources.length, excludedDuplicateCurves: document.excluded.length }, null, 2)); }
finally { store.close(); }
