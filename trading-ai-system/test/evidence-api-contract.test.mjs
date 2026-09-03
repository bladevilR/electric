import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openTradingEvidenceStore } from '../lib/trading-evidence-store.mjs';

const systemRoot = fileURLToPath(new URL('..', import.meta.url));

async function startServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'evidence-api-'));
  const port = 8200 + Math.floor(Math.random() * 700);
  const evidencePath = path.join(directory, 'evidence.sqlite');
  const store = openTradingEvidenceStore({ filePath: evidencePath, clock: () => '2026-09-03T10:00:00.000Z' });
  store.appendFacts([{
    sourceId: 'JSPEC-PRICE', fieldId: 'dayAheadUserPriceFinalYuanPerMwh', businessDate: '2026-07-01',
    pointIndex: 1, value: 350, unit: '元/MWh', availableAt: '2026-06-30T08:00:00.000Z',
    capturedAt: '2026-06-30T08:05:00.000Z', sourceRevision: 'price-v1',
  }]);
  store.appendFeatureSnapshot({
    id: 'snapshot-api', targetTradingDate: '2026-07-02', cutoffAt: '2026-07-01T08:00:00.000Z',
    completenessPct: 100, payload: { rows: [] }, createdAt: '2026-07-01T08:05:00.000Z',
  });
  store.appendForecastRun({
    forecastRunId: 'live-api', forecastRunType: 'live_issued', targetField: 'dayAheadUserPriceFinalYuanPerMwh',
    targetTradingDate: '2026-07-02', forecastGeneratedAt: '2026-07-01T08:05:00.000Z',
    decisionCutoffAt: '2026-07-01T08:00:00.000Z', featureSnapshotId: 'snapshot-api',
    featureVersion: 'v1', modelId: 'baseline', modelVersion: '1', codeCommitSha: 'abc1234',
    trainingStartDate: '2026-07-01', trainingEndDate: '2026-07-01', backtestSplitLabel: 'live',
    inputCompletenessPct: 100, rows: [{ pointIndex: 1, pointForecast: 351, p10: 340, p50: 351, p90: 360 }],
  });
  store.close();

  const args = [
    '--no-warnings', 'server.mjs', '--port', String(port), '--evidence-store', evidencePath,
    '--audit', path.join(directory, 'audit.ndjson'),
    '--visible-snapshot', path.join(directory, 'visible.json'),
    '--visible-history', path.join(directory, 'history.json'),
    '--point-in-time-store', path.join(directory, 'point.json'),
    '--forecast-ledger', path.join(directory, 'forecast.json'),
    '--outcome-ledger', path.join(directory, 'outcome.json'),
    '--expected-point-count', '2',
  ];
  const child = spawn(process.execPath, args, { cwd: systemRoot, env: { ...process.env, JSPEC_MANAGED_BROWSER_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdout.on('data', (chunk) => { if (chunk.toString().includes('Trading AI System running at')) resolve(); });
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${stderr}`)));
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      child.kill();
      await once(child, 'exit').catch(() => {});
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('collector status is stable and omits browser credentials', async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/collector/status`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.browser.state, 'stopped');
    assert.doesNotMatch(JSON.stringify(body), /cookie|token|password|(?:"pin")/i);
    assert.equal(body.weather.provider, 'Open-Meteo');
  } finally {
    await server.close();
  }
});

test('history facts and coverage expose filtered canonical SQLite data', async () => {
  const server = await startServer();
  try {
    const factsResponse = await fetch(`${server.baseUrl}/api/history/facts?fieldId=dayAheadUserPriceFinalYuanPerMwh&from=2026-07-01&to=2026-07-31&limit=50`);
    const facts = await factsResponse.json();
    assert.equal(factsResponse.status, 200);
    assert.equal(facts.query.fieldId, 'dayAheadUserPriceFinalYuanPerMwh');
    assert.equal(facts.rows.length, 1);
    assert.ok(facts.rows.length <= 50);
    const coverage = await fetch(`${server.baseUrl}/api/history/coverage?fieldId=dayAheadUserPriceFinalYuanPerMwh`).then((response) => response.json());
    assert.equal(coverage.coverage.dateCount, 1);
    assert.equal(coverage.coverage.pointsByDate['2026-07-01'], 1);
  } finally {
    await server.close();
  }
});

test('forecast runs come from the evidence store and invalid queries are rejected', async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/forecast/runs?runType=live_issued&date=2026-07-02`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.runs.map((run) => run.forecastRunId), ['live-api']);
    assert.equal((await fetch(`${server.baseUrl}/api/history/facts?from=bad-date`)).status, 400);
    assert.equal((await fetch(`${server.baseUrl}/api/forecast/runs?runType=bad`)).status, 400);
  } finally {
    await server.close();
  }
});
