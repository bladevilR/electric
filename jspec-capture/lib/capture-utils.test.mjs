import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';

import {
  normalizeCapture,
  redactSensitiveJson,
  shouldCaptureResponse,
  writeCaptureSet,
} from './capture-utils.mjs';

test('shouldCaptureResponse only keeps successful jspec xhr/fetch requests', () => {
  assert.equal(
    shouldCaptureResponse({
      url: 'https://www.jspec.com.cn/api/dashboard',
      resourceType: 'xhr',
      status: 200,
      contentType: 'application/json;charset=utf-8',
    }),
    true
  );

  assert.equal(
    shouldCaptureResponse({
      url: 'https://www.jspec.com.cn/static/js/app.js',
      resourceType: 'script',
      status: 200,
      contentType: 'application/javascript',
    }),
    false
  );

  assert.equal(
    shouldCaptureResponse({
      url: 'https://example.com/api/dashboard',
      resourceType: 'xhr',
      status: 200,
      contentType: 'application/json',
    }),
    false
  );

  assert.equal(
    shouldCaptureResponse({
      url: 'https://www.jspec.com.cn/px-common-authcenter/auth/v2/encryption/login',
      resourceType: 'xhr',
      status: 200,
      contentType: 'application/json',
    }),
    false
  );

  assert.equal(
    shouldCaptureResponse({
      url: 'https://www.jspec.com.cn/px-common-authcenter/auth/v2/captcha/get',
      resourceType: 'xhr',
      status: 200,
      contentType: 'application/json',
    }),
    false
  );

  assert.equal(
    shouldCaptureResponse({
      url: 'https://www.jspec.com.cn/px-gateway-Token/getPxGatewayToken',
      resourceType: 'xhr',
      status: 200,
      contentType: 'application/json',
    }),
    false
  );
});

test('writeCaptureSet persists captured responses and dashboard snapshots', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'jspec-capture-'));

  try {
    const capture = normalizeCapture({
      index: 1,
      capturedAt: '2026-04-20T10:00:00.000Z',
      url: 'https://www.jspec.com.cn/api/dashboard/summary',
      status: 200,
      resourceType: 'xhr',
      method: 'GET',
      contentType: 'application/json',
      headers: { 'content-type': 'application/json' },
      requestHeaders: {
        CurrentRoute: '/pxf-spotgoods-province-extranet/userBid96/index',
      },
      requestBodyText: JSON.stringify({ runDate: '2026-04-27' }),
      bodyText: JSON.stringify({ data: { total: 42 } }),
    });

    const captureDir = await writeCaptureSet({
      outputRoot: tempRoot,
      captures: [capture],
      pageUrl: 'https://www.jspec.com.cn/#/dashboard',
      snapshotHtml: '<main>dashboard</main>',
      snapshotText: 'dashboard',
    });

    const indexPayload = JSON.parse(
      await readFile(path.join(captureDir, 'index.json'), 'utf8')
    );
    assert.equal(indexPayload.captureCount, 1);
    assert.equal(indexPayload.responses[0].url, 'https://www.jspec.com.cn/api/dashboard/summary');
    assert.equal(indexPayload.responses[0].businessTarget.id, 'user_bid_96');

    const responseFiles = await readdir(path.join(captureDir, 'responses'));
    assert.equal(responseFiles.length, 1);

    const responsePayload = JSON.parse(
      await readFile(path.join(captureDir, 'responses', responseFiles[0]), 'utf8')
    );
    assert.equal(responsePayload.bodyJson.data.total, 42);
    assert.equal(responsePayload.meta.requestHeaders.CurrentRoute, '/pxf-spotgoods-province-extranet/userBid96/index');
    assert.equal(responsePayload.meta.requestBodyJson.runDate, '2026-04-27');
    assert.equal(responsePayload.businessTarget.id, 'user_bid_96');

    const snapshotText = await readFile(path.join(captureDir, 'dashboard.txt'), 'utf8');
    assert.equal(snapshotText, 'dashboard');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('normalizeCapture redacts session credentials but keeps routing metadata', () => {
  const capture = normalizeCapture({
    index: 1,
    capturedAt: '2026-04-27T10:00:00.000Z',
    url: 'https://www.jspec.com.cn/px-common-service/queryPage',
    status: 200,
    resourceType: 'xhr',
    method: 'POST',
    contentType: 'application/json',
    headers: { 'set-cookie': 'session=secret', 'content-type': 'application/json' },
    requestHeaders: {
      CurrentRoute:
        '/pxf-spotgoods-province-extranet/realTimeClearingRelease/RealTimeMarAvePricePublic',
      'x-ticket': 'secret-ticket',
      Cookie: 'SESSION=secret',
      Authorization: 'Bearer secret',
    },
    requestBodyText: JSON.stringify({
      dataTime: '2026-04-27',
      ticket: 'secret-ticket',
      userName: 'secret-user',
    }),
    bodyText: JSON.stringify({ data: [] }),
  });

  assert.equal(capture.meta.requestHeaders.CurrentRoute.includes('RealTimeMarAvePricePublic'), true);
  assert.equal(capture.meta.requestHeaders['x-ticket'], '[REDACTED]');
  assert.equal(capture.meta.requestHeaders.Cookie, '[REDACTED]');
  assert.equal(capture.meta.requestHeaders.Authorization, '[REDACTED]');
  assert.equal(capture.meta.headers['set-cookie'], '[REDACTED]');
  assert.equal(capture.meta.requestBodyJson.ticket, '[REDACTED]');
  assert.equal(capture.meta.requestBodyJson.userName, '[REDACTED]');
  assert.equal(capture.meta.requestBodyJson.dataTime, '2026-04-27');
  assert.equal(capture.businessTarget.id, 'realtime_average_price');
});

test('redactSensitiveJson recursively redacts credential-like keys', () => {
  assert.deepEqual(
    redactSensitiveJson({
      dataTime: '2026-05-08',
      authKey: {
        sm2: 'secret-sm2',
        sm4: 'secret-sm4',
        secureCode: 'secret-code',
      },
      nested: [{ token: 'secret-token', value: 1 }],
    }),
    {
      dataTime: '2026-05-08',
      authKey: '[REDACTED]',
      nested: [{ token: '[REDACTED]', value: 1 }],
    }
  );
});
