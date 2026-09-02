#!/usr/bin/env node

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CURRENT_FILE = fileURLToPath(import.meta.url);
const DEFAULT_PROJECT_ROOT = path.dirname(path.dirname(CURRENT_FILE));

const COMMANDS = new Set([
  'setup',
  'doctor',
  'smoke',
  'validate-traces',
  'validate-information',
  'dynamic-check',
  'dynamic-run',
]);

function absoluteFrom(base, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
}

export function resolveToolPaths({
  projectRoot = DEFAULT_PROJECT_ROOT,
  homeDir = os.homedir(),
  env = process.env,
} = {}) {
  const normalizedProjectRoot = path.resolve(projectRoot);
  const defaultAttachments = path.join(
    homeDir,
    'Downloads',
    '智能体运行日志格式校验工具',
    'competition-attachments'
  );
  const attachmentsDir = absoluteFrom(
    normalizedProjectRoot,
    env.COMPETITION_ATTACHMENTS_DIR || defaultAttachments
  );
  const runtimeDir = absoluteFrom(
    normalizedProjectRoot,
    env.COMPETITION_TOOLS_RUNTIME_DIR || path.join(normalizedProjectRoot, '.competition-tools')
  );
  const venvDir = path.join(runtimeDir, 'venv');

  return {
    projectRoot: normalizedProjectRoot,
    attachmentsDir,
    runtimeDir,
    uvCacheDir: path.join(runtimeDir, 'uv-cache'),
    venvDir,
    venvPython: path.join(venvDir, 'bin', 'python'),
    bootstrapPython:
      env.COMPETITION_BOOTSTRAP_PYTHON ||
      (existsSync('/opt/homebrew/bin/python3') ? '/opt/homebrew/bin/python3' : 'python3'),
    uvBin:
      env.COMPETITION_UV_BIN || (existsSync('/opt/homebrew/bin/uv') ? '/opt/homebrew/bin/uv' : 'uv'),
    requirements: path.join(attachmentsDir, 'genai-log-validator', 'requirements.txt'),
    genaiMain: path.join(attachmentsDir, 'genai-log-validator', 'src', 'main.py'),
    validTrace: path.join(
      attachmentsDir,
      'genai-log-validator',
      'examples',
      'valid_trace.json'
    ),
    informationValidator: path.join(
      attachmentsDir,
      'information-validator',
      'information_validator.py'
    ),
    informationExample: path.join(
      attachmentsDir,
      'information-validator',
      'information.example.json'
    ),
    dynamicRunner: path.join(
      attachmentsDir,
      'dynamic-evaluation-runner',
      'dynamic_evaluation_runner.py'
    ),
  };
}

function requireArgumentCount(command, args, minimum, maximum = minimum) {
  if (args.length < minimum || (maximum !== null && args.length > maximum)) {
    const expected = maximum === null ? `至少 ${minimum}` : minimum === maximum ? `${minimum}` : `${minimum}-${maximum}`;
    throw new Error(`命令 ${command} 需要 ${expected} 个参数。`);
  }
}

function explicitOutputPath(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if ((value === '--output' || value === '-o') && args[index + 1] && !args[index + 1].startsWith('-')) {
      return args[index + 1];
    }
    if (value.startsWith('--output=') && value.slice('--output='.length)) {
      return value.slice('--output='.length);
    }
  }
  return null;
}

function informationSource(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--json') {
      continue;
    }
    if (value === '--json-out' || value === '--max-mib') {
      index += 1;
      continue;
    }
    if (value.startsWith('--json-out=') || value.startsWith('--max-mib=') || value.startsWith('-')) {
      continue;
    }
    return value;
  }
  return null;
}

export function parseCli(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error('必须指定命令；本工具不会默认执行联网的 dynamic-run。');
  }

  const [command, ...originalArgs] = argv;
  if (command === '--help' || command === '-h' || command === 'help') {
    return { command: 'help', args: [] };
  }
  if (!COMMANDS.has(command)) {
    throw new Error(`未知命令：${command}`);
  }

  let args = originalArgs;
  let allowNetwork = false;
  if (command === 'validate-information') {
    allowNetwork = args.includes('--allow-network');
    args = args.filter((value) => value !== '--allow-network');
    const source = informationSource(args);
    const isUrl = typeof source === 'string' && /^https?:\/\//i.test(source);
    const isManifest =
      typeof source === 'string' && ['.csv', '.xlsx'].includes(path.extname(source).toLowerCase());
    if ((isUrl || isManifest) && !allowNetwork) {
      throw new Error(
        'validate-information 的 URL/CSV/XLSX 输入可能联网；如确实需要，请显式加 --allow-network。'
      );
    }
  }

  if (command === 'setup' || command === 'doctor' || command === 'smoke') {
    requireArgumentCount(command, args, 0);
  } else if (command === 'validate-traces' || command === 'validate-information') {
    requireArgumentCount(command, args, 1, null);
  } else if (command === 'dynamic-check') {
    requireArgumentCount(command, args, 2);
  } else if (command === 'dynamic-run') {
    if (!explicitOutputPath(args)) {
      throw new Error('dynamic-run 必须显式指定 --output 报告路径。');
    }
    requireArgumentCount(command, args, 3, null);
  }

  return allowNetwork ? { command, args, allowNetwork: true } : { command, args };
}

export function buildPythonInvocation(parsed, paths) {
  const { command, args } = parsed;
  if (command === 'validate-traces') {
    return {
      executable: paths.venvPython,
      args: [paths.genaiMain, ...args],
      network: false,
    };
  }
  if (command === 'validate-information') {
    return {
      executable: paths.venvPython,
      args: [paths.informationValidator, ...args],
      network: parsed.allowNetwork === true,
    };
  }
  if (command === 'dynamic-check') {
    return {
      executable: paths.venvPython,
      args: [paths.dynamicRunner, 'check', ...args],
      network: false,
    };
  }
  if (command === 'dynamic-run') {
    return {
      executable: paths.venvPython,
      args: [paths.dynamicRunner, 'run', ...args],
      network: true,
    };
  }
  throw new Error(`命令 ${command} 不是 Python 子命令。`);
}

function normalizedPackageName(value) {
  return value.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

export function checkPinnedDependencies(requirementsText, versions) {
  const expected = {};
  for (const rawLine of String(requirementsText).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_.-]+)==([^\s;]+)$/);
    if (match) {
      expected[normalizedPackageName(match[1])] = match[2];
    }
  }

  const mismatches = [];
  for (const [name, expectedVersion] of Object.entries(expected)) {
    const actualVersion = versions?.[name];
    if (actualVersion !== expectedVersion) {
      mismatches.push(`${name}: 期望 ${expectedVersion}，实际 ${actualVersion || '未安装'}`);
    }
  }
  if (Object.keys(expected).length === 0) {
    mismatches.push('requirements.txt 中没有可校验的 == 锁定版本');
  }
  return { ok: mismatches.length === 0, expected, mismatches };
}

export function buildChildEnvironment(paths, baseEnv = process.env) {
  return {
    ...baseEnv,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    UV_CACHE_DIR: paths.uvCacheDir,
  };
}

function runProcess(executable, args, { inherit = false, paths = resolveToolPaths() } = {}) {
  const result = spawnSync(executable, args, {
    cwd: DEFAULT_PROJECT_ROOT,
    env: buildChildEnvironment(paths),
    encoding: inherit ? undefined : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    stdio: inherit ? 'inherit' : 'pipe',
  });
  return result;
}

function readableFile(filePath) {
  try {
    accessSync(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function requiredSourceFiles(paths) {
  return [
    ['Trace 校验器', paths.genaiMain],
    ['Trace 校验器依赖', paths.requirements],
    ['information 校验器', paths.informationValidator],
    ['动态评测 runner', paths.dynamicRunner],
    ['有效 Trace 示例', paths.validTrace],
    ['information 示例', paths.informationExample],
  ];
}

function compactChildFailure(result) {
  if (result.error) {
    return result.error.message;
  }
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  return stderr || stdout || `子进程退出码 ${String(result.status)}`;
}

function assertChildSuccess(result, action) {
  if (result.error || result.status !== 0) {
    throw new Error(`${action}失败：${compactChildFailure(result)}`);
  }
}

function inspectInstallation(paths) {
  const sourceChecks = requiredSourceFiles(paths).map(([name, filePath]) => ({
    name,
    path: filePath,
    ok: readableFile(filePath),
  }));
  const pythonReadable = readableFile(paths.venvPython);
  let versions = null;
  let versionCheck = null;
  let dependencyError = null;

  if (pythonReadable) {
    const dependencyCheck = runProcess(
      paths.venvPython,
      [
        '-c',
        'import json, pydantic, yaml; print(json.dumps({"python": __import__("platform").python_version(), "pydantic": pydantic.__version__, "pyyaml": yaml.__version__}))',
      ],
      { paths }
    );
    if (dependencyCheck.status === 0) {
      try {
        versions = JSON.parse(dependencyCheck.stdout.trim());
        const requirementsText = readFileSync(paths.requirements, 'utf8');
        versionCheck = checkPinnedDependencies(requirementsText, versions);
        if (!versionCheck.ok) {
          dependencyError = versionCheck.mismatches.join('；');
        }
      } catch (error) {
        dependencyError = `无法核对依赖版本：${error.message}`;
      }
    } else {
      dependencyError = compactChildFailure(dependencyCheck);
    }
  }

  return {
    ready:
      sourceChecks.every((item) => item.ok) &&
      pythonReadable &&
      versions !== null &&
      versionCheck?.ok === true,
    platform: `${process.platform}/${process.arch}`,
    attachmentsDir: paths.attachmentsDir,
    runtimeDir: paths.runtimeDir,
    sourceChecks,
    python: {
      path: paths.venvPython,
      ok: pythonReadable,
      versions,
      versionCheck,
      error: dependencyError,
    },
  };
}

function printDoctor(report) {
  console.log(`平台：${report.platform}`);
  console.log(`原始附件（只读使用）：${report.attachmentsDir}`);
  console.log(`隔离运行目录：${report.runtimeDir}`);
  for (const item of report.sourceChecks) {
    console.log(`${item.ok ? '✓' : '✗'} ${item.name}：${item.path}`);
  }
  console.log(`${report.python.ok ? '✓' : '✗'} Python 虚拟环境：${report.python.path}`);
  if (report.python.versions && report.python.versionCheck?.ok) {
    const { python, pydantic, pyyaml } = report.python.versions;
    console.log(`✓ 依赖：Python ${python}, pydantic ${pydantic}, PyYAML ${pyyaml}`);
  } else if (report.python.error) {
    console.log(`✗ 依赖：${report.python.error}`);
  }
  console.log(report.ready ? '结论：工具链已就绪。' : '结论：工具链未就绪，请先执行 setup。');
}

function setup(paths) {
  const missing = requiredSourceFiles(paths).filter(([, filePath]) => !readableFile(filePath));
  if (missing.length > 0) {
    throw new Error(`下载附件不完整，缺少：${missing.map(([name]) => name).join('、')}`);
  }

  mkdirSync(paths.runtimeDir, { recursive: true, mode: 0o700 });
  if (!readableFile(paths.venvPython)) {
    console.log(`正在创建隔离环境：${paths.venvDir}`);
    const createResult = runProcess(
      paths.uvBin,
      ['venv', '--python', paths.bootstrapPython, paths.venvDir],
      { inherit: true, paths }
    );
    assertChildSuccess(createResult, '创建 Python 虚拟环境');
  }

  console.log('正在按下载包的锁定版本安装依赖……');
  const installResult = runProcess(
    paths.uvBin,
    ['pip', 'install', '--python', paths.venvPython, '--requirement', paths.requirements],
    { inherit: true, paths }
  );
  assertChildSuccess(installResult, '安装比赛工具依赖');

  const report = inspectInstallation(paths);
  printDoctor(report);
  if (!report.ready) {
    throw new Error('安装命令结束，但 doctor 仍未通过。');
  }
}

function runSmoke(paths) {
  const doctor = inspectInstallation(paths);
  if (!doctor.ready) {
    printDoctor(doctor);
    throw new Error('工具链未就绪，无法执行 smoke；请先执行 setup。');
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'codex-competition-smoke-'));
  const invalidTrace = path.join(tempDir, 'invalid-trace.json');
  writeFileSync(invalidTrace, '{\n', { encoding: 'utf8', mode: 0o600 });

  try {
    const cases = [
      {
        name: '有效 Trace 正例',
        expectedStatus: 0,
        invocation: {
          executable: paths.venvPython,
          args: [paths.genaiMain, paths.validTrace, '--format', 'json'],
        },
      },
      {
        name: '非法 Trace 反例（必须被拒绝）',
        expectedStatus: 1,
        invocation: {
          executable: paths.venvPython,
          args: [paths.genaiMain, invalidTrace, '--format', 'json'],
        },
      },
      {
        name: 'information.json 格式正例',
        expectedStatus: 0,
        invocation: {
          executable: paths.venvPython,
          args: [paths.informationValidator, paths.informationExample, '--json'],
        },
      },
      {
        name: '动态评测离线 check（不调用 API）',
        expectedStatus: 0,
        invocation: {
          executable: paths.venvPython,
          args: [paths.dynamicRunner, 'check', paths.informationExample, paths.validTrace],
        },
      },
    ];

    const failures = [];
    for (const item of cases) {
      const result = runProcess(item.invocation.executable, item.invocation.args, { paths });
      const ok = !result.error && result.status === item.expectedStatus;
      console.log(`${ok ? '✓' : '✗'} ${item.name}`);
      if (!ok) {
        failures.push(`${item.name}：${compactChildFailure(result)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`smoke 未通过：\n${failures.join('\n')}`);
    }
    console.log('结论：4/4 个安全离线用例通过。');
  } finally {
    const safePrefix = `${path.resolve(os.tmpdir())}${path.sep}`;
    const resolvedTempDir = path.resolve(tempDir);
    if (resolvedTempDir.startsWith(safePrefix) && path.basename(resolvedTempDir).startsWith('codex-competition-smoke-')) {
      rmSync(resolvedTempDir, { recursive: true, force: true });
    }
  }
}

function printHelp() {
  console.log(`比赛附件 Mac 工具链

用法：
  node tools/competition-tools.mjs setup
  node tools/competition-tools.mjs doctor
  node tools/competition-tools.mjs smoke
  node tools/competition-tools.mjs validate-traces <trace...> [--format text|json|jsonl]
  node tools/competition-tools.mjs validate-information <information.json> [--json] [--allow-network]
  node tools/competition-tools.mjs dynamic-check <information.json> <trace.json>
  node tools/competition-tools.mjs dynamic-run <information.json> <trace.json> --output <report.json> [--timeout 30]

安全约束：
  - setup/doctor/smoke/dynamic-check 不调用参赛 API。
  - validate-information 默认只允许本地 JSON；URL/CSV/XLSX 必须显式加 --allow-network。
  - 只有 dynamic-run 或显式加 --allow-network 才会允许联网。
  - dynamic-run 必须显式指定 --output，避免意外覆盖当前目录文件。

可选环境变量：
  COMPETITION_ATTACHMENTS_DIR
  COMPETITION_TOOLS_RUNTIME_DIR
  COMPETITION_BOOTSTRAP_PYTHON
  COMPETITION_UV_BIN`);
}

export function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    console.error(`错误：${error.message}`);
    printHelp();
    return 2;
  }

  if (parsed.command === 'help') {
    printHelp();
    return 0;
  }

  const paths = resolveToolPaths();
  try {
    if (parsed.command === 'setup') {
      setup(paths);
      return 0;
    }
    if (parsed.command === 'doctor') {
      const report = inspectInstallation(paths);
      printDoctor(report);
      return report.ready ? 0 : 1;
    }
    if (parsed.command === 'smoke') {
      runSmoke(paths);
      return 0;
    }

    if (!readableFile(paths.venvPython)) {
      throw new Error(`未找到隔离 Python 环境：${paths.venvPython}；请先执行 setup。`);
    }
    const invocation = buildPythonInvocation(parsed, paths);
    if (invocation.network) {
      const message =
        parsed.command === 'dynamic-run'
          ? '提示：已显式进入 dynamic-run，将按 information.json 调用参赛 API。'
          : '提示：输入是 HTTP(S) URL，校验器将下载该 information.json。';
      console.error(message);
    }
    const result = runProcess(invocation.executable, invocation.args, { inherit: true, paths });
    if (result.error) {
      throw new Error(`无法启动子进程：${result.error.message}`);
    }
    return Number.isInteger(result.status) ? result.status : 1;
  } catch (error) {
    console.error(`错误：${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILE) {
  process.exitCode = main();
}
