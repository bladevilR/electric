import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compactDataset,
  readStandardDataset,
  summarizeDataset,
  writeBrowserDataFile,
} from './lib/system-data.mjs';
import { buildStrategySuggestions } from './lib/strategy-engine.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const defaultStandardPath = path.resolve(
  rootDir,
  '../jspec-capture/output/session-20260507-101645/standard/standard-96.json'
);
const browserDataPath = path.resolve(rootDir, 'data/standard-96.js');
const startTime = Date.now();

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }
  return process.argv[index + 1];
}

const port = Number(getArgValue('--port', process.env.PORT || 5177));
const standardPath = path.resolve(getArgValue('--standard', defaultStandardPath));

function sendJson(response, payload, statusCode = 200) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendError(response, error, statusCode = 500) {
  sendJson(
    response,
    {
      ok: false,
      error: error?.message ?? String(error),
    },
    statusCode
  );
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    }[ext] ?? 'application/octet-stream'
  );
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const resolved = path.resolve(rootDir, `.${decoded}`);
  if (!resolved.startsWith(rootDir)) {
    return null;
  }
  return resolved;
}

async function loadDataset() {
  return compactDataset(await readStandardDataset(standardPath));
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, {
      ok: true,
      name: 'trading-ai-system',
      version: '0.2.0',
      uptimeSeconds: Math.round((Date.now() - startTime) / 1000),
      standardPath,
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/dataset') {
    sendJson(response, await loadDataset());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/summary') {
    sendJson(response, summarizeDataset(await loadDataset()));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/strategy') {
    const dataset = await loadDataset();
    sendJson(response, {
      generatedAt: new Date().toISOString(),
      suggestions: buildStrategySuggestions(dataset, { date: url.searchParams.get('date') }),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/refresh') {
    const summary = await writeBrowserDataFile({
      sourcePath: standardPath,
      outputPath: browserDataPath,
    });
    sendJson(response, {
      ok: true,
      refreshedAt: new Date().toISOString(),
      summary,
    });
    return;
  }

  sendJson(response, { ok: false, error: 'API route not found' }, 404);
}

async function handleStatic(response, urlPath) {
  const filePath = safeStaticPath(urlPath);
  if (!filePath) {
    sendJson(response, { ok: false, error: 'Invalid path' }, 403);
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      sendJson(response, { ok: false, error: 'Not found' }, 404);
      return;
    }

    response.writeHead(200, { 'content-type': contentType(filePath) });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(response, { ok: false, error: 'Not found' }, 404);
      return;
    }
    sendError(response, error);
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    await handleStatic(response, url.pathname);
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Trading AI System running at http://127.0.0.1:${port}\n`);
});
