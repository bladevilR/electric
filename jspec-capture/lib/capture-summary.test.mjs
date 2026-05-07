import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCaptureSummary, formatCoverageMarkdown } from './capture-summary.mjs';

test('buildCaptureSummary counts captures by target category', () => {
  const summary = buildCaptureSummary([
    { businessTarget: { id: 'user_bid_96', category: 'dayahead_declaration' } },
    { businessTarget: { id: 'user_bid_96', category: 'dayahead_declaration' } },
    { businessTarget: { id: 'realtime_average_price', category: 'realtime_price' } },
    { businessTarget: null },
  ]);

  assert.equal(summary.totalCaptures, 4);
  assert.equal(summary.classifiedCaptures, 3);
  assert.equal(summary.byCategory.dayahead_declaration, 2);
  assert.equal(summary.byTarget.user_bid_96.count, 2);
  assert.ok(summary.targetCoverage.missingRequiredIds.includes('actual_load_96'));
});

test('formatCoverageMarkdown includes readable Chinese target names', () => {
  const markdown = formatCoverageMarkdown(
    buildCaptureSummary([
      {
        businessTarget: {
          id: 'user_bid_96',
          name: '用户侧96点主动申报',
          category: 'dayahead_declaration',
        },
      },
    ])
  );

  assert.match(markdown, /用户侧96点主动申报/);
  assert.match(markdown, /Missing P0/);
});

test('buildCaptureSummary accepts legacy replay captures', () => {
  const summary = buildCaptureSummary([
    {
      request: {
        url: 'https://www.jspec.com.cn/px-common-service/queryPage',
        headers: {
          CurrentRoute:
            '/pxf-spotgoods-province-extranet/realTimeClearingRelease/RealTimeMarAvePricePublic',
        },
      },
    },
  ]);

  assert.equal(summary.classifiedCaptures, 1);
  assert.equal(summary.byTarget.realtime_average_price.count, 1);
});
