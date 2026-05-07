import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyBusinessTarget,
  listBusinessTargets,
  summarizeTargetCoverage,
} from './jspec-targets.mjs';

test('classifyBusinessTarget identifies core spot market pages', () => {
  assert.equal(
    classifyBusinessTarget({
      url: 'https://www.jspec.com.cn/pxf-spotgoods-province-extranet/#/pxf-spotgoods-province-extranet/userBid96/index',
    })?.id,
    'user_bid_96'
  );

  assert.equal(
    classifyBusinessTarget({
      url: 'https://www.jspec.com.cn/pxf-spotgoods-province-extranet/#/pxf-spotgoods-province-extranet/realTimeClearingRelease/RealTimeMarAvePricePublic',
    })?.id,
    'realtime_average_price'
  );

  assert.equal(
    classifyBusinessTarget({
      url: 'https://www.jspec.com.cn/pxf-js-outer-settlespot/#/pxf-js-outer-settlespot/rptApproveInfo/rptApproveInfo',
    })?.id,
    'spot_statement_dispute'
  );
});

test('classifyBusinessTarget can use CurrentRoute when API URL is generic', () => {
  const target = classifyBusinessTarget({
    url: 'https://www.jspec.com.cn/px-common-service/queryPage',
    requestHeaders: {
      currentroute:
        '/pxf-spotgoods-province-extranet/Dd2jyUserClearingResult/Dd2jyRqClearing',
    },
  });

  assert.equal(target?.id, 'dayahead_user_clearing');
});

test('summarizeTargetCoverage separates required and optional coverage', () => {
  const targets = listBusinessTargets();
  assert.ok(targets.some((target) => target.id === 'actual_load_96'));
  assert.equal(
    targets.find((target) => target.id === 'user_bid_96')?.name,
    '用户侧96点主动申报'
  );

  const summary = summarizeTargetCoverage([
    { businessTarget: { id: 'user_bid_96' } },
    { businessTarget: { id: 'dayahead_user_clearing' } },
  ]);

  assert.deepEqual(summary.presentRequiredIds.sort(), [
    'dayahead_user_clearing',
    'user_bid_96',
  ]);
  assert.ok(summary.missingRequiredIds.includes('actual_load_96'));
});
