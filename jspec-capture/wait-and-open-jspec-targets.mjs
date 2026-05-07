import { isLikelyLoggedIn } from './lib/login-state.mjs';
import { buildJspecSpaUrl, getTargetsByIds } from './lib/target-url.mjs';
import { loadPlaywright } from './lib/playwright-loader.mjs';

const { chromium } = loadPlaywright();

const DEFAULT_P0_TARGETS = [
  'user_bid_96',
  'user_default_bid_96',
  'dayahead_user_clearing',
  'dayahead_public_clearing',
  'realtime_public_clearing',
  'realtime_average_price',
  'actual_load_96',
  'settle_day',
];

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }

  return process.argv[index + 1];
}

function getTargetsArg() {
  const value = getArgValue('--targets', DEFAULT_P0_TARGETS.join(','));
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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

async function findJspecPage(context) {
  return (
    context.pages().find((candidate) => candidate.url().includes('jspec.com.cn')) ??
    (await context.newPage())
  );
}

async function waitForLogin({ page, timeoutMs, pollMs }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (isLikelyLoggedIn({ url: page.url(), text })) {
      return;
    }

    process.stdout.write(`[wait] JSPEC is not logged in yet: ${page.url()}\n`);
    await page.waitForTimeout(pollMs);
  }

  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} seconds waiting for JSPEC login.`);
}

async function main() {
  const debugUrl = getArgValue('--debug-url', 'http://127.0.0.1:9333');
  const waitMs = Number(getArgValue('--wait-ms', '60000'));
  const timeoutMs = Number(getArgValue('--timeout-ms', String(30 * 60 * 1000)));
  const pollMs = Number(getArgValue('--poll-ms', '3000'));
  const targetIds = getTargetsArg();
  const targets = getTargetsByIds(targetIds);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    let browser;
    try {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      const endpoint = await resolveDebugEndpoint(debugUrl);
      browser = await chromium.connectOverCDP(endpoint);
      const context = browser.contexts()[0];
      if (!context) {
        throw new Error('Connected browser has no available context.');
      }

      const page = await findJspecPage(context);
      await waitForLogin({ page, timeoutMs: remainingMs, pollMs });
      process.stdout.write('[login] JSPEC login detected. Opening target pages.\n');

      for (const target of targets) {
        const route = target.routeFragments[0];
        const url = buildJspecSpaUrl(route);
        process.stdout.write(`[open] ${target.priority} ${target.id}: ${url}\n`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForTimeout(waitMs);
      }

      process.stdout.write(`Opened ${targets.length} JSPEC target page(s).\n`);

      if (typeof browser.disconnect === 'function') {
        browser.disconnect();
      } else {
        await browser.close();
      }
      return;
    } catch (error) {
      if (browser) {
        if (typeof browser.disconnect === 'function') {
          browser.disconnect();
        } else {
          await browser.close().catch(() => {});
        }
      }
      process.stderr.write(`[retry] ${error.message}\n`);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} seconds waiting for JSPEC login.`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
