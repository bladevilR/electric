import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  appendCompetitionTrace,
  buildCompetitionTrace,
  exportCompetitionTraces,
  indexCompetitionEvidence,
} from '../lib/competition-trace.mjs';

function execution(overrides = {}) {
  return {
    request: { instruction: '请分析电价', conversationId: 'case-1', rootOperation: 'invoke_agent' },
    result: {
      content: '{"status":"data_blocked"}', finishReason: 'stop', classification: 'domain_analysis',
      toolExecutions: [{ name: 'load_trading_analysis_context', callId: 'call-1', arguments: { date: '2026-05-07' }, status: 'ok', result: { rows: 96 } }],
      memoryExecutions: [{ operation: 'search_memory', conversationId: 'case-1', value: '先列数据缺口' }],
    },
    dataSource: 'repository_sample', model: 'electric-trading-copilot-v1',
    startedAtUnixNano: '1788105600000000000', endedAtUnixNano: '1788105601000000000',
    ...overrides,
  };
}

test('buildCompetitionTrace creates validator-shaped root, tool, and memory spans', () => {
  const document = buildCompetitionTrace(execution());
  const spans = document.resourceSpans[0].scopeSpans[0].spans;
  const [root, tool, memory] = spans;

  assert.match(root.traceId, /^[0-9a-f]{32}$/);
  assert.match(root.spanId, /^[0-9a-f]{16}$/);
  assert.equal(root.status.code, 1);
  assert.equal(tool.parentSpanId, root.spanId);
  assert.equal(memory.parentSpanId, root.spanId);
  assert.equal(new Set(spans.map((span) => span.spanId)).size, spans.length);
  const evidence = indexCompetitionEvidence(document);
  assert.equal(evidence.traceIds.length, 1);
  assert.equal(evidence.root.operation, 'invoke_agent');
  assert.equal(evidence.tools[0].name, 'load_trading_analysis_context');
  assert.equal(evidence.memories[0].operation, 'search_memory');
  assert.match(evidence.root.input, /请分析电价/);
  assert.match(evidence.root.output, /data_blocked/);
});

test('append and export merge complete trace documents and reject corrupt records', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'competition-trace-'));
  const log = path.join(temp, 'traces.ndjson');
  const output = path.join(temp, 'traces.json');
  try {
    await appendCompetitionTrace(log, buildCompetitionTrace(execution()));
    await appendCompetitionTrace(log, buildCompetitionTrace(execution({ request: { instruction: '第二个任务', conversationId: 'case-2', rootOperation: 'chat' } })));
    const merged = await exportCompetitionTraces(log, output);
    assert.equal(merged.resourceSpans.length, 2);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), merged);

    await writeFile(log, `${await readFile(log, 'utf8')}{broken\n`, 'utf8');
    await assert.rejects(() => exportCompetitionTraces(log, output), /损坏/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('export rejects duplicate span ids and cross-trace parent references', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'competition-trace-integrity-'));
  try {
    const duplicateLog = path.join(temp, 'duplicate.ndjson');
    const duplicate = buildCompetitionTrace(execution());
    duplicate.resourceSpans[0].scopeSpans[0].spans.push(structuredClone(duplicate.resourceSpans[0].scopeSpans[0].spans[0]));
    await appendCompetitionTrace(duplicateLog, duplicate);
    await assert.rejects(() => exportCompetitionTraces(duplicateLog, path.join(temp, 'duplicate.json')), /重复 Span ID/);

    const parentLog = path.join(temp, 'parent.ndjson');
    const brokenParent = buildCompetitionTrace(execution());
    brokenParent.resourceSpans[0].scopeSpans[0].spans[1].parentSpanId = 'ffffffffffffffff';
    await appendCompetitionTrace(parentLog, brokenParent);
    await assert.rejects(() => exportCompetitionTraces(parentLog, path.join(temp, 'parent.json')), /父 Span/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
