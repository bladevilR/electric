import path from 'node:path';

import { writeBrowserDataFile } from './lib/system-data.mjs';

const defaultSource =
  '../jspec-capture/output/session-20260507-101645/standard/standard-96.json';

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }
  return process.argv[index + 1];
}

async function main() {
  const sourcePath = path.resolve(getArgValue('--source', defaultSource));
  const outputPath = path.resolve(getArgValue('--output', './data/standard-96.js'));
  const summary = await writeBrowserDataFile({ sourcePath, outputPath });
  process.stdout.write(`Wrote ${outputPath}\n`);
  process.stdout.write(`Rows: ${summary.rowCount}, P0: ${summary.p0SourceCoverage.present}/${summary.p0SourceCoverage.total}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
