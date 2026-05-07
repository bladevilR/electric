import test from 'node:test';
import assert from 'node:assert/strict';

import { isLikelyLoggedIn } from './login-state.mjs';

test('isLikelyLoggedIn rejects the public outNet login page', () => {
  assert.equal(
    isLikelyLoggedIn({
      url: 'https://www.jspec.com.cn/#/outNet',
      text: '欢迎使用江苏电力交易平台 登 录 注 册 下载Ukey',
    }),
    false
  );
});

test('isLikelyLoggedIn accepts authenticated dashboard or app pages', () => {
  assert.equal(
    isLikelyLoggedIn({
      url: 'https://www.jspec.com.cn/#/dashboard',
      text: '江苏省内现货 我的交易 我的计划',
    }),
    true
  );

  assert.equal(
    isLikelyLoggedIn({
      url: 'https://www.jspec.com.cn/pxf-spotgoods-province-extranet/#/pxf-spotgoods-province-extranet/userBid96/index',
      text: '用户侧96点主动申报 查询',
    }),
    true
  );
});
