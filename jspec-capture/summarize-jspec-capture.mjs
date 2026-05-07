import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildCaptureSummary, formatCoverageMarkdown } from './lib/capture-summary.mjs';
import { classifyBusinessTarget } from './lib/jspec-targets.mjs';

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
  const names = (await readdir(responsesDir)).filter((name) => name.endsWith('.json'));
  const captures = [];

  for (const name of names) {
    const filePath = path.join(responsesDir, name);
    const payload = await readJson(filePath);
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
      fileName: name,
      businessTarget,
      meta,
      request,
    });
  }

  return captures;
}

async function main() {
  const captureDir = path.resolve(getArgValue('--capture-dir', '.'));
  const outputDir = path.resolve(getArgValue('--output-dir', captureDir));

  const captures = await readCaptures(captureDir);
  const summary = buildCaptureSummary(captures);
  const markdown = formatCoverageMarkdown(summary);

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'coverage-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await writeFile(path.join(outputDir, 'coverage-summary.md'), markdown, 'utf8');

  process.stdout.write(markdown);
  process.stdout.write(`\nSaved coverage summary to ${outputDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
