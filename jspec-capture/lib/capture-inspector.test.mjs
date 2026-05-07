import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInspectionRows, formatInspectionMarkdown } from './capture-inspector.mjs';

test('buildInspectionRows summarizes response payload shapes', () => {
  const rows = buildInspectionRows([
    {
      fileName: '001-price.json',
      businessTarget: { id: 'realtime_average_price', name: 'realtime price' },
      meta: {
        method: 'POST',
        url: 'https://www.jspec.com.cn/px-spotgoods-province/realTime/query',
        requestBodyJson: { date: '2026-04-27' },
      },
      bodyJson: {
        status: 0,
        data: Array.from({ length: 96 }, (_, index) => ({
          timePoint: index + 1,
          price: 300 + index,
        })),
      },
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].targetId, 'realtime_average_price');
  assert.equal(rows[0].dataKind, 'array');
  assert.equal(rows[0].dataLength, 96);
  assert.equal(rows[0].looksLike96Point, true);
  assert.deepEqual(rows[0].sampleDataKeys, ['timePoint', 'price']);
  assert.deepEqual(rows[0].requestKeys, ['date']);
});

test('buildInspectionRows detects table-head based 96 point payloads', () => {
  const rows = buildInspectionRows([
    {
      fileName: '001-load.json',
      businessTarget: { id: 'actual_load_96', name: 'actual load' },
      meta: {
        method: 'POST',
        url: 'https://www.jspec.com.cn/px-js-outer-deferrableload/electricity/queryDailyElectricity',
        requestBodyJson: { startDate: '2026-03-01', endDate: '2026-03-31' },
      },
      bodyJson: {
        successful: true,
        data: {
          listTableHead: Array.from({ length: 96 }, (_, index) => ({
            prop: `point${index + 1}`,
            label: `${index + 1}`,
          })),
          list: {
            list: [
              Object.fromEntries(
                Array.from({ length: 96 }, (_, index) => [`point${index + 1}`, index])
              ),
            ],
          },
        },
      },
    },
  ]);

  assert.equal(rows[0].looksLike96Point, true);
  assert.equal(rows[0].pointColumnCount, 96);
  assert.equal(rows[0].sampleDataKeys.includes('point1'), true);
});

test('buildInspectionRows detects wide price1 to price96 payloads', () => {
  const rows = buildInspectionRows([
    {
      fileName: '001-price-wide.json',
      businessTarget: { id: 'dayahead_public_clearing', name: 'dayahead price' },
      meta: {
        method: 'POST',
        url: 'https://www.jspec.com.cn/px-spotgoods-province/provincialSpotMarketNewRule/queryRqClearingReleasePublic',
        requestBodyJson: { dataTime: '2026-04-24' },
      },
      bodyJson: {
        data: [
          Object.fromEntries(
            Array.from({ length: 96 }, (_, index) => [`price${index + 1}`, index])
          ),
        ],
      },
    },
  ]);

  assert.equal(rows[0].looksLike96Point, true);
  assert.equal(rows[0].pointColumnCount, 96);
});

test('buildInspectionRows detects nested 96 row payloads', () => {
  const rows = buildInspectionRows([
    {
      fileName: '001-bid.json',
      businessTarget: { id: 'user_bid_96', name: 'bid curve' },
      meta: {
        method: 'POST',
        url: 'https://www.jspec.com.cn/px-spotgoods-province/mosEnergyBidInfoUser/getMosEnergyBidInfoUser',
        requestBodyJson: { dataTime: '2026-04-28' },
      },
      bodyJson: {
        data: {
          dataTime: '2026-04-28',
          mosDeratePendParamList: Array.from({ length: 96 }, (_, index) => ({
            timeSlot: index + 1,
            power: index,
          })),
        },
      },
    },
  ]);

  assert.equal(rows[0].looksLike96Point, true);
  assert.equal(rows[0].dataLength, 96);
  assert.deepEqual(rows[0].sampleDataKeys, ['timeSlot', 'power']);
});

test('formatInspectionMarkdown includes endpoint and 96 point hint', () => {
  const markdown = formatInspectionMarkdown([
    {
      targetId: 'realtime_average_price',
      method: 'POST',
      path: '/px-spotgoods-province/realTime/query',
      dataKind: 'array',
      dataLength: 96,
      looksLike96Point: true,
      pointColumnCount: 0,
      sampleDataKeys: ['timePoint', 'price'],
      requestKeys: ['date'],
      fileName: '001-price.json',
    },
  ]);

  assert.match(markdown, /realtime_average_price/);
  assert.match(markdown, /96-point/);
  assert.match(markdown, /timePoint, price/);
});
