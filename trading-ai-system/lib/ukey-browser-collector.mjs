import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_JSPEC_URL = 'https://www.jspec.com.cn/';
const DEFAULT_DEBUG_ADDRESS = '127.0.0.1';
const DEFAULT_DEBUG_PORT = 9224;
const DEFAULT_INTERVAL_SECONDS = 30;
const SNAPSHOT_SOURCE = 'jspec_managed_browser_visible_page';
const SENSITIVE_FIELD_PATTERN =
  /cookie|token|ticket|authorization|password|passwd|secret|credential|cert|private.?key|pin/i;

const FIELD_RULES = [
  { field: 'date', patterns: [/交易日期|业务日期|日期|date/i] },
  { field: 'pointIndex', patterns: [/点位|序号|时段序号|节点序号|point|index/i] },
  { field: 'timePoint', patterns: [/时点|时间点|时间|时段|交易时段|period|time/i] },
  { field: 'realTimeAvgPrice', patterns: [/实时.*加权.*均价|实时.*均价|加权.*均价|实时平均价/i] },
  { field: 'realTimePointPriceCurrent', patterns: [/实时.*节点.*电价|实时.*出清.*价|实时.*价格|节点.*电价/i] },
  { field: 'defaultDeclarationPower', patterns: [/缺省.*申报|缺省.*电力|缺省.*功率|默认.*申报/i] },
  { field: 'declarationPower', patterns: [/主动.*申报|申报.*电力|申报.*功率|申报量/i] },
  { field: 'dayAheadPublicPrice', patterns: [/日前.*公开|日前.*公共|日前.*统一|日前.*出清.*价/i] },
  { field: 'dayAheadUserPrice', patterns: [/日前.*用户|用户侧.*日前|日前.*用户侧/i] },
  { field: 'actualKwh', patterns: [/实际.*电量|实际.*负荷|实际.*用电|kwh|负荷/i] },
  { field: 'settleAmount', patterns: [/结算.*金额|费用|金额|settle/i] },
];

const NUMERIC_FIELDS = new Set([
  'pointIndex',
  'realTimeAvgPrice',
  'realTimePointPriceCurrent',
  'defaultDeclarationPower',
  'declarationPower',
  'dayAheadPublicPrice',
  'dayAheadUserPrice',
  'actualKwh',
  'settleAmount',
]);

const VISIBLE_TABLE_EXPRESSION = `(() => {
  const clean = (value) => String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const tables = Array.from(document.querySelectorAll('table'))
    .filter(isVisible)
    .map((table) => {
      const headerCells = Array.from(table.querySelectorAll('thead th'));
      const fallbackHeaderCells = headerCells.length ? [] : Array.from(table.querySelectorAll('tr:first-child th, tr:first-child td'));
      const headers = (headerCells.length ? headerCells : fallbackHeaderCells).map((cell) => clean(cell.innerText || cell.textContent));
      const rows = Array.from(table.querySelectorAll('tbody tr, tr'))
        .filter((row) => isVisible(row))
        .map((row) => Array.from(row.querySelectorAll('td, th')).map((cell) => clean(cell.innerText || cell.textContent)))
        .filter((row) => row.some(Boolean));
      const dataRows = headers.length && rows.length && rows[0].join('|') === headers.join('|') ? rows.slice(1) : rows;
      return { headers, rows: dataRows };
    });
  return {
    url: window.location.href,
    title: document.title,
    bodyText: clean(document.body ? document.body.innerText : '').slice(0, 4000),
    tables,
    capturedAt: new Date().toISOString()
  };
})()`;

function cleanString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
  return cleanString(value).replace(/[：:（）()\[\]【】\s]/g, '');
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const match = cleanString(value)
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function cleanDate(value) {
  const text = cleanString(value);
  const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (!match) {
    return '';
  }
  return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;
}

function extractDateFromText(...values) {
  for (const value of values) {
    const date = cleanDate(value);
    if (date) {
      return date;
    }
  }
  return '';
}

function mapHeaderToField(header) {
  const normalized = normalizeHeader(header);
  if (!normalized) {
    return '';
  }
  for (const rule of FIELD_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.field;
    }
  }
  return '';
}

function inferPointIndex(value) {
  const text = cleanString(value);
  const explicit = text.includes(':') ? null : text.match(/(?:第)?\s*(\d{1,2})\s*(?:点|段|序)?$/);
  if (explicit) {
    const numeric = Number(explicit[1]);
    if (numeric >= 1 && numeric <= 96) {
      return numeric;
    }
  }

  const times = [...text.matchAll(/(\d{1,2}):(\d{2})/g)];
  if (!times.length) {
    return null;
  }
  const [, rawHour, rawMinute] = times[times.length - 1];
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (hour === 24 && minute === 0) {
    return 96;
  }
  if (hour < 0 || hour > 23 || ![0, 15, 30, 45].includes(minute)) {
    return null;
  }
  const point = hour * 4 + Math.ceil(minute / 15);
  return point >= 1 && point <= 96 ? point : null;
}

function hasBusinessValue(row) {
  return [
    'realTimeAvgPrice',
    'realTimePointPriceCurrent',
    'defaultDeclarationPower',
    'declarationPower',
    'dayAheadPublicPrice',
    'dayAheadUserPrice',
    'actualKwh',
    'settleAmount',
  ].some((field) => row[field] !== null && row[field] !== undefined && row[field] !== '');
}

function browserNameFromPath(executablePath = '') {
  const lower = executablePath.toLowerCase();
  if (lower.includes('msedge')) {
    return 'Edge';
  }
  if (lower.includes('chrome')) {
    return 'Chrome';
  }
  return executablePath ? 'Browser' : 'Unavailable';
}

function standardBrowserCandidates(env = process.env) {
  const candidates = [];
  if (env.JSPEC_BROWSER_PATH) {
    candidates.push(env.JSPEC_BROWSER_PATH);
  }
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return candidates;
}

function findBrowserExecutable(options = {}) {
  if (options.executablePath) {
    return options.executablePath;
  }
  return standardBrowserCandidates(options.env).find((candidate) => existsSync(candidate)) || '';
}

export function buildManagedBrowserLaunch(options = {}) {
  const env = options.env || process.env;
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const jspecUrl = options.jspecUrl || env.JSPEC_URL || DEFAULT_JSPEC_URL;
  const debugAddress = DEFAULT_DEBUG_ADDRESS;
  const debugPort = Number(options.debugPort || env.JSPEC_CDP_PORT || DEFAULT_DEBUG_PORT);
  const profileDir = path.resolve(rootDir, '.browser/jspec-managed-profile');
  const executablePath = findBrowserExecutable(options);
  const browserName = browserNameFromPath(executablePath);
  const args = executablePath
    ? [
        `--remote-debugging-address=${debugAddress}`,
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        jspecUrl,
      ]
    : [];

  return {
    available: Boolean(executablePath) && env.JSPEC_MANAGED_BROWSER_DISABLED !== '1',
    disabled: env.JSPEC_MANAGED_BROWSER_DISABLED === '1',
    browserName,
    executablePath: executablePath || null,
    debugAddress,
    debugPort,
    profileDir,
    launchUrl: jspecUrl,
    args,
  };
}

export function parseVisibleBusinessSnapshot(pageSnapshot = {}, options = {}) {
  const tables = Array.isArray(pageSnapshot.tables) ? pageSnapshot.tables : [];
  const defaultDate =
    cleanDate(options.defaultDate) ||
    extractDateFromText(pageSnapshot.bodyText, pageSnapshot.title, pageSnapshot.url);
  const errors = [];
  const rows = [];
  let matchedTableCount = 0;

  tables.forEach((table, tableIndex) => {
    const headers = Array.isArray(table.headers) ? table.headers.map(cleanString) : [];
    const sensitiveHeaders = headers.filter((header) => SENSITIVE_FIELD_PATTERN.test(header));
    if (sensitiveHeaders.length) {
      errors.push(`Table ${tableIndex + 1} contains sensitive headers: ${sensitiveHeaders.join(', ')}`);
      return;
    }

    const fieldByIndex = headers.map(mapHeaderToField);
    if (!fieldByIndex.some(Boolean)) {
      return;
    }

    let tableMatched = false;
    const tableRows = Array.isArray(table.rows) ? table.rows : [];
    tableRows.forEach((rawCells) => {
      const cells = Array.isArray(rawCells) ? rawCells.map(cleanString) : [];
      const row = {};
      fieldByIndex.forEach((field, index) => {
        if (!field) {
          return;
        }
        const value = cells[index];
        if (NUMERIC_FIELDS.has(field)) {
          row[field] = numberOrNull(value);
        } else if (field === 'date') {
          row[field] = cleanDate(value);
        } else {
          row[field] = cleanString(value);
        }
      });

      if (!row.date) {
        row.date = defaultDate;
      }
      if (row.pointIndex === null || row.pointIndex === undefined) {
        row.pointIndex = inferPointIndex(row.timePoint || cells[0]);
      }
      if (!row.timePoint) {
        const timeCell = cells.find((cell) => /\d{1,2}:\d{2}/.test(cell));
        if (timeCell) {
          row.timePoint = timeCell;
        }
      }

      if (!row.date || !row.pointIndex || !hasBusinessValue(row)) {
        return;
      }

      row.sourceTargets = ['visible_page_snapshot'];
      rows.push(
        Object.fromEntries(
          Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== '')
        )
      );
      tableMatched = true;
    });

    if (tableMatched) {
      matchedTableCount += 1;
    }
  });

  return {
    source: SNAPSHOT_SOURCE,
    generatedAt: pageSnapshot.capturedAt || new Date().toISOString(),
    pageUrl: cleanString(pageSnapshot.url),
    pageTitle: cleanString(pageSnapshot.title),
    tableCount: tables.length,
    matchedTableCount,
    rowCount: rows.length,
    rows,
    errors,
  };
}

function eventDataToString(data) {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer).toString('utf8');
  }
  return String(data);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`CDP HTTP ${response.status}`);
  }
  return response.json();
}

function cdpEvaluate(webSocketDebuggerUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const id = 1;
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error('CDP evaluation timed out'));
    }, 8000);

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: {
            expression,
            returnByValue: true,
          },
        })
      );
    });

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(eventDataToString(event.data));
      if (message.id !== id) {
        return;
      }
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {}
      if (message.error) {
        reject(new Error(message.error.message || 'CDP evaluation failed'));
        return;
      }
      if (message.result?.exceptionDetails) {
        reject(new Error('Visible page evaluation failed'));
        return;
      }
      resolve(message.result?.result?.value || {});
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('CDP websocket connection failed'));
    });
  });
}

export function createUkeyBrowserCollector(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const env = options.env || process.env;
  let launch = buildManagedBrowserLaunch({ rootDir, env, debugPort: options.debugPort });
  let browserProcess = null;
  let browserState = 'stopped';
  let browserStartedAt = null;
  let browserLastError = '';
  let collectorTimer = null;
  let collectorState = 'stopped';
  let lastSampleAt = null;
  let lastRowCount = 0;
  let lastAccepted = false;
  let lastPageUrl = '';
  let lastPageTitle = '';
  let collectorLastError = '';

  function refreshLaunch() {
    launch = buildManagedBrowserLaunch({ rootDir, env, debugPort: options.debugPort });
    return launch;
  }

  function browserWindowStatus() {
    const current = refreshLaunch();
    return {
      available: current.available,
      disabled: current.disabled,
      state: browserState,
      browserName: current.browserName,
      executablePath: current.executablePath,
      debugAddress: current.debugAddress,
      debugPort: current.debugPort,
      profileDir: current.profileDir,
      launchUrl: current.launchUrl,
      pid: browserProcess?.pid || null,
      startedAt: browserStartedAt,
      lastError: browserLastError || null,
    };
  }

  function collectorStatus() {
    return {
      state: collectorState,
      intervalSeconds: DEFAULT_INTERVAL_SECONDS,
      lastSampleAt,
      lastRowCount,
      lastAccepted,
      lastPageUrl,
      lastPageTitle,
      lastError: collectorLastError || null,
    };
  }

  async function startBrowser() {
    const current = refreshLaunch();
    if (!current.available) {
      browserState = 'unavailable';
      browserLastError = current.disabled
        ? 'Managed browser launch is disabled for this process.'
        : 'Chrome or Edge was not found on this computer.';
      return { ok: false, error: browserLastError, browserWindow: browserWindowStatus(), collector: collectorStatus() };
    }
    if (browserProcess && !browserProcess.killed) {
      return { ok: true, browserWindow: browserWindowStatus(), collector: collectorStatus() };
    }

    await mkdir(current.profileDir, { recursive: true });
    browserProcess = spawn(current.executablePath, current.args, {
      cwd: rootDir,
      stdio: 'ignore',
      windowsHide: false,
    });
    browserState = 'running';
    browserStartedAt = new Date().toISOString();
    browserLastError = '';
    browserProcess.once('exit', (code) => {
      browserState = 'stopped';
      browserProcess = null;
      if (code && code !== 0) {
        browserLastError = `Browser exited with code ${code}`;
      }
    });
    browserProcess.unref?.();
    return { ok: true, browserWindow: browserWindowStatus(), collector: collectorStatus() };
  }

  function stopBrowser() {
    stopCollector();
    if (browserProcess && !browserProcess.killed) {
      browserProcess.kill();
    }
    browserProcess = null;
    browserState = 'stopped';
    return { ok: true, browserWindow: browserWindowStatus(), collector: collectorStatus() };
  }

  async function captureVisiblePage() {
    const current = refreshLaunch();
    const targets = await fetchJson(`http://${current.debugAddress}:${current.debugPort}/json`);
    const pages = Array.isArray(targets) ? targets.filter((target) => target.type === 'page') : [];
    const target =
      pages.find((page) => String(page.url || '').includes('jspec')) ||
      pages.find((page) => page.webSocketDebuggerUrl) ||
      null;
    if (!target?.webSocketDebuggerUrl) {
      throw new Error('No visible managed browser page is available.');
    }
    return cdpEvaluate(target.webSocketDebuggerUrl, VISIBLE_TABLE_EXPRESSION);
  }

  async function sampleVisiblePage() {
    try {
      const pageSnapshot = await captureVisiblePage();
      const snapshot = parseVisibleBusinessSnapshot(pageSnapshot);
      lastSampleAt = snapshot.generatedAt;
      lastRowCount = snapshot.rowCount;
      lastPageUrl = snapshot.pageUrl;
      lastPageTitle = snapshot.pageTitle;
      collectorLastError = snapshot.rowCount ? '' : snapshot.errors.join('; ') || 'No visible JSPEC business rows were detected.';
      return snapshot;
    } catch (error) {
      collectorLastError = error?.message || String(error);
      lastSampleAt = new Date().toISOString();
      throw error;
    }
  }

  function recordIngestResult(snapshot = {}) {
    lastAccepted = Boolean(snapshot.accepted);
    lastRowCount = Number(snapshot.rowCount || lastRowCount || 0);
    lastSampleAt = snapshot.generatedAt || lastSampleAt;
    if (Array.isArray(snapshot.errors) && snapshot.errors.length) {
      collectorLastError = snapshot.errors.join('; ');
    } else if (snapshot.accepted) {
      collectorLastError = '';
    }
  }

  function recordCollectorError(error) {
    collectorLastError = error?.message || String(error);
    lastSampleAt = new Date().toISOString();
  }

  function startCollector(onSample, intervalSeconds = DEFAULT_INTERVAL_SECONDS) {
    stopCollector();
    const seconds = Number(intervalSeconds) > 0 ? Number(intervalSeconds) : DEFAULT_INTERVAL_SECONDS;
    collectorState = 'running';
    collectorLastError = '';
    collectorTimer = setInterval(() => {
      Promise.resolve()
        .then(onSample)
        .catch((error) => recordCollectorError(error));
    }, seconds * 1000);
    collectorTimer.unref?.();
    Promise.resolve()
      .then(onSample)
      .catch((error) => recordCollectorError(error));
    return { ok: true, browserWindow: browserWindowStatus(), collector: collectorStatus() };
  }

  function stopCollector() {
    if (collectorTimer) {
      clearInterval(collectorTimer);
      collectorTimer = null;
    }
    collectorState = 'stopped';
    return { ok: true, browserWindow: browserWindowStatus(), collector: collectorStatus() };
  }

  function status() {
    return {
      browserWindow: browserWindowStatus(),
      collector: collectorStatus(),
    };
  }

  return {
    startBrowser,
    stopBrowser,
    sampleVisiblePage,
    recordIngestResult,
    recordCollectorError,
    startCollector,
    stopCollector,
    status,
  };
}
