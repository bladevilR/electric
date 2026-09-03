import { createReadStream, existsSync } from 'node:fs';
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
import {
  mergeVisibleHistory,
  readVisibleHistory,
  writeVisibleHistoryAtomic,
} from './lib/visible-history.mjs';
import { buildBackfillPlan, createUkeyBrowserCollector } from './lib/ukey-browser-collector.mjs';
import { buildModelConfig, requestStrategyModelPrediction } from './lib/ai-model-client.mjs';
import { buildInventoryFromDirectories } from './lib/data-assets.mjs';
import { buildForecastFeatureStore } from './lib/forecast-feature-store.mjs';
import { buildForecastModelReport } from './lib/forecast-models.mjs';
import { buildStrategyValidation, runForecastBacktest } from './lib/backtest-engine.mjs';
import { buildCostStrategy } from './lib/cost-optimizer.mjs';
import { buildOptionalSettlementReference } from './lib/settlement-reference.mjs';
import { buildSavingsWorkbench } from './lib/savings-workbench.mjs';
import { buildDeclarationReplay } from './lib/declaration-replay.mjs';
import {
  backtestDeclarationOptimizer,
  buildDeclarationRecommendation,
} from './lib/declaration-optimizer.mjs';
import { buildStrategyEvolution } from './lib/strategy-evolution.mjs';
import { loadDataSourceRegistry } from './lib/data-source-registry.mjs';
import { loadFieldCatalog } from './lib/field-catalog.mjs';
import { readPointInTimeStore } from './lib/point-in-time-store.mjs';
import { buildFeatureSnapshot } from './lib/feature-snapshot.mjs';
import { findForecastRuns, readForecastLedger } from './lib/forecast-ledger.mjs';
import { readOutcomeLedger } from './lib/outcome-ledger.mjs';
import { buildAccuracyReport } from './lib/forecast-evaluation.mjs';
import {
  createCompetitionMemoryStore,
  competitionRequestRoute,
  executeCompetitionAgent,
  parseCompetitionChatRequest,
} from './lib/competition-agent.mjs';
import {
  appendCompetitionTrace,
  buildCompetitionTrace,
  indexCompetitionEvidence,
} from './lib/competition-trace.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, '..');
const localCaptureStandardPath = path.resolve(
  rootDir,
  '../jspec-capture/output/session-20260507-101645/standard/standard-96.json'
);
const defaultStandardPath = existsSync(localCaptureStandardPath)
  ? localCaptureStandardPath
  : path.resolve(rootDir, 'data/standard-96.sample.json');
const browserDataPath = path.resolve(rootDir, 'data/standard-96.js');
const integrationSummaryPath = path.resolve(rootDir, 'data/integration-summary.json');
const integrationBuildScriptPath = path.resolve(rootDir, 'tools/build-integration-summary.py');
const dataSourceRegistryPath = path.resolve(rootDir, 'config/data-sources.json');
const fieldCatalogPath = path.resolve(rootDir, 'config/field-catalog.json');
const defaultAuditLogPath = path.resolve(rootDir, 'data/audit-log.ndjson');
const businessInputsDir = path.resolve(rootDir, 'data/business-inputs');
const defaultCaptureOutputPath = path.resolve(rootDir, '../jspec-capture/output');
const visibleSnapshotPath = path.resolve(
  getArgValue(
    '--visible-snapshot',
    process.env.TRADING_VISIBLE_SNAPSHOT_PATH || path.resolve(rootDir, 'data/ukey-visible-snapshot.json')
  )
);
const visibleHistoryPath = path.resolve(
  getArgValue(
    '--visible-history',
    process.env.TRADING_VISIBLE_HISTORY_PATH || path.resolve(rootDir, 'data/ukey-visible-history.json')
  )
);
const defaultPointInTimeStorePath = process.platform === 'win32' && process.env.LOCALAPPDATA
  ? path.resolve(process.env.LOCALAPPDATA, 'ElectricTradingAI/data/point-in-time-facts.json')
  : path.resolve(rootDir, 'data/point-in-time-facts.json');
const pointInTimeStorePath = path.resolve(
  getArgValue(
    '--point-in-time-store',
    process.env.TRADING_POINT_IN_TIME_STORE_PATH || defaultPointInTimeStorePath
  )
);
const ledgerDataRoot = process.platform === 'win32' && process.env.LOCALAPPDATA
  ? path.resolve(process.env.LOCALAPPDATA, 'ElectricTradingAI/data')
  : path.resolve(rootDir, 'data');
const forecastLedgerPath = path.resolve(getArgValue('--forecast-ledger', process.env.TRADING_FORECAST_LEDGER_PATH || path.join(ledgerDataRoot, 'forecast-ledger.json')));
const outcomeLedgerPath = path.resolve(getArgValue('--outcome-ledger', process.env.TRADING_OUTCOME_LEDGER_PATH || path.join(ledgerDataRoot, 'outcome-ledger.json')));
const startTime = Date.now();
const ukeyBrowserCollector = createUkeyBrowserCollector({ rootDir, env: process.env });
let settlementReferenceCache = null;
let strategyValidationCache = null;
let declarationOptimizerValidationCache = null;
let visibleHistoryWrite = Promise.resolve();

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }
  return process.argv[index + 1];
}

const port = Number(getArgValue('--port', process.env.PORT || 5177));
const host = process.env.HOST || '127.0.0.1';
const standardPath = path.resolve(getArgValue('--standard', defaultStandardPath));
const pythonPath = getArgValue('--python', process.env.TRADING_AI_PYTHON || '');
const auditLogPath = path.resolve(getArgValue('--audit', process.env.TRADING_AUDIT_LOG || defaultAuditLogPath));
const competitionTraceLogPath = path.resolve(
  getArgValue(
    '--competition-trace-log',
    process.env.COMPETITION_TRACE_LOG || path.resolve(rootDir, '.competition-runtime/traces.ndjson')
  )
);
const competitionMemoryStore = createCompetitionMemoryStore();

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

async function readCompetitionJsonBody(request, maxBytes = 1024 * 1024) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`request body exceeds ${maxBytes} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) throw new Error('request body must not be empty');
  return JSON.parse(text);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
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
  const history = await loadVisibleHistory();
  return mergeVisibleSnapshot(dataset, {
    ...history,
    accepted: history.rowCount > 0,
  });
}

async function loadVisibleHistory() {
  return readVisibleHistory(visibleHistoryPath, visibleSnapshotPath);
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

async function appendVisibleHistory(snapshot) {
  const operation = visibleHistoryWrite.then(async () => {
    const history = await loadVisibleHistory();
    const merged = mergeVisibleHistory(history, snapshot);
    await writeVisibleHistoryAtomic(visibleHistoryPath, merged);
    return merged;
  });
  visibleHistoryWrite = operation.catch(() => {});
  return operation;
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
    await Promise.all([saveVisibleSnapshot(snapshot), appendVisibleHistory(snapshot)]);
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

async function sweepManagedVisibleSnapshot(actor = 'local-auto-sweep', options = {}) {
  try {
    const sweep = await ukeyBrowserCollector.autoSweepVisiblePages(options);
    const snapshot = await persistVisibleSnapshotPayload(sweep, actor);
    ukeyBrowserCollector.recordIngestResult(snapshot);
    return {
      ok: snapshot.accepted,
      snapshot,
      sweepResult: {
        source: sweep.source,
        generatedAt: sweep.generatedAt,
        targetCount: sweep.targetCount,
        pageCount: sweep.pageCount,
        acceptedPageCount: sweep.acceptedPageCount,
        rowCount: sweep.rowCount,
        pages: sweep.pages,
        errors: sweep.errors,
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

async function loadDataAssets() {
  return buildInventoryFromDirectories([defaultCaptureOutputPath]);
}

async function loadSettlementReference() {
  if (!settlementReferenceCache) {
    settlementReferenceCache = buildOptionalSettlementReference({
      projectRoot,
      pythonPath,
      onUnavailable(error) {
        console.warn(`Optional settlement reference unavailable: ${error?.message || String(error)}`);
      },
    });
  }
  return settlementReferenceCache;
}

function datasetFromFeatureStore(featureStore, generatedAt) {
  return {
    generatedAt,
    rows: featureStore.rows,
    quality: {
      dates: featureStore.summary?.dates || [],
      gaps: [],
      fieldCompleteness: featureStore.summary?.fieldCompleteness || {},
    },
  };
}

async function loadForecastContext(date = '') {
  const dataset = await loadDataset();
  const assets = await loadDataAssets();
  const settlementReference = await loadSettlementReference();
  const allFeatureStore = buildForecastFeatureStore(dataset, { assets, settlementReference });
  const featureStore = buildForecastFeatureStore(dataset, { assets, settlementReference, date });
  const modelReport = buildForecastModelReport(allFeatureStore, { targetDate: date });
  const backtestReport = runForecastBacktest(allFeatureStore);
  return {
    dataset,
    assets,
    settlementReference,
    allFeatureStore,
    featureStore,
    strategyDataset: datasetFromFeatureStore(featureStore, dataset.generatedAt),
    modelReport,
    backtestReport,
  };
}

async function loadStrategyValidation() {
  if (!strategyValidationCache) {
    strategyValidationCache = Promise.all([
      loadForecastContext(''),
      loadDeclarationOptimizerValidation(),
    ])
      .then(([context, declarationOptimizer]) =>
        buildStrategyValidation(context.backtestReport, {
          declarationReplay: buildDeclarationReplay(context.allFeatureStore),
          declarationOptimizer,
        })
      )
      .catch((error) => {
        strategyValidationCache = null;
        throw error;
      });
  }
  return strategyValidationCache;
}

async function loadDeclarationOptimizerValidation() {
  if (!declarationOptimizerValidationCache) {
    declarationOptimizerValidationCache = loadForecastContext('')
      .then((context) =>
        backtestDeclarationOptimizer(context.allFeatureStore)
      )
      .catch((error) => {
        declarationOptimizerValidationCache = null;
        throw error;
      });
  }
  return declarationOptimizerValidationCache;
}

async function loadProductionReadiness(date = '') {
  const [dataset, integrationClosure, businessInputs] = await Promise.all([
    loadDataset(),
    loadIntegrationClosure(),
    loadBusinessInputs(),
  ]);
  const summary = summarizeDataset(dataset);
  const workbench = buildSavingsWorkbench({
    date,
    dataset,
    businessInputs,
  });
  return buildProductionReadiness({
    summary,
    integrationClosure,
    selectedDateSummary: {
      date: workbench.date,
      rowCount: workbench.metrics.rowCount,
      marketPricePointCount: workbench.metrics.marketPricePointCount,
      actualLoadPointCount: workbench.metrics.actualLoadPointCount,
      settlementPointCount: workbench.metrics.settlementPointCount,
    },
    businessInputSummary: {
      readyForDraftPrefill: workbench.metrics.executionInputsReady,
    },
    env: process.env,
    paths: {
      standardPath,
      integrationSummaryPath,
      auditLogPath,
    },
    governance: {
      fieldCatalogLoaded: existsSync(fieldCatalogPath),
      sourceRegistryLoaded: existsSync(dataSourceRegistryPath),
      p0SemanticsConfirmed: false,
      pointInTimeStoreWritable: Boolean(pointInTimeStorePath),
      featureSnapshotLeakageGuardEnabled: true,
      forecastLedgerWritable: Boolean(forecastLedgerPath),
      outcomeLedgerWritable: Boolean(outcomeLedgerPath),
      finalOutcomeCoverage: false,
      pointInTimeBacktestEnabled: false,
      economicReplayEvidenceComplete: false,
    },
  });
}

function competitionDate(instruction) {
  const matched = instruction.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  if (!matched) return '';
  return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`;
}

function sendCompetitionError(response, error) {
  sendJson(response, {
    error: {
      message: error?.message || String(error),
      type: 'invalid_request_error',
      code: error?.statusCode === 413 ? 'request_too_large' : 'invalid_request',
    },
  }, error?.statusCode || 400);
}

async function handleCompetitionChat(request, response) {
  try {
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      const error = new Error('content-type must be application/json');
      error.statusCode = 415;
      throw error;
    }
    const startedAtUnixNano = String(BigInt(Date.now()) * 1_000_000n);
    const parsed = parseCompetitionChatRequest(await readCompetitionJsonBody(request));
    const date = competitionDate(parsed.instruction);
    const dataSource = standardPath.endsWith(`${path.sep}data${path.sep}standard-96.sample.json`)
      ? 'repository_sample'
      : 'configured_standard';
    let context = { dataSource, date };
    if (competitionRequestRoute(parsed) === 'domain_analysis') {
      const dataset = await loadDataset();
      const readiness = await loadProductionReadiness(date);
      context = {
        ...context,
        advice: buildStrategyAdvice(dataset, { date }),
        suggestions: buildStrategySuggestions(dataset, { date }),
        readiness,
      };
    }
    const result = executeCompetitionAgent({
      request: parsed,
      context,
      memoryStore: competitionMemoryStore,
    });
    const endedAtUnixNano = String(BigInt(Date.now()) * 1_000_000n + 1n);
    const trace = buildCompetitionTrace({
      request: parsed,
      result,
      dataSource,
      model: parsed.model,
      startedAtUnixNano,
      endedAtUnixNano,
    });
    await appendCompetitionTrace(competitionTraceLogPath, trace);
    const evidence = indexCompetitionEvidence(trace);
    const traceId = evidence.root.traceId;
    const spanId = evidence.root.spanId;
    const body = JSON.stringify({
      id: `chatcmpl-${traceId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: parsed.model,
      choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: result.finishReason }],
      usage: {
        prompt_tokens: Math.max(1, Math.ceil(parsed.instruction.length / 2)),
        completion_tokens: Math.max(1, Math.ceil(result.content.length / 2)),
        total_tokens: Math.max(2, Math.ceil((parsed.instruction.length + result.content.length) / 2)),
      },
      trace_id: traceId,
    }, null, 2);
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      traceparent: `00-${traceId}-${spanId}-01`,
    });
    response.end(body);
  } catch (error) {
    sendCompetitionError(response, error);
  }
}

async function loadUkeyStatus(dataset = null) {
  const [resolvedDataset, visibleSnapshot, visibleHistory] = await Promise.all([
    dataset ? Promise.resolve(dataset) : loadDataset(),
    loadVisibleSnapshot(),
    loadVisibleHistory(),
  ]);
  return {
    ...buildUkeyAssistantStatus({
      env: process.env,
      summary: summarizeDataset(resolvedDataset),
    }),
    ...ukeyBrowserCollector.status(),
    visibleSnapshot: {
      accepted: Boolean(visibleSnapshot.accepted),
      rowCount: visibleSnapshot.rowCount || 0,
      generatedAt: visibleSnapshot.generatedAt || null,
      storagePath: visibleSnapshotPath,
    },
    visibleHistory: {
      rowCount: visibleHistory.rowCount || 0,
      dateCount: visibleHistory.dateCount || 0,
      dates: visibleHistory.dates || [],
      generatedAt: visibleHistory.generatedAt || null,
      storagePath: visibleHistoryPath,
    },
  };
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/forecast/runs') {
    const runType = url.searchParams.get('runType') || '';
    if (runType && !['live_issued', 'point_in_time_replay'].includes(runType)) { sendJson(response, { error: { code: 'forecast_run_type_invalid' } }, 400); return; }
    const ledger = await readForecastLedger(forecastLedgerPath);
    const runs = findForecastRuns(ledger, { forecastRunType: runType || undefined, targetTradingDate: url.searchParams.get('date') || undefined, modelId: url.searchParams.get('modelId') || undefined });
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const offset = Math.max(0, Number(Buffer.from(url.searchParams.get('cursor') || 'MA==', 'base64').toString('utf8')) || 0);
    sendJson(response, { runs: runs.slice(offset, offset + limit), nextCursor: offset + limit < runs.length ? Buffer.from(String(offset + limit)).toString('base64') : null }); return;
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/forecast/run/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/forecast/run/'.length));
    const run = (await readForecastLedger(forecastLedgerPath)).runs.find((item) => item.forecastRunId === id);
    if (!run) { sendJson(response, { error: { code: 'forecast_run_not_found' } }, 404); return; }
    sendJson(response, run); return;
  }
  if (request.method === 'GET' && url.pathname === '/api/forecast/accuracy') {
    const runType = url.searchParams.get('runType') || 'live_issued';
    const actualLabelVersion = url.searchParams.get('actualLabelVersion') || 'final';
    if (!['live_issued', 'point_in_time_replay'].includes(runType)) { sendJson(response, { error: { code: 'forecast_run_type_invalid' } }, 400); return; }
    if (!['temporary', 'current', 'final', 'settlement_initial', 'settlement_final', 'settlement_adjusted'].includes(actualLabelVersion)) { sendJson(response, { error: { code: 'outcome_label_invalid' } }, 400); return; }
    const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
    if (from && to && from > to) { sendJson(response, { error: { code: 'date_range_invalid' } }, 400); return; }
    const [forecastLedger, outcomeLedger] = await Promise.all([readForecastLedger(forecastLedgerPath), readOutcomeLedger(outcomeLedgerPath)]);
    const runs = forecastLedger.runs.filter((run) => run.forecastRunType === runType && (!from || run.targetTradingDate >= from) && (!to || run.targetTradingDate <= to) && (!url.searchParams.get('modelId') || run.modelId === url.searchParams.get('modelId')));
    const report = buildAccuracyReport({ runs, outcomes: outcomeLedger.outcomes, config: { version: '1', runType, actualLabelVersion, dimensions: url.searchParams.get('regime') ? [url.searchParams.get('regime')] : [] } });
    sendJson(response, { ...report, filter: { from: from || null, to: to || null, runType, modelId: url.searchParams.get('modelId'), actualLabelVersion }, runTypes: [runType] }); return;
  }
  if (request.method === 'GET' && url.pathname === '/api/forecast/outcome-coverage') {
    const ledger = await readOutcomeLedger(outcomeLedgerPath);
    const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '', targetField = url.searchParams.get('targetField') || '';
    const outcomes = ledger.outcomes.filter((item) => (!from || item.businessDate >= from) && (!to || item.businessDate <= to) && (!targetField || item.targetField === targetField));
    const byLabelVersion = {};
    for (const outcome of outcomes) byLabelVersion[outcome.actualLabelVersion] = (byLabelVersion[outcome.actualLabelVersion] || 0) + 1;
    sendJson(response, { filter: { from: from || null, to: to || null, targetField: targetField || null }, total: outcomes.length, byLabelVersion }); return;
  }
  if (request.method === 'GET' && url.pathname === '/api/data-sources') {
    sendJson(response, await loadDataSourceRegistry(dataSourceRegistryPath));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/field-catalog') {
    sendJson(response, await loadFieldCatalog(fieldCatalogPath));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/point-in-time/context') {
    const targetDate = url.searchParams.get('date') || '';
    const asOf = url.searchParams.get('asOf') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      sendJson(response, { error: { code: 'target_date_invalid', message: 'date must use YYYY-MM-DD' } }, 400);
      return;
    }
    const asOfMs = Date.parse(asOf);
    if (!Number.isFinite(asOfMs)) {
      sendJson(response, { error: { code: 'as_of_invalid', message: 'asOf must be an ISO timestamp' } }, 400);
      return;
    }
    if (asOfMs > Date.now()) {
      sendJson(response, { error: { code: 'as_of_in_future', message: 'asOf cannot be in the future for live queries' } }, 400);
      return;
    }
    const [store, catalog] = await Promise.all([
      readPointInTimeStore(pointInTimeStorePath),
      loadFieldCatalog(fieldCatalogPath),
    ]);
    const requestedFields = (url.searchParams.get('fields') || '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    const requiredFields = requestedFields.length
      ? requestedFields
      : ['systemLoadForecastMw', 'dayAheadPublicPriceYuanPerMwh', 'realTimeWeightedAveragePriceYuanPerMwh'];
    try {
      sendJson(response, buildFeatureSnapshot({
        facts: store.facts,
        catalog,
        targetDate,
        decisionCutoffAt: asOf,
        requiredFields,
      }));
    } catch (error) {
      sendJson(response, { error: { code: 'point_in_time_context_invalid', message: error.message } }, 400);
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, {
      ok: true,
      name: 'trading-ai-system',
      pid: process.pid,
      rootDir,
      version: '0.2.0',
      uptimeSeconds: Math.round((Date.now() - startTime) / 1000),
      standardPath,
      integrationSummaryPath,
      auditLogPath,
      visibleHistoryPath,
      pointInTimeStorePath,
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

  if (request.method === 'GET' && url.pathname === '/api/workbench') {
    const dataset = await loadDataset();
    const [businessInputs, ukeyStatus, auditEvents] = await Promise.all([
      loadBusinessInputs(),
      loadUkeyStatus(dataset),
      readAuditLog(auditLogPath, { limit: 8 }),
    ]);
    sendJson(
      response,
      buildSavingsWorkbench({
        date: url.searchParams.get('date') || '',
        dataset,
        businessInputs,
        ukeyStatus,
        auditEvents,
      })
    );
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
    const readiness = await loadProductionReadiness(url.searchParams.get('date') || '');
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

  if (request.method === 'GET' && url.pathname === '/api/data-assets') {
    sendJson(response, await loadDataAssets());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/settlement/reference') {
    sendJson(response, await loadSettlementReference());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/forecast/features') {
    const context = await loadForecastContext(url.searchParams.get('date') || '');
    sendJson(response, context.featureStore);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/forecast/model') {
    const context = await loadForecastContext(url.searchParams.get('date') || '');
    sendJson(response, context.modelReport);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/backtest') {
    const context = await loadForecastContext(url.searchParams.get('date') || '');
    sendJson(response, context.backtestReport);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/strategy-validation') {
    sendJson(response, await loadStrategyValidation());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/strategy-evolution') {
    const date = url.searchParams.get('date') || '';
    const [strategyValidation, auditEvents] = await Promise.all([
      loadStrategyValidation(),
      readAuditLog(auditLogPath, { limit: 12 }),
    ]);
    sendJson(
      response,
      buildStrategyEvolution({
        date,
        strategyValidation,
        auditEvents,
      })
    );
    return;
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/api/declaration-optimizer/validation'
  ) {
    sendJson(response, await loadDeclarationOptimizerValidation());
    return;
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/api/declaration-optimizer/recommendation'
  ) {
    const date = url.searchParams.get('date') || '';
    const [context, validation, businessInputs] = await Promise.all([
      loadForecastContext(date),
      loadDeclarationOptimizerValidation(),
      loadBusinessInputs(),
    ]);
    sendJson(
      response,
      buildDeclarationRecommendation(context.allFeatureStore, date, validation, {
        minDeclarationPowerMw:
          businessInputs.tradeLimits?.values?.minDeclarationPowerMw,
        maxDeclarationPowerMw:
          businessInputs.tradeLimits?.values?.maxDeclarationPowerMw,
      })
    );
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/cost-strategy') {
    const context = await loadForecastContext(url.searchParams.get('date') || '');
    sendJson(
      response,
      buildCostStrategy(context.strategyDataset, {
        date: url.searchParams.get('date') || '',
        assets: context.assets,
        modelReport: context.modelReport,
        backtestReport: context.backtestReport,
      })
    );
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/backfill/plan') {
    const context = await loadForecastContext(url.searchParams.get('date') || '');
    sendJson(
      response,
      buildBackfillPlan(context.strategyDataset, {
        date: url.searchParams.get('date') || '',
        assets: context.assets,
      })
    );
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/ukey-assistant') {
    sendJson(response, await loadUkeyStatus());
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

  if (request.method === 'POST' && url.pathname === '/api/ukey-assistant/sweep/run') {
    const body = await readJsonBody(request);
    sendJson(
      response,
      await sweepManagedVisibleSnapshot(
        request.headers['x-operator-id'] || process.env.TRADING_OPERATOR_ID || 'local-auto-sweep',
        {
          delayMs: body.delayMs,
          mode: body.mode,
          targetIds: Array.isArray(body.targetIds) ? body.targetIds : undefined,
          targets: Array.isArray(body.targets) ? body.targets : undefined,
        }
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
    const date = url.searchParams.get('date') || '';
    const context = await loadForecastContext(date);
    sendJson(
      response,
      buildStrategyReport(context.dataset, {
        date,
        integrationClosure: await loadIntegrationClosure(),
        assets: context.assets,
        featureStore: context.allFeatureStore,
        strategyDataset: context.strategyDataset,
        modelReport: context.modelReport,
        backtestReport: context.backtestReport,
        settlementReference: context.settlementReference,
      })
    );
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/strategy-report.md') {
    const date = url.searchParams.get('date') || '';
    const context = await loadForecastContext(date);
    const report = buildStrategyReport(context.dataset, {
      date,
      integrationClosure: await loadIntegrationClosure(),
      assets: context.assets,
      featureStore: context.allFeatureStore,
      strategyDataset: context.strategyDataset,
      modelReport: context.modelReport,
      backtestReport: context.backtestReport,
      settlementReference: context.settlementReference,
    });
    sendText(response, renderStrategyReportMarkdown(report), 'text/markdown; charset=utf-8');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/refresh') {
    settlementReferenceCache = null;
    strategyValidationCache = null;
    declarationOptimizerValidationCache = null;
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
    const date = url.searchParams.get('date') || '';
    const context = await loadForecastContext(date);
    const integrationClosure = await loadIntegrationClosure();
    const readiness = await loadProductionReadiness(date);
    const businessInputs = await loadBusinessInputs();
    const proposal = await createExecutionProposal({
      dataset: context.dataset,
      date,
      integrationClosure,
      readiness,
      businessInputs,
      assets: context.assets,
      featureStore: context.allFeatureStore,
      strategyDataset: context.strategyDataset,
      modelReport: context.modelReport,
      backtestReport: context.backtestReport,
      settlementReference: context.settlementReference,
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

    response.writeHead(200, {
      'content-type': contentType(filePath),
      'cache-control': 'no-store',
    });
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
    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      await handleCompetitionChat(request, response);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    await handleStatic(response, url.pathname);
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Trading AI System running at http://${host}:${port}\n`);
});
