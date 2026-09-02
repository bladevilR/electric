import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function hex(bytes) { return randomBytes(bytes).toString('hex'); }
function json(value) { return JSON.stringify(value); }
function attr(key, value) {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') return { key, value: { intValue: String(value) } };
  return { key, value: { stringValue: String(value) } };
}
function attributes(values) {
  return Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => attr(key, value));
}
function span({ name, traceId, spanId = hex(8), parentSpanId, start, end, status = 1, values }) {
  return {
    name, traceId, spanId, ...(parentSpanId ? { parentSpanId } : {}),
    startTimeUnixNano: String(start), endTimeUnixNano: String(end),
    status: { code: status }, attributes: attributes(values),
  };
}

export function buildCompetitionTrace(execution) {
  const traceId = execution.traceId || hex(16);
  const rootSpanId = execution.rootSpanId || hex(8);
  const start = BigInt(execution.startedAtUnixNano || Date.now() * 1_000_000);
  const end = BigInt(execution.endedAtUnixNano || start + 1_000_000n);
  const children = [...(execution.result.toolExecutions || []), ...(execution.result.memoryExecutions || [])];
  const slice = children.length ? (end - start) / BigInt(children.length + 1) : 0n;
  const toolDefinitions = (execution.result.toolExecutions || []).map((item) => ({
    type: 'function', name: item.name, description: '读取竞赛 Agent 已登记的本地能力',
  }));
  const root = span({
    name: `${execution.request.rootOperation || 'invoke_agent'} ${execution.model}`,
    traceId, spanId: rootSpanId, start, end, status: 1,
    values: {
      'gen_ai.operation.name': execution.request.rootOperation || 'invoke_agent',
      'gen_ai.request.model': execution.model,
      'gen_ai.response.model': execution.model,
      'gen_ai.conversation.id': execution.request.conversationId,
      'gen_ai.input.messages': json([{ role: 'user', parts: [{ type: 'text', content: execution.request.instruction }] }]),
      'gen_ai.output.messages': json([{ role: 'assistant', parts: [{ type: 'text', content: execution.result.content }], finish_reason: execution.result.finishReason || 'stop' }]),
      'gen_ai.tool.definitions': toolDefinitions.length ? json(toolDefinitions) : undefined,
      'competition.data_source': execution.dataSource || 'unknown',
      'competition.classification': execution.result.classification,
    },
  });
  const childSpans = children.map((item, index) => {
    const childStart = start + slice * BigInt(index + 1);
    const childEnd = index === children.length - 1 ? end - 1n : childStart + (slice > 1n ? slice - 1n : 0n);
    if (item.operation) {
      return span({ name: item.operation, traceId, parentSpanId: rootSpanId, start: childStart, end: childEnd, values: {
        'gen_ai.operation.name': item.operation,
        'gen_ai.conversation.id': item.conversationId,
        'gen_ai.memory.store.id': 'competition-preferences',
        'gen_ai.memory.record.count': 1,
        'gen_ai.memory.records': json([{ id: `${item.conversationId}-preference`, content: item.value }]),
      } });
    }
    return span({ name: `execute_tool ${item.name}`, traceId, parentSpanId: rootSpanId, start: childStart, end: childEnd,
      status: item.status === 'error' ? 2 : 1, values: {
        'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': item.name,
        'gen_ai.tool.call.id': item.callId, 'gen_ai.tool.call.arguments': json(item.arguments || {}),
        'gen_ai.tool.call.result': json(item.result || {}),
        ...(item.errorType ? { 'error.type': item.errorType } : {}),
      } });
  });
  return { resourceSpans: [{ resource: { attributes: attributes({ 'service.name': 'electric-trading-copilot', 'service.version': '1.0.0' }) },
    scopeSpans: [{ scope: { name: 'trading-ai-system.competition', version: '1.0.0' }, spans: [root, ...childSpans] }] }] };
}

export async function appendCompetitionTrace(logPath, document) {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(document)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function exportCompetitionTraces(logPath, outputPath) {
  const lines = (await readFile(logPath, 'utf8')).split(/\r?\n/).filter(Boolean);
  const resourceSpans = [];
  for (let index = 0; index < lines.length; index += 1) {
    try {
      const document = JSON.parse(lines[index]);
      if (!Array.isArray(document.resourceSpans) || !document.resourceSpans.length) throw new Error('missing resourceSpans');
      resourceSpans.push(...document.resourceSpans);
    } catch (error) {
      throw new Error(`Trace 运行日志第 ${index + 1} 行损坏：${error.message}`);
    }
  }
  if (!resourceSpans.length) throw new Error('Trace 运行日志为空');
  const merged = { resourceSpans };
  validateTraceIntegrity(merged);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

function validateTraceIntegrity(document) {
  const all = (document.resourceSpans || []).flatMap((resource) => (resource.scopeSpans || []).flatMap((scope) => scope.spans || []));
  const keys = new Set();
  const byTrace = new Map();
  for (const item of all) {
    if (!/^[0-9a-f]{32}$/.test(item.traceId || '') || !/^[0-9a-f]{16}$/.test(item.spanId || '')) throw new Error('Trace 或 Span ID 格式无效');
    const key = `${item.traceId}:${item.spanId}`;
    if (keys.has(key)) throw new Error(`重复 Span ID：${item.spanId}`);
    keys.add(key);
    if (!byTrace.has(item.traceId)) byTrace.set(item.traceId, []);
    byTrace.get(item.traceId).push(item);
    let start;
    let end;
    try { start = BigInt(item.startTimeUnixNano); end = BigInt(item.endTimeUnixNano); } catch { throw new Error(`Span ${item.spanId} 时间戳不是整数`); }
    if (start <= 0n || end < start) throw new Error(`Span ${item.spanId} 时间范围无效`);
  }
  for (const [traceId, items] of byTrace) {
    const ids = new Set(items.map((item) => item.spanId));
    const roots = items.filter((item) => !item.parentSpanId);
    if (roots.length !== 1) throw new Error(`Trace ${traceId} 必须恰好有一个根 Span`);
    for (const item of items) {
      if (item.parentSpanId && !ids.has(item.parentSpanId)) throw new Error(`Span ${item.spanId} 的父 Span ${item.parentSpanId} 不在同一 Trace`);
    }
  }
}

function attrs(list = []) {
  return Object.fromEntries(list.map((item) => [item.key, item.value?.stringValue ?? item.value?.intValue ?? item.value?.boolValue]));
}
export function indexCompetitionEvidence(document) {
  const spans = (document.resourceSpans || []).flatMap((resource) => (resource.scopeSpans || []).flatMap((scope) => scope.spans || []));
  const indexed = spans.map((item) => ({ ...item, values: attrs(item.attributes) }));
  const rootSpan = indexed.find((item) => !item.parentSpanId);
  const parseMessage = (value) => {
    try { return JSON.stringify(JSON.parse(value)); } catch { return String(value || ''); }
  };
  return {
    traceIds: [...new Set(indexed.map((item) => item.traceId))],
    root: rootSpan ? { traceId: rootSpan.traceId, spanId: rootSpan.spanId, operation: rootSpan.values['gen_ai.operation.name'], input: parseMessage(rootSpan.values['gen_ai.input.messages']), output: parseMessage(rootSpan.values['gen_ai.output.messages']) } : null,
    tools: indexed.filter((item) => item.values['gen_ai.operation.name'] === 'execute_tool').map((item) => ({ traceId: item.traceId, spanId: item.spanId, parentSpanId: item.parentSpanId, name: item.values['gen_ai.tool.name'] })),
    memories: indexed.filter((item) => ['create_memory', 'search_memory'].includes(item.values['gen_ai.operation.name'])).map((item) => ({ traceId: item.traceId, spanId: item.spanId, parentSpanId: item.parentSpanId, operation: item.values['gen_ai.operation.name'] })),
  };
}
