import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir } from 'node:fs/promises';

import {
  normalizeCapture,
  shouldCaptureResponse,
  writeCaptureSet,
} from './lib/capture-utils.mjs';
import { loadPlaywright } from './lib/playwright-loader.mjs';
import { cloneChromeProfile } from './lib/profile-clone.mjs';

const { chromium } = loadPlaywright();

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }

  return process.argv[index + 1];
}

async function main() {
  const sourceUserDataDir = path.resolve(
    getArgValue('--user-data-dir', `${process.env.LOCALAPPDATA}/Google/Chrome/User Data`)
  );
  const profileName = getArgValue('--profile', 'Profile 4');
  const pageUrl = getArgValue('--page-url', 'https://www.jspec.com.cn/#/dashboard');
  const outputRoot = path.resolve(getArgValue('--output-dir', './output'));
  const waitMs = Number(getArgValue('--wait-ms', '12000'));
  const workRoot = path.resolve(getArgValue('--work-dir', './work'));
  const chromeExecutable = getArgValue(
    '--chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
  );

  await mkdir(workRoot, { recursive: true });
  const cloneRoot = await mkdtemp(path.join(workRoot, `chrome-clone-${Date.now()}-`));
  await cloneChromeProfile({ sourceUserDataDir, profileName, cloneRoot });

  const context = await chromium.launchPersistentContext(cloneRoot, {
    executablePath: chromeExecutable,
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check'],
    viewport: { width: 1440, height: 960 },
  });

  try {
    let page = context.pages()[0] ?? (await context.newPage());
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
      try {
        bodyText = await response.text();
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
          bodyText,
        })
      );
    };

    page.on('response', responseListener);

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
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

    process.stdout.write(`Saved ${captures.length} responses to ${captureDir}\n`);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
