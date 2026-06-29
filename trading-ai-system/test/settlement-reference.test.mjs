import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSettlementReference } from '../lib/settlement-reference.mjs';

const systemRoot = fileURLToPath(new URL('..', import.meta.url));
const projectRoot = path.resolve(systemRoot, '..');

test('buildSettlementReference inventories local Excel and manual export references', async () => {
  const reference = await buildSettlementReference({ projectRoot });

  assert.equal(reference.summary.canFillActualKwh, true);
  assert.equal(reference.summary.canFillSettleAmount, true);
  assert.equal(reference.summary.hasSettlementReference, true);
  assert.ok(reference.summary.workbookCount >= 9);
  assert.ok(reference.summary.spotReconciliationWorkbookCount >= 8);
  assert.ok(reference.summary.actualKwhCandidateRows >= 17000);
  assert.ok(reference.summary.settleAmountCandidateRows >= 17000);
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

  assert.ok(reference.workbooks.filter((item) => item.kind === 'transaction_calculation').length >= 5);
  assert.ok(reference.upgradeHooks.some((item) => item.id === 'actual_load_96'));
  assert.ok(reference.usageBoundaries.some((item) => item.includes('历史核对单')));
});
