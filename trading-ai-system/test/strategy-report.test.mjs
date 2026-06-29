import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStrategyReport, renderStrategyReportMarkdown } from '../lib/strategy-report.mjs';

const dataset = {
  generatedAt: '2026-05-07T03:00:00.000Z',
  sources: {
    user_bid_96: { rows: 96 },
    realtime_average_price: { rows: 57 },
  },
  quality: {
    dates: ['2026-05-07', '2026-05-08'],
    gaps: [{ id: 'actual_load_96_empty' }, { id: 'settle_day_empty' }],
    fieldCompleteness: { realTimeAvgPrice: 4, actualKwh: 0, settleAmount: 0 },
  },
  rows: [
    { date: '2026-05-07', pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: 100 },
    { date: '2026-05-07', pointIndex: 2, timePoint: '00:30', realTimeAvgPrice: 105 },
    { date: '2026-05-07', pointIndex: 3, timePoint: '00:45', realTimeAvgPrice: 200 },
    { date: '2026-05-07', pointIndex: 4, timePoint: '01:00', realTimeAvgPrice: 210 },
    { date: '2026-05-08', pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: 80 },
  ],
};

test('buildStrategyReport creates a trial-only report from real dataset fields', () => {
  const report = buildStrategyReport(dataset, { date: '2026-05-07' });

  assert.equal(report.title, '苏州地铁电力交易 AI 辅助策略报告');
  assert.equal(report.date, '2026-05-07');
  assert.equal(report.status, 'trial_only');
  assert.equal(report.statusText, '可试算，不可执行');
  assert.equal(report.market.rowCount, 4);
  assert.equal(report.market.realTimePricePoints, 4);
  assert.equal(report.market.averageRealTimePrice, 153.75);
  assert.equal(report.dataQuality.gapCount, 2);
  assert.ok(report.forecastSummary);
  assert.ok(report.backtestSummary);
  assert.ok(report.costStrategy);
  assert.ok(report.settlementReferenceSummary);
  assert.equal(report.settlementReferenceSummary.hasSettlementReference, false);
  assert.equal(report.savingsFocus.modelMode, report.costStrategy.modelMode);
  assert.equal(typeof report.savingsFocus.confidenceScore, 'number');
  assert.ok(report.savingsFocus.dataNeeds.length > 0);
  assert.ok(report.suggestions.some((item) => item.type === 'low_price'));
  assert.ok(report.suggestions.every((item) => item.executable === false));
});

test('buildStrategyReport deduplicates blockers and closure items', () => {
  const report = buildStrategyReport(dataset, {
    date: '2026-05-07',
    settlementReference: {
      summary: {
        hasSettlementReference: true,
        workbookCount: 2,
        spotReconciliationWorkbookCount: 1,
        monthlySettlementWorkbookCount: 1,
        actualDaily96ExportFiles: 0,
        settlementExportFiles: 0,
        positionExportFiles: 0,
      },
    },
  });

  assert.ok(report.blockingReasons.includes('预测负荷未接入，无法计算建议电量'));
  assert.ok(report.blockingReasons.includes('实际负荷未接入，不能校验策略对负荷偏差的影响'));
  assert.ok(report.closureItems.some((item) => item.id === 'forecast_load_96'));
  assert.ok(report.closureItems.some((item) => item.id === 'actual_load_96'));
  assert.ok(report.nextActions.some((item) => item.id === 'targeted_backfill'));
  assert.equal(report.settlementReferenceSummary.hasSettlementReference, true);
  assert.equal(report.settlementReferenceSummary.referenceWorkbookCount, 2);
  assert.equal(
    report.closureItems.filter((item) => item.id === 'forecast_load_96').length,
    1
  );
});

test('renderStrategyReportMarkdown serializes report without executable instructions', () => {
  const markdown = renderStrategyReportMarkdown(
    buildStrategyReport(dataset, { date: '2026-05-07' })
  );

  assert.match(markdown, /^# 苏州地铁电力交易 AI 辅助策略报告/);
  assert.match(markdown, /交易日：2026-05-07/);
  assert.match(markdown, /状态：可试算，不可执行/);
  assert.match(markdown, /预测负荷 96 点/);
  assert.match(markdown, /日结算/);
  assert.doesNotMatch(markdown, /执行电量|下单|自动申报/);
});
