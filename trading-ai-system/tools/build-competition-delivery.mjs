#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { exportCompetitionTraces } from '../lib/competition-trace.mjs';
import { COMPETITION_MODEL } from '../lib/competition-agent.mjs';
import { buildChildEnvironment, resolveToolPaths } from './competition-tools.mjs';

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DELIVERY_ROOT = path.join(PROJECT_ROOT, 'competition-delivery');
const RUNTIME_ROOT = path.join(PROJECT_ROOT, '.competition-runtime');
const BUILDER_ID = 'competition-evaluation-submission';
const STATIC_PORT = 5178;
const DYNAMIC_PORT = 5177;
const MAIN_INSTRUCTION = '请分析2026年5月7日江苏电力现货市场96点价格，识别低价与高价风险窗口，列出数据缺口，并说明人工复核边界，不生成自动下单。';

function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
async function exists(target) { try { await access(target); return true; } catch { return false; } }

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`本机端口 ${port} 已被占用，请先停止占用该端口的进程`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

function startServer(port, traceLog) {
  const child = spawn(process.execPath, ['server.mjs', '--port', String(port), '--competition-trace-log', traceLog], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, HOST: '127.0.0.1', JSPEC_MANAGED_BROWSER_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      if (child.exitCode === null) child.kill('SIGTERM');
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error(`服务启动超时：${output.trim()}`)), 15_000);
    child.once('exit', (code) => fail(new Error(`服务提前退出（${code}）：${output.trim()}`)));
    const poll = setInterval(async () => {
      if (!output.includes('Trading AI System running at')) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      resolve({ child, output: () => output });
    }, 25);
  });
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

async function invoke(port, instruction, user, operation = 'invoke_agent') {
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: COMPETITION_MODEL,
      stream: false,
      messages: [{ role: 'user', content: instruction }],
      user,
      metadata: { competition_operation: operation },
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.trace_id || !body.choices?.[0]?.message?.content) {
    throw new Error(`本机 Agent 请求失败（HTTP ${response.status}）：${JSON.stringify(body)}`);
  }
  return { trace_id: body.trace_id, classification: JSON.parse(JSON.stringify(body.choices[0].message.content)).slice(0, 160) };
}

function runPython(executable, args, label, toolPaths) {
  const result = spawnSync(executable, args, {
    cwd: PROJECT_ROOT,
    env: buildChildEnvironment(toolPaths),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label}失败：${(result.stderr || result.stdout || result.error?.message || `退出码 ${result.status}`).trim()}`);
  }
  return result.stdout.trim();
}

function normalizeReportPaths(value, stagingRoot) {
  if (typeof value === 'string' && value.startsWith(stagingRoot)) {
    return path.join(DELIVERY_ROOT, path.relative(path.join(stagingRoot, 'competition-delivery'), value));
  }
  if (Array.isArray(value)) return value.map((item) => normalizeReportPaths(item, stagingRoot));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeReportPaths(item, stagingRoot)]));
  }
  return value;
}

async function writeValidatorReport(filePath, stdout, stagingRoot, assertReport) {
  let payload;
  try { payload = JSON.parse(stdout); } catch (error) { throw new Error(`官方校验器输出不是合法 JSON：${error.message}`); }
  assertReport(payload);
  payload = normalizeReportPaths(payload, stagingRoot);
  await writeFile(filePath, json(payload));
  return payload;
}

async function existingDeliveryIsOwned() {
  if (!(await exists(DELIVERY_ROOT))) return false;
  const manifestPath = path.join(DELIVERY_ROOT, 'qa', 'build-manifest.json');
  if (!(await exists(manifestPath))) throw new Error(`交付目录已存在且不是本构建器拥有：${DELIVERY_ROOT}`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.builder !== BUILDER_ID) throw new Error(`交付目录所有者不匹配：${DELIVERY_ROOT}`);
  const uploadDir = path.join(DELIVERY_ROOT, 'upload');
  await assertExactUploadInventory(uploadDir);
  const hashCheck = await verifySha256Manifest(uploadDir, manifest.sha256);
  if (!hashCheck.ok) throw new Error(`现有正式材料已被人工修改，拒绝自动替换：${JSON.stringify(hashCheck.mismatches)}`);
  return true;
}

async function publishDelivery(stagedDelivery, stagingRoot, hasExisting) {
  if (!hasExisting) {
    await rename(stagedDelivery, DELIVERY_ROOT);
    return null;
  }
  const backup = path.join(stagingRoot, `previous-delivery-${Date.now()}`);
  await rename(DELIVERY_ROOT, backup);
  try {
    await rename(stagedDelivery, DELIVERY_ROOT);
  } catch (error) {
    await rename(backup, DELIVERY_ROOT);
    throw error;
  }
  return backup;
}

async function build() {
  const hasExisting = await existingDeliveryIsOwned();
  await assertPortFree(STATIC_PORT);
  await assertPortFree(DYNAMIC_PORT);
  await mkdir(RUNTIME_ROOT, { recursive: true, mode: 0o700 });
  const stagingRoot = await mkdtemp(path.join(RUNTIME_ROOT, 'delivery-build-'));
  const stagedDelivery = path.join(stagingRoot, 'competition-delivery');
  const uploadDir = path.join(stagedDelivery, 'upload');
  const qaDir = path.join(stagedDelivery, 'qa');
  await mkdir(uploadDir, { recursive: true });
  await mkdir(qaDir, { recursive: true });
  const staticLog = path.join(stagingRoot, 'static-traces.ndjson');
  const dynamicLog = path.join(stagingRoot, 'dynamic-traces.ndjson');
  const toolPaths = resolveToolPaths({ projectRoot: PROJECT_ROOT });
  let staticServer;
  let dynamicServer;
  try {
    staticServer = await startServer(STATIC_PORT, staticLog);
    const staticCalls = [
      await invoke(STATIC_PORT, MAIN_INSTRUCTION, 'submission-main'),
      await invoke(STATIC_PORT, '请记住：后续分析先列数据缺口。', 'memory-case', 'chat'),
      await invoke(STATIC_PORT, MAIN_INSTRUCTION, 'memory-case', 'chat'),
    ];
    await stopServer(staticServer);
    staticServer = null;

    const staticTracePath = path.join(uploadDir, 'traces.json');
    const staticDocument = await exportCompetitionTraces(staticLog, staticTracePath);
    const informationPath = path.join(uploadDir, 'information.json');
    const information = buildCompetitionInformation(staticDocument, {
      endpoint: `http://127.0.0.1:${DYNAMIC_PORT}/v1/chat/completions`,
    });
    await writeFile(informationPath, json(information));

    await writeValidatorReport(path.join(qaDir, 'traces-validation.json'), runPython(
      toolPaths.venvPython, [toolPaths.genaiMain, staticTracePath, '--format', 'json'], '官方静态 Trace 校验', toolPaths,
    ), stagingRoot, assertOfficialTraceValidationReport);
    await writeValidatorReport(path.join(qaDir, 'information-validation.json'), runPython(
      toolPaths.venvPython, [toolPaths.informationValidator, informationPath, '--json'], '官方 information 校验', toolPaths,
    ), stagingRoot, assertOfficialInformationValidationReport);

    dynamicServer = await startServer(DYNAMIC_PORT, dynamicLog);
    const executionReportPath = path.join(qaDir, 'execution-report.json');
    runPython(toolPaths.venvPython, [
      toolPaths.dynamicRunner, 'run', informationPath, staticTracePath,
      '--output', executionReportPath, '--timeout', '30',
    ], '官方动态 3/3 评测', toolPaths);
    await stopServer(dynamicServer);
    dynamicServer = null;

    const dynamicTracePath = path.join(uploadDir, 'traces-dynamic.json');
    const dynamicDocument = await exportCompetitionTraces(dynamicLog, dynamicTracePath);
    await writeValidatorReport(path.join(qaDir, 'traces-dynamic-validation.json'), runPython(
      toolPaths.venvPython, [toolPaths.genaiMain, dynamicTracePath, '--format', 'json'], '官方动态 Trace 校验', toolPaths,
    ), stagingRoot, assertOfficialTraceValidationReport);
    const executionReport = JSON.parse(await readFile(executionReportPath, 'utf8'));
    const reconciliation = reconcileDynamicTraces(executionReport, dynamicDocument);
    await writeFile(path.join(qaDir, 'trace-reconciliation.json'), json(reconciliation));

    const provenance = buildDataProvenance({ sourcePath: 'data/standard-96.sample.json', dataSource: 'repository_sample' });
    await writeFile(path.join(qaDir, 'data-provenance.json'), json(provenance));
    await assertExactUploadInventory(uploadDir);
    await assertSafeSubmissionContent(uploadDir);
    const hashes = await buildSha256Manifest(uploadDir);
    const hashCheck = await verifySha256Manifest(uploadDir, hashes);
    if (!hashCheck.ok) throw new Error(`SHA-256 复核失败：${JSON.stringify(hashCheck.mismatches)}`);
    await writeFile(path.join(qaDir, 'SHA256SUMS.txt'), `${Object.entries(hashes).map(([name, hash]) => `${hash}  upload/${name}`).join('\n')}\n`);
    await writeFile(path.join(qaDir, 'build-manifest.json'), json({
      builder: BUILDER_ID,
      built_at: new Date().toISOString(),
      official_upload_files: Object.keys(hashes).sort(),
      sha256: hashes,
      static_calls: staticCalls.map((item) => ({ trace_id: item.trace_id })),
      dynamic_summary: executionReport.summary,
      trace_reconciliation: reconciliation.ok,
      secret_and_placeholder_scan: true,
      provenance,
    }));
    const backup = await publishDelivery(stagedDelivery, stagingRoot, hasExisting);
    process.stdout.write(`交付包已生成：${DELIVERY_ROOT}\n`);
    if (backup) process.stdout.write(`上一版已保留：${backup}\n`);
  } finally {
    await stopServer(staticServer);
    await stopServer(dynamicServer);
  }
}

async function verify() {
  const uploadDir = path.join(DELIVERY_ROOT, 'upload');
  const manifest = JSON.parse(await readFile(path.join(DELIVERY_ROOT, 'qa', 'build-manifest.json'), 'utf8'));
  await assertExactUploadInventory(uploadDir);
  await assertSafeSubmissionContent(uploadDir);
  const result = await verifySha256Manifest(uploadDir, manifest.sha256);
  if (!result.ok) throw new Error(`SHA-256 不一致：${JSON.stringify(result.mismatches)}`);
  const report = JSON.parse(await readFile(path.join(DELIVERY_ROOT, 'qa', 'execution-report.json'), 'utf8'));
  const dynamic = JSON.parse(await readFile(path.join(uploadDir, 'traces-dynamic.json'), 'utf8'));
  reconcileDynamicTraces(report, dynamic);
  process.stdout.write('交付包复核通过：正式目录精确 3 个文件，内容扫描、SHA-256 和动态 Trace 对账均通过。\n');
}

const command = process.argv[2] || 'build';
try {
  if (command === 'build') await build();
  else if (command === 'verify') await verify();
  else throw new Error('用法：node tools/build-competition-delivery.mjs [build|verify]');
} catch (error) {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
}
