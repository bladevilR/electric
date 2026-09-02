import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCompetitionTrace } from '../lib/competition-trace.mjs';
import {
  assertExactUploadInventory,
  assertOfficialInformationValidationReport,
  assertOfficialTraceValidationReport,
  assertSafeSubmissionContent,
  buildCompetitionInformation,
  buildDataProvenance,
  buildSha256Manifest,
  reconcileDynamicTraces,
  verifySha256Manifest,
} from '../lib/competition-materials.mjs';

const model = 'electric-trading-copilot-v1';
function doc(operation, instruction, result, conversationId = 'case') {
  return buildCompetitionTrace({ request: { instruction, conversationId, rootOperation: operation }, result, dataSource: 'repository_sample', model });
}
const analysisResult = { content: '{"status":"data_blocked","data_source":"repository_sample"}', finishReason: 'stop', classification: 'domain_analysis', toolExecutions: [{ name: 'load_trading_analysis_context', callId: 'c1', arguments: { date: '2026-05-07' }, status: 'ok', result: { rows: 96 } }], memoryExecutions: [] };

test('information material derives every evidence identifier from current traces', () => {
  const main = doc('invoke_agent', '请分析2026年5月7日江苏电力现货价格', analysisResult, 'main');
  const create = doc('chat', '请记住偏好', { content: '已记住', finishReason: 'stop', classification: 'memory_created', toolExecutions: [], memoryExecutions: [{ operation: 'create_memory', conversationId: 'memory', value: '先列缺口' }] }, 'memory');
  const search = doc('chat', '请继续分析', { ...analysisResult, memoryExecutions: [{ operation: 'search_memory', conversationId: 'memory', value: '先列缺口' }] }, 'memory');
  const traces = { resourceSpans: [...main.resourceSpans, ...create.resourceSpans, ...search.resourceSpans] };
  const info = buildCompetitionInformation(traces, { endpoint: 'http://127.0.0.1:5177/v1/chat/completions' });

  assert.equal(info.api.model, model);
  assert.equal(info.api.authentication.method, 'none');
  assert.equal(info.task_log_evidence_examples[0].trace_id, main.resourceSpans[0].scopeSpans[0].spans[0].traceId);
  assert.match(info.task_log_evidence_examples[0].deliverable_hash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(info.task_log_evidence_examples[0].declared_stages.every((stage) => stage.stage_evidence_span_ids.every((id) => JSON.stringify(traces).includes(id))));
  for (const key of ['business_intent_examples', 'inference_task_examples', 'task_log_evidence_examples', 'tool_skill_examples', 'memory_capability_examples']) assert.ok(info[key].length > 0);
});

test('dynamic reconciliation requires exactly the three reported trace ids', () => {
  const traces = ['a', 'b', 'c'].map((suffix) => doc('invoke_agent', suffix, { ...analysisResult, content: suffix }, suffix));
  const dynamic = { resourceSpans: traces.flatMap((item) => item.resourceSpans) };
  const ids = traces.map((item) => item.resourceSpans[0].scopeSpans[0].spans[0].traceId);
  const report = { summary: { total: 3, succeeded: 3, failed: 0 }, tests: ids.map((trace_id) => ({ status: 'succeeded', http_status: 200, trace_id })) };
  assert.deepEqual(reconcileDynamicTraces(report, dynamic), { ok: true, expectedTraceIds: ids.sort(), actualTraceIds: ids.sort(), missing: [], unexpected: [] });
  assert.throws(() => reconcileDynamicTraces({ ...report, tests: report.tests.slice(0, 2) }, dynamic), /3/);
  assert.throws(() => reconcileDynamicTraces({ ...report, tests: report.tests.map((item, index) => index ? item : { ...item, status: 'failed', http_status: 500 }) }, dynamic), /逐条|成功/);
});

test('information material rejects unrelated memory create and search spans', () => {
  const main = doc('invoke_agent', '请分析2026年5月7日江苏电力现货价格', analysisResult, 'main');
  const create = doc('chat', '请记住偏好', { content: '已记住', finishReason: 'stop', classification: 'memory_created', toolExecutions: [], memoryExecutions: [{ operation: 'create_memory', conversationId: 'memory-a', value: '先列缺口' }] }, 'memory-a');
  const search = doc('chat', '请继续分析', { ...analysisResult, memoryExecutions: [{ operation: 'search_memory', conversationId: 'memory-b', value: '另一偏好' }] }, 'memory-b');
  assert.throws(() => buildCompetitionInformation({ resourceSpans: [...main.resourceSpans, ...create.resourceSpans, ...search.resourceSpans] }, { endpoint: 'http://127.0.0.1:5177/v1/chat/completions' }), /记忆链路/);
});

test('upload inventory is exact and unsafe secrets or placeholders are rejected', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'competition-materials-'));
  for (const name of ['traces.json', 'traces-dynamic.json', 'information.json']) {
    await writeFile(path.join(directory, name), '{"data_source":"repository_sample"}\n');
  }
  assert.deepEqual(await assertExactUploadInventory(directory), ['information.json', 'traces-dynamic.json', 'traces.json']);
  await assertSafeSubmissionContent(directory);
  await mkdir(path.join(directory, 'unexpected-directory'));
  await assert.rejects(() => assertExactUploadInventory(directory), /精确包含/);
  await rm(path.join(directory, 'unexpected-directory'), { recursive: true });
  await writeFile(path.join(directory, 'information.json'), '{"token":"YOUR_TOKEN"}\n');
  await assert.rejects(() => assertSafeSubmissionContent(directory), /占位符|敏感/);
});

test('submission scan rejects structured credentials and sample-data production claims', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'competition-sensitive-'));
  for (const name of ['traces.json', 'traces-dynamic.json', 'information.json']) await writeFile(path.join(directory, name), '{}\n');
  await writeFile(path.join(directory, 'information.json'), '{"authentication":{"method":"none","password":"secret-value"}}\n');
  await assert.rejects(() => assertSafeSubmissionContent(directory), /敏感/);
  await writeFile(path.join(directory, 'information.json'), '{"data_source":"repository_sample","production_ready":true}\n');
  await assert.rejects(() => assertSafeSubmissionContent(directory), /样例|生产/);
  await writeFile(path.join(directory, 'information.json'), '{"endpoint":"${API_ENDPOINT}"}\n');
  await assert.rejects(() => assertSafeSubmissionContent(directory), /占位符/);
});

test('official validator reports must be parseable and explicitly successful', () => {
  const trace = { schema_version: '2.0', valid: true, input_format_valid: true, genai_fields_valid: true, evaluation_compatible: true, trace_integrity_valid: true, error_count: 0 };
  const information = { verdict: '可提交', status: 'pass', summary: { error_count: 0 } };
  assert.deepEqual(assertOfficialTraceValidationReport(trace), trace);
  assert.deepEqual(assertOfficialInformationValidationReport(information), information);
  assert.throws(() => assertOfficialTraceValidationReport({ ...trace, valid: false }), /未通过/);
  assert.throws(() => assertOfficialInformationValidationReport({ ...information, status: 'fail' }), /未通过/);
});

test('sample provenance and SHA-256 manifest are reproducible', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'competition-checksums-'));
  for (const [name, value] of [['traces.json', 'a'], ['traces-dynamic.json', 'b'], ['information.json', 'c']]) {
    await writeFile(path.join(directory, name), value);
  }
  const provenance = buildDataProvenance({ sourcePath: 'data/standard-96.sample.json', dataSource: 'repository_sample' });
  assert.equal(provenance.production_ready, false);
  assert.equal(provenance.realized_savings_claimed, false);
  const manifest = await buildSha256Manifest(directory);
  assert.equal(Object.keys(manifest).length, 3);
  assert.deepEqual(await verifySha256Manifest(directory, manifest), { ok: true, mismatches: [] });
  await writeFile(path.join(directory, 'traces.json'), 'changed');
  assert.equal((await verifySha256Manifest(directory, manifest)).ok, false);
});
