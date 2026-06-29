import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_JSPEC_URL = 'https://www.jspec.com.cn/';
const DEFAULT_DEBUG_ADDRESS = '127.0.0.1';
const DEFAULT_DEBUG_PORT = 9224;
const DEFAULT_INTERVAL_SECONDS = 30;
const DEFAULT_SWEEP_DELAY_MS = 8000;
const SNAPSHOT_SOURCE = 'jspec_managed_browser_visible_page';
const SWEEP_SOURCE = 'jspec_managed_browser_auto_sweep';
const SENSITIVE_FIELD_PATTERN =
  /cookie|token|ticket|authorization|password|passwd|secret|credential|cert|private.?key|pin/i;
const FORBIDDEN_SWEEP_ROUTE_PATTERN = /tradeDemo|rollMatchTrade|submit|commit|save|delete|cancel/i;

const DEFAULT_SWEEP_TARGETS = [
  {
    id: 'dashboard',
    name: 'JSPEC 首页',
    category: 'login_context',
    priority: 'P0',
    required: false,
    routeFragment: '/dashboard',
    outputHint: '登录后的平台首页状态',
  },
  {
    id: 'user_bid_96',
    name: '用户侧96点主动申报',
    category: 'dayahead_declaration',
    priority: 'P0',
    required: true,
    routeFragment: '/pxf-spotgoods-province-extranet/userBid96/index',
    expectedFields: ['declarationPower'],
    outputHint: '96点日前主动申报曲线',
  },
  {
    id: 'user_default_bid_96',
    name: '用户侧96点缺省申报',
    category: 'dayahead_declaration',
    priority: 'P0',
    required: true,
    routeFragment: '/pxf-spotgoods-province-extranet/userDefaultBid96/index',
    expectedFields: ['defaultDeclarationPower'],
    outputHint: '96点缺省申报曲线',
  },
  {
    id: 'dayahead_user_clearing',
    name: '用户侧日前出清',
    category: 'dayahead_price',
    priority: 'P0',
    required: true,
    routeFragment: '/pxf-spotgoods-province-extranet/Dd2jyUserClearingResult/Dd2jyRqClearing',
    expectedFields: ['dayAheadUserPrice'],
    outputHint: '96点日前用户侧出清结果',
  },
  {
    id: 'dayahead_public_clearing',
    name: '日前公开出清',
    category: 'dayahead_price',
    priority: 'P0',
    required: true,
    routeFragment:
      '/pxf-spotgoods-province-extranet/afterDiscloseInformation/xrdClearingResultOnlyJiesuan/DayClearingResult',
    expectedFields: ['dayAheadPublicPrice'],
    outputHint: '96点日前公开出清价格',
  },
  {
    id: 'realtime_public_clearing',
    name: '实时公开出清',
    category: 'realtime_price',
    priority: 'P0',
    required: true,
    routeFragment:
      '/pxf-spotgoods-province-extranet/afterDiscloseInformation/xrdClearingResultOnlyJiesuan/CurClearingResult',
    expectedFields: ['realTimePointPriceCurrent'],
    outputHint: '96点实时公开出清结果',
  },
  {
    id: 'realtime_average_price',
    name: '实时加权均价公开',
    category: 'realtime_price',
    priority: 'P0',
    required: true,
    routeFragment: '/pxf-spotgoods-province-extranet/realTimeClearingRelease/RealTimeMarAvePricePublic',
    expectedFields: ['realTimeAvgPrice'],
    outputHint: '96点实时加权均价',
  },
  {
    id: 'actual_load_96',
    name: '96点日电量查询',
    category: 'actual_load',
    priority: 'P0',
    required: true,
    routeFragment: '/pxf-js-outer-deferrableload/dayElectricity',
    expectedFields: ['actualKwh'],
    outputHint: '96点实际电量/负荷',
  },
  {
    id: 'settle_day',
    name: '日结算查询',
    category: 'settlement',
    priority: 'P0',
    required: true,
    routeFragment: '/pxf-js-outer-deferrableload/settleDay',
    expectedFields: ['settleAmount'],
    outputHint: '日结算明细',
  },
  {
    id: 'energy_block_trades',
    name: '能量块成交结果',
    category: 'energy_block',
    priority: 'P1',
    required: false,
    routeFragment: '/pxf-trade-auction-extranet/myTransaction/TradeResult',
    outputHint: '能量块成交结果',
  },
  {
    id: 'energy_block_limits',
    name: '能量块可买可卖量/限额',
    category: 'energy_block',
    priority: 'P1',
    required: false,
    routeFragment: '/pxf-trade-auction-extranet/myTransaction/QuotaQuery',
    outputHint: '能量块可买可卖量和限额',
  },
  {
    id: 'position_query',
    name: '持仓量查询',
    category: 'contract_position',
    priority: 'P1',
    required: false,
    routeFragment: '/pxf-js-outer-planmod/fsjyccl',
    outputHint: '当前持仓量',
  },
];

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

function jspecOrigin(baseUrl = DEFAULT_JSPEC_URL) {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return new URL(DEFAULT_JSPEC_URL).origin;
  }
}

function buildJspecSweepUrl(routeFragment, baseUrl = DEFAULT_JSPEC_URL) {
  const route = cleanString(routeFragment);
  const origin = jspecOrigin(baseUrl);
  if (route === '/dashboard') {
    return `${origin}/#/dashboard`;
  }
  if (!route.startsWith('/')) {
    throw new Error(`JSPEC sweep route must start with "/": ${routeFragment}`);
  }
  const appName = route.split('/').filter(Boolean)[0];
  if (!appName) {
    throw new Error(`Could not infer JSPEC app name from route: ${routeFragment}`);
  }
  return `${origin}/${appName}/#${route}`;
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanString).filter(Boolean))];
}

function normalizeSweepTarget(target = {}, index = 0, baseUrl = DEFAULT_JSPEC_URL) {
  const routeFragment = cleanString(target.routeFragment || target.route || target.path);
  if (routeFragment && FORBIDDEN_SWEEP_ROUTE_PATTERN.test(routeFragment)) {
    return null;
  }
  const url = cleanString(target.url) || buildJspecSweepUrl(routeFragment, baseUrl);
  return {
    id: cleanString(target.id) || `sweep_target_${index + 1}`,
    name: cleanString(target.name || target.title) || `JSPEC 巡扫目标 ${index + 1}`,
    category: cleanString(target.category) || 'business',
    priority: cleanString(target.priority) || 'P1',
    required: Boolean(target.required),
    routeFragment,
    url,
    expectedFields: Array.isArray(target.expectedFields) ? uniqueStrings(target.expectedFields) : [],
    outputHint: cleanString(target.outputHint),
    order: index + 1,
  };
}

function resolveSweepDelayMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return DEFAULT_SWEEP_DELAY_MS;
  }
  return Math.min(Math.max(Math.round(numeric), 1000), 120000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildAutoSweepTargets(options = {}) {
  const baseUrl = options.baseUrl || options.jspecUrl || DEFAULT_JSPEC_URL;
  const sourceTargets = Array.isArray(options.targets) && options.targets.length ? options.targets : DEFAULT_SWEEP_TARGETS;
  return sourceTargets
    .map((target, index) => normalizeSweepTarget(target, index, baseUrl))
    .filter(Boolean);
}

export function buildAutoSweepSummary(pageResults = [], options = {}) {
  const startedAt = options.startedAt || new Date().toISOString();
  const finishedAt = options.finishedAt || new Date().toISOString();
  const rows = [];
  const errors = [];
  const pages = pageResults.map((result = {}, index) => {
    const target = result.target || {};
    const snapshot = result.snapshot || {};
    const targetId = cleanString(target.id) || `sweep_target_${index + 1}`;
    const snapshotRows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    const rowCount = Number(snapshot.rowCount ?? snapshotRows.length ?? 0);
    const pageErrors = [
      ...(Array.isArray(snapshot.errors) ? snapshot.errors.map(cleanString).filter(Boolean) : []),
      cleanString(result.error),
    ].filter(Boolean);

    snapshotRows.forEach((row) => {
      rows.push({
        ...row,
        sourceTargets: uniqueStrings([targetId, ...(Array.isArray(row.sourceTargets) ? row.sourceTargets : [])]),
      });
    });

    pageErrors.forEach((error) => errors.push(`${targetId}: ${error}`));

    return {
      targetId,
      name: cleanString(target.name),
      category: cleanString(target.category),
      priority: cleanString(target.priority),
      required: Boolean(target.required),
      routeFragment: cleanString(target.routeFragment),
      url: cleanString(target.url || snapshot.pageUrl),
      ok: rowCount > 0,
      rowCount,
      tableCount: Number(snapshot.tableCount || 0),
      matchedTableCount: Number(snapshot.matchedTableCount || 0),
      pageUrl: cleanString(snapshot.pageUrl),
      pageTitle: cleanString(snapshot.pageTitle),
      error: pageErrors.join('; ') || null,
    };
  });

  return {
    source: SWEEP_SOURCE,
    generatedAt: finishedAt,
    startedAt,
    finishedAt,
    targetCount: Number(options.targetCount || pages.length),
    targetIds: pages.map((page) => page.targetId),
    pageCount: pages.length,
    acceptedPageCount: pages.filter((page) => page.rowCount > 0).length,
    rowCount: rows.length,
    rows,
    pages,
    errors,
  };
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

function cdpCommand(webSocketDebuggerUrl, method, params = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const id = 1;
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error(`${method} timed out`));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id,
          method,
          params,
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
        reject(new Error(message.error.message || `${method} failed`));
        return;
      }
      resolve(message.result || {});
    });

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('CDP websocket connection failed'));
    });
  });
}

async function cdpEvaluate(webSocketDebuggerUrl, expression) {
  const result = await cdpCommand(
    webSocketDebuggerUrl,
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
    },
    8000
  );
  if (result.exceptionDetails) {
    throw new Error('Visible page evaluation failed');
  }
  return result.result?.value || {};
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
  let sweepState = 'idle';
  let lastSweepAt = null;
  let lastSweepRowCount = 0;
  let lastSweepAcceptedPageCount = 0;
  let lastSweepPageCount = 0;
  let lastSweepError = '';

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

  function sweepStatus() {
    const current = refreshLaunch();
    const targets = buildAutoSweepTargets({ baseUrl: current.launchUrl });
    return {
      state: sweepState,
      defaultDelayMs: resolveSweepDelayMs(env.JSPEC_SWEEP_DELAY_MS),
      targetCount: targets.length,
      targetIds: targets.map((target) => target.id),
      lastRunAt: lastSweepAt,
      lastRowCount: lastSweepRowCount,
      lastAcceptedPageCount: lastSweepAcceptedPageCount,
      lastPageCount: lastSweepPageCount,
      lastError: lastSweepError || null,
    };
  }

  async function startBrowser() {
    const current = refreshLaunch();
    if (!current.available) {
      browserState = 'unavailable';
      browserLastError = current.disabled
        ? 'Managed browser launch is disabled for this process.'
        : 'Chrome or Edge was not found on this computer.';
      return { ok: false, error: browserLastError, browserWindow: browserWindowStatus(), collector: collectorStatus(), sweep: sweepStatus() };
    }
    if (browserProcess && !browserProcess.killed) {
      return { ok: true, browserWindow: browserWindowStatus(), collector: collectorStatus(), sweep: sweepStatus() };
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
    return { ok: true, browserWindow: browserWindowStatus(), collector: collectorStatus(), sweep: sweepStatus() };
  }

  function stopBrowser() {
    stopCollector();
    if (browserProcess && !browserProcess.killed) {
      browserProcess.kill();
    }
    browserProcess = null;
    browserState = 'stopped';
    return { ok: true, browserWindow: browserWindowStatus(), collector: collectorStatus(), sweep: sweepStatus() };
  }

  async function findManagedPageTarget() {
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
    return target;
  }

  async function captureVisiblePage() {
    const target = await findManagedPageTarget();
    return cdpEvaluate(target.webSocketDebuggerUrl, VISIBLE_TABLE_EXPRESSION);
  }

  async function captureSweepTarget(browserTarget, sweepTarget, delayMs) {
    await cdpCommand(
      browserTarget.webSocketDebuggerUrl,
      'Page.navigate',
      { url: sweepTarget.url },
      20000
    );
    await sleep(delayMs);
    return cdpEvaluate(browserTarget.webSocketDebuggerUrl, VISIBLE_TABLE_EXPRESSION);
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

  async function autoSweepVisiblePages(sweepOptions = {}) {
    const startedAt = new Date().toISOString();
    const targets = buildAutoSweepTargets({
      baseUrl: refreshLaunch().launchUrl,
      targets: sweepOptions.targets,
    });
    const delayMs = resolveSweepDelayMs(sweepOptions.delayMs || env.JSPEC_SWEEP_DELAY_MS);
    const pageResults = [];
    sweepState = 'running';
    lastSweepError = '';

    try {
      if (sweepOptions.startBrowser !== false && (!browserProcess || browserProcess.killed)) {
        const browserStart = await startBrowser();
        if (!browserStart.ok) {
          throw new Error(browserStart.error || 'Managed browser could not be started.');
        }
        await sleep(1500);
      }

      const browserTarget = await findManagedPageTarget();
      for (const target of targets) {
        try {
          const pageSnapshot = await captureSweepTarget(browserTarget, target, delayMs);
          const snapshot = parseVisibleBusinessSnapshot(pageSnapshot);
          pageResults.push({ target, snapshot });
        } catch (error) {
          pageResults.push({ target, error: error?.message || String(error) });
        }
      }

      const summary = buildAutoSweepSummary(pageResults, {
        startedAt,
        finishedAt: new Date().toISOString(),
        targetCount: targets.length,
      });
      lastSweepAt = summary.generatedAt;
      lastSweepRowCount = summary.rowCount;
      lastSweepAcceptedPageCount = summary.acceptedPageCount;
      lastSweepPageCount = summary.pageCount;
      lastSweepError = summary.rowCount ? '' : summary.errors.join('; ') || 'No visible JSPEC business rows were detected.';
      lastSampleAt = summary.generatedAt;
      lastRowCount = summary.rowCount;
      collectorLastError = lastSweepError;
      return summary;
    } catch (error) {
      lastSweepAt = new Date().toISOString();
      lastSweepError = error?.message || String(error);
      collectorLastError = lastSweepError;
      throw error;
    } finally {
      sweepState = 'idle';
    }
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
    return { ok: true, browserWindow: browserWindowStatus(), collector: collectorStatus(), sweep: sweepStatus() };
  }

  function stopCollector() {
    if (collectorTimer) {
      clearInterval(collectorTimer);
      collectorTimer = null;
    }
    collectorState = 'stopped';
    return { ok: true, browserWindow: browserWindowStatus(), collector: collectorStatus(), sweep: sweepStatus() };
  }

  function status() {
    return {
      browserWindow: browserWindowStatus(),
      collector: collectorStatus(),
      sweep: sweepStatus(),
    };
  }

  return {
    startBrowser,
    stopBrowser,
    sampleVisiblePage,
    autoSweepVisiblePages,
    recordIngestResult,
    recordCollectorError,
    startCollector,
    stopCollector,
    status,
  };
}
