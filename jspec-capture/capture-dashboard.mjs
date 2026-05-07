import path from 'node:path';

import {
  normalizeCapture,
  shouldCaptureResponse,
  writeCaptureSet,
} from './lib/capture-utils.mjs';
import { loadPlaywright } from './lib/playwright-loader.mjs';

const { chromium } = loadPlaywright();

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }

  return process.argv[index + 1];
}

async function resolveDebugEndpoint(debugUrl) {
  if (debugUrl.startsWith('ws://') || debugUrl.startsWith('wss://')) {
    return debugUrl;
  }

  const versionUrl = `${debugUrl.replace(/\/+$/, '')}/json/version`;
  const response = await fetch(versionUrl);

  if (!response.ok) {
    throw new Error(`Could not read ${versionUrl}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload.webSocketDebuggerUrl) {
    throw new Error(`No webSocketDebuggerUrl was returned from ${versionUrl}.`);
  }

  return payload.webSocketDebuggerUrl;
}

async function main() {
  const debugUrl = getArgValue('--debug-url', 'http://127.0.0.1:9222');
  const pageUrl = getArgValue('--page-url', 'https://www.jspec.com.cn/#/dashboard');
  const outputRoot = path.resolve(getArgValue('--output-dir', './output'));
  const waitMs = Number(getArgValue('--wait-ms', '8000'));

  let browser;
  try {
    const endpoint = await resolveDebugEndpoint(debugUrl);
    browser = await chromium.connectOverCDP(endpoint);
  } catch (error) {
    throw new Error(
      `Could not connect to a debug browser at ${debugUrl}. Start Chrome with open-chrome-debug.ps1, sign in if needed, then rerun this command.\n${error.message}`
    );
  }

  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('Connected browser has no available context.');
  }

  let page = context
    .pages()
    .find((item) => item.url().includes('jspec.com.cn'));

  if (!page) {
    page = context.pages().find((item) => item.url() === 'about:blank');
  }

  if (!page) {
    page = await context.newPage();
  }

  const captures = [];

  const responseListener = async (response) => {
    const request = response.request();
    const resourceType = request.resourceType();
    const url = response.url();
    const contentType = response.headers()['content-type'] ?? '';

    if (
      !shouldCaptureResponse({
        url,
        resourceType,
        status: response.status(),
        contentType,
      })
    ) {
      return;
    }

    let bodyText;
    let requestHeaders = {};
    let requestBodyText = null;
    try {
      bodyText = await response.text();
      requestHeaders = await request.headers();
      requestBodyText = request.postData();
    } catch {
      return;
    }

    captures.push(
      normalizeCapture({
        index: captures.length + 1,
        capturedAt: new Date().toISOString(),
        url,
        status: response.status(),
        resourceType,
        method: request.method(),
        contentType,
        headers: response.headers(),
        requestHeaders,
        requestBodyText,
        pageUrl: page.url(),
        bodyText,
      })
    );

    process.stdout.write(`[capture] ${response.status()} ${request.method()} ${url}\n`);
  };

  page.on('response', responseListener);

  if (!page.url().includes('jspec.com.cn')) {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  await page.waitForTimeout(waitMs);

  const snapshotHtml = await page.content();
  const snapshotText = await page.locator('body').innerText().catch(() => '');

  const captureDir = await writeCaptureSet({
    outputRoot,
    captures,
    pageUrl,
    snapshotHtml,
    snapshotText,
  });

  page.off('response', responseListener);

  process.stdout.write(`Saved ${captures.length} responses to ${captureDir}\n`);
  await browser.close();
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
