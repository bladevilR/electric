import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildDataAssetInventory,
  buildInventoryFromDirectories,
  readCaptureDirectory,
} from '../lib/data-assets.mjs';

const capture = (fileName, url, data, extra = {}) => ({
  fileName,
  meta: { capturedAt: '2026-06-29T01:00:00.000Z', url },
  bodyJson: { status: 0, successful: true, data },
  ...extra,
});

test('buildDataAssetInventory classifies raw JSPEC cost-strategy assets', () => {
  const inventory = buildDataAssetInventory([
    capture(
      'rt-average.json',
      'https://www.jspec.com.cn/px-spotgoods-province/realTimeClearingRelease/queryRealTimeMarAvePricePublic',
      [{ dataTime: '2026-06-29', timePoint: '00:15', avgPrice: 320 }]
    ),
    capture(
      'dayahead-public.json',
      'https://www.jspec.com.cn/px-spotgoods-province/dayClearingResult/queryTableXrdOnlyJiesuan',
      [{ dataTime: '2026-06-29', timePoint: '00:15', unitPrice: 300 }]
    ),
    capture(
      'dayahead-user.json',
      'https://www.jspec.com.cn/px-spotgoods-province/Dd2jyUserClearingResult/queryDd2jyRqClearing',
      [{ dataTime: '2026-06-29', timePoint: '00:15', unitPrice: 305 }]
    ),
    capture(
      'realtime-public.json',
      'https://www.jspec.com.cn/px-spotgoods-province/curClearingResult/queryTableXrdOnlyJiesuan',
      [{ dataTime: '2026-06-29', timePoint: '00:15', northPrice: 318 }]
    ),
    capture(
      'user-bid.json',
      'https://www.jspec.com.cn/px-spotgoods-province/mosEnergyBidInfoUser/getMosEnergyBidInfoUser',
      { dataTime: '2026-06-29', mosDeratePendParamList: [{ timeSlot: '00:15', power: 21 }] }
    ),
    capture(
      'default-bid.json',
      'https://www.jspec.com.cn/px-spotgoods-province/mosEnergyBidInfoUser/getMosEnergyBidInfoUserDefault',
      { dataTime: '2026-06-29', mosDeratePendParamList: [{ timeSlot: '00:15', power: 22 }] }
    ),
    capture(
      'system-forecast.json',
      'https://www.jspec.com.cn/px-spotgoods-province/glbecoParamvalue/getCurve',
      { 4: ['80100', '80200'] }
    ),
    capture(
      'actual-system-load.json',
      'https://www.jspec.com.cn/px-spotgoods-province/afterDiscloseInformation/queryTableActualSystemLoad',
      [{ dataTime: '2026-06-29', value1: 81000, value2: 81100 }]
    ),
    capture(
      'current-contract.json',
      'https://www.jspec.com.cn/px-contract-extranet/contractApi/getContractListById',
      { total: 176, list: [{ contractId: 'C1' }] },
      { businessTarget: { id: 'current_contract' } }
    ),
    capture(
      'history-contract.json',
      'https://www.jspec.com.cn/px-contract-extranet/contractApi/getContractListByIdTime',
      { total: 88, list: [{ contractId: 'H1' }] },
      { businessTarget: { id: 'history_contract' } }
    ),
    capture(
      'trade-sequence.json',
      'https://www.jspec.com.cn/px-trade-extranet/tradeNotice/queryTradeInfoListByTypeAndUser',
      [{ tradeseqId: 'T1' }]
    ),
  ]);

  assert.equal(inventory.summary.realtimeAveragePriceRows, 1);
  assert.equal(inventory.summary.dayAheadPublicClearingRows, 1);
  assert.equal(inventory.summary.dayAheadUserClearingRows, 1);
  assert.equal(inventory.summary.realtimePublicClearingRows, 1);
  assert.equal(inventory.summary.userBidRows, 1);
  assert.equal(inventory.summary.userDefaultBidRows, 1);
  assert.equal(inventory.summary.systemLoadForecastRows, 2);
  assert.equal(inventory.summary.actualSystemLoadRows, 2);
  assert.equal(inventory.summary.contractCurrentTotal, 176);
  assert.equal(inventory.summary.contractCurrentCapturedRows, 1);
  assert.equal(inventory.summary.contractHistoryTotal, 88);
  assert.equal(inventory.summary.contractHistoryCapturedRows, 1);
  assert.equal(inventory.summary.tradeSequenceRows, 1);
  assert.equal(inventory.assets.contractsCurrent[0].sourceFile, 'current-contract.json');
});

test('buildDataAssetInventory records empty actual-load and settlement evidence', () => {
  const inventory = buildDataAssetInventory([
    capture(
      'daily-electricity.json',
      'https://www.jspec.com.cn/px-js-outer-deferrableload/electricity/queryDailyElectricity',
      { listTableHead: [{ prop: 'point1', label: '0:15(kWh)' }], list: { total: 0, list: null } },
      { businessTarget: { id: 'actual_load_96' } }
    ),
    capture(
      'settle-day.json',
      'https://www.jspec.com.cn/px-js-outer-deferrableload/tranDeclare/queryDaySettleResult',
      { total: 0, list: null },
      { businessTarget: { id: 'settle_day' } }
    ),
    capture(
      'settle-file-list.json',
      'https://www.jspec.com.cn/px-js-outer-settlecal/fileDown/queryFileList',
      { total: 0, list: [] },
      { businessTarget: { id: 'file_download_center' } }
    ),
  ]);

  assert.equal(inventory.summary.emptyActualLoadEndpoints, 1);
  assert.equal(inventory.summary.emptySettlementEndpoints, 2);
  assert.equal(inventory.evidence.emptySources.some((item) => item.targetId === 'actual_load_96'), true);
  assert.equal(inventory.evidence.emptySources.some((item) => item.targetId === 'settle_day'), true);
  assert.equal(inventory.summary.actualUserLoadRows, 0);
});

test('readCaptureDirectory reads nested response files and buildInventoryFromDirectories combines them', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'data-assets-'));
  try {
    const responses = path.join(temp, 'session', 'responses');
    await mkdir(responses, { recursive: true });
    await writeFile(
      path.join(responses, '001.json'),
      JSON.stringify(
        capture(
          '001.json',
          'https://www.jspec.com.cn/px-spotgoods-province/realTimeClearingRelease/queryRealTimeMarAvePricePublic',
          [{ dataTime: '2026-06-29', timePoint: '00:15', avgPrice: 320 }]
        )
      ),
      'utf8'
    );

    const captures = await readCaptureDirectory(temp);
    const inventory = await buildInventoryFromDirectories([temp]);

    assert.equal(captures.length, 1);
    assert.equal(inventory.summary.realtimeAveragePriceRows, 1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
