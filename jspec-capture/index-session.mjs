import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { classifyBusinessTarget } from './lib/jspec-targets.mjs';
import {
  buildInventoryRows,
  buildStandardOutputCheck,
  formatInventoryCsv,
  formatSourceEndpointSummary,
  formatStandardOutputCheck,
} from './lib/offline-inventory.mjs';

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }

  return process.argv[index + 1];
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function getSessionId(captureDir) {
  return path.basename(path.resolve(captureDir));
}

async function readCaptures(captureDir) {
  const responsesDir = path.join(captureDir, 'responses');
  const names = (await readdir(responsesDir)).filter((name) => name.endsWith('.json')).sort();
  const captures = [];

  for (const name of names) {
    const payload = await readJson(path.join(responsesDir, name));
    const meta = payload.meta ?? {};
    const request = payload.request ?? {};
    const businessTarget =
      payload.businessTarget ??
      classifyBusinessTarget({
        url: meta.url ?? request.url ?? payload.url,
        requestHeaders: meta.requestHeaders ?? request.headers ?? payload.requestHeaders,
        pageUrl: undefined,
      });

    captures.push({
      ...payload,
      fileName: payload.fileName ?? name,
      businessTarget,
    });
  }

  return captures;
}

async function tryReadDatasetSummary(captureDir) {
  try {
    return await readJson(path.join(captureDir, 'standard', 'dataset-summary.json'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function main() {
  const captureDir = path.resolve(getArgValue('--capture-dir', '.'));
  const sessionId = getSessionId(captureDir);
  const outputDir = path.resolve(
    getArgValue('--output-dir', path.join('data', 'jspec', 'inventory', sessionId))
  );

  const captures = await readCaptures(captureDir);
  const rows = buildInventoryRows({ sessionId, captures });
  const endpointSummary = formatSourceEndpointSummary(rows);
  const datasetSummary = await tryReadDatasetSummary(captureDir);

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'raw-response-index.json'), JSON.stringify(rows, null, 2), 'utf8');
  await writeFile(path.join(outputDir, 'raw-response-index.csv'), `${formatInventoryCsv(rows)}\n`, 'utf8');
  await writeFile(path.join(outputDir, 'source-endpoint-summary.md'), endpointSummary, 'utf8');

  if (datasetSummary) {
    const check = buildStandardOutputCheck({ datasetSummary });
    await writeFile(
      path.join(outputDir, 'standard-output-check.md'),
      formatStandardOutputCheck(check),
      'utf8'
    );
  }

  process.stdout.write(endpointSummary);
  process.stdout.write(`\nSaved offline inventory to ${outputDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
