import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';

import { normalizeCapture } from './capture-utils.mjs';
import { createSessionWriter } from './session-writer.mjs';

test('createSessionWriter persists each capture immediately', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'jspec-session-'));

  try {
    const writer = await createSessionWriter({
      outputRoot: tempRoot,
      pageUrl: 'https://www.jspec.com.cn/#/dashboard',
      session: {
        debugUrl: 'http://127.0.0.1:9333',
        captureAll: true,
      },
    });

    const capture = normalizeCapture({
      index: 1,
      capturedAt: '2026-04-27T02:30:00.000Z',
      url: 'https://www.jspec.com.cn/px-common-service/queryPage',
      status: 200,
      resourceType: 'xhr',
      method: 'POST',
      contentType: 'application/json',
      headers: { 'content-type': 'application/json' },
      requestHeaders: {
        CurrentRoute:
          '/pxf-spotgoods-province-extranet/realTimeClearingRelease/RealTimeMarAvePricePublic',
      },
      requestBodyText: JSON.stringify({ date: '2026-04-27' }),
      pageUrl: 'https://www.jspec.com.cn/#/dashboard',
      bodyText: JSON.stringify({ data: [{ price: 321.12 }] }),
    });

    await writer.writeCapture(capture);

    const indexPayload = JSON.parse(
      await readFile(path.join(writer.captureDir, 'index.json'), 'utf8')
    );
    assert.equal(indexPayload.captureCount, 1);
    assert.equal(indexPayload.responses[0].businessTarget.id, 'realtime_average_price');

    const responseFiles = await readdir(path.join(writer.captureDir, 'responses'));
    assert.equal(responseFiles.length, 1);

    const responsePayload = JSON.parse(
      await readFile(path.join(writer.captureDir, 'responses', responseFiles[0]), 'utf8')
    );
    assert.equal(responsePayload.bodyJson.data[0].price, 321.12);

    const events = await readFile(path.join(writer.captureDir, 'events.jsonl'), 'utf8');
    assert.match(events, /realtime_average_price/);

    const coverage = await readFile(path.join(writer.captureDir, 'coverage-summary.md'), 'utf8');
    assert.match(coverage, /Total captures: 1/);

    await writer.finalize({
      pageUrl: 'https://www.jspec.com.cn/#/dashboard',
      snapshotHtml: '<main>dashboard</main>',
      snapshotText: 'dashboard',
      session: {
        durationMs: 1000,
        interrupted: false,
      },
    });

    assert.equal(
      await readFile(path.join(writer.captureDir, 'dashboard.txt'), 'utf8'),
      'dashboard'
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
