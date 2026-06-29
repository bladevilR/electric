import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInventoryRows,
  buildStandardOutputCheck,
  formatInventoryCsv,
  formatSourceEndpointSummary,
  formatStandardOutputCheck,
} from './offline-inventory.mjs';

function capture(overrides = {}) {
  return {
    fileName: '001-response.json',
    meta: {
      capturedAt: '2026-05-12T02:16:42.308Z',
      url:
        'https://www.jspec.com.cn/px-spotgoods-province/mosEnergyBidInfoUser/getMosEnergyBidInfoUser?ticket=secret',
      status: 200,
      requestHeaders: {
        'x-ticket': '[REDACTED]',
        currentroute: '/pxf-spotgoods-province-extranet/userBid96/index',
      },
      requestBodyJson: {
        pd: '[REDACTED]',
      },
    },
    businessTarget: {
      id: 'user_bid_96',
      category: 'dayahead_declaration',
    },
    bodyJson: {
      status: 0,
      data: {
        mosDeratePendParamList: Array.from({ length: 96 }, (_, index) => ({
          timeSlot: index + 1,
          power: index,
        })),
      },
    },
    ...overrides,
  };
}

test('buildInventoryRows strips query strings and treats redacted credential headers as safe', () => {
  const rows = buildInventoryRows({
    sessionId: 'session-20260512-101623',
    captures: [capture()],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].session_id, 'session-20260512-101623');
  assert.equal(
    rows[0].endpoint_path,
    '/px-spotgoods-province/mosEnergyBidInfoUser/getMosEnergyBidInfoUser'
  );
  assert.equal(rows[0].business_area, 'bid');
  assert.equal(rows[0].record_count_guess, 96);
  assert.equal(rows[0].has_sensitive_headers, false);
  assert.equal(rows[0].standardized_table, 'standard_96_curve');
});

test('buildInventoryRows flags unredacted sensitive request headers', () => {
  const rows = buildInventoryRows({
    sessionId: 'session-unsafe',
    captures: [
      capture({
        meta: {
          ...capture().meta,
          requestHeaders: {
            authorization: 'Bearer real-token',
          },
        },
      }),
    ],
  });

  assert.equal(rows[0].has_sensitive_headers, true);
  assert.match(rows[0].notes, /authorization/);
});

test('formatInventoryCsv emits stable columns with escaped values', () => {
  const csv = formatInventoryCsv([
    {
      session_id: 'session-1',
      source_file: 'a,b.json',
      endpoint_path: '/path',
      business_area: 'unknown',
      captured_at: '2026-05-12T00:00:00.000Z',
      status_code: 200,
      record_count_guess: 0,
      has_sensitive_headers: false,
      standardized_table: '',
      notes: 'needs "review"',
    },
  ]);

  assert.match(csv, /^session_id,source_file,endpoint_path/m);
  assert.match(csv, /"a,b\.json"/);
  assert.match(csv, /"needs ""review"""/);
});

test('source endpoint summary groups rows by business area and endpoint', () => {
  const rows = buildInventoryRows({
    sessionId: 'session-20260512-101623',
    captures: [
      capture(),
      capture({
        fileName: '002-contract.json',
        meta: {
          ...capture().meta,
          url: 'https://www.jspec.com.cn/px-contract-extranet/contractApi/getContractListById',
          requestHeaders: {},
        },
        businessTarget: null,
        bodyJson: {
          status: 0,
          data: [{ contractId: 'C1' }],
        },
      }),
    ],
  });

  const markdown = formatSourceEndpointSummary(rows);

  assert.match(markdown, /Total indexed responses: 2/);
  assert.match(markdown, /\| bid \| 1 \|/);
  assert.match(markdown, /\| contract \| 1 \|/);
  assert.match(markdown, /getContractListById/);
});

test('standard output check explains merged 192 rows against source row counts', () => {
  const check = buildStandardOutputCheck({
    datasetSummary: {
      rowCount: 192,
      dates: ['2026-05-12', '2026-05-13'],
      sources: {
        user_bid_96: { captures: 3, rows: 288 },
        user_default_bid_96: { captures: 3, rows: 288 },
        realtime_average_price: { captures: 1, rows: 96 },
      },
      fieldCompleteness: {
        date: 192,
        pointIndex: 192,
        timePoint: 192,
        declarationPower: 0,
        realTimeAvgPrice: 57,
      },
      gaps: [{ id: 'mixed_dates', severity: 'medium', message: 'two dates' }],
    },
  });

  assert.equal(check.row_count, 192);
  assert.deepEqual(check.date_distribution, { '2026-05-12': 96, '2026-05-13': 96 });
  assert.equal(check.source_row_total, 672);
  assert.ok(check.row_count_explanation.includes('2 date(s) x 96'));
  assert.deepEqual(check.zero_non_empty_fields, ['declarationPower']);

  const markdown = formatStandardOutputCheck(check);
  assert.match(markdown, /192/);
  assert.match(markdown, /declarationPower/);
  assert.match(markdown, /mixed_dates/);
});
