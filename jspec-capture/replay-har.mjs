import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { buildReplayRequest, shouldReplayRequest } from './lib/replay-har-utils.mjs';
import { sanitizeSegment, formatTimestamp } from './lib/capture-utils.mjs';

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }

  return process.argv[index + 1];
}

async function main() {
  const harPath = getArgValue('--har', '');
  const outputRoot = path.resolve(getArgValue('--output-dir', './output'));

  if (!harPath) {
    throw new Error('Missing --har <path-to-har>');
  }

  const harPayload = JSON.parse(await readFile(path.resolve(harPath), 'utf8'));
  const entries = harPayload?.log?.entries ?? [];
  const requests = entries.filter(shouldReplayRequest).map(buildReplayRequest);

  const replayDir = path.join(outputRoot, `replay-${formatTimestamp()}`);
  const responsesDir = path.join(replayDir, 'responses');
  await mkdir(responsesDir, { recursive: true });

  const results = [];

  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' ? undefined : request.bodyText,
    });

    const text = await response.text();
    const fileName = `${String(index + 1).padStart(3, '0')}-${sanitizeSegment(request.url)}.json`;
    const output = {
      request,
      response: {
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
      },
      bodyText: text,
    };

    results.push({
      fileName,
      url: request.url,
      status: response.status,
      ok: response.ok,
    });

    await writeFile(path.join(responsesDir, fileName), JSON.stringify(output, null, 2), 'utf8');
  }

  await writeFile(
    path.join(replayDir, 'index.json'),
    JSON.stringify(
      {
        sourceHar: path.resolve(harPath),
        requestCount: requests.length,
        responses: results,
      },
      null,
      2
    ),
    'utf8'
  );

  process.stdout.write(`Replayed ${requests.length} requests to ${replayDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
