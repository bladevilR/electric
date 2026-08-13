import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const systemRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const repoRoot = path.resolve(systemRoot, '..');

const files = [
  'README.md',
  '一分钟上手.html',
  '启动系统.bat',
  '录制比赛视频.bat',
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
  'recording',
  'data/business-inputs',
];

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument.slice(2);
    if (key === 'validate-source-only') {
      result.validateSourceOnly = true;
      continue;
    }
    result[key] = argv[index + 1];
    index += 1;
  }
  return result;
}

function requireSourceLayout() {
  const missing = [
    ...files.map((entry) => path.join(systemRoot, entry)),
    ...directories.map((entry) => path.join(systemRoot, entry)),
  ].filter((entry) => !existsSync(entry));
  if (missing.length) {
    throw new Error(`录制包源文件缺失：${missing.join(', ')}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: options.stdio,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} 执行失败：${result.stderr || result.stdout || result.status}`
    );
  }
  return result;
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function findEntryBySuffix(root, suffix) {
  const entries = await readdir(root, {
    recursive: true,
    withFileTypes: true,
  });
  const normalizedSuffix = suffix.split('/').join(path.sep);
  const match = entries.find(
    (entry) =>
      entry.isFile() &&
      path.join(entry.parentPath || entry.path, entry.name).endsWith(
        normalizedSuffix
      )
  );
  return match
    ? path.join(match.parentPath || match.path, match.name)
    : '';
}

async function copySource(outputRoot) {
  for (const relativePath of files) {
    const target = path.join(outputRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(systemRoot, relativePath), target);
  }
  for (const relativePath of directories) {
    const target = path.join(outputRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(systemRoot, relativePath), target, {
      recursive: true,
      filter: (source) =>
        !source.includes(`${path.sep}recording${path.sep}recordings`),
    });
  }
  const summaryPath = path.join(systemRoot, 'data', 'integration-summary.json');
  if (existsSync(summaryPath)) {
    await cp(
      summaryPath,
      path.join(outputRoot, 'data', 'integration-summary.json')
    );
  }
}

async function extractNodeAndSample(nodeZip, outputRoot) {
  const listing = run('unzip', ['-Z1', nodeZip]).stdout
    .split(/\r?\n/)
    .filter(Boolean);
  const nodeEntry = listing.find((entry) =>
    entry.replaceAll('\\', '/').endsWith('/runtime/node/node.exe')
  );
  const sampleEntry = listing.find((entry) =>
    entry.replaceAll('\\', '/').endsWith('/data/standard-96.sample.json')
  );
  if (!nodeEntry || !sampleEntry) {
    throw new Error('既有启动包缺少 node.exe 或 standard-96.sample.json');
  }
  const nodeBuffer = run('unzip', ['-p', nodeZip, nodeEntry], {
    encoding: null,
  }).stdout;
  const sampleBuffer = run('unzip', ['-p', nodeZip, sampleEntry], {
    encoding: null,
  }).stdout;
  const nodeTarget = path.join(outputRoot, 'runtime', 'node', 'node.exe');
  const sampleTarget = path.join(
    outputRoot,
    'data',
    'standard-96.sample.json'
  );
  await mkdir(path.dirname(nodeTarget), { recursive: true });
  await mkdir(path.dirname(sampleTarget), { recursive: true });
  await writeFile(nodeTarget, nodeBuffer);
  await writeFile(sampleTarget, sampleBuffer);
  return { nodeTarget, sampleTarget };
}

async function extractFfmpeg(ffmpegArchive, outputRoot) {
  const temporaryRoot = path.join(
    repoRoot,
    'dist',
    `.ffmpeg-extract-${process.pid}`
  );
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });
  try {
    run('7z', ['x', '-y', `-o${temporaryRoot}`, ffmpegArchive]);
    const ffmpegSource = await findEntryBySuffix(
      temporaryRoot,
      'bin/ffmpeg.exe'
    );
    const ffprobeSource = await findEntryBySuffix(
      temporaryRoot,
      'bin/ffprobe.exe'
    );
    const licenseSource = await findEntryBySuffix(temporaryRoot, 'LICENSE');
    const readmeSource = await findEntryBySuffix(temporaryRoot, 'README.txt');
    if (!ffmpegSource || !ffprobeSource || !licenseSource || !readmeSource) {
      throw new Error('FFmpeg 归档缺少 ffmpeg.exe、ffprobe.exe 或许可证');
    }
    const runtimeRoot = path.join(outputRoot, 'runtime', 'ffmpeg');
    await mkdir(runtimeRoot, { recursive: true });
    const ffmpegTarget = path.join(runtimeRoot, 'ffmpeg.exe');
    const ffprobeTarget = path.join(runtimeRoot, 'ffprobe.exe');
    await cp(ffmpegSource, ffmpegTarget);
    await cp(ffprobeSource, ffprobeTarget);
    await cp(licenseSource, path.join(runtimeRoot, 'LICENSE'));
    await cp(readmeSource, path.join(runtimeRoot, 'README.txt'));
    await writeFile(
      path.join(runtimeRoot, 'NOTICE.txt'),
      [
        'FFmpeg 8.1.2 essentials build for Windows x64',
        'Build source: https://www.gyan.dev/ffmpeg/builds/',
        'Upstream source: https://ffmpeg.org/',
        'Archive SHA-256: e25b682664025d49034c981afb4bae36238a40f29a3cc1c713ad9a8b5b3528f6',
        'License: GPLv3; see LICENSE and README.txt in this directory.',
        '',
      ].join('\r\n'),
      'utf8'
    );
    return { ffmpegTarget, ffprobeTarget };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireSourceLayout();
  if (args.validateSourceOnly) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, files, directories })}\n`
    );
    return;
  }

  const nodeZip = path.resolve(args['node-zip'] || '');
  const ffmpegArchive = path.resolve(args['ffmpeg-archive'] || '');
  if (!args['node-zip'] || !existsSync(nodeZip)) {
    throw new Error('必须用 --node-zip 指定已验证的 Windows 启动包');
  }
  if (!args['ffmpeg-archive'] || !existsSync(ffmpegArchive)) {
    throw new Error('必须用 --ffmpeg-archive 指定已校验的 FFmpeg 归档');
  }
  const ffmpegArchiveHash = await hashFile(ffmpegArchive);
  const expectedFfmpegHash =
    'e25b682664025d49034c981afb4bae36238a40f29a3cc1c713ad9a8b5b3528f6';
  if (ffmpegArchiveHash !== expectedFfmpegHash) {
    throw new Error(
      `FFmpeg 归档 SHA-256 不匹配：${ffmpegArchiveHash}`
    );
  }

  const outputRoot = path.resolve(
    args.output ||
      path.join(repoRoot, 'dist', 'trading-ai-system-windows-auto-recording')
  );
  const zipPath = `${outputRoot}.zip`;
  await rm(outputRoot, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(outputRoot, { recursive: true });
  await copySource(outputRoot);
  const { nodeTarget } = await extractNodeAndSample(nodeZip, outputRoot);
  const { ffmpegTarget, ffprobeTarget } = await extractFfmpeg(
    ffmpegArchive,
    outputRoot
  );

  const manifest = {
    name: 'trading-ai-system-windows-auto-recording',
    title: '电力交易 AI · Windows 一键启动与自动录制包',
    generatedAt: new Date().toISOString(),
    entries: {
      start: '启动系统.bat',
      record: '录制比赛视频.bat',
      guide: 'recording/录制说明.html',
    },
    runtime: {
      node: {
        path: 'runtime/node/node.exe',
        sha256: await hashFile(nodeTarget),
      },
      ffmpeg: {
        version: '8.1.2 essentials',
        path: 'runtime/ffmpeg/ffmpeg.exe',
        sha256: await hashFile(ffmpegTarget),
      },
      ffprobe: {
        version: '8.1.2 essentials',
        path: 'runtime/ffmpeg/ffprobe.exe',
        sha256: await hashFile(ffprobeTarget),
      },
    },
    safety: [
      '不包含浏览器登录态、Cookie、Token、证书私钥或 UKey PIN。',
      '自动演示不点击申报提交或交易按钮。',
      'TTS 解说与画面分离，原始录屏不会被覆盖。',
    ],
  };
  await writeFile(
    path.join(outputRoot, 'package-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  run('zip', ['-qr', '-1', zipPath, '.'], { cwd: outputRoot });
  run('unzip', ['-tq', zipPath]);
  const zipStats = await stat(zipPath);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        outputRoot,
        zipPath,
        zipSizeBytes: zipStats.size,
        zipSha256: await hashFile(zipPath),
        runtime: manifest.runtime,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
