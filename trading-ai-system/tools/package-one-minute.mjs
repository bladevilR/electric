import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const systemRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(systemRoot, '..');
const outputRoot = path.join(repoRoot, 'dist', 'trading-ai-system-one-minute');
const zipPath = `${outputRoot}.zip`;
const sampleStandardPath = path.join(
  repoRoot,
  'jspec-capture',
  'output',
  'session-20260507-101645',
  'standard',
  'standard-96.json'
);

const files = [
  '.env.production.example',
  'README.md',
  '一分钟上手.html',
  '启动系统.bat',
  'index.html',
  'app.js',
  'styles.css',
  'workbench.js',
  'workbench.css',
  'server.mjs',
  'run-system.ps1',
  'start-system.ps1',
  'build-data.mjs',
];

const directories = [
  'assets',
  'lib',
  'docs',
  'tools',
  'data/business-inputs',
];

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function copyFileIfExists(relativePath) {
  const source = path.join(systemRoot, relativePath);
  if (!existsSync(source)) return;
  const target = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}

async function copyDirectoryIfExists(relativePath) {
  const source = path.join(systemRoot, relativePath);
  if (!existsSync(source)) return;
  const target = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

async function copyRuntimeNode() {
  const candidates = [
    path.join(systemRoot, 'runtime', 'node', 'node.exe'),
    path.join(
      process.env.USERPROFILE || '',
      '.cache',
      'codex-runtimes',
      'codex-primary-runtime',
      'dependencies',
      'node',
      'bin',
      'node.exe'
    ),
  ];
  const source = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!source) return false;
  const target = path.join(outputRoot, 'runtime', 'node', 'node.exe');
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
  return true;
}

async function main() {
  await rm(outputRoot, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const file of files) {
    await copyFileIfExists(file);
  }
  for (const directory of directories) {
    await copyDirectoryIfExists(directory);
  }

  await copyFileIfExists('data/integration-summary.json');
  if (existsSync(sampleStandardPath)) {
    await mkdir(path.join(outputRoot, 'data'), { recursive: true });
    await cp(sampleStandardPath, path.join(outputRoot, 'data', 'standard-96.sample.json'));
  }

  const hasRuntime = await copyRuntimeNode();
  const manifest = {
    name: 'trading-ai-system-one-minute',
    title: '电力交易策略助手 - 一分钟上手包',
    generatedAt: new Date().toISOString(),
    entry: '一分钟上手.html',
    launcher: '启动系统.bat',
    presentBy: 'Si hang',
    includesNodeRuntime: hasRuntime,
    notes: [
      '本包不包含本机浏览器登录态、Cookie、Token、证书私钥或 UKey PIN。',
      '启动后保持 UKey、数据窗口和本地服务打开。',
      '系统不会自动提交申报或交易。',
    ],
  };
  await writeFile(
    path.join(outputRoot, 'package-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  const guide = await readFile(path.join(outputRoot, '一分钟上手.html'), 'utf8');
  if (!guide.includes('present by Si hang')) {
    throw new Error('Missing present by Si hang signature in guide.');
  }

  const command = [
    '$ErrorActionPreference = "Stop"',
    `if (Test-Path -LiteralPath ${psQuote(zipPath)}) { Remove-Item -LiteralPath ${psQuote(zipPath)} -Force }`,
    `Compress-Archive -Path ${psQuote(path.join(outputRoot, '*'))} -DestinationPath ${psQuote(zipPath)} -Force`,
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Compress-Archive failed with exit code ${result.status}`);
  }

  console.log(JSON.stringify({ ok: true, outputRoot, zipPath, includesNodeRuntime: hasRuntime }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
