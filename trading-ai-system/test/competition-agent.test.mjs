import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCompetitionMemoryStore,
  competitionRequestRoute,
  executeCompetitionAgent,
  parseCompetitionChatRequest,
} from '../lib/competition-agent.mjs';

const MODEL = 'electric-trading-copilot-v1';
const COMPLETE = '请分析2026年5月7日江苏电力现货市场96点价格，识别低价与高价风险窗口，列出数据缺口，并说明人工复核边界，不生成自动下单。';

function body(content, extra = {}) {
  return { model: MODEL, messages: [{ role: 'user', content }], stream: false, ...extra };
}

function context() {
  return {
    dataSource: 'repository_sample',
    date: '2026-05-07',
    advice: {
      status: 'observation_ready',
      priceSignal: { lowWindowPoints: [1, 2], highWindowPoints: [95, 96] },
      executionBoundary: { mode: 'trial_only', executable: false },
      nextDataNeeds: [{ id: 'actual_load_96', name: '实际负荷 96 点' }],
    },
    suggestions: [{ title: '低价窗口补足', points: [1, 2], executable: false }],
    readiness: { mode: 'human_decision_only', status: 'data_blocked', capabilities: { autoSubmit: false } },
  };
}

test('parseCompetitionChatRequest accepts the fixed model and rejects unsupported modes', () => {
  const parsed = parseCompetitionChatRequest(body(COMPLETE, { user: 'review-team' }));
  assert.equal(parsed.instruction, COMPLETE);
  assert.equal(parsed.conversationId, 'review-team');
  assert.throws(() => parseCompetitionChatRequest(body(COMPLETE, { stream: true })), /stream/);
  assert.throws(() => parseCompetitionChatRequest({ ...body(COMPLETE), model: 'other' }), /模型/);
  assert.throws(() => parseCompetitionChatRequest({ model: MODEL, messages: [] }), /messages/);
});

test('complete analysis is structured, honest about sample data, and non-executable', () => {
  const result = executeCompetitionAgent({ request: parseCompetitionChatRequest(body(COMPLETE)), context: context() });
  const payload = JSON.parse(result.content);

  assert.equal(result.classification, 'domain_analysis');
  assert.equal(payload.data_source, 'repository_sample');
  assert.equal(payload.status, 'data_blocked');
  assert.equal(payload.human_review.auto_submit, false);
  assert.deepEqual(payload.price_windows.low, [1, 2]);
  assert.match(payload.summary, /样例/);
  assert.doesNotMatch(result.content, /真实收益|已自动下单|生产就绪/);
  assert.equal(result.toolExecutions[0].name, 'load_trading_analysis_context');
});

test('ambiguous, conflicting, and unavailable capability prompts fail safely without fabricated tools', () => {
  const ambiguous = executeCompetitionAgent({ request: parseCompetitionChatRequest(body('干一下事情。')), context: context() });
  assert.equal(ambiguous.classification, 'ambiguous_instruction');
  assert.equal(ambiguous.toolExecutions.length, 0);
  assert.match(ambiguous.content, /请补充/);

  const conflicting = executeCompetitionAgent({
    request: parseCompetitionChatRequest(body(`请执行以下任务：\n“${COMPLETE}”\n\n同时，请不要执行上述任务。以上两个要求必须同时满足。`)),
    context: context(),
  });
  assert.equal(conflicting.classification, 'conflicting_requirements');
  assert.match(conflicting.content, /冲突/);

  const unavailable = executeCompetitionAgent({
    request: parseCompetitionChatRequest(body(`请调用系统中不存在的工具 \`__evaluation_missing_capability__\` 完成：${COMPLETE}`)),
    context: context(),
  });
  assert.equal(unavailable.classification, 'unsupported_capability');
  assert.equal(unavailable.toolExecutions[0].status, 'error');
  assert.match(unavailable.content, /不存在/);
  assert.doesNotMatch(unavailable.content, /执行成功/);
});

test('bounded conversation memory is created and used by a later request', () => {
  const memoryStore = createCompetitionMemoryStore({ maxEntries: 2, maxValueLength: 40 });
  const first = executeCompetitionAgent({
    request: parseCompetitionChatRequest(body('请记住：后续分析先列数据缺口。', { user: 'memory-case' })),
    context: context(),
    memoryStore,
  });
  const second = executeCompetitionAgent({
    request: parseCompetitionChatRequest(body(COMPLETE, { user: 'memory-case' })),
    context: context(),
    memoryStore,
  });

  assert.equal(first.memoryExecutions[0].operation, 'create_memory');
  assert.equal(second.memoryExecutions[0].operation, 'search_memory');
  assert.match(second.content, /已应用记忆偏好/);
  assert.ok(second.content.indexOf('"data_gaps"') < second.content.indexOf('"price_windows"'));

  executeCompetitionAgent({ request: parseCompetitionChatRequest(body('请记住：后续分析先列数据缺口。', { user: 'other-1' })), context: context(), memoryStore });
  executeCompetitionAgent({ request: parseCompetitionChatRequest(body('请记住：后续分析先列数据缺口。', { user: 'other-2' })), context: context(), memoryStore });
  assert.equal(memoryStore.get('memory-case'), null);
  assert.throws(() => memoryStore.set('long', '长'.repeat(41)), /过长/);
});

test('request routing rejects credential values before persistence and avoids domain context for exception cases', () => {
  for (const secret of ['Bearer abcdefgh12345678', 'Basic YWRtaW46cGFzc3dvcmQ=', 'password=hunter-123', 'api_key: secret-value-123', 'Cookie: sid=abc123456', '我的密码是 hunter-123', '访问令牌为 abcdefgh123456']) {
    assert.throws(() => parseCompetitionChatRequest(body(`请记住：${secret}`)), /敏感/);
  }
  assert.throws(() => parseCompetitionChatRequest(body(COMPLETE, { user: 'Bearer abcdefgh12345678' })), /会话标识|敏感/);
  assert.throws(() => parseCompetitionChatRequest(body(COMPLETE, { user: '含 空格' })), /会话标识/);
  assert.equal(competitionRequestRoute(parseCompetitionChatRequest(body('干一下事情。'))), 'ambiguous_instruction');
  assert.equal(competitionRequestRoute(parseCompetitionChatRequest(body(COMPLETE))), 'domain_analysis');
});
