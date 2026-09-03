import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { appendFact, emptyStore, writePointInTimeStoreAtomic } from '../lib/point-in-time-store.mjs';
import { createForecastRun, appendForecastRun, writeForecastLedgerAtomic } from '../lib/forecast-ledger.mjs';
import { appendOutcomeRevision, writeOutcomeLedgerAtomic } from '../lib/outcome-ledger.mjs';

const systemRoot = fileURLToPath(new URL('..', import.meta.url));
const localCaptureStandardPath = path.resolve(
  systemRoot,
  '../jspec-capture/output/session-20260507-101645/standard/standard-96.json'
);
const defaultStandardPath = existsSync(localCaptureStandardPath)
  ? localCaptureStandardPath
  : path.resolve(systemRoot, 'data/standard-96.sample.json');

async function readExpectedStandardSummary() {
  const dataset = JSON.parse(await readFile(defaultStandardPath, 'utf8'));
  return {
    rowCount: Array.isArray(dataset.rows) ? dataset.rows.length : 0,
  };
}

async function startServer(options = {}) {
  const port = 7200 + Math.floor(Math.random() * 1000);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-server-'));
  const auditPath = path.join(temp, 'audit-log.ndjson');
  const visibleSnapshotPath = path.join(temp, 'ukey-visible-snapshot.json');
  const visibleHistoryPath = path.join(temp, 'ukey-visible-history.json');
  const pointInTimeStorePath = path.join(temp, 'point-in-time-facts.json');
  const forecastLedgerPath = path.join(temp, 'forecast-ledger.json');
  const outcomeLedgerPath = path.join(temp, 'outcome-ledger.json');
  const args = [
    'server.mjs',
    '--port',
    String(port),
    '--audit',
    auditPath,
    '--visible-snapshot',
    visibleSnapshotPath,
    '--visible-history',
    visibleHistoryPath,
    '--point-in-time-store',
    pointInTimeStorePath,
    '--forecast-ledger', forecastLedgerPath,
    '--outcome-ledger', outcomeLedgerPath,
  ];
  if (options.standard) args.push('--standard', options.standard);
  if (options.python) args.push('--python', options.python);
  const server = spawn(
    process.execPath,
    args,
    {
      cwd: systemRoot,
      env: {
        ...process.env,
        JSPEC_MANAGED_BROWSER_DISABLED: '1',
        ...(options.host ? { HOST: options.host } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const ready = new Promise((resolve, reject) => {
    let stderr = '';
    server.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    server.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (text.includes('Trading AI System running at')) {
        resolve();
      }
    });
    server.on('exit', (code) => {
      reject(new Error(`server exited before ready: ${code}\n${stderr}`));
    });
  });

  await ready;
  return {
    baseUrl: `http://${options.clientHost || '127.0.0.1'}:${port}`,
    visibleHistoryPath,
    pointInTimeStorePath,
    forecastLedgerPath,
    outcomeLedgerPath,
    async close() {
      server.kill();
      await once(server, 'exit').catch(() => {});
      await rm(temp, { recursive: true, force: true });
    },
  };
}

test('forecast API stays available when the optional settlement reference runtime fails', async () => {
  const server = await startServer({
    python: process.execPath,
    standard: path.resolve(systemRoot, 'data/standard-96.sample.json'),
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/forecast/model`);
    const report = await response.json();

    assert.equal(response.status, 200);
    assert.ok(['insufficient_history', 'baseline_ready'].includes(report.status));
  } finally {
    await server.close();
  }
});

test('catalog and point-in-time APIs expose cutoff-safe read-only context', async () => {
  const server = await startServer();
  try {
    let store = appendFact(emptyStore(), {
      sourceId: 'JSPEC-P0-3', fieldId: 'dayAheadUserPriceTemporaryYuanPerMwh', businessDate: '2026-08-24',
      pointIndex: 1, value: 318.5, availableAt: '2026-08-23T10:00:00+08:00', capturedAt: '2026-08-23T10:01:00+08:00', sourceRevision: 'r1'
    });
    store = appendFact(store, {
      sourceId: 'JSPEC-P0-3', fieldId: 'dayAheadUserPriceTemporaryYuanPerMwh', businessDate: '2026-08-24',
      pointIndex: 1, value: 999, availableAt: '2026-08-23T13:00:00+08:00', capturedAt: '2026-08-23T13:01:00+08:00', sourceRevision: 'r2'
    });
    await writePointInTimeStoreAtomic(server.pointInTimeStorePath, store);

    const [sourcesResponse, fieldsResponse, contextResponse] = await Promise.all([
      fetch(`${server.baseUrl}/api/data-sources`),
      fetch(`${server.baseUrl}/api/field-catalog`),
      fetch(`${server.baseUrl}/api/point-in-time/context?date=2026-08-24&asOf=${encodeURIComponent('2026-08-23T12:00:00+08:00')}&fields=dayAheadUserPriceTemporaryYuanPerMwh`),
    ]);
    const sources = await sourcesResponse.json();
    const fields = await fieldsResponse.json();
    const context = await contextResponse.json();
    assert.equal(sourcesResponse.headers.get('cache-control'), 'no-store');
    assert.ok(sources.sources.some((source) => source.sourceId === 'JSPEC-P0-3'));
    assert.ok(fields.fields.some((field) => field.fieldId === 'dayAheadUserClearedPowerMw'));
    assert.doesNotMatch(JSON.stringify(fields), /"(?:cookie|token|authorization|pin|private[_ -]?key|password)"\s*:/i);
    assert.equal(context.rows[0].fields.dayAheadUserPriceTemporaryYuanPerMwh, 318.5);
    assert.deepEqual(context.rows[0].selectedFactIds, [store.facts[0].factId]);

    const future = await fetch(`${server.baseUrl}/api/point-in-time/context?date=2026-08-24&asOf=2999-01-01T00:00:00Z`);
    assert.equal(future.status, 400);
    assert.equal((await future.json()).error.code, 'as_of_in_future');
  } finally {
    await server.close();
  }
});

test('forecast accuracy API isolates live and replay ledgers', async () => {
  const server = await startServer();
  try {
    const run = createForecastRun({forecastRunId:'live-1',forecastRunType:'live_issued',targetField:'price',targetTradingDate:'2026-08-24',forecastGeneratedAt:'2026-08-23T09:00:00+08:00',decisionCutoffAt:'2026-08-23T10:00:00+08:00',featureSnapshotId:'fs-1',featureVersion:'v1',modelId:'median',modelVersion:'1',codeCommitSha:'abc1234',trainingStartDate:'2026-08-01',trainingEndDate:'2026-08-22',backtestSplitLabel:'live',inputCompletenessPct:100,rows:[{pointIndex:1,pointForecast:10}]});
    await writeForecastLedgerAtomic(server.forecastLedgerPath, appendForecastRun({version:1,runs:[]},run));
    const outcome={targetField:'price',businessDate:'2026-08-24',pointIndex:1,actualValue:12,actualLabelVersion:'final',sourceId:'JSPEC-P0-3',sourceRevision:'r1',publishedAt:'2026-08-25T09:00:00+08:00',actualBackfilledAt:'2026-08-25T09:01:00+08:00'};
    await writeOutcomeLedgerAtomic(server.outcomeLedgerPath,appendOutcomeRevision({version:1,outcomes:[]},outcome));
    const response=await fetch(`${server.baseUrl}/api/forecast/accuracy?runType=live_issued&actualLabelVersion=final`);const body=await response.json();
    assert.equal(response.status,200);assert.deepEqual(body.runTypes,['live_issued']);assert.equal(body.metrics.mae,2);
    assert.equal((await fetch(`${server.baseUrl}/api/forecast/accuracy?runType=bad`)).status,400);
  } finally { await server.close(); }
});

function visibleSnapshot(date, price) {
  return {
    source: 'visible_page_snapshot',
    rows: [{ date, pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: price }],
  };
}

function nonLoopbackIpv4() {
  return Object.values(os.networkInterfaces())
    .flat()
    .find((address) => address?.family === 'IPv4' && !address.internal)?.address;
}

test('HOST=0.0.0.0 allows the production server to accept non-loopback traffic', async (context) => {
  const clientHost = nonLoopbackIpv4();
  if (!clientHost) {
    context.skip('当前测试环境没有非回环 IPv4 地址');
    return;
  }
  const server = await startServer({ host: '0.0.0.0', clientHost });

  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    const health = await response.json();
    assert.equal(response.status, 200);
    assert.equal(health.ok, true);
  } finally {
    await server.close();
  }
});

test('the production server remains loopback-only when HOST is unset', async (context) => {
  const clientHost = nonLoopbackIpv4();
  if (!clientHost) {
    context.skip('当前测试环境没有非回环 IPv4 地址');
    return;
  }
  const server = await startServer({ clientHost });

  try {
    await assert.rejects(
      fetch(`${server.baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) })
    );
  } finally {
    await server.close();
  }
});

test('accepted visible snapshots accumulate across trading dates in persistent history', async () => {
  const server = await startServer({
    standard: path.join(systemRoot, 'data/standard-96.sample.json'),
  });

  try {
    for (const [date, price] of [
      ['2026-08-17', 320],
      ['2026-08-18', 330],
    ]) {
      const response = await fetch(`${server.baseUrl}/api/ukey-assistant/visible-snapshot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(visibleSnapshot(date, price)),
      });
      assert.equal(response.status, 200);
    }

    const history = JSON.parse(await readFile(server.visibleHistoryPath, 'utf8'));
    assert.deepEqual(history.dates, ['2026-08-17', '2026-08-18']);
    assert.equal(history.rowCount, 2);

    const dataset = await fetch(`${server.baseUrl}/api/dataset`).then((response) => response.json());
    assert.equal(dataset.rows.some((row) => row.date === '2026-08-17' && row.realTimeAvgPrice === 320), true);
    assert.equal(dataset.rows.some((row) => row.date === '2026-08-18' && row.realTimeAvgPrice === 330), true);

    const status = await fetch(`${server.baseUrl}/api/ukey-assistant`).then((response) => response.json());
    assert.equal(status.visibleHistory.dateCount, 2);
    assert.equal(status.visibleHistory.rowCount, 2);
  } finally {
    await server.close();
  }
});

test('local server exposes the P0 system loop', async () => {
  const expectedStandardSummary = await readExpectedStandardSummary();
  const server = await startServer();

  try {
    const [
      home,
      appScript,
      workbenchScript,
      health,
      summary,
      workbench,
      strategy,
      strategyReport,
      strategyReportMarkdown,
      integrations,
      integrationsMarkdown,
      productionReadiness,
      businessInputs,
      ukeyAssistant,
      modelRuntime,
      dataAssets,
      settlementReference,
      forecastFeatures,
      historicalForecastFeatures,
      transactionForecastFeatures,
      forecastModel,
      backtest,
      costStrategy,
      backfillPlan,
      declarationOptimizerValidation,
      declarationRecommendation,
      strategyValidation,
      refresh,
    ] = await Promise.all([
      fetch(`${server.baseUrl}/`).then((response) => response.text()),
      fetch(`${server.baseUrl}/app.js`).then((response) => response.text()),
      fetch(`${server.baseUrl}/workbench.js`).then((response) => response.text()),
      fetch(`${server.baseUrl}/api/health`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/summary`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/workbench?date=2026-07-27`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/strategy?date=2026-05-07`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/strategy-report?date=2026-05-07`, { method: 'POST' }).then(
        (response) => response.json()
      ),
      fetch(`${server.baseUrl}/api/strategy-report.md?date=2026-05-07`).then((response) =>
        response.text()
      ),
      fetch(`${server.baseUrl}/api/integrations`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/integrations.md`).then((response) => response.text()),
      fetch(`${server.baseUrl}/api/production/readiness`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/business-inputs`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/ukey-assistant`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/ai/model`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/data-assets`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/settlement/reference`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/forecast/features?date=2026-05-07`).then((response) =>
        response.json()
      ),
      fetch(`${server.baseUrl}/api/forecast/features?date=2026-01-01`).then((response) =>
        response.json()
      ),
      fetch(`${server.baseUrl}/api/forecast/features?date=2026-03-31`).then((response) =>
        response.json()
      ),
      fetch(`${server.baseUrl}/api/forecast/model?date=2026-05-07`).then((response) =>
        response.json()
      ),
      fetch(`${server.baseUrl}/api/backtest`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/cost-strategy?date=2026-05-07`).then((response) =>
        response.json()
      ),
      fetch(`${server.baseUrl}/api/backfill/plan?date=2026-05-07`).then((response) =>
        response.json()
      ),
      fetch(`${server.baseUrl}/api/declaration-optimizer/validation`).then(
        (response) => response.json()
      ),
      fetch(
        `${server.baseUrl}/api/declaration-optimizer/recommendation?date=2026-07-29`
      ).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/strategy-validation`).then((response) =>
        response.json()
      ),
      fetch(`${server.baseUrl}/api/refresh`, { method: 'POST' }).then((response) =>
        response.json()
      ),
    ]);

    assert.match(home, /电力交易智能决策平台/);
    assert.match(
      home,
      /<script type="module" src="\.\/workbench\.js(?:\?v=[^"]+)?"><\/script>/
    );
    assert.match(home, /id="workbenchRoot"/);
    assert.doesNotMatch(home, /data\/standard-96\.js/);
    assert.match(workbenchScript, /当日交易决策中心/);
    assert.match(workbenchScript, /\/api\/workbench/);
    assert.match(workbenchScript, /未获取/);
    assert.match(workbenchScript, /系统运行成本/);
    assert.match(appScript, /dataQuality/);
    assert.match(appScript, /数据准备情况/);
    assert.match(appScript, /业务数据是否到位/);
    assert.match(appScript, /当前交易日点位/);
    assert.match(appScript, /\/api\/integrations/);
    assert.match(appScript, /integrationClosure/);
    assert.match(appScript, /\/api\/strategy/);
    assert.match(appScript, /strategySuggestions/);
    assert.match(appScript, /辅助建议/);
    assert.match(appScript, /blockingReasons/);
    assert.match(appScript, /不会自动提交/);
    assert.match(appScript, /\/api\/strategy-report/);
    assert.ok(
      appScript.includes(
        "fetch(`/api/strategy-report?date=${encodeURIComponent(state.date)}`, {\n      method: 'POST',\n      cache: 'no-store',\n    })"
      )
    );
    assert.match(appScript, /\/api\/production\/readiness/);
    assert.match(appScript, /\/api\/execution\/proposal/);
    assert.match(appScript, /\/api\/execution\/review/);
    assert.match(appScript, /\/api\/audit/);
    assert.match(appScript, /\/api\/business-inputs/);
    assert.match(appScript, /\/api\/ukey-assistant/);
    assert.match(appScript, /\/api\/ukey-assistant\/browser\/start/);
    assert.match(appScript, /\/api\/ukey-assistant\/collector\/sample/);
    assert.match(appScript, /\/api\/ukey-assistant\/sweep\/run/);
    assert.match(appScript, /ukeyStartBrowserButton/);
    assert.match(appScript, /ukeySweepButton/);
    assert.match(appScript, /mode: 'full'/);
    assert.match(appScript, /一键全量慢采/);
    assert.match(appScript, /ukeySampleButton/);
    assert.match(appScript, /renderUkeyAssistant/);
    assert.match(appScript, /data-review-decision/);
    assert.match(appScript, /strategyReport/);
    assert.match(appScript, /productionReadiness/);
    assert.match(appScript, /businessInputs/);
    assert.match(appScript, /costStrategy/);
    assert.match(appScript, /dataAssets/);
    assert.match(appScript, /settlementReference/);
    assert.match(appScript, /结算参考/);
    assert.match(appScript, /历史标签点/);
    assert.match(appScript, /交易计算表 CSV/);
    assert.match(appScript, /小时持仓参考/);
    assert.match(appScript, /月度结算概览/);
    assert.match(appScript, /长期交易背景/);
    assert.match(appScript, /额外复盘点/);
    assert.match(appScript, /forecastLab/);
    assert.match(appScript, /backtestReport/);
    assert.match(appScript, /backfillPlan/);
    assert.match(appScript, /\/api\/data-assets/);
    assert.match(appScript, /\/api\/settlement\/reference/);
    assert.match(appScript, /\/api\/forecast\/model/);
    assert.match(appScript, /\/api\/backtest/);
    assert.match(appScript, /\/api\/cost-strategy/);
    assert.match(appScript, /\/api\/backfill\/plan/);
    assert.match(appScript, /render\(\);\s*loadSystemData\(\);/);
    assert.match(appScript, /fullSweepButton/);
    assert.match(appScript, /一键全量慢采/);
    assert.match(appScript, /全量慢采中/);
    assert.match(appScript, /后台自动完成/);
    assert.match(appScript, /可以去做别的/);
    assert.match(appScript, /保持 UKey、数据窗口和本地服务打开/);
    assert.match(appScript, /mode: 'full'/);
    assert.match(appScript, /计划加载中/);
    assert.match(appScript, /预计耗时/);
    assert.match(appScript, /startFullSlowSweep/);
    assert.doesNotMatch(appScript, /targetIds: targets\.map\(\(target\) => target\.id\)/);
    assert.match(appScript, /今日工作台/);
    assert.match(appScript, /策略建议/);
    assert.match(appScript, /数据进度/);
    assert.match(appScript, /结算参考/);
    assert.match(appScript, /价格预测/);
    assert.match(appScript, /预测验证/);
    assert.match(appScript, /能预测实时均价/);
    assert.match(appScript, /识别高价风险/);
    assert.match(appScript, /暂不生成执行电量/);
    assert.match(appScript, /需要目标日实际负荷/);
    assert.match(appScript, /需要目标日结算/);
    assert.match(appScript, /MAE 平均误差/);
    assert.match(appScript, /RMSE 均方根误差/);
    assert.doesNotMatch(appScript, /模型模式/);
    assert.doesNotMatch(appScript, /same-slot baseline/);
    assert.doesNotMatch(appScript, /raw captures/);
    assert.doesNotMatch(appScript, /walk-forward/);
    assert.match(appScript, /报告已生成/);
    assert.doesNotMatch(appScript, /待接入/);
    assert.doesNotMatch(appScript, /72,783|218 ~ 728|协鑫能科|GCL-ET|10:30-14:30|17:30-20:30|21:00-22:00|\+2\.8 万kWh|\+1\.2 ~ \+2\.6|2026-03/);

    assert.equal(health.ok, true);
    assert.equal(health.name, 'trading-ai-system');
    assert.equal(health.modelRuntime.provider, 'openai_compatible');
    assert.equal(health.modelRuntime.configured, false);
    assert.equal(health.pointInTimeStorePath, server.pointInTimeStorePath);

    assert.equal(summary.rowCount, expectedStandardSummary.rowCount);
    assert.equal(summary.p0SourceCoverage.present, 8);
    assert.equal(summary.p0SourceCoverage.total, 8);
    assert.ok(summary.gapCount >= 1);

    assert.equal(workbench.date, '2026-07-27');
    assert.equal(workbench.status, 'blocked');
    assert.equal(workbench.execution.allowed, false);
    assert.equal(workbench.savings.estimatedNetYuan, null);
    assert.equal(workbench.savings.realizedNetYuan, null);
    assert.equal(workbench.primaryAction.id, 'collect_today_data');
    assert.ok(workbench.blockers.some((item) => item.id === 'current_day_missing'));
    assert.deepEqual(
      workbench.stages.map((stage) => stage.label),
      ['数据接入', '质量校验', '策略决策', '结算评估']
    );

    assert.ok(Array.isArray(strategy.suggestions));
    assert.equal(strategy.modelRuntime.provider, 'openai_compatible');
    assert.equal(strategy.modelPrediction.status, 'disabled');
    assert.equal(strategy.advice.status, 'observation_ready');
    assert.equal(strategy.advice.executionBoundary.executable, false);
    assert.equal(strategy.advice.realtimePrice.required, true);
    assert.equal(strategy.advice.realtimePrice.status, 'available_snapshot');
    assert.ok(strategy.suggestions.some((item) => item.type === 'low_price'));
    assert.ok(strategy.suggestions.some((item) => item.type === 'high_price_risk'));
    assert.ok(strategy.suggestions.some((item) => item.type === 'data_gap'));
    assert.ok(strategy.suggestions.every((item) => item.executable === false));
    assert.ok(strategy.suggestions.every((item) => item.requiredData.length > 0));
    assert.ok(strategy.suggestions.every((item) => item.blockingReasons.length > 0));
    assert.doesNotMatch(JSON.stringify(strategy), /待接入/);

    assert.equal(strategyReport.title, '苏州地铁电力交易 AI 辅助策略报告');
    assert.equal(strategyReport.status, 'trial_only');
    assert.equal(strategyReport.statusText, '可试算，不可执行');
    assert.ok(strategyReport.forecastSummary);
    assert.ok(strategyReport.backtestSummary);
    assert.ok(strategyReport.costStrategy);
    assert.ok(strategyReport.savingsFocus);
    assert.ok(strategyReport.nextActions.some((item) => item.id === 'targeted_backfill'));
    assert.ok(strategyReport.closureItems.some((item) => item.id === 'actual_load_96'));
    assert.ok(strategyReport.blockingReasons.some((item) => item.includes('日结算')));
    assert.doesNotMatch(JSON.stringify(strategyReport), /待接入/);

    assert.match(strategyReportMarkdown, /^# 苏州地铁电力交易 AI 辅助策略报告/);
    assert.match(strategyReportMarkdown, /状态：可试算，不可执行/);
    assert.match(strategyReportMarkdown, /闭环清单/);
    assert.doesNotMatch(strategyReportMarkdown, /待接入/);

    assert.equal(integrations.completion.accounted, integrations.completion.total);
    assert.ok(integrations.items.some((item) => item.id === 'trade_ledger' && item.status === 'closed'));
    assert.ok(integrations.items.some((item) => item.id === 'actual_load_96' && item.status === 'source_empty'));
    assert.doesNotMatch(JSON.stringify(integrations), /待接入/);

    assert.match(integrationsMarkdown, /^# \u6570\u636e\u95ed\u73af\u53f0\u8d26/);
    assert.match(integrationsMarkdown, /\u95ed\u73af\u5b8c\u6210\u5ea6\uff1a8\/8/);
    assert.match(integrationsMarkdown, /\u6e90\u8fd4\u56de\u7a7a/);
    assert.doesNotMatch(integrationsMarkdown, /\u5f85\u63a5\u5165/);

    assert.equal(productionReadiness.status, 'data_blocked');
    assert.equal(productionReadiness.capabilities.proposalDraft, false);
    assert.equal(productionReadiness.capabilities.verifiedSavings, false);
    assert.equal(productionReadiness.capabilities.autoSubmit, false);
    assert.equal(productionReadiness.blockers.some((item) => item.id === 'ca_ukey'), false);
    assert.ok(productionReadiness.blockers.some((item) => item.id === 'current_day_data'));
    assert.ok(productionReadiness.warnings.some((item) => item.id === 'source_empty_data'));
    assert.doesNotMatch(JSON.stringify(productionReadiness), /寰呮帴鍏?/);
    assert.equal(businessInputs.summary.readyForDraftPrefill, false);
    assert.ok(businessInputs.templates.forecastLoad96.endsWith('forecast-load-96.csv'));
    assert.equal(ukeyAssistant.mode, 'local_integrated_ukey_assistant');
    assert.equal(ukeyAssistant.capabilities.serverReadsCredential, false);
    assert.ok(ukeyAssistant.prohibitedActions.includes('read_cookie'));
    assert.equal(ukeyAssistant.browserWindow.debugAddress, '127.0.0.1');
    assert.equal(ukeyAssistant.browserWindow.profileDir.endsWith('.browser\\jspec-managed-profile') || ukeyAssistant.browserWindow.profileDir.endsWith('.browser/jspec-managed-profile'), true);
    assert.equal(ukeyAssistant.collector.intervalSeconds, 30);
    assert.equal(ukeyAssistant.collector.state, 'stopped');
    assert.equal(ukeyAssistant.sweep.state, 'idle');
    assert.equal(ukeyAssistant.sweep.defaultDelayMs, 20000);
    assert.ok(ukeyAssistant.sweep.targetCount >= 10);
    assert.ok(ukeyAssistant.sweep.targetIds.includes('energy_block_trades'));
    assert.equal(modelRuntime.provider, 'openai_compatible');
    assert.equal(modelRuntime.configured, false);
    assert.doesNotMatch(JSON.stringify(modelRuntime), /sk-/);
    assert.ok(dataAssets.summary);
    assert.ok(settlementReference.summary);
    assert.equal(settlementReference.summary.canFillActualKwh, true);
    assert.ok(settlementReference.summary.transactionCalculationHourlySummaryRows >= 720);
    assert.ok(settlementReference.summary.transactionCalculationPositionHourlyRows >= 240);
    assert.ok(Array.isArray(settlementReference.monthlyOverviewRows));
    assert.ok(Array.isArray(settlementReference.longTermOverviewRows));
    assert.ok(Array.isArray(forecastFeatures.rows));
    const hasLocalSettlementWorkbooks = settlementReference.summary.hasSettlementReference;
    const hasFullHistoricalEvidence = hasLocalSettlementWorkbooks && summary.rowCount > 192;
    if (hasLocalSettlementWorkbooks) {
      assert.equal(settlementReference.summary.canFillSettleAmount, true);
      assert.ok(settlementReference.summary.actualKwhCandidateRows >= 17000);
      assert.ok(settlementReference.summary.settleAmountCandidateRows >= 17000);
      assert.ok(settlementReference.summary.monthlyOverviewRows >= 2);
      assert.ok(settlementReference.summary.longTermOverviewRows >= 6);
      assert.ok(settlementReference.monthlyOverviewRows.some((item) => item.monthKey === '2026-01'));
      assert.ok(settlementReference.longTermOverviewRows.some((item) => item.periodLabel === '2024'));
      assert.equal(historicalForecastFeatures.rows.length, 96);
      assert.equal(historicalForecastFeatures.summary.fieldCompleteness.actualKwh, 96);
      assert.equal(historicalForecastFeatures.summary.fieldCompleteness.settleAmount, 96);
      assert.equal(historicalForecastFeatures.rows[0].actualKwh, 20163);
      assert.equal(historicalForecastFeatures.rows[0].settleAmount, 6579.17);
      assert.equal(historicalForecastFeatures.rows[0].dayAheadForecastMwh, 9.275);
      assert.equal(historicalForecastFeatures.rows[0].totalTradeSavingYuan, 111.296);
    } else {
      assert.equal(settlementReference.summary.hasSettlementReference, false);
      assert.equal(settlementReference.summary.canFillSettleAmount, false);
      assert.equal(settlementReference.summary.settleAmountCandidateRows, 0);
      assert.equal(settlementReference.summary.monthlyOverviewRows, 0);
      assert.equal(settlementReference.summary.longTermOverviewRows, 0);
      assert.deepEqual(settlementReference.monthlyOverviewRows, []);
      assert.deepEqual(settlementReference.longTermOverviewRows, []);
      assert.equal(historicalForecastFeatures.rows.length, 0);
    }
    assert.equal(transactionForecastFeatures.rows.length, 96);
    assert.equal(transactionForecastFeatures.summary.fieldCompleteness.actualKwh, 96);
    assert.equal(transactionForecastFeatures.summary.fieldCompleteness.declarationPower, 96);
    assert.equal(
      transactionForecastFeatures.rows[0].sourceEndpoints.includes('transaction-calculation-standardized'),
      true
    );
    assert.ok(forecastModel.status);
    assert.ok(backtest.status);
    assert.ok(Array.isArray(costStrategy.policyTiers));
    assert.ok(Array.isArray(backfillPlan.targets));
    assert.equal(backfillPlan.targets.length <= 4, true);
    if (hasFullHistoricalEvidence) {
      assert.equal(declarationOptimizerValidation.status, 'validated');
      assert.equal(
        declarationOptimizerValidation.selectedModel.id,
        'same_slot_mean_w42_a1'
      );
      assert.equal(declarationOptimizerValidation.holdout.pointCount, 4128);
      assert.equal(declarationOptimizerValidation.holdout.improvementPct, 9.64);
      assert.equal(
        declarationOptimizerValidation.holdout.dailyWinRatePct,
        86.05
      );
      assert.equal(strategyValidation.operatingMode, 'validated_optimizer');
    } else {
      assert.equal(declarationOptimizerValidation.status, 'insufficient_history');
      assert.equal(declarationOptimizerValidation.selectedModel, null);
      assert.equal(declarationOptimizerValidation.holdout, null);
      assert.equal(strategyValidation.operatingMode, 'baseline_fallback');
    }
    assert.equal(declarationOptimizerValidation.costSavingsYuan, null);
    assert.equal(declarationRecommendation.status, 'missing_baseline');
    assert.equal(
      declarationRecommendation.operatingMode,
      'baseline_fallback'
    );
    assert.equal(strategyValidation.executionAllowed, false);

    const browserStart = await fetch(`${server.baseUrl}/api/ukey-assistant/browser/start`, {
      method: 'POST',
    }).then((response) => response.json());
    assert.equal(typeof browserStart.ok, 'boolean');
    assert.ok(browserStart.browserWindow);

    const collectorSample = await fetch(`${server.baseUrl}/api/ukey-assistant/collector/sample`, {
      method: 'POST',
    }).then((response) => response.json());
    assert.equal(typeof collectorSample.ok, 'boolean');
    assert.ok(collectorSample.collector);

    const sweepRun = await fetch(`${server.baseUrl}/api/ukey-assistant/sweep/run`, {
      method: 'POST',
    }).then((response) => response.json());
    assert.equal(typeof sweepRun.ok, 'boolean');
    assert.ok(sweepRun.sweep);
    assert.ok(sweepRun.sweep.targetCount >= 10);

    const collectorStart = await fetch(`${server.baseUrl}/api/ukey-assistant/collector/start`, {
      method: 'POST',
    }).then((response) => response.json());
    assert.equal(typeof collectorStart.ok, 'boolean');
    assert.ok(collectorStart.collector);

    const collectorStop = await fetch(`${server.baseUrl}/api/ukey-assistant/collector/stop`, {
      method: 'POST',
    }).then((response) => response.json());
    assert.equal(collectorStop.ok, true);
    assert.equal(collectorStop.collector.state, 'stopped');

    const browserStop = await fetch(`${server.baseUrl}/api/ukey-assistant/browser/stop`, {
      method: 'POST',
    }).then((response) => response.json());
    assert.equal(browserStop.ok, true);
    assert.ok(browserStop.browserWindow);

    if (hasFullHistoricalEvidence) {
      assert.equal(refresh.ok, true);
      assert.equal(refresh.integrationClosure.completion.accounted, refresh.integrationClosure.completion.total);
      assert.ok(refresh.integrationSummary.generatedAt);
    } else {
      assert.equal(refresh.ok, false);
      assert.match(refresh.error, /integration summary build exited|No module named|dataset-summary\.json/);
    }

    const executionProposal = await fetch(
      `${server.baseUrl}/api/execution/proposal?date=2026-05-07`,
      { method: 'POST', headers: { 'x-operator-id': 'contract-test' } }
    ).then((response) => response.json());
    const audit = await fetch(`${server.baseUrl}/api/audit?limit=20`).then((response) =>
      response.json()
    );

    assert.equal(executionProposal.status, 'blocked');
    assert.equal(executionProposal.autoSubmit, false);
    assert.equal(executionProposal.humanDecisionRequired, true);
    assert.deepEqual(executionProposal.orderLines, []);
    assert.ok(executionProposal.costStrategy);
    assert.ok(executionProposal.reviewWarnings.some((item) => item.includes('成本优化策略置信度')));
    assert.deepEqual(executionProposal.proposalLines, []);
    assert.ok(executionProposal.blockers.some((item) => item.includes('负荷、持仓与交易限额')));
    assert.equal(executionProposal.blockers.some((item) => item.includes('CA/UKey')), false);

    const review = await fetch(
      `${server.baseUrl}/api/execution/review?proposalId=blocked-contract&date=2026-05-07&decision=accepted&note=manual`,
      { method: 'POST', headers: { 'x-reviewer-id': 'reviewer-test' } }
    ).then((response) => response.json());
    assert.ok(audit.events.some((item) => item.type === 'execution_proposal_created'));
    assert.equal(review.decision, 'accepted');
    assert.equal(review.autoSubmit, false);

    const auditAfterReview = await fetch(`${server.baseUrl}/api/audit?limit=20`).then((response) =>
      response.json()
    );
    assert.ok(auditAfterReview.events.some((item) => item.type === 'proposal_review_recorded'));
  } finally {
    await server.close();
  }
});

test('one-minute onboarding page is friendly and launchable', async () => {
  const [guideHtml, homeHtml, workbenchScript, launcherBat, launchScript, packageScript, iconInfo] = await Promise.all([
    readFile(path.join(systemRoot, '一分钟上手.html'), 'utf8'),
    readFile(path.join(systemRoot, 'index.html'), 'utf8'),
    readFile(path.join(systemRoot, 'workbench.js'), 'utf8'),
    readFile(path.join(systemRoot, '启动系统.bat'), 'utf8'),
    readFile(path.join(systemRoot, 'start-system.ps1'), 'utf8'),
    readFile(path.join(systemRoot, 'tools/package-one-minute.mjs'), 'utf8'),
    stat(path.join(systemRoot, 'assets/app-icon.png')),
  ]);

  assert.match(guideHtml, /一分钟上手/);
  assert.match(guideHtml, /一键启动/);
  assert.match(guideHtml, /全量功能/);
  assert.match(guideHtml, /全量慢采/);
  assert.match(guideHtml, /价格预测/);
  assert.match(guideHtml, /左侧“价格预测”/);
  assert.match(guideHtml, /累计 5\/5/);
  assert.match(guideHtml, /第 6 个交易日/);
  assert.match(guideHtml, /成功采集/);
  assert.doesNotMatch(guideHtml, /进入“数据进度”“结算参考”“价格预测”“预测验证”/);
  assert.match(guideHtml, /省钱策略/);
  assert.match(guideHtml, /UKey/);
  assert.match(guideHtml, /不会自动提交/);
  assert.match(guideHtml, /Windows 10\/11/);
  assert.match(guideHtml, /PowerShell/);
  assert.match(guideHtml, /5177/);
  assert.match(guideHtml, /先解压/);
  assert.match(guideHtml, /启动系统\.bat/);
  assert.match(guideHtml, /assets\/app-icon\.png/);

  assert.match(homeHtml, /assets\/app-icon\.png/);
  assert.match(workbenchScript, /一分钟上手/);
  assert.match(launcherBat, /start-system\.ps1/);
  assert.match(launcherBat, /chcp 65001/);
  assert.match(launchScript, /Invoke-RestMethod/);
  assert.match(launchScript, /api\/health/);
  assert.match(launchScript, /Start-Process/);
  assert.match(launcherBat, /standard-96\.sample\.json/);
  assert.match(packageScript, /start-system\.ps1/);
  assert.match(packageScript, /trading-ai-system-one-minute/);
  assert.doesNotMatch(packageScript, /ukey-visible-history\.json/);
  assert.ok(iconInfo.size > 1000);
});

test('documentation connects onsite evidence to canonical point-in-time fields', async () => {
  const [readme, taskSheet, dictionary] = await Promise.all([
    readFile(path.join(systemRoot, 'README.md'), 'utf8'),
    readFile(path.join(systemRoot, 'docs/ukey现场字段探索任务单.md'), 'utf8'),
    readFile(path.join(systemRoot, 'docs/data-source-field-dictionary-v1.md'), 'utf8'),
  ]);
  const documentation = `${readme}\n${taskSheet}\n${dictionary}`;
  assert.match(documentation, /dayAheadUserClearedPowerMw/);
  assert.match(documentation, /临时价、最终价、有效价/);
  assert.match(documentation, /availableAt <= decisionCutoffAt/);
  assert.match(documentation, /只读页面可见数据/);
  assert.match(documentation, /真实发布预测/);
  assert.match(documentation, /历史时点重放/);
  assert.match(documentation, /最终结算复盘/);
  assert.match(documentation, /forecast-ledger\.json/);
  assert.match(documentation, /outcome-ledger\.json/);
});

test('market context APIs stay truthful when optional sources are absent', async () => {
  const server = await startServer();
  try {
    const query = 'date=2026-08-24&asOf=2026-08-23T10%3A00%3A00%2B08%3A00';
    const context = await (await fetch(`${server.baseUrl}/api/market/context?${query}`)).json();
    assert.equal(context.mode, 'real');
    assert.equal(context.summary.availableCapacityMw, null);
    assert.ok(context.missingFields.includes('availableCapacityMw'));
    const weather = await (await fetch(`${server.baseUrl}/api/weather/coverage?${query}`)).json();
    assert.equal(weather.pointCount, 0);
    const supply = await (await fetch(`${server.baseUrl}/api/supply-network/coverage?${query}`)).json();
    assert.equal(supply.fieldCount, 0);
    const candidates = await (await fetch(`${server.baseUrl}/api/forecast/candidates?${query}&target=dayAheadPrice`)).json();
    assert.equal(candidates.fallback.status, 'candidate_unavailable');
    const ablation = await (await fetch(`${server.baseUrl}/api/model/ablation?modelId=x&evaluationRunId=y`)).json();
    assert.equal(ablation.requiresHumanApproval, true);
  } finally { await server.close(); }
});
