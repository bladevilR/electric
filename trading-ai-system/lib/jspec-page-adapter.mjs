import { createHash } from 'node:crypto';

const LOGIN_PATTERN = /(?:#\/outNet|\/outNet|\/login|\/signin)|UKey\s*登录|外网登录|用户登录|请登录/i;
const RATE_LIMIT_PATTERN = /api\s*访问频率|访问频率过高|请求频率过高|操作过于频繁|too many requests|rate limit/i;
const EMPTY_PATTERN = /暂无数据|无数据|查询结果为空|没有符合条件的数据/i;
const SERVICE_UNAVAILABLE_PATTERN = /服务正在维护|系统维护中|服务暂不可用|service unavailable/i;
const DATE_INPUT_SELECTOR = [
  'input[type="date"]',
  'input[placeholder*="日期"]',
  'input[placeholder*="时间"]',
  '.el-date-editor input',
  '.ant-picker input',
].join(', ');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function numericValue(value) {
  const text = cleanText(value).replace(/,/g, '').replace(/[—–]/g, '');
  if (!text) return null;
  const match = text.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function dateFromText(value) {
  const match = String(value || '').match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function pointFromTime(value) {
  const match = cleanText(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour === 24 && minute === 0) return 96;
  if (hour === 0 && minute === 0) return 96;
  const totalMinutes = hour * 60 + minute;
  if (totalMinutes < 15 || totalMinutes > 1440 || totalMinutes % 15 !== 0) return null;
  return totalMinutes / 15;
}

function matchesAny(value, patterns = []) {
  return patterns.some((pattern) => pattern.test(cleanText(value)));
}

export class CollectorAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CollectorAdapterError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CollectorAdapterError(code, message, details);
}

function resolveNavigationUrl(config, page) {
  if (config.url) return config.url;
  if (!config.routeFragment) fail('source_route_unconfigured', `${config.id} has no confirmed route.`);
  const current = new URL(page.url());
  const origin = config.baseUrl ? new URL(config.baseUrl).origin : current.origin;
  const route = config.routeFragment.startsWith('/') ? config.routeFragment : `/${config.routeFragment}`;
  if (route === '/dashboard') return `${origin}/#/dashboard`;
  const appName = route.split('/').filter(Boolean)[0];
  if (!appName) fail('source_route_unconfigured', `${config.id} has no micro-frontend route.`);
  return `${origin}/${appName}/#${route}`;
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
}

function searchableContexts(page) {
  try {
    const frames = page.frames?.();
    if (Array.isArray(frames) && frames.length) return frames;
  } catch {
    // Some test doubles expose only the locator surface.
  }
  return [page];
}

async function firstVisible(locator) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function findDateInput(page, timeoutMs = 15000) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  do {
    for (const context of searchableContexts(page)) {
      const byLabel = await firstVisible(context.getByLabel(/交易日期|业务日期|预报日期|查询日期|日期/));
      if (byLabel) return byLabel;
      const byAttribute = await firstVisible(context.locator(DATE_INPUT_SELECTOR));
      if (byAttribute) return byAttribute;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
  } while (Date.now() <= deadline);
  fail('date_control_missing', 'No visible business-date input was found.');
}

async function visibleDateInputs(page) {
  const inputs = [];
  for (const context of searchableContexts(page)) {
    const locator = context.locator(DATE_INPUT_SELECTOR);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) inputs.push(candidate);
    }
  }
  return inputs;
}

async function setInputValue(input, value) {
  try {
    await input.fill(value);
  } catch {
    await input.evaluate((element, nextValue) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(element, nextValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  await input.press('Enter').catch(() => {});
}

function mapHeaders(headers, columns) {
  const mapped = new Map();
  headers.forEach((header, index) => {
    const definition = columns.find((column) => matchesAny(header, column.patterns));
    if (definition && !mapped.has(definition.fieldId)) mapped.set(definition.fieldId, { ...definition, index });
  });
  return mapped;
}

function chooseTable(tables, columns) {
  return [...tables]
    .map((table) => ({ table, mapped: mapHeaders(table.headers, columns) }))
    .sort((left, right) => right.mapped.size - left.mapped.size || right.table.rows.length - left.table.rows.length)[0] || null;
}

export function createJspecAdapter(config = {}) {
  const id = cleanText(config.id);
  const sourceId = cleanText(config.sourceId);
  if (!id) throw new Error('adapter_id_required');
  if (!sourceId) throw new Error('adapter_source_id_required');
  const expectedPointCount = Number(config.expectedPointCount || 96);
  const columns = (config.columns || []).map((column) => ({ ...column, patterns: column.patterns || [] }));
  const requiredFields = config.requiredFields || columns.filter((column) => column.required).map((column) => column.fieldId);
  const pointPatterns = config.pointPatterns || [/点位|序号|时段序号|节点序号|point|index/i];
  const timePatterns = config.timePatterns || [/时点|时间点|时间|时段|交易时段|period|time/i];
  const datePatterns = config.datePatterns || [/交易日期|业务日期|预报日期|日期|date/i];
  const verifiedQueryPages = new WeakSet();

  async function detect(page) {
    const text = `${page.url()}\n${await bodyText(page)}`;
    if (LOGIN_PATTERN.test(text)) return { state: 'login_expired' };
    if (RATE_LIMIT_PATTERN.test(text)) return { state: 'rate_limited' };
    if (SERVICE_UNAVAILABLE_PATTERN.test(text)) return { state: 'service_unavailable' };
    if (EMPTY_PATTERN.test(text)) return { state: 'no_data' };
    return { state: 'ready' };
  }

  async function navigate(page) {
    const url = resolveNavigationUrl(config, page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Number(config.navigationTimeoutMs || 30000) });
    return { url: page.url() };
  }

  async function discoverBounds(page) {
    const input = await findDateInput(page, config.dateControlTimeoutMs);
    const [minimum, maximum] = await Promise.all([input.getAttribute('min'), input.getAttribute('max')]);
    const earliestDate = dateFromText(minimum) || dateFromText(config.earliestDate);
    const latestDate = dateFromText(maximum) || dateFromText(config.latestDate);
    if (!earliestDate || !latestDate) {
      fail('history_bounds_unavailable', 'The page did not expose a reliable historical date range.');
    }
    return { earliestDate, latestDate };
  }

  async function setQuery(page, query = {}) {
    const businessDate = dateFromText(query.businessDate);
    if (!businessDate) fail('business_date_invalid', 'A YYYY-MM-DD business date is required.');
    const firstInput = await findDateInput(page, config.dateControlTimeoutMs);
    const inputs = config.fillAllDateInputs ? await visibleDateInputs(page) : [firstInput];
    for (const input of inputs.length ? inputs : [firstInput]) await setInputValue(input, businessDate);
    return { businessDate };
  }

  async function submit(page) {
    const button = page.getByRole('button', { name: /查\s*询|搜\s*索|检\s*索/ }).first();
    if (!await button.count()) fail('query_button_missing', 'No query button was found.');
    const responsePattern = config.responseUrlPattern;
    const responsePromise = responsePattern && typeof page.waitForResponse === 'function'
      ? page.waitForResponse((response) => {
        if (responsePattern instanceof RegExp) return new RegExp(responsePattern.source, responsePattern.flags.replace('g', '')).test(response.url());
        return response.url().includes(String(responsePattern));
      }, { timeout: Number(config.resultTimeoutMs || 15000) })
      : null;
    await button.click();
    if (responsePromise) {
      let response;
      try {
        response = await responsePromise;
        await response.finished().catch(() => {});
      } catch {
        fail('query_response_timeout', 'The JSPEC query response did not arrive before the timeout.');
      }
      if (!response.ok()) fail('query_response_failed', `JSPEC query returned HTTP ${response.status()}.`);
      const responseText = await response.text().catch(() => '');
      if (RATE_LIMIT_PATTERN.test(responseText)) fail('rate_limited', 'JSPEC reported an access-frequency limit.');
      if (SERVICE_UNAVAILABLE_PATTERN.test(responseText)) fail('service_unavailable', '平台接口返回：服务正在维护中，请稍后再试。当前日期未采集成功，不等于没有数据。');
      verifiedQueryPages.add(page);
      await page.waitForTimeout(Math.max(0, Number(config.postSubmitSettleMs || 0)));
    }
  }

  async function waitForResult(page) {
    const responseVerified = verifiedQueryPages.has(page);
    verifiedQueryPages.delete(page);
    const state = await detect(page);
    if (state.state === 'login_expired') fail('login_expired', 'The dedicated browser session requires UKey login.');
    if (state.state === 'rate_limited' && !responseVerified) fail('rate_limited', 'JSPEC reported an access-frequency limit.');
    if (state.state === 'service_unavailable') fail('service_unavailable', '平台接口返回：服务正在维护中，请稍后再试。当前日期未采集成功，不等于没有数据。');
    const row = page.locator('table tbody tr').first();
    try {
      await row.waitFor({ state: 'visible', timeout: Number(config.resultTimeoutMs || 15000) });
    } catch {
      const updatedState = await detect(page);
      if (updatedState.state !== 'ready') fail(updatedState.state, `JSPEC result state: ${updatedState.state}`);
      fail('page_timeout', 'A result table did not become visible before the timeout.');
    }
    return { state: 'ready' };
  }

  async function extract(page, options = {}) {
    const capturedAt = options.capturedAt || new Date().toISOString();
    const raw = await page.evaluate(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      const readHeaders = (root) => [...root.querySelectorAll('thead th')].map((cell) => cell.innerText || cell.textContent || '');
      const readRows = (root) => [...root.querySelectorAll('tbody tr')].filter(visible).map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.innerText || cell.textContent || '')
      );
      const elementTables = [...document.querySelectorAll('.el-table')].filter(visible).map((root) => ({
        headers: readHeaders(root.querySelector('.el-table__header-wrapper') || root),
        rows: readRows(root.querySelector('.el-table__body-wrapper') || root),
      }));
      const genericTables = [...document.querySelectorAll('table')]
        .filter((table) => visible(table) && !table.closest('.el-table'))
        .map((table) => ({
        headers: [...table.querySelectorAll('thead th')].map((cell) => cell.innerText || cell.textContent || ''),
        rows: [...table.querySelectorAll('tbody tr')].filter(visible).map((row) =>
          [...row.querySelectorAll('td')].map((cell) => cell.innerText || cell.textContent || '')
        ),
      }));
      const tables = [...elementTables, ...genericTables];
      const dateInput = document.querySelector('input[type="date"], input[placeholder*="日期"], input[placeholder*="时间"]');
      const output = document.querySelector('output, [data-query-date], .query-date');
      return {
        url: location.href,
        title: document.title,
        bodyText: document.body?.innerText || '',
        inputDate: dateInput?.value || '',
        outputDate: output?.value || output?.textContent || '',
        tables,
      };
    });
    const stateText = `${raw.url}\n${raw.bodyText}`;
    if (LOGIN_PATTERN.test(stateText)) fail('login_expired', 'The dedicated browser session requires UKey login.');
    if (RATE_LIMIT_PATTERN.test(stateText)) fail('rate_limited', 'JSPEC reported an access-frequency limit.');
    if (SERVICE_UNAVAILABLE_PATTERN.test(stateText)) fail('service_unavailable', '平台接口返回：服务正在维护中，请稍后再试。当前日期未采集成功，不等于没有数据。');
    const selected = chooseTable(raw.tables, columns);
    const table = selected?.table || { headers: [], rows: [] };
    const mapped = selected?.mapped || new Map();
    const pointColumn = table.headers.findIndex((header) => matchesAny(header, pointPatterns));
    const timeColumn = table.headers.findIndex((header) => matchesAny(header, timePatterns));
    const dateColumn = table.headers.findIndex((header) => matchesAny(header, datePatterns));
    const queryDate = dateFromText(raw.outputDate) || dateFromText(raw.inputDate) || dateFromText(raw.bodyText);
    const structureFingerprint = sha256(stableHeaderText(table.headers));
    const contentSha256 = sha256(JSON.stringify({ queryDate, headers: table.headers, rows: table.rows }));
    const sourceRevision = `visible:${contentSha256}`;
    const facts = [];

    table.rows.forEach((cells, rowIndex) => {
      const pointIndex = numericValue(cells[pointColumn]) || pointFromTime(cells[timeColumn]) || rowIndex + 1;
      const businessDate = dateFromText(cells[dateColumn]) || queryDate || options.businessDate;
      for (const definition of mapped.values()) {
        const value = definition.numeric === false ? cleanText(cells[definition.index]) : numericValue(cells[definition.index]);
        if (value === null || value === '') continue;
        facts.push({
          sourceId,
          fieldId: definition.fieldId,
          businessDate,
          pointIndex,
          value,
          unit: definition.unit || null,
          availableAt: capturedAt,
          capturedAt,
          sourceRevision,
        });
      }
    });

    return {
      adapterId: id,
      sourceId,
      pageUrl: raw.url,
      pageTitle: cleanText(raw.title),
      queryDate,
      headers: table.headers.map(cleanText),
      mappedFields: [...mapped.keys()],
      intervalMinutes: table.rows.length === 96 && timeColumn >= 0 && table.rows.every((cells,index)=>pointFromTime(cells[timeColumn])===index+1) ? 15 : null,
      facts,
      structureFingerprint,
      contentSha256,
      capturedAt,
    };
  }

  function validate(result = {}, query = {}) {
    const requestedDate = dateFromText(query.businessDate);
    if (!requestedDate) fail('business_date_invalid', 'A YYYY-MM-DD business date is required.');
    if (result.queryDate !== requestedDate) {
      fail('query_date_mismatch', `Requested ${requestedDate}, but the page shows ${result.queryDate || 'no date'}.`, {
        requestedDate,
        visibleDate: result.queryDate || null,
      });
    }
    const missingFields = requiredFields.filter((fieldId) => !result.mappedFields?.includes(fieldId));
    if (missingFields.length) fail('required_column_missing', `Required fields are missing: ${missingFields.join(', ')}`, { missingFields });
    if (!result.facts?.length) fail('no_data', 'No supported business facts were extracted.');
    const coverageByField = {};
    for (const fieldId of result.mappedFields) {
      const points = result.facts.filter((fact) => fact.fieldId === fieldId).map((fact) => fact.pointIndex);
      const unique = new Set(points);
      if (unique.size !== points.length) fail('duplicate_point_index', `${fieldId} contains duplicate point indices.`);
      coverageByField[fieldId] = unique.size;
    }
    const incompleteFields = requiredFields.filter((fieldId) => Number(coverageByField[fieldId] || 0) < expectedPointCount);
    if (incompleteFields.length) {
      fail('coverage_incomplete', `Required fields do not contain ${expectedPointCount} unique points.`, {
        expectedPointCount,
        coverageByField,
      });
    }
    return { ...result, coverageByField, accepted: true };
  }

  async function nextPage(page) {
    const button = page.getByRole('button', { name: /下一页|下页|Next/i }).first();
    if (!await button.count()) return false;
    if (await button.isDisabled()) return false;
    if ((await button.getAttribute('aria-disabled')) === 'true') return false;
    await button.click();
    return true;
  }

  async function fingerprint(page) {
    const result = await extract(page, { capturedAt: new Date(0).toISOString() });
    return result.structureFingerprint;
  }

  return {
    id,
    sourceId,
    expectedPointCount,
    detect,
    navigate,
    discoverBounds,
    setQuery,
    submit,
    waitForResult,
    extract,
    validate,
    nextPage,
    fingerprint,
  };
}

function stableHeaderText(headers) {
  return headers.map(cleanText).join('|').toLowerCase();
}
