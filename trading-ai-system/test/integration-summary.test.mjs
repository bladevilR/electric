import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIntegrationClosure,
  normalizeIntegrationSummary,
  renderIntegrationClosureMarkdown,
} from '../lib/integration-summary.mjs';

const summary = {
  generatedAt: '2026-05-07T05:10:00.000Z',
  ledger: {
    sourceFile: '2026年交易电量、电价、结算一览表.xlsx',
    months: [
      { month: '1月', actualSettlementEnergyWanKwh: 5341.5655, savingVsGridWanYuan: 330.255 },
      { month: '2月', actualSettlementEnergyWanKwh: 4682.3859, savingVsGridWanYuan: -62.2703 },
    ],
  },
  settlementChecks: {
    files: [
      { fileName: '2025年06月现货核对单 .xlsx', dailySheets: 30, totalUsageMwh: 11000, totalSavingYuan: 120000 },
      { fileName: '4、2026年2月现货核对单 .xlsx', dailySheets: 28, totalUsageMwh: 8500, totalSavingYuan: -40000 },
    ],
  },
  participants: [{ participantName: '苏州市轨道交通集团有限公司', participantId: '200579' }],
  standard: {
    p0SourceCoverage: { present: 8, total: 8 },
    gaps: [{ id: 'actual_load_96_empty' }, { id: 'settle_day_empty' }],
    fieldCompleteness: { actualKwh: 0, settleAmount: 0, realTimeAvgPrice: 57 },
  },
};

test('normalizeIntegrationSummary computes totals from real source summaries', () => {
  const normalized = normalizeIntegrationSummary(summary);

  assert.equal(normalized.ledger.monthCount, 2);
  assert.equal(normalized.ledger.totalActualSettlementEnergyWanKwh, 10023.9514);
  assert.equal(normalized.ledger.totalSavingVsGridWanYuan, 267.9847);
  assert.equal(normalized.settlementChecks.fileCount, 2);
  assert.equal(normalized.settlementChecks.totalDailySheets, 58);
  assert.equal(normalized.participants.length, 1);
});

test('buildIntegrationClosure accounts for every formerly pending item', () => {
  const closure = buildIntegrationClosure(summary);

  assert.ok(closure.items.length >= 8);
  assert.equal(closure.completion.accounted, closure.completion.total);
  assert.ok(closure.items.some((item) => item.id === 'trade_ledger' && item.status === 'closed'));
  assert.ok(closure.items.some((item) => item.id === 'settlement_checks' && item.status === 'closed'));
  assert.ok(closure.items.some((item) => item.id === 'actual_load_96' && item.status === 'source_empty'));
  assert.ok(closure.items.some((item) => item.id === 'forecast_load_96' && item.status === 'registered'));
  assert.doesNotMatch(JSON.stringify(closure), /待接入/);
});

test('renderIntegrationClosureMarkdown exports closed-source evidence', () => {
  const markdown = renderIntegrationClosureMarkdown(buildIntegrationClosure(summary));

  assert.match(markdown, /^# 数据闭环台账/);
  assert.match(markdown, /闭环完成度：8\/8/);
  assert.match(markdown, /交易电量、电价、结算一览表/);
  assert.match(markdown, /源返回空/);
  assert.doesNotMatch(markdown, /待接入/);
});
