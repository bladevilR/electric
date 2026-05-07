import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { buildCapturesFromHar } from '../parse-har.mjs';
import { writeCaptureSet } from './capture-utils.mjs';

test('parse-har script converts jspec JSON entries into capture files', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'jspec-har-'));

  const harPayload = {
    log: {
      entries: [
        {
          startedDateTime: '2026-04-20T10:00:00.000Z',
          _resourceType: 'xhr',
          request: {
            method: 'GET',
            url: 'https://www.jspec.com.cn/api/dashboard/summary',
          },
          response: {
            status: 200,
            headers: [{ name: 'content-type', value: 'application/json' }],
            content: {
              mimeType: 'application/json',
              text: JSON.stringify({ data: { total: 7 } }),
            },
          },
        },
      ],
    },
  };

  try {
    const captures = buildCapturesFromHar(harPayload.log.entries);
    assert.equal(captures.length, 1);

    const captureDirName = await writeCaptureSet({
      outputRoot: tempRoot,
      captures,
      pageUrl: harPayload.log.entries[0].request.url,
      snapshotHtml: '',
      snapshotText: '',
    });

    const indexPayload = JSON.parse(
      await readFile(path.join(captureDirName, 'index.json'), 'utf8')
    );
    assert.equal(indexPayload.captureCount, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
