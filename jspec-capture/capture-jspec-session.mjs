import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  normalizeCapture,
  shouldCaptureResponse,
} from './lib/capture-utils.mjs';
import { listBusinessTargets } from './lib/jspec-targets.mjs';
import { loadPlaywright } from './lib/playwright-loader.mjs';
import { createSessionWriter } from './lib/session-writer.mjs';

const { chromium } = loadPlaywright();

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }

  return process.argv[index + 1];
}

function hasArg(name) {
  return process.argv.includes(name);
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

function shouldKeepCapture(capture, captureAll) {
  if (captureAll) {
    return true;
  }

  return Boolean(capture.businessTarget);
}

async function attachPage({ page, captures, captureAll, writer }) {
  if (page.__jspecCaptureAttached) {
    return;
  }
  page.__jspecCaptureAttached = true;

  page.on('response', async (response) => {
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

    const capture = normalizeCapture({
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
    });

    if (!shouldKeepCapture(capture, captureAll)) {
      return;
    }

    captures.push(capture);
    await writer.writeCapture(capture);
    const targetLabel = capture.businessTarget
      ? `${capture.businessTarget.priority} ${capture.businessTarget.name}`
      : 'unclassified';
    process.stdout.write(
      `[capture] ${String(captures.length).padStart(3, '0')} ${response.status()} ${request.method()} ${targetLabel} ${url}\n`
    );
  });
}

async function writeTargetGuide(outputRoot) {
  const targets = listBusinessTargets();
  const lines = [
    '# JSPEC capture targets',
    '',
    'Open these pages in the debug Chrome window while this session is running.',
    '',
    '| Priority | Required | Name | Route | Output |',
    '| --- | --- | --- | --- | --- |',
    ...targets.map((target) => {
      const route = target.routeFragments[0] ?? '';
      return `| ${target.priority} | ${target.required ? 'yes' : 'no'} | ${target.name} | \`${route}\` | ${target.outputHint} |`;
    }),
    '',
  ];

  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, 'target-guide.md'), lines.join('\n'), 'utf8');
}

async function main() {
  const debugUrl = getArgValue('--debug-url', 'http://127.0.0.1:9333');
  const outputRoot = path.resolve(getArgValue('--output-dir', './output'));
  const durationMs = Number(getArgValue('--duration-ms', String(30 * 60 * 1000)));
  const captureAll = hasArg('--all');
  const openDashboard = !hasArg('--no-open-dashboard');
  const pageUrl = getArgValue('--page-url', 'https://www.jspec.com.cn/#/dashboard');

  await writeTargetGuide(outputRoot);

  let browser;
  try {
    const endpoint = await resolveDebugEndpoint(debugUrl);
    browser = await chromium.connectOverCDP(endpoint);
  } catch (error) {
    throw new Error(
      `Could not connect to a debug browser at ${debugUrl}. Start Chrome with open-chrome-debug.ps1, sign in, then rerun this command.\n${error.message}`
    );
  }

  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('Connected browser has no available context.');
  }

  const captures = [];
  const writer = await createSessionWriter({
    outputRoot,
    pageUrl,
    session: {
      debugUrl,
      requestedDurationMs: durationMs,
      captureAll,
      openDashboard,
    },
  });

  context.on('page', (page) => {
    attachPage({ page, captures, captureAll, writer }).catch((error) => {
      process.stderr.write(`Could not attach to new page: ${error.message}\n`);
    });
  });

  for (const page of context.pages()) {
    await attachPage({ page, captures, captureAll, writer });
  }

  if (openDashboard && !context.pages().some((page) => page.url().includes('jspec.com.cn'))) {
    const page = await context.newPage();
    await attachPage({ page, captures, captureAll, writer });
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  }

  process.stdout.write(
    `Listening for JSPEC responses for ${Math.round(durationMs / 1000)} seconds. Open target pages in the debug Chrome window.\n`
  );
  process.stdout.write(
    `Output directory: ${writer.captureDir}\n`
  );
  process.stdout.write(
    captureAll
      ? 'Mode: capture all successful JSPEC XHR/fetch responses.\n'
      : 'Mode: capture only classified business target responses. Use --all to keep every JSPEC XHR/fetch response.\n'
  );

  let interrupted = false;
  const stop = () => {
    interrupted = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const startedAt = Date.now();
  while (!interrupted && Date.now() - startedAt < durationMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const jspecPage = context.pages().find((page) => page.url().includes('jspec.com.cn'));
  const snapshotHtml = jspecPage ? await jspecPage.content().catch(() => '') : '';
  const snapshotText = jspecPage ? await jspecPage.locator('body').innerText().catch(() => '') : '';

  await writer.finalize({
    pageUrl: jspecPage?.url() ?? pageUrl,
    snapshotHtml,
    snapshotText,
    session: {
        debugUrl,
        durationMs: Date.now() - startedAt,
        captureAll,
        interrupted,
    },
  });

  process.stdout.write(`Saved ${captures.length} responses to ${writer.captureDir}\n`);

  if (typeof browser.disconnect === 'function') {
    browser.disconnect();
  } else {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
