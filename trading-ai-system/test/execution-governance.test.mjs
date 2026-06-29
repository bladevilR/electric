import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { readAuditLog } from '../lib/audit-log.mjs';
import { buildProductionReadiness } from '../lib/production-readiness.mjs';
import { createExecutionProposal } from '../lib/execution-governance.mjs';

const dataset = {
  generatedAt: '2026-05-07T03:00:00.000Z',
  sources: {
    user_default_bid_96: { rows: 96 },
    realtime_average_price: { rows: 4 },
  },
  quality: {
    dates: ['2026-05-07'],
    gaps: [{ id: 'actual_load_96_empty' }, { id: 'settle_day_empty' }],
    fieldCompleteness: { realTimeAvgPrice: 4, actualKwh: 0, settleAmount: 0 },
  },
  rows: [
    { date: '2026-05-07', pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: 100 },
    { date: '2026-05-07', pointIndex: 2, timePoint: '00:30', realTimeAvgPrice: 105 },
    { date: '2026-05-07', pointIndex: 3, timePoint: '00:45', realTimeAvgPrice: 200 },
    { date: '2026-05-07', pointIndex: 4, timePoint: '01:00', realTimeAvgPrice: 210 },
  ],
};

const integrationClosure = {
  completion: { total: 8, accounted: 8, closed: 3, sourceEmpty: 2, registered: 3 },
  items: [
    { id: 'trade_ledger', name: '交易台账', status: 'closed', closureText: '已解析月度交易台账。' },
    { id: 'actual_load_96', name: '实际负荷 96 点', status: 'source_empty', closureText: '源返回空。' },
    { id: 'manual_confirmation', name: '人工确认', status: 'registered', closureText: '执行前必须人工确认。' },
  ],
};

test('createExecutionProposal generates editable draft lines without auto submit', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-execution-'));
  const auditPath = path.join(temp, 'audit-log.ndjson');

  try {
    const readiness = buildProductionReadiness({
      summary: { rowCount: 4, p0SourceCoverage: { present: 2, total: 8 }, gapCount: 2 },
      integrationClosure,
      env: {},
    });

    const proposal = await createExecutionProposal({
      dataset,
      date: '2026-05-07',
      integrationClosure,
      readiness,
      businessInputs: {
        forecastLoad96: {
          rows: [
            { date: '2026-05-07', pointIndex: 1, forecastKwh: 1000 },
            { date: '2026-05-07', pointIndex: 2, forecastKwh: 1200 },
            { date: '2026-05-07', pointIndex: 3, forecastKwh: 1400 },
            { date: '2026-05-07', pointIndex: 4, forecastKwh: 1600 },
          ],
        },
        position96: {
          rows: [
            { date: '2026-05-07', pointIndex: 1, availableBuyMwh: 0.4, availableSellMwh: 0.1 },
            { date: '2026-05-07', pointIndex: 2, availableBuyMwh: 0.5, availableSellMwh: 0.2 },
            { date: '2026-05-07', pointIndex: 3, availableBuyMwh: 0.2, availableSellMwh: 0.6 },
            { date: '2026-05-07', pointIndex: 4, availableBuyMwh: 0.1, availableSellMwh: 0.7 },
          ],
        },
        tradeLimits: {
          values: {
            minQuantityMwh: 0.1,
            maxDraftQuantityMwh: 0.8,
            buyPriceCeilingYuanPerMwh: 180,
            sellPriceFloorYuanPerMwh: 210,
          },
        },
      },
      settlementReference: {
        summary: {
          hasSettlementReference: true,
          workbookCount: 2,
          spotReconciliationWorkbookCount: 1,
          monthlySettlementWorkbookCount: 1,
          actualDaily96ExportFiles: 0,
          settlementExportFiles: 0,
          positionExportFiles: 0,
          canFillActualKwh: false,
          canFillSettleAmount: false,
        },
      },
      auditPath,
      actor: 'operator-a',
    });

    assert.equal(proposal.status, 'draft_ready');
    assert.equal(proposal.autoSubmit, false);
    assert.equal(proposal.humanDecisionRequired, true);
    assert.deepEqual(proposal.orderLines, []);
    assert.ok(proposal.costStrategy);
    assert.equal(proposal.settlementReferenceSummary.hasSettlementReference, true);
    assert.equal(proposal.settlementReferenceSummary.canFillActualKwh, false);
    assert.equal(proposal.settlementReferenceSummary.canFillSettleAmount, false);
    assert.equal(
      proposal.costStrategy.policyTiers.some((item) => item.id === 'aggressive' && item.executable === false),
      true
    );
    assert.ok(proposal.proposalLines.length > 0);
    assert.ok(proposal.proposalLines.every((item) => item.editable === true));
    assert.equal(proposal.proposalLines[0].quantityMwh, 0.4);
    assert.equal(proposal.proposalLines[0].priceLimit, 180);
    assert.ok(proposal.proposalLines[0].evidence.some((item) => item.includes('预测负荷')));
    assert.ok(proposal.reviewWarnings.some((item) => item.includes('实际负荷')));
    assert.ok(proposal.reviewWarnings.some((item) => item.includes('省钱策略置信度')));
    assert.ok(proposal.reviewWarnings.some((item) => item.includes('人工决策支持')));
    assert.equal(proposal.blockers.some((item) => item.includes('CA/UKey')), false);

    const events = await readAuditLog(auditPath);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'execution_proposal_created');
    assert.equal(events[0].outcome, 'draft_ready');
    assert.equal(events[0].actor, 'operator-a');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
