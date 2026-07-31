import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { buildTtsAssets } from './lib/demo-plan.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) continue;
    result[argument.slice(2)] = argv[index + 1];
  }
  return result;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plan || !args.timeline || !args.output) {
    throw new Error('用法：--plan <分镜.json> --timeline <实际时间线.json> --output <目录>');
  }
  const outputDirectory = path.resolve(args.output);
  const [plan, timeline] = await Promise.all([
    readJson(path.resolve(args.plan)),
    readJson(path.resolve(args.timeline)),
  ]);
  const assets = buildTtsAssets(plan, timeline);
  if (assets.segmentCount === 0) {
    throw new Error('实际时间线中没有成功完成的分镜，无法生成配音资产');
  }
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, '解说稿.txt'), assets.script, 'utf8'),
    writeFile(path.join(outputDirectory, '配音.ssml'), assets.ssml, 'utf8'),
    writeFile(path.join(outputDirectory, '字幕.srt'), assets.srt, 'utf8'),
  ]);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      segmentCount: assets.segmentCount,
      outputDirectory,
    })}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
