import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildInspectionRows, formatInspectionMarkdown } from './lib/capture-inspector.mjs';

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

async function readCaptures(captureDir) {
  const responsesDir = path.join(captureDir, 'responses');
  const names = (await readdir(responsesDir)).filter((name) => name.endsWith('.json')).sort();
  const captures = [];

  for (const name of names) {
    const payload = await readJson(path.join(responsesDir, name));
    captures.push({
      ...payload,
      fileName: payload.fileName ?? name,
    });
  }

  return captures;
}

async function main() {
  const captureDir = path.resolve(getArgValue('--capture-dir', '.'));
  const outputDir = path.resolve(getArgValue('--output-dir', captureDir));

  const captures = await readCaptures(captureDir);
  const rows = buildInspectionRows(captures);
  const markdown = formatInspectionMarkdown(rows);

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'inspection-summary.json'),
    JSON.stringify(rows, null, 2),
    'utf8'
  );
  await writeFile(path.join(outputDir, 'inspection-summary.md'), markdown, 'utf8');

  process.stdout.write(markdown);
  process.stdout.write(`\nSaved inspection summary to ${outputDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
