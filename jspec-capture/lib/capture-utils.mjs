import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  classifyBusinessTarget,
  summarizeTargetCoverage,
} from './jspec-targets.mjs';

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-ticket',
]);

const SENSITIVE_PATH_PATTERNS = [
  /\/px-common-authcenter\//i,
  /\/auth\/v\d+\//i,
  /\/captcha\//i,
  /\/login\b/i,
  /\/securekey\b/i,
  /\/px-gateway-token\//i,
];

const SENSITIVE_BODY_KEYS = new Set([
  'authorization',
  'authkey',
  'captcha',
  'cookie',
  'password',
  'pd',
  'pointjson',
  'securecode',
  'sm2',
  'sm4',
  'ticket',
  'token',
  'username',
  'x-ticket',
]);

export function sanitizeSegment(value, fallback = 'item') {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return cleaned || fallback;
}

export function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function shouldCaptureResponse({ url, resourceType, status, contentType }) {
  if (!url || !resourceType) {
    return false;
  }

  if (!['fetch', 'xhr'].includes(resourceType)) {
    return false;
  }

  if (typeof status === 'number' && (status < 200 || status >= 400)) {
    return false;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  if (!parsedUrl.hostname.endsWith('jspec.com.cn')) {
    return false;
  }

  if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(parsedUrl.pathname))) {
    return false;
  }

  const loweredType = String(contentType || '').toLowerCase();
  if (
    loweredType.includes('json') ||
    loweredType.includes('text') ||
    loweredType.includes('javascript') ||
    loweredType === ''
  ) {
    return true;
  }

  return false;
}

export function tryParseJson(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!['{', '['].includes(trimmed[0])) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function redactHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [
      key,
      SENSITIVE_HEADER_NAMES.has(String(key).toLowerCase()) ? '[REDACTED]' : value,
    ])
  );
}

export function redactSensitiveJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveJson(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_BODY_KEYS.has(String(key).toLowerCase())
        ? '[REDACTED]'
        : redactSensitiveJson(item),
    ])
  );
}

export function normalizeCapture({
  index,
  capturedAt,
  url,
  status,
  resourceType,
  method,
  contentType,
  headers,
  requestHeaders,
  requestBodyText,
  pageUrl,
  bodyText,
}) {
  const bodyJson = tryParseJson(bodyText);
  const requestBodyJson = tryParseJson(requestBodyText);
  const safeRequestBodyJson = redactSensitiveJson(requestBodyJson);
  const safeHeaders = redactHeaders(headers);
  const safeRequestHeaders = redactHeaders(requestHeaders);
  const businessTarget = classifyBusinessTarget({
    url,
    requestHeaders: safeRequestHeaders,
    pageUrl,
  });
  const urlObject = new URL(url);
  const fileStem = `${String(index).padStart(3, '0')}-${sanitizeSegment(
    `${urlObject.hostname}${urlObject.pathname}`,
    'response'
  )}`;

  return {
    fileName: `${fileStem}.json`,
    meta: {
      index,
      capturedAt,
      url,
      status,
      resourceType,
      method,
      contentType,
      headers: safeHeaders,
      requestHeaders: safeRequestHeaders,
      requestBodyJson: safeRequestBodyJson,
      requestBodyText: requestBodyJson ? null : requestBodyText ?? null,
    },
    businessTarget,
    bodyJson,
    bodyText: bodyJson ? null : bodyText,
  };
}

export async function writeCaptureSet({
  outputRoot,
  captures,
  pageUrl,
  snapshotHtml,
  snapshotText,
}) {
  const captureDir = path.join(outputRoot, `capture-${formatTimestamp()}`);
  const responsesDir = path.join(captureDir, 'responses');

  await mkdir(responsesDir, { recursive: true });

  const indexPayload = {
    pageUrl,
    captureCount: captures.length,
    createdAt: new Date().toISOString(),
    targetCoverage: summarizeTargetCoverage(captures),
    responses: captures.map((capture) => ({
      fileName: capture.fileName,
      businessTarget: capture.businessTarget,
      ...capture.meta,
    })),
  };

  await writeFile(
    path.join(captureDir, 'index.json'),
    JSON.stringify(indexPayload, null, 2),
    'utf8'
  );

  await writeFile(path.join(captureDir, 'dashboard.html'), snapshotHtml ?? '', 'utf8');
  await writeFile(path.join(captureDir, 'dashboard.txt'), snapshotText ?? '', 'utf8');

  await Promise.all(
    captures.map((capture) =>
      writeFile(
        path.join(responsesDir, capture.fileName),
        JSON.stringify(capture, null, 2),
        'utf8'
      )
    )
  );

  return captureDir;
}
