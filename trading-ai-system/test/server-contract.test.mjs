import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const systemRoot = fileURLToPath(new URL('..', import.meta.url));
const defaultStandardPath = path.resolve(
  systemRoot,
  '../jspec-capture/output/session-20260507-101645/standard/standard-96.json'
);

async function readExpectedStandardSummary() {
  const dataset = JSON.parse(await readFile(defaultStandardPath, 'utf8'));
  return {
    rowCount: Array.isArray(dataset.rows) ? dataset.rows.length : 0,
  };
}

async function startServer() {
  const port = 7200 + Math.floor(Math.random() * 1000);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-server-'));
  const auditPath = path.join(temp, 'audit-log.ndjson');
  const visibleSnapshotPath = path.join(temp, 'ukey-visible-snapshot.json');
  const server = spawn(
    process.execPath,
    ['server.mjs', '--port', String(port), '--audit', auditPath, '--visible-snapshot', visibleSnapshotPath],
    {
      cwd: systemRoot,
      env: { ...process.env, JSPEC_MANAGED_BROWSER_DISABLED: '1' },
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
      if (text.includes(`http://127.0.0.1:${port}`)) {
        resolve();
      }
    });
    server.on('exit', (code) => {
      reject(new Error(`server exited before ready: ${code}\n${stderr}`));
    });
  });

  await ready;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      server.kill();
      await once(server, 'exit').catch(() => {});
      await rm(temp, { recursive: true, force: true });
    },
  };
}

test('local server exposes the P0 system loop', async () => {
  const expectedStandardSummary = await readExpectedStandardSummary();
  const server = await startServer();

  try {
    const [
      home,
      appScript,
      health,
      summary,
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
      refresh,
    ] = await Promise.all([
      fetch(`${server.baseUrl}/`).then((response) => response.text()),
      fetch(`${server.baseUrl}/app.js`).then((response) => response.text()),
      fetch(`${server.baseUrl}/api/health`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/summary`).then((response) => response.json()),
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
      fetch(`${server.baseUrl}/api/refresh`, { method: 'POST' }).then((response) =>
        response.json()
      ),
    ]);

    assert.match(home, /电力交易策略助手/);
    assert.match(home, /<script src="\.\/app\.js"><\/script>/);
    assert.match(home, /id="reportButton"/);
    assert.doesNotMatch(home, /data\/standard-96\.js/);
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
    assert.match(appScript, /mode: 'core'/);
    assert.match(appScript, /自动扫核心页/);
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
    assert.match(appScript, /slowBackfillButton/);
    assert.match(appScript, /开始自动慢采/);
    assert.match(appScript, /计划加载中/);
    assert.match(appScript, /预计耗时/);
    assert.match(appScript, /startSlowBackfill/);
    assert.match(appScript, /targetIds: targets\.map\(\(target\) => target\.id\)/);
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

    assert.equal(summary.rowCount, expectedStandardSummary.rowCount);
    assert.equal(summary.p0SourceCoverage.present, 8);
    assert.equal(summary.p0SourceCoverage.total, 8);
    assert.ok(summary.gapCount >= 1);

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

    assert.equal(productionReadiness.status, 'decision_support_ready');
    assert.equal(productionReadiness.capabilities.autoSubmit, false);
    assert.equal(productionReadiness.blockers.some((item) => item.id === 'ca_ukey'), false);
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
    assert.equal(settlementReference.summary.canFillSettleAmount, true);
    assert.ok(settlementReference.summary.actualKwhCandidateRows >= 17000);
    assert.ok(settlementReference.summary.settleAmountCandidateRows >= 17000);
    assert.ok(settlementReference.summary.transactionCalculationHourlySummaryRows >= 720);
    assert.ok(settlementReference.summary.transactionCalculationPositionHourlyRows >= 240);
    assert.ok(settlementReference.summary.monthlyOverviewRows >= 2);
    assert.ok(settlementReference.summary.longTermOverviewRows >= 6);
    assert.ok(Array.isArray(settlementReference.monthlyOverviewRows));
    assert.ok(Array.isArray(settlementReference.longTermOverviewRows));
    assert.ok(settlementReference.monthlyOverviewRows.some((item) => item.monthKey === '2026-01'));
    assert.ok(settlementReference.longTermOverviewRows.some((item) => item.periodLabel === '2024'));
    assert.equal(settlementReference.summary.hasSettlementReference, true);
    assert.ok(Array.isArray(forecastFeatures.rows));
    assert.equal(historicalForecastFeatures.rows.length, 96);
    assert.equal(historicalForecastFeatures.summary.fieldCompleteness.actualKwh, 96);
    assert.equal(historicalForecastFeatures.summary.fieldCompleteness.settleAmount, 96);
    assert.equal(historicalForecastFeatures.rows[0].actualKwh, 20163);
    assert.equal(historicalForecastFeatures.rows[0].settleAmount, 6579.17);
    assert.equal(historicalForecastFeatures.rows[0].dayAheadForecastMwh, 9.275);
    assert.equal(historicalForecastFeatures.rows[0].totalTradeSavingYuan, 111.296);
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

    assert.equal(refresh.ok, true);
    assert.equal(refresh.integrationClosure.completion.accounted, refresh.integrationClosure.completion.total);
    assert.ok(refresh.integrationSummary.generatedAt);

    const executionProposal = await fetch(
      `${server.baseUrl}/api/execution/proposal?date=2026-05-07`,
      { method: 'POST', headers: { 'x-operator-id': 'contract-test' } }
    ).then((response) => response.json());
    const audit = await fetch(`${server.baseUrl}/api/audit?limit=20`).then((response) =>
      response.json()
    );

    assert.equal(executionProposal.status, 'draft_ready');
    assert.equal(executionProposal.autoSubmit, false);
    assert.equal(executionProposal.humanDecisionRequired, true);
    assert.deepEqual(executionProposal.orderLines, []);
    assert.ok(executionProposal.costStrategy);
    assert.ok(executionProposal.reviewWarnings.some((item) => item.includes('省钱策略置信度')));
    assert.ok(executionProposal.proposalLines.length > 0);
    assert.ok(executionProposal.proposalLines.every((item) => item.editable));
    assert.equal(executionProposal.blockers.some((item) => item.includes('CA/UKey')), false);

    const review = await fetch(
      `${server.baseUrl}/api/execution/review?proposalId=${executionProposal.proposalLines[0].id}&date=2026-05-07&decision=accepted&note=manual`,
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
