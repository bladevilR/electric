import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const model = 'electric-trading-copilot-v1';
const instruction = '请分析2026年5月7日江苏电力现货市场96点价格，识别低价与高价风险窗口，列出数据缺口，并说明人工复核边界，不生成自动下单。';

async function fixture(extraArgs = []) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'competition-server-'));
  const port = 8500 + Math.floor(Math.random() * 500);
  const traceLog = path.join(temp, 'traces.ndjson');
  const child = spawn(process.execPath, ['server.mjs', '--port', String(port), '--competition-trace-log', traceLog, ...extraArgs], {
    cwd: root, env: { ...process.env, JSPEC_MANAGED_BROWSER_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('Trading AI System running')) resolve(); });
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${stderr}`)));
  });
  return { baseUrl: `http://127.0.0.1:${port}`, traceLog, async close() { child.kill(); await once(child, 'exit').catch(() => {}); await rm(temp, { recursive: true, force: true }); } };
}

test('OpenAI-compatible endpoint returns a correlated trace from real domain execution', async () => {
  const server = await fixture();
  try {
    const response = await fetch(`${server.baseUrl}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: instruction }], stream: false }) });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.model, model);
    assert.match(payload.trace_id, /^[0-9a-f]{32}$/);
    assert.match(response.headers.get('traceparent') || '', new RegExp(`^00-${payload.trace_id}-[0-9a-f]{16}-01$`));
    assert.match(payload.choices[0].message.content, /repository_sample/);
    const logged = (await readFile(server.traceLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].resourceSpans[0].scopeSpans[0].spans[0].traceId, payload.trace_id);
  } finally { await server.close(); }
});

test('endpoint rejects streaming and malformed requests without writing a trace', async () => {
  const server = await fixture();
  try {
    const response = await fetch(`${server.baseUrl}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: instruction }], stream: true }) });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error.type, 'invalid_request_error');
    await assert.rejects(() => readFile(server.traceLog, 'utf8'), /ENOENT/);
  } finally { await server.close(); }
});

test('endpoint rejects malformed contracts, oversized bodies, and credential values before writing traces', async () => {
  const server = await fixture();
  try {
    const cases = [
      { status: 415, headers: { 'content-type': 'text/plain' }, body: '{}' },
      { status: 400, headers: { 'content-type': 'application/json' }, body: '{broken' },
      { status: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'wrong', messages: [{ role: 'user', content: instruction }] }) },
      { status: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [] }) },
      { status: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: '请记住：Bearer abcdefgh12345678' }] }) },
      { status: 413, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: '大'.repeat(1_100_000) }] }) },
    ];
    for (const item of cases) {
      const response = await fetch(`${server.baseUrl}/v1/chat/completions`, { method: 'POST', headers: item.headers, body: item.body });
      assert.equal(response.status, item.status);
    }
    await assert.rejects(() => readFile(server.traceLog, 'utf8'), /ENOENT/);
  } finally { await server.close(); }
});

test('ambiguous requests do not load the configured domain dataset', async () => {
  const missingStandard = path.join(os.tmpdir(), `missing-competition-${Date.now()}.json`);
  const server = await fixture(['--standard', missingStandard]);
  try {
    const response = await fetch(`${server.baseUrl}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: '干一下事情。' }] }) });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.match(payload.choices[0].message.content, /模糊|不完整/);
    const logged = (await readFile(server.traceLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(logged[0].resourceSpans[0].scopeSpans[0].spans.length, 1);
  } finally { await server.close(); }
});
