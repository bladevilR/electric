import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';
import { buildManagedBrowserLaunch } from '../lib/ukey-browser-collector.mjs';
import { createPlaywrightCollectorRuntime } from '../lib/playwright-collector-runtime.mjs';

async function createFixtureServer() {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (request.url.startsWith('/dashboard')) {
      response.end(`<!doctype html><html><head><title>电力交易平台</title></head><body>
        <main data-jspec-business-root><h1>工作台</h1><nav>日前交易 实时市场 结算管理</nav></main>
      </body></html>`);
      return;
    }
    response.end(`<!doctype html><html><head><title>电力交易平台</title></head><body>
      <main><h1>外网登录</h1><button>UKey 登录</button></main>
    </body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function runtimeFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'playwright-collector-runtime-'));
  const server = await createFixtureServer();
  const launch = buildManagedBrowserLaunch({ rootDir: directory });
  assert.equal(launch.available, true, 'Chrome or Edge is required for the collector runtime test');
  const runtime = createPlaywrightCollectorRuntime({
    rootDir: directory,
    playwright: { chromium },
    executablePath: launch.executablePath,
    profileDir: path.join(directory, 'profile'),
    launchUrl: `${server.baseUrl}/out#/outNet`,
    headless: true,
    clock: () => '2026-09-03T10:00:00.000Z',
  });
  return {
    directory,
    server,
    runtime,
    async close() {
      await runtime.stop();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('persistent runtime recognizes login, readiness, and operational transitions in real Chrome', async () => {
  const context = await runtimeFixture();
  try {
    const observedStates = [];
    const unsubscribe = context.runtime.subscribe((status) => observedStates.push(status.state));
    const started = await context.runtime.start();
    assert.equal(started.state, 'login_required');
    assert.match(started.profileDir, /profile$/);
    assert.equal(started.headless, true);

    const page = await context.runtime.getPage();
    await page.goto(`${context.server.baseUrl}/dashboard#/dashboard`);
    assert.equal((await context.runtime.healthCheck()).state, 'ready');
    assert.equal(context.runtime.transition('collecting').state, 'collecting');
    assert.equal(context.runtime.transition('ready').state, 'ready');
    assert.equal(context.runtime.transition('rate_limited', {
      errorCode: 'rate_limited',
      errorMessage: '访问频率过高',
    }).state, 'rate_limited');

    const serialized = JSON.stringify(context.runtime.status());
    assert.doesNotMatch(serialized, /cookie|token|storageState|password|pin/i);
    assert.equal(context.runtime.status().lastErrorCode, 'rate_limited');
    assert.deepEqual(observedStates, ['login_required', 'ready', 'collecting', 'ready', 'rate_limited']);
    unsubscribe();
  } finally {
    await context.close();
  }
});

test('start reuses one context and stop leaves a stable stopped state', async () => {
  const context = await runtimeFixture();
  try {
    await context.runtime.start();
    const firstPage = await context.runtime.getPage();
    await context.runtime.start();
    const secondPage = await context.runtime.getPage();
    assert.equal(firstPage, secondPage);

    const stopped = await context.runtime.stop();
    assert.equal(stopped.state, 'stopped');
    await assert.rejects(() => context.runtime.getPage(), /collector_browser_not_started/);
  } finally {
    await context.close();
  }
});

test('login redirect after readiness is reported as login_expired', async () => {
  const context = await runtimeFixture();
  try {
    await context.runtime.start();
    const page = await context.runtime.getPage();
    await page.goto(`${context.server.baseUrl}/dashboard#/dashboard`);
    assert.equal((await context.runtime.healthCheck()).state, 'ready');
    await page.goto(`${context.server.baseUrl}/out#/outNet`);
    assert.equal((await context.runtime.healthCheck()).state, 'login_expired');
  } finally {
    await context.close();
  }
});
