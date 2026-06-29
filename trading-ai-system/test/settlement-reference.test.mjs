import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSettlementReference } from '../lib/settlement-reference.mjs';

const systemRoot = fileURLToPath(new URL('..', import.meta.url));
const projectRoot = path.resolve(systemRoot, '..');

test('buildSettlementReference inventories local Excel and manual export references', async () => {
  const reference = await buildSettlementReference({ projectRoot });

  assert.equal(reference.summary.canFillActualKwh, false);
  assert.equal(reference.summary.canFillSettleAmount, false);
  assert.equal(reference.summary.hasSettlementReference, true);
  assert.ok(reference.summary.workbookCount >= 2);
  assert.equal(reference.summary.actualDaily96ExportFiles, 0);
  assert.equal(reference.summary.settlementExportFiles, 0);
  assert.equal(reference.summary.positionExportFiles, 0);

  const spot = reference.workbooks.find((item) => item.kind === 'spot_reconciliation');
  assert.ok(spot);
  assert.ok(spot.sheets.some((sheet) => sheet.name === '合约日清分' && sheet.numericRows >= 96));
  assert.ok(spot.sheets.some((sheet) => sheet.name === '偏差收益回收' && sheet.numericRows === 96));

  const monthly = reference.workbooks.find((item) => item.kind === 'monthly_settlement_overview');
  assert.ok(monthly);
  assert.ok(monthly.sheets.some((sheet) => sheet.name === '2026年' && sheet.numericRows >= 10));

  assert.ok(reference.upgradeHooks.some((item) => item.id === 'actual_load_96'));
  assert.ok(reference.usageBoundaries.some((item) => item.includes('不能替代 96 点实际负荷')));
});
