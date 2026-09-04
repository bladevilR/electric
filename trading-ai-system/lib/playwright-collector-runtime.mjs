import path from 'node:path';

import { chromium as defaultChromium } from 'playwright';
import { buildManagedBrowserLaunch } from './ukey-browser-collector.mjs';

const STATES = new Set([
  'uninitialized',
  'login_required',
  'ready',
  'collecting',
  'paused',
  'rate_limited',
  'login_expired',
  'page_changed',
  'error',
  'stopped',
]);

const LOGIN_URL_PATTERN = /(?:#\/outNet|\/outNet|\/login|\/signin)(?:[/?#]|$)/i;
const LOGIN_TEXT_PATTERN = /UKey\s*登录|外网登录|用户登录|请登录/i;
const AUTHENTICATED_ROUTE_PATTERN = /#\/(?:dashboard|pxf-[a-z0-9-]+)(?:[/?#]|$)/i;
const BUSINESS_TEXT_PATTERN = /日前交易|实时市场|结算管理|电力交易工作台/i;
const BUSINESS_LANDMARKS = '[data-jspec-business-root], [data-jspec-page="business"]';

function nowFrom(clock) {
  const value = clock();
  if (!Number.isFinite(Date.parse(value))) throw new Error('collector_clock_invalid');
  return value;
}

function safeErrorMessage(value) {
  const text = String(value || '');
  if (/cookie|token|ticket|authorization|password|passwd|secret|credential|cert|private.?key|pin/i.test(text)) {
    return 'Collector error details were hidden because they may contain sensitive data.';
  }
  return text;
}

export function createPlaywrightCollectorRuntime(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const launchDefaults = buildManagedBrowserLaunch({ rootDir, env: options.env || process.env });
  const chromium = options.playwright?.chromium || defaultChromium;
  const executablePath = options.executablePath || launchDefaults.executablePath;
  const profileDir = path.resolve(options.profileDir || path.join(rootDir, '.browser', 'jspec-playwright-profile'));
  const launchUrl = String(options.launchUrl || launchDefaults.launchUrl || 'https://www.jspec.com.cn/');
  const headless = options.headless === true;
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
  const listeners = new Set();

  let context = null;
  let managedPage = null;
  let state = 'uninitialized';
  let startedAt = null;
  let updatedAt = null;
  let lastReadyAt = null;
  let lastHealthCheckAt = null;
  let lastPageUrl = null;
  let lastPageTitle = null;
  let lastErrorCode = null;
  let lastErrorMessage = null;
  let everReady = false;

  function status() {
    return {
      state,
      browserName: launchDefaults.browserName || 'Google Chrome',
      executablePath: executablePath || null,
      profileDir,
      headless,
      startedAt,
      updatedAt,
      lastReadyAt,
      lastHealthCheckAt,
      lastPageUrl,
      lastPageTitle,
      lastErrorCode,
      lastErrorMessage,
    };
  }

  function emit() {
    const snapshot = status();
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  }

  function transition(nextState, details = {}) {
    if (!STATES.has(nextState)) throw new Error(`collector_state_invalid:${nextState}`);
    state = nextState;
    updatedAt = nowFrom(clock);
    if (nextState === 'ready') {
      everReady = true;
      lastReadyAt = updatedAt;
      lastErrorCode = null;
      lastErrorMessage = null;
    } else if (details.errorCode || details.errorMessage) {
      lastErrorCode = details.errorCode ? String(details.errorCode) : null;
      lastErrorMessage = details.errorMessage ? safeErrorMessage(details.errorMessage) : null;
    }
    return emit();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('collector_listener_required');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function selectManagedPage() {
    const pages = context.pages();
    managedPage = pages.find((page) => page.url().includes('jspec')) || pages[0] || await context.newPage();
    if (managedPage.url() === 'about:blank') {
      await managedPage.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    return managedPage;
  }

  async function bringManagedWindowToFront() {
    if (!managedPage || managedPage.isClosed()) throw new Error('collector_browser_not_started');
    if (!headless && typeof context?.newCDPSession === 'function') {
      let session;
      try {
        session = await context.newCDPSession(managedPage);
        const { windowId } = await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'normal' },
        });
      } catch {
        // Page activation below remains the portable fallback when window bounds are unavailable.
      } finally {
        await session?.detach().catch(() => {});
      }
    }
    await managedPage.bringToFront();
  }

  async function healthCheck() {
    if (!context || !managedPage || managedPage.isClosed()) throw new Error('collector_browser_not_started');
    lastHealthCheckAt = nowFrom(clock);
    try {
      lastPageUrl = managedPage.url();
      lastPageTitle = await managedPage.title();
      const [landmarkCount, bodyText] = await Promise.all([
        managedPage.locator(BUSINESS_LANDMARKS).count(),
        managedPage.locator('body').innerText({ timeout: 3000 }).catch(() => ''),
      ]);
      const isLogin = LOGIN_URL_PATTERN.test(lastPageUrl) || LOGIN_TEXT_PATTERN.test(bodyText);
      if (isLogin) {
        return transition(everReady ? 'login_expired' : 'login_required', {
          errorCode: everReady ? 'login_expired' : null,
          errorMessage: everReady ? 'The dedicated JSPEC session requires login again.' : null,
        });
      }
      if (landmarkCount > 0 || BUSINESS_TEXT_PATTERN.test(bodyText) || AUTHENTICATED_ROUTE_PATTERN.test(lastPageUrl)) {
        return transition('ready');
      }
      return transition('page_changed', {
        errorCode: 'business_landmark_missing',
        errorMessage: 'The current page does not expose a recognized JSPEC business landmark.',
      });
    } catch (error) {
      return transition('error', {
        errorCode: 'browser_health_check_failed',
        errorMessage: error?.message || String(error),
      });
    }
  }

  async function start() {
    await options.beforeStart?.();
    if (context) {
      if (!managedPage || managedPage.isClosed()) await selectManagedPage();
      await bringManagedWindowToFront();
      return healthCheck();
    }
    if (!executablePath) {
      return transition('error', {
        errorCode: 'chrome_not_found',
        errorMessage: 'Google Chrome or Microsoft Edge was not found on this computer.',
      });
    }
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        executablePath,
        headless,
        viewport: null,
        args: ['--start-maximized'],
      });
      startedAt = nowFrom(clock);
      await selectManagedPage();
      await bringManagedWindowToFront();
      return healthCheck();
    } catch (error) {
      context = null;
      managedPage = null;
      return transition('error', {
        errorCode: 'browser_start_failed',
        errorMessage: error?.message || String(error),
      });
    }
  }

  async function getPage() {
    if (!context || !managedPage || managedPage.isClosed()) throw new Error('collector_browser_not_started');
    return managedPage;
  }

  async function stop() {
    const activeContext = context;
    context = null;
    managedPage = null;
    if (activeContext) await activeContext.close().catch(() => {});
    state = 'stopped';
    updatedAt = nowFrom(clock);
    lastPageUrl = null;
    lastPageTitle = null;
    return emit();
  }

  return {
    start,
    stop,
    getPage,
    healthCheck,
    status,
    transition,
    subscribe,
  };
}
