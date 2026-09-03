import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSettlementReference, linkSettlementReference } from '../lib/settlement-reference.mjs';

const systemRoot = fileURLToPath(new URL('..', import.meta.url));
const projectRoot = path.resolve(systemRoot, '..');

test('settlement rows link to immutable outcome metadata',()=>{const rows=linkSettlementReference({featureRows:[{date:'2026-08-24',pointIndex:1,settlementPrice:320}]},{sourceFileName:'settle.xlsx',sourceFileSha256:'abc',sourceSheetName:'sheet',parserVersion:'1',parsedAt:'2026-08-25T00:00:00Z',settlementRevision:'r1'});assert.equal(rows[0].actualLabelVersion,'settlement_final');assert.equal(rows[0].sourceFileName,'settle.xlsx');});

test('buildSettlementReference inventories local Excel and manual export references', async (context) => {
  const reference = await buildSettlementReference({ projectRoot });

  if (reference.summary.workbookCount === 0) {
    context.skip('本机未提供被 Git 忽略的业务 Excel，不伪造真实结算集成验收');
    return;
  }

  assert.equal(reference.summary.canFillActualKwh, true);
  assert.equal(reference.summary.canFillSettleAmount, true);
  assert.equal(reference.summary.hasSettlementReference, true);
  assert.ok(reference.summary.workbookCount >= 9);
  assert.ok(reference.summary.spotReconciliationWorkbookCount >= 8);
  assert.ok(reference.summary.actualKwhCandidateRows >= 17000);
  assert.ok(reference.summary.settleAmountCandidateRows >= 17000);
  assert.ok(reference.summary.transactionCalculationUsageRows >= 6240);
  assert.ok(reference.summary.transactionCalculationSubmissionRows >= 480);
  assert.ok(reference.summary.transactionCalculationFeatureRowCount >= 960);
  assert.ok(reference.summary.transactionCalculationHourlySummaryRows >= 720);
  assert.ok(reference.summary.transactionCalculationHourlyTransactionRows >= 3000);
  assert.ok(reference.summary.transactionCalculationPositionHourlyRows >= 240);
  assert.ok(reference.summary.transactionCalculationOperationHourlyRows >= 240);
  assert.ok(reference.summary.monthlyOverviewRows >= 2);
  assert.ok(reference.summary.monthlyOverviewMonths.includes('2026-01'));
  assert.ok(reference.summary.monthlyOverviewMonths.includes('2026-02'));
  assert.ok(reference.summary.longTermOverviewRows >= 6);
  assert.equal(reference.summary.actualDaily96ExportFiles, 0);
  assert.equal(reference.summary.settlementExportFiles, 0);
  assert.equal(reference.summary.positionExportFiles, 0);

  const january = reference.workbooks.find((item) => item.fileName.includes('2026年1月现货核对单'));
  assert.ok(january);
  assert.equal(january.kind, 'spot_reconciliation');
  assert.equal(january.canFillActualKwh, true);
  assert.equal(january.canFillSettleAmount, true);
  assert.equal(january.validDailySheetCount, 31);
  assert.equal(january.actualKwhRows, 31 * 96);
  assert.equal(january.settleAmountRows, 31 * 96);
  assert.equal(january.extraPointMetricRows, 31 * 96);
  assert.ok(
    january.featureRows.some(
      (item) =>
        item.date === '2026-01-01' &&
        item.pointIndex === 1 &&
        item.dayAheadForecastMwh === 9.275 &&
        item.totalTradeSavingYuan === 111.296
    )
  );

  const november = reference.workbooks.find((item) => item.fileName.includes('2025年11月现货核对单'));
  assert.ok(november);
  assert.equal(november.validDailySheetCount, 30);
  assert.ok(november.badDailySheets.some((item) => item.name === '31'));

  const march = reference.workbooks.find((item) => item.fileName.includes('2026年03月21日'));
  assert.ok(march);
  assert.ok(march.sheets.some((sheet) => sheet.name === '合约日清分' && sheet.pointRows === 96));

  const monthly = reference.workbooks.find((item) => item.kind === 'monthly_settlement_overview');
  assert.ok(monthly);
  assert.ok(monthly.sheets.some((sheet) => sheet.name === '2026年' && sheet.numericRows >= 10));
  assert.ok(monthly.monthlyOverviewRowCount >= 2);
  assert.ok(
    reference.monthlyOverviewRows.some(
      (item) =>
        item.monthKey === '2026-01' &&
        item.actualSettlementEnergyWanKwh === 5341.5655 &&
        item.settlementPriceYuanPerKwh === 0.641901
    )
  );
  assert.ok(
    reference.longTermOverviewRows.some(
      (item) =>
        item.rowKind === 'year_summary' &&
        item.periodLabel === '2024' &&
        item.totalTradeEnergyWanKwh === 60985.5984
    )
  );
  assert.ok(
    reference.longTermOverviewRows.some(
      (item) => item.rowKind === 'annual_deal' && item.periodLabel === '双边' && item.dealEnergy === 509000
    )
  );

  assert.ok(reference.workbooks.filter((item) => item.kind === 'transaction_calculation').length >= 5);
  assert.ok(
    reference.featureRows.some(
      (item) =>
        item.date === '2026-03-31' &&
        item.pointIndex === 1 &&
        item.actualKwh !== undefined &&
        item.sourceEndpoint === 'transaction-calculation-standardized'
    )
  );
  assert.ok(
    reference.featureRows.some(
      (item) =>
        item.date === '2026-03-31' &&
        item.pointIndex === 1 &&
        item.declarationPower !== undefined &&
        item.sourceEndpoint === 'transaction-calculation-standardized'
    )
  );
  assert.ok(reference.transactionCalculationStandardized.hourlyBusinessRows.length >= 720);
  assert.ok(
    reference.transactionCalculationStandardized.hourlyBusinessRows.some(
      (item) =>
        item.exportMonth === '2026-03' &&
        item.hourIndex === 1 &&
        item.metricId === 'position_mwh' &&
        item.valueMwh !== null
    )
  );
  assert.ok(
    reference.transactionCalculationStandardized.hourlyBusinessRows.some(
      (item) =>
        item.exportMonth === '2026-03' &&
        item.hourIndex === 1 &&
        item.metricId === 'operation_1_mwh' &&
        item.valueMwh !== null
    )
  );
  assert.ok(reference.upgradeHooks.some((item) => item.id === 'actual_load_96'));
  assert.ok(reference.usageBoundaries.some((item) => item.includes('历史核对单')));
  assert.ok(reference.usageBoundaries.some((item) => item.includes('小时持仓')));
});
