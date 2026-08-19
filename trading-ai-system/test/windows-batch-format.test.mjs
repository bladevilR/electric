import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const launcherPath = fileURLToPath(new URL('../启动系统.bat', import.meta.url));
const powershellLauncherPath = fileURLToPath(new URL('../start-system.ps1', import.meta.url));
const homePath = fileURLToPath(new URL('../index.html', import.meta.url));
const packageScriptPath = fileURLToPath(new URL('../tools/package-one-minute.mjs', import.meta.url));

test('Windows batch launcher uses CRLF for every line break', async () => {
  const launcher = await readFile(launcherPath, 'utf8');

  assert.match(launcher, /\r\n/, 'launcher must contain Windows CRLF line breaks');
  assert.doesNotMatch(launcher, /(?<!\r)\n/, 'launcher must not contain lone LF line breaks');
});

test('Windows onboarding package declares its local sample data as a required asset', async () => {
  const packageScript = await readFile(packageScriptPath, 'utf8');

  assert.match(packageScript, /['"]data\/standard-96\.sample\.json['"]/);
  assert.doesNotMatch(packageScript, /['"]\.env\.production\.example['"]/);
});

test('Windows onboarding package declares every browser boot dependency', async () => {
  const packageScript = await readFile(packageScriptPath, 'utf8');

  assert.match(packageScript, /['"]workbench-motion\.js['"]/);
  assert.match(packageScript, /['"]vendor['"]/);
  assert.match(packageScript, /spawnSync\(['"]zip['"]/);
});

test('Windows launcher prefers a modern browser instead of the system default', async () => {
  const launcher = await readFile(powershellLauncherPath, 'utf8');

  assert.match(launcher, /msedge\.exe/);
  assert.match(launcher, /chrome\.exe/);
  assert.ok(launcher.indexOf('chrome.exe') < launcher.indexOf('msedge.exe'));
  assert.match(launcher, /function Open-WorkbenchBrowser/);
});

test('Windows launcher stores cumulative trading history in LocalAppData', async () => {
  const launcher = await readFile(powershellLauncherPath, 'utf8');

  assert.match(launcher, /LOCALAPPDATA/);
  assert.match(launcher, /ElectricTradingAI/);
  assert.match(launcher, /TRADING_VISIBLE_HISTORY_PATH/);
  assert.match(launcher, /ukey-visible-history\.json/);
});

test('legacy browsers show an actionable compatibility error instead of permanent loading', async () => {
  const home = await readFile(homePath, 'utf8');

  assert.match(home, /<script nomodule>/);
  assert.match(home, /请使用 Microsoft Edge 或 Google Chrome/);
});
