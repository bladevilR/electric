import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const distRoot = path.join(workspaceRoot, 'dist');
const packageName = 'ElectricTradingAI-Desktop-Demo-PRD-20260830';
const outputRoot = path.join(distRoot, packageName);
const legacyOutputRoot = path.join(distRoot, '电力交易AI-桌面模拟演示系统与PRD-20260830');
const systemRoot = path.join(outputRoot, 'Desktop-Demo-System');
const prdRoot = path.join(outputRoot, 'PRD');
const zipPath = path.join(distRoot, '电力交易AI-桌面模拟演示系统与PRD-20260830.zip');
const runtimeSourceZip = path.join(distRoot, 'trading-ai-system-one-minute.zip');

const files = [
  'index.html',
  'app.js',
  'styles.css',
  'workbench.js',
  'workbench-motion.js',
  'workbench.css',
  'server.mjs',
  'run-system.ps1',
  'start-system.ps1',
  'build-data.mjs',
  'data/standard-96.js',
  'data/standard-96.sample.json',
  'data/integration-summary.json',
  'data/audit-log.ndjson',
  'tools/build-integration-summary.py',
  'tools/build-settlement-reference.py',
];

const directories = [
  'assets',
  'vendor',
  'lib',
  'data/business-inputs',
];

async function copyRelative(relativePath) {
  const source = path.join(projectRoot, relativePath);
  if (!existsSync(source)) throw new Error(`缺少系统文件：${relativePath}`);
  const target = path.join(systemRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

async function readPortableNode() {
  const existingRuntime = path.join(outputRoot, 'Desktop-Demo-System', 'runtime', 'node', 'node.exe');
  if (existsSync(existingRuntime)) return readFile(existingRuntime);

  const sourceZip = existsSync(runtimeSourceZip) ? runtimeSourceZip : zipPath;
  if (!existsSync(sourceZip)) {
    throw new Error('缺少已验证的 Windows Node 运行时来源。');
  }
  const entry = sourceZip === runtimeSourceZip
    ? 'runtime/node/node.exe'
    : `${packageName}/Desktop-Demo-System/runtime/node/node.exe`;
  const result = spawnSync('unzip', ['-p', sourceZip, entry], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout?.length) {
    throw new Error('无法从已验证启动包提取 Windows Node 运行时。');
  }
  return result.stdout;
}

async function writePortableNode(runtimeBuffer) {
  const target = path.join(systemRoot, 'runtime', 'node', 'node.exe');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, runtimeBuffer);
}

function createZip() {
  const result = spawnSync('zip', ['-qr', zipPath, packageName], {
    cwd: distRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`zip 打包失败，退出码 ${result.status}`);
}

async function main() {
  const portableNode = await readPortableNode();
  await rm(outputRoot, { recursive: true, force: true });
  await rm(legacyOutputRoot, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(systemRoot, { recursive: true });
  await mkdir(prdRoot, { recursive: true });

  for (const file of files) await copyRelative(file);
  for (const directory of directories) await copyRelative(directory);
  await cp(path.join(projectRoot, '启动系统.bat'), path.join(systemRoot, 'START-SYSTEM.bat'));
  await writePortableNode(portableNode);

  const prdName = '电力交易AI-智能交易副驾驶-产品需求文档PRD-v1.1.docx';
  await cp(
    path.join(projectRoot, 'deliverables', prdName),
    path.join(prdRoot, 'Product-Requirements-Document-v1.1.docx')
  );

  const guide = [
    '电力交易 AI · 桌面模拟演示系统',
    '',
    '启动方式：双击“Desktop-Demo-System\\START-SYSTEM.bat”。',
    '系统会启动本地服务并自动打开浏览器；启动窗口需保持开启。',
    '',
    '推荐演示顺序：',
    '1. 先打开基础数据，说明气象、机组、负荷与电价四类模拟输入均已就绪。',
    '2. 打开价格预测，说明基础数据如何生成 96 点预测并进入申报优化。',
    '3. 在申报优化首页依次点击数据接入、质量校验、申报优化、人工复核、结算评估。',
    '4. 展示 96 点申报曲线、三个重点调整窗口和推导依据。',
    '5. 依次打开策略进化、复盘回顾，最后打开证据抽屉说明计算口径和操作留痕。',
    '',
    '数据说明：比赛演示使用系统内置模拟数据，打开即可完成全流程操作。',
  ].join('\r\n');
  await writeFile(path.join(outputRoot, 'START-HERE.txt'), guide, 'utf8');

  const manifest = {
    name: packageName,
    generatedAt: new Date().toISOString(),
    deliverables: ['Desktop-Demo-System', 'PRD'],
    entry: 'Desktop-Demo-System/START-SYSTEM.bat',
    dataMode: '比赛演示 · 模拟数据 · 全流程采用模拟数据',
    desktopOnly: true,
  };
  await writeFile(path.join(outputRoot, 'package-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const launcher = await readFile(path.join(systemRoot, 'start-system.ps1'), 'utf8');
  if (!launcher.includes('demo=submission&v=20260830-workstation-v12')) {
    throw new Error('启动器未指向最终桌面演示版本。');
  }

  createZip();
  console.log(JSON.stringify({ ok: true, outputRoot, zipPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
