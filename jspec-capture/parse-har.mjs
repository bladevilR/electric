import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  normalizeCapture,
  shouldCaptureResponse,
  writeCaptureSet,
} from './lib/capture-utils.mjs';

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }

  return process.argv[index + 1];
}

export function decodeHarText(content = {}) {
  if (!content.text) {
    return '';
  }

  if (content.encoding === 'base64') {
    return Buffer.from(content.text, 'base64').toString('utf8');
  }

  return content.text;
}

export function buildCapturesFromHar(entries = []) {
  return entries
    .map((entry, index) => {
      const url = entry?.request?.url ?? '';
      const status = entry?.response?.status ?? 0;
      const contentType =
        entry?.response?.content?.mimeType ??
        entry?.response?.headers?.find?.((header) => header.name?.toLowerCase() === 'content-type')
          ?.value ??
        '';
      const resourceType = entry?._resourceType ?? entry?._initiator?.type ?? 'xhr';

      if (
        !shouldCaptureResponse({
          url,
          resourceType,
          status,
          contentType,
        })
      ) {
        return null;
      }

      return normalizeCapture({
        index: index + 1,
        capturedAt: entry.startedDateTime ?? new Date().toISOString(),
        url,
        status,
        resourceType,
        method: entry?.request?.method ?? 'GET',
        contentType,
        headers: Object.fromEntries(
          (entry?.response?.headers ?? []).map((header) => [header.name, header.value])
        ),
        bodyText: decodeHarText(entry?.response?.content),
      });
    })
    .filter(Boolean);
}

export async function main() {
  const harPath = getArgValue('--har', '');
  const outputRoot = path.resolve(getArgValue('--output-dir', './output'));

  if (!harPath) {
    throw new Error('Missing --har <path-to-har>');
  }

  const harPayload = JSON.parse(await readFile(path.resolve(harPath), 'utf8'));
  const entries = harPayload?.log?.entries ?? [];
  const captures = buildCapturesFromHar(entries);

  const captureDir = await writeCaptureSet({
    outputRoot,
    captures,
    pageUrl: entries[0]?.request?.url ?? '',
    snapshotHtml: '',
    snapshotText: '',
  });

  process.stdout.write(`Saved ${captures.length} HAR responses to ${captureDir}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
