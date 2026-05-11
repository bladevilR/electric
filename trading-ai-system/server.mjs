import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compactDataset,
  readStandardDataset,
  summarizeDataset,
  writeBrowserDataFile,
} from './lib/system-data.mjs';
import { buildStrategyAdvice, buildStrategySuggestions } from './lib/strategy-engine.mjs';
import { buildStrategyReport, renderStrategyReportMarkdown } from './lib/strategy-report.mjs';
import {
  buildIntegrationClosure,
  readIntegrationSummary,
  renderIntegrationClosureMarkdown,
} from './lib/integration-summary.mjs';
import { buildIntegrationSummaryFile, resolvePythonPath } from './lib/integration-build.mjs';
import { appendAuditEvent, readAuditLog } from './lib/audit-log.mjs';
import { buildProductionReadiness } from './lib/production-readiness.mjs';
import { createExecutionProposal } from './lib/execution-governance.mjs';
import { readBusinessInputs, summarizeBusinessInputs } from './lib/business-inputs.mjs';
import { createProposalReview } from './lib/proposal-review.mjs';
import {
  buildUkeyAssistantStatus,
  mergeVisibleSnapshot,
  validateVisibleSnapshot,
} from './lib/ukey-assistant.mjs';
import { createUkeyBrowserCollector } from './lib/ukey-browser-collector.mjs';
import { buildModelConfig, requestStrategyModelPrediction } from './lib/ai-model-client.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const defaultStandardPath = path.resolve(
  rootDir,
  '../jspec-capture/output/session-20260507-101645/standard/standard-96.json'
);
const browserDataPath = path.resolve(rootDir, 'data/standard-96.js');
const integrationSummaryPath = path.resolve(rootDir, 'data/integration-summary.json');
const integrationBuildScriptPath = path.resolve(rootDir, 'tools/build-integration-summary.py');
const defaultAuditLogPath = path.resolve(rootDir, 'data/audit-log.ndjson');
const businessInputsDir = path.resolve(rootDir, 'data/business-inputs');
const visibleSnapshotPath = path.resolve(rootDir, 'data/ukey-visible-snapshot.json');
const startTime = Date.now();
const ukeyBrowserCollector = createUkeyBrowserCollector({ rootDir, env: process.env });

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }
  return process.argv[index + 1];
}

const port = Number(getArgValue('--port', process.env.PORT || 5177));
const standardPath = path.resolve(getArgValue('--standard', defaultStandardPath));
const pythonPath = getArgValue('--python', process.env.TRADING_AI_PYTHON || '');
const auditLogPath = path.resolve(getArgValue('--audit', process.env.TRADING_AUDIT_LOG || defaultAuditLogPath));

function sendJson(response, payload, statusCode = 200) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendText(response, body, contentTypeValue = 'text/plain; charset=utf-8', statusCode = 200) {
  response.writeHead(statusCode, {
    'content-type': contentTypeValue,
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

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(request) {
  const body = await readRequestBody(request);
  if (!body.trim()) {
    return {};
  }
  return JSON.parse(body);
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
  const dataset = compactDataset(await readStandardDataset(standardPath));
  return mergeVisibleSnapshot(dataset, await loadVisibleSnapshot());
}

async function loadVisibleSnapshot() {
  try {
    return JSON.parse(await readFile(visibleSnapshotPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { accepted: false, rows: [] };
    }
    throw error;
  }
}

async function saveVisibleSnapshot(snapshot) {
  await mkdir(path.dirname(visibleSnapshotPath), { recursive: true });
  await writeFile(visibleSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

async function persistVisibleSnapshotPayload(payload, actor) {
  const snapshot = validateVisibleSnapshot(payload);
  if (!snapshot.accepted && Array.isArray(payload?.errors) && payload.errors.length) {
    snapshot.errors = [...snapshot.errors, ...payload.errors];
  }
  if (!snapshot.accepted && !snapshot.errors.length) {
    snapshot.errors = ['No visible business rows were accepted.'];
  }

  if (snapshot.accepted) {
    await saveVisibleSnapshot(snapshot);
    await appendAuditEvent(auditLogPath, {
      type: 'ukey_visible_snapshot_accepted',
      actor,
      outcome: 'accepted',
      rowCount: snapshot.rowCount,
      source: snapshot.source,
    });
    return snapshot;
  }

  await appendAuditEvent(auditLogPath, {
    type: 'ukey_visible_snapshot_rejected',
    actor,
    outcome: 'rejected',
    errors: snapshot.errors,
  });
  return snapshot;
}

async function sampleManagedVisibleSnapshot(actor = 'local-collector') {
  try {
    const parsedSnapshot = await ukeyBrowserCollector.sampleVisiblePage();
    const snapshot = await persistVisibleSnapshotPayload(parsedSnapshot, actor);
    ukeyBrowserCollector.recordIngestResult(snapshot);
    return {
      ok: snapshot.accepted,
      snapshot,
      sample: {
        pageUrl: parsedSnapshot.pageUrl,
        pageTitle: parsedSnapshot.pageTitle,
        tableCount: parsedSnapshot.tableCount,
        matchedTableCount: parsedSnapshot.matchedTableCount,
      },
      ...ukeyBrowserCollector.status(),
    };
  } catch (error) {
    ukeyBrowserCollector.recordCollectorError(error);
    return {
      ok: false,
      error: error?.message ?? String(error),
      ...ukeyBrowserCollector.status(),
    };
  }
}

async function loadIntegrationClosure() {
  return buildIntegrationClosure(await readIntegrationSummary(integrationSummaryPath));
}

async function loadBusinessInputs() {
  return readBusinessInputs(businessInputsDir);
}

async function loadProductionReadiness() {
  const dataset = await loadDataset();
  const summary = summarizeDataset(dataset);
  const integrationClosure = await loadIntegrationClosure();
  return buildProductionReadiness({
    summary,
    integrationClosure,
    env: process.env,
    paths: {
      standardPath,
      integrationSummaryPath,
      auditLogPath,
    },
  });
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, {
      ok: true,
      name: 'trading-ai-system',
      version: '0.2.0',
      uptimeSeconds: Math.round((Date.now() - startTime) / 1000),
      standardPath,
      integrationSummaryPath,
      auditLogPath,
      businessInputsDir,
      pythonPath: await resolvePythonPath(pythonPath),
      modelRuntime: buildModelConfig(process.env),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/ai/model') {
    sendJson(response, {
      generatedAt: new Date().toISOString(),
      ...buildModelConfig(process.env),
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

  if (request.method === 'GET' && url.pathname === '/api/integrations') {
    sendJson(response, await loadIntegrationClosure());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/integrations.md') {
    sendText(response, renderIntegrationClosureMarkdown(await loadIntegrationClosure()), 'text/markdown; charset=utf-8');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/production/readiness') {
    const readiness = await loadProductionReadiness();
    await appendAuditEvent(auditLogPath, {
      type: 'production_readiness_checked',
      actor: 'system',
      outcome: readiness.status,
      blockerCount: readiness.blockers.length,
    });
    sendJson(response, readiness);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/business-inputs') {
    const inputs = await loadBusinessInputs();
    sendJson(response, {
      generatedAt: new Date().toISOString(),
      templates: inputs.templates,
      summary: summarizeBusinessInputs(inputs),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/ukey-assistant') {
    const dataset = await loadDataset();
    const summary = summarizeDataset(dataset);
    const visibleSnapshot = await loadVisibleSnapshot();
    const collectorStatus = ukeyBrowserCollector.status();
    sendJson(response, {
      ...buildUkeyAssistantStatus({
        env: process.env,
        summary,
      }),
      ...collectorStatus,
      visibleSnapshot: {
        accepted: Boolean(visibleSnapshot.accepted),
        rowCount: visibleSnapshot.rowCount || 0,
        generatedAt: visibleSnapshot.generatedAt || null,
        storagePath: visibleSnapshotPath,
      },
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/ukey-assistant/browser/start') {
    sendJson(response, await ukeyBrowserCollector.startBrowser());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/ukey-assistant/browser/stop') {
    sendJson(response, ukeyBrowserCollector.stopBrowser());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/ukey-assistant/collector/sample') {
    sendJson(
      response,
      await sampleManagedVisibleSnapshot(
        request.headers['x-operator-id'] || process.env.TRADING_OPERATOR_ID || 'local-collector'
      )
    );
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/ukey-assistant/collector/start') {
    const body = await readJsonBody(request);
    const actor = request.headers['x-operator-id'] || process.env.TRADING_OPERATOR_ID || 'local-auto-collector';
    sendJson(
      response,
      ukeyBrowserCollector.startCollector(
        () => sampleManagedVisibleSnapshot(actor),
        Number(body.intervalSeconds || 30)
      )
    );
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/ukey-assistant/collector/stop') {
    sendJson(response, ukeyBrowserCollector.stopCollector());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/ukey-assistant/visible-snapshot') {
    const snapshot = await persistVisibleSnapshotPayload(
      await readJsonBody(request),
      request.headers['x-operator-id'] || process.env.TRADING_OPERATOR_ID || 'local-operator'
    );
    if (snapshot.accepted) {
      sendJson(response, snapshot);
      return;
    }

    sendJson(response, snapshot, 422);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/audit') {
    sendJson(response, {
      generatedAt: new Date().toISOString(),
      events: await readAuditLog(auditLogPath, { limit: Number(url.searchParams.get('limit') || 100) }),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/strategy') {
    const dataset = await loadDataset();
    const date = url.searchParams.get('date');
    const advice = buildStrategyAdvice(dataset, { date });
    const suggestions = buildStrategySuggestions(dataset, { date });
    sendJson(response, {
      generatedAt: new Date().toISOString(),
      modelRuntime: buildModelConfig(process.env),
      modelPrediction: await requestStrategyModelPrediction({
        env: process.env,
        dataset,
        date,
        advice,
        suggestions,
      }),
      advice,
      suggestions,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/strategy-report') {
    const dataset = await loadDataset();
    sendJson(
      response,
      buildStrategyReport(dataset, {
        date: url.searchParams.get('date'),
        integrationClosure: await loadIntegrationClosure(),
      })
    );
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/strategy-report.md') {
    const dataset = await loadDataset();
    const report = buildStrategyReport(dataset, {
      date: url.searchParams.get('date'),
      integrationClosure: await loadIntegrationClosure(),
    });
    sendText(response, renderStrategyReportMarkdown(report), 'text/markdown; charset=utf-8');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/refresh') {
    const summary = await writeBrowserDataFile({
      sourcePath: standardPath,
      outputPath: browserDataPath,
    });
    const integrationBuild = await buildIntegrationSummaryFile({
      scriptPath: integrationBuildScriptPath,
      pythonPath,
    });
    const integrationSummary = await readIntegrationSummary(integrationSummaryPath);
    const integrationClosure = await loadIntegrationClosure();
    await appendAuditEvent(auditLogPath, {
      type: 'system_refresh_completed',
      actor: 'system',
      outcome: 'ok',
      rowCount: summary.rowCount,
      integrationCompletion: integrationClosure.completion,
    });
    sendJson(response, {
      ok: true,
      refreshedAt: new Date().toISOString(),
      summary,
      integrationBuild,
      integrationSummary,
      integrationClosure,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/execution/proposal') {
    const dataset = await loadDataset();
    const integrationClosure = await loadIntegrationClosure();
    const readiness = await loadProductionReadiness();
    const businessInputs = await loadBusinessInputs();
    const proposal = await createExecutionProposal({
      dataset,
      date: url.searchParams.get('date'),
      integrationClosure,
      readiness,
      businessInputs,
      auditPath: auditLogPath,
      actor: request.headers['x-operator-id'] || process.env.TRADING_OPERATOR_ID || 'local-operator',
    });
    sendJson(response, proposal);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/execution/review') {
    const review = await createProposalReview({
      auditPath: auditLogPath,
      proposalId: url.searchParams.get('proposalId') || '',
      date: url.searchParams.get('date') || '',
      decision: url.searchParams.get('decision') || '',
      reviewer: request.headers['x-reviewer-id'] || process.env.TRADING_APPROVER_ID || 'local-reviewer',
      note: url.searchParams.get('note') || '',
    });
    sendJson(response, review);
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
