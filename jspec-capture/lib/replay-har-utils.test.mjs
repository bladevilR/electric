import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReplayRequest, shouldReplayRequest } from './replay-har-utils.mjs';

test('buildReplayRequest keeps only the headers needed to replay a jspec request', () => {
  const entry = {
    _resourceType: 'xhr',
    request: {
      method: 'POST',
      url: 'https://www.jspec.com.cn/px-trade-extranet/tradeNotice/queryTradeInfoByTypeAndUser',
      headers: [
        { name: 'Accept', value: 'application/json' },
        { name: 'X-Ticket', value: 'ticket-123' },
        { name: 'CurrentRoute', value: '/dashboard' },
        { name: 'Host', value: 'www.jspec.com.cn' },
      ],
      postData: {
        text: '{"data":{},"pageInfo":{"pageNum":1,"pageSize":6}}',
      },
    },
  };

  const replay = buildReplayRequest(entry);
  assert.equal(replay.method, 'POST');
  assert.equal(replay.headers['X-Ticket'], 'ticket-123');
  assert.equal(replay.headers.Host, undefined);
  assert.match(replay.bodyText, /pageSize/);
});

test('shouldReplayRequest requires a jspec xhr/fetch request with X-Ticket', () => {
  assert.equal(
    shouldReplayRequest({
      _resourceType: 'xhr',
      request: {
        method: 'POST',
        url: 'https://www.jspec.com.cn/api/demo',
        headers: [{ name: 'X-Ticket', value: 'ticket-123' }],
      },
    }),
    true
  );

  assert.equal(
    shouldReplayRequest({
      _resourceType: 'document',
      request: {
        method: 'GET',
        url: 'https://www.jspec.com.cn/',
        headers: [{ name: 'X-Ticket', value: 'ticket-123' }],
      },
    }),
    false
  );

  assert.equal(
    shouldReplayRequest({
      _resourceType: 'xhr',
      request: {
        method: 'POST',
        url: 'https://example.com/api/demo',
        headers: [{ name: 'X-Ticket', value: 'ticket-123' }],
      },
    }),
    false
  );
});
