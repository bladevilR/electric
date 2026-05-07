import { buildJspecSpaUrl, getTargetsByIds } from './lib/target-url.mjs';
import { loadPlaywright } from './lib/playwright-loader.mjs';

const { chromium } = loadPlaywright();

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }

  return process.argv[index + 1];
}

function getTargetsArg() {
  const value = getArgValue('--targets', 'actual_load_96,settle_day');
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

async function main() {
  const debugUrl = getArgValue('--debug-url', 'http://127.0.0.1:9333');
  const waitMs = Number(getArgValue('--wait-ms', '60000'));
  const targetIds = getTargetsArg();
  const targets = getTargetsByIds(targetIds);

  const endpoint = await resolveDebugEndpoint(debugUrl);
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('Connected browser has no available context.');
  }

  const page =
    context.pages().find((candidate) => candidate.url().includes('jspec.com.cn')) ??
    (await context.newPage());

  for (const target of targets) {
    const route = target.routeFragments[0];
    const url = buildJspecSpaUrl(route);
    process.stdout.write(`[open] ${target.priority} ${target.name}: ${url}\n`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(waitMs);
  }

  process.stdout.write(`Opened ${targets.length} JSPEC target page(s).\n`);

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
