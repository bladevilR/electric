export const COMPETITION_MODEL = 'electric-trading-copilot-v1';

function containsSensitiveValue(value) {
  return [
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
    /\bBasic\s+[A-Za-z0-9+/=]{8,}/i,
    /\bCookie\s*:\s*\S+/i,
    /\b(?:password|passwd|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*[^\s,;]{4,}/i,
    /(?:密码|口令|令牌|密钥|秘钥|API\s*Key|Token)\s*(?:是|为|[:=])\s*[^\s,;]{4,}/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\bsk-[A-Za-z0-9_-]{12,}\b/,
  ].some((pattern) => pattern.test(value));
}

function textContent(message) {
  if (typeof message?.content === 'string') return message.content.trim();
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n');
}

export function parseCompetitionChatRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('请求体必须是 JSON 对象');
  }
  if (body.model !== COMPETITION_MODEL) {
    throw new Error(`模型必须是 ${COMPETITION_MODEL}`);
  }
  if (body.stream === true) {
    throw new Error('stream 模式不支持');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error('messages 必须是非空数组');
  }
  const instruction = [...body.messages]
    .reverse()
    .find((message) => message?.role === 'user');
  const content = textContent(instruction);
  if (!content) {
    throw new Error('messages 必须包含非空用户文本');
  }
  if (containsSensitiveValue(content)) {
    throw new Error('请求包含疑似敏感凭证值，已在写入日志前拒绝');
  }
  let conversationId = 'anonymous';
  if (typeof body.user === 'string' && body.user.trim()) {
    conversationId = body.user.trim();
    if (conversationId.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(conversationId) || containsSensitiveValue(conversationId)) {
      throw new Error('user 会话标识必须是最长 64 位的不透明安全标识，不得包含空格或敏感值');
    }
  }
  return {
    model: body.model,
    messages: body.messages,
    instruction: content,
    conversationId,
    rootOperation: body.metadata?.competition_operation === 'chat' ? 'chat' : 'invoke_agent',
  };
}

export function createCompetitionMemoryStore({ maxEntries = 100, maxValueLength = 200 } = {}) {
  const values = new Map();
  return {
    get(conversationId) {
      return values.get(conversationId) || null;
    },
    set(conversationId, value) {
      if (value.length > maxValueLength) throw new Error(`记忆偏好过长，最多 ${maxValueLength} 个字符`);
      if (containsSensitiveValue(value)) throw new Error('记忆偏好包含疑似敏感凭证值');
      if (values.has(conversationId)) values.delete(conversationId);
      values.set(conversationId, value);
      while (values.size > maxEntries) values.delete(values.keys().next().value);
      return value;
    },
  };
}

function baseResult(classification, content, extra = {}) {
  return {
    classification,
    content,
    finishReason: 'stop',
    toolExecutions: [],
    memoryExecutions: [],
    ...extra,
  };
}

function completeDomainInstruction(value) {
  return (
    /20\d{2}年\d{1,2}月\d{1,2}日/.test(value) &&
    value.includes('价格') &&
    value.includes('低价') &&
    value.includes('高价') &&
    value.includes('数据缺口') &&
    value.includes('人工复核')
  );
}

function unsafeInstruction(value) {
  const withoutSafeNegations = value.replace(
    /(?:不生成|不要|禁止|不得|不)(?:执行|进行)?(?:自动下单|自动申报)/g,
    ''
  );
  return /(自动下单|自动申报|绕过.*复核|UKey|PIN|密码|私钥|令牌|token|cookie|api[_ -]?key|secret|保证收益)/i.test(withoutSafeNegations);
}

export function competitionRequestRoute(request) {
  const instruction = request.instruction;
  if (instruction.includes('同时，请不要执行上述任务')) return 'conflicting_requirements';
  if (instruction.includes('__evaluation_missing_capability__')) return 'unsupported_capability';
  if (unsafeInstruction(instruction)) return 'unsafe_action';
  if (/^请记住：(.+?)[。！！]?$/.test(instruction)) return 'memory_created';
  return completeDomainInstruction(instruction) ? 'domain_analysis' : 'ambiguous_instruction';
}

export function executeCompetitionAgent({ request, context = {}, memoryStore = createCompetitionMemoryStore() }) {
  const instruction = request.instruction;
  const route = competitionRequestRoute(request);
  if (route === 'conflicting_requirements') {
    return baseResult('conflicting_requirements', '指令同时要求执行和不执行同一任务，两者冲突。请明确保留其中一个要求，在此之前我不会擅自执行。');
  }
  if (route === 'unsupported_capability') {
    return baseResult('unsupported_capability', '工具 `__evaluation_missing_capability__` 不存在，我不会猜测或伪造执行结果。请选择已登记的只读电力分析能力。', {
      toolExecutions: [{
        name: '__evaluation_missing_capability__',
        callId: 'missing-capability',
        arguments: { instruction },
        status: 'error',
        errorType: 'capability_not_available',
        result: { ok: false, error: 'tool_not_found' },
      }],
    });
  }
  if (route === 'unsafe_action') {
    return baseResult('unsafe_action', '该请求涉及自动交易、凭证或绕过人工复核，已拒绝危险部分。可继续提供只读分析、数据缺口和人工复核清单。');
  }
  const memoryMatch = instruction.match(/^请记住：(.+?)[。！！]?$/);
  if (route === 'memory_created') {
    const value = memoryMatch[1].trim();
    if (value !== '后续分析先列数据缺口') {
      return baseResult('unsupported_memory_preference', '仅支持记住已经实现的非敏感展示偏好：后续分析先列数据缺口。');
    }
    memoryStore.set(request.conversationId, value);
    return baseResult('memory_created', `已记住本会话的非敏感分析偏好：${value}`, {
      memoryExecutions: [{ operation: 'create_memory', conversationId: request.conversationId, value }],
    });
  }
  if (route === 'ambiguous_instruction') {
    return baseResult('ambiguous_instruction', '当前指令模糊或不完整。请补充交易日期、需分析的 96 点价格、低价/高价窗口、数据缺口和人工复核边界。');
  }

  const remembered = memoryStore.get(request.conversationId);
  const common = {
    status: context.readiness?.status || 'data_blocked',
    summary: context.dataSource === 'repository_sample'
      ? '本次是基于仓库样例数据的只读分析，不是生产交易结果。'
      : '本次为只读电力交易辅助分析。',
    data_source: context.dataSource || 'unknown',
    date: context.date || '',
  };
  const priceWindows = { low: context.advice?.priceSignal?.lowWindowPoints || [], high: context.advice?.priceSignal?.highWindowPoints || [] };
  const dataGaps = (context.advice?.nextDataNeeds || []).map((item) => item.name || item.id);
  const tail = { human_review: { mode: 'human_decision_only', auto_submit: false, executable: false }, ...(remembered ? { memory_note: `已应用记忆偏好：${remembered}` } : {}) };
  const payload = remembered === '后续分析先列数据缺口'
    ? { ...common, data_gaps: dataGaps, price_windows: priceWindows, ...tail }
    : { ...common, price_windows: priceWindows, data_gaps: dataGaps, ...tail };
  return baseResult('domain_analysis', JSON.stringify(payload, null, 2), {
    toolExecutions: [{
      name: 'load_trading_analysis_context',
      callId: 'load-context',
      arguments: { date: context.date || '' },
      status: 'ok',
      result: { advice: context.advice, suggestions: context.suggestions, readiness: context.readiness, dataSource: context.dataSource },
    }],
    memoryExecutions: remembered
      ? [{ operation: 'search_memory', conversationId: request.conversationId, value: remembered }]
      : [],
  });
}
