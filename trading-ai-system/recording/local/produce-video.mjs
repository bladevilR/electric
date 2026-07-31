import { spawn } from 'node:child_process';
import {
  appendFile,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  buildOutputPaths,
  buildTimelineSkeleton,
  validateProductionConfig,
} from './lib/video-production.mjs';
import { recordBrowserVideo } from './record-browser-video.mjs';
import { renderNarration } from './render-narration.mjs';
import { probeMedia, renderFinalVideo } from './render-final.mjs';

function parseArgs(argv) {
  const result = { stage: 'all', port: 5197, smoke: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--smoke') {
      result.smoke = true;
      continue;
    }
    if (argument === '--stage' || argument === '--port') {
      result[argument.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  result.port = Number(result.port);
  return result;
}

function smokeOutputPaths(paths) {
  const root = path.join(paths.root, 'smoke');
  return {
    root,
    rawVideo: path.join(root, 'raw', 'browser-recording.webm'),
    timeline: path.join(root, 'timeline.json'),
    subtitles: path.join(root, 'subtitles.srt'),
    narrationDirectory: path.join(root, 'narration'),
    narrationAudio: path.join(root, 'narration.wav'),
    finalVideo: path.join(root, 'smoke.mp4'),
    log: path.join(root, 'production.log'),
    screenshots: path.join(root, 'acceptance'),
  };
}

async function waitForHealth(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();
      if (response.ok && data.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`本地服务未就绪：${lastError}`);
}

async function startServer(projectRoot, port, log) {
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  try {
    await waitForHealth(healthUrl, 1000);
    log(`复用已运行的本地服务：${healthUrl}`);
    return null;
  } catch {
    // 目标端口没有健康服务，启动当前仓库的真实入口。
  }
  const child = spawn(process.execPath, ['server.mjs', '--port', String(port)], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => log(String(chunk).trimEnd()));
  child.stderr.on('data', (chunk) => log(String(chunk).trimEnd()));
  await waitForHealth(healthUrl);
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    '..'
  );
  const plan = JSON.parse(
    await readFile(path.join(projectRoot, 'recording', 'demo-plan.json'), 'utf8')
  );
  const baseUrl = `http://127.0.0.1:${args.port}${plan.url}`;
  validateProductionConfig({
    baseUrl,
    width: 1920,
    height: 1080,
    fps: 30,
  });
  let paths = buildOutputPaths(projectRoot);
  if (args.smoke) paths = smokeOutputPaths(paths);
  await mkdir(paths.root, { recursive: true });
  await mkdir(path.dirname(paths.rawVideo), { recursive: true });
  await mkdir(paths.screenshots, { recursive: true });
  await writeFile(
    paths.log,
    `[${new Date().toISOString()}] 开始本地演示视频制作\n`,
    'utf8'
  );
  const log = (message) => {
    if (!message) return;
    const line = `[${new Date().toISOString()}] ${message}\n`;
    process.stdout.write(line);
    appendFile(paths.log, line, 'utf8').catch(() => {});
  };
  const skeleton = buildTimelineSkeleton(plan);
  if (
    !args.smoke &&
    (skeleton.durationMs < 215_000 || skeleton.durationMs > 235_000)
  ) {
    throw new Error(
      `计划时长必须在 3:35–3:55：${skeleton.durationMs}ms`
    );
  }

  let server = null;
  try {
    server = await startServer(projectRoot, args.port, log);
    if (['all', 'record'].includes(args.stage)) {
      await unlink(paths.rawVideo).catch(() => {});
      await recordBrowserVideo({
        projectRoot,
        baseUrl,
        plan,
        skeleton,
        rawVideo: paths.rawVideo,
        timelineFile: paths.timeline,
        screenshotDirectory: paths.screenshots,
        log,
        smoke: args.smoke,
      });
      const rawProbe = await probeMedia(paths.rawVideo, {
        cwd: projectRoot,
        log,
      });
      const timeline = JSON.parse(await readFile(paths.timeline, 'utf8'));
      timeline.durationMs = Math.ceil(
        Number.parseFloat(rawProbe.format.duration) * 1000
      );
      timeline.rawMedia = rawProbe;
      await writeFile(paths.timeline, `${JSON.stringify(timeline, null, 2)}\n`);
      log(`浏览器录制完成：${(timeline.durationMs / 1000).toFixed(2)} 秒`);
    }

    if (['all', 'tts'].includes(args.stage)) {
      const timeline = JSON.parse(await readFile(paths.timeline, 'utf8'));
      await renderNarration({
        projectRoot,
        timeline,
        paths,
        log,
      });
      log('TTS、字幕和旁白音轨生成完成');
    }

    let finalProbe = null;
    if (['all', 'final'].includes(args.stage)) {
      finalProbe = await renderFinalVideo({ projectRoot, paths, log });
      await writeFile(
        path.join(paths.root, 'final-probe.json'),
        `${JSON.stringify(finalProbe, null, 2)}\n`,
        'utf8'
      );
      log(`最终成片生成：${paths.finalVideo}`);
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        stage: args.stage,
        smoke: args.smoke,
        finalVideo: paths.finalVideo,
        media: finalProbe,
      })}\n`
    );
  } catch (error) {
    log(`制作失败：${error.stack || error.message}`);
    throw error;
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
