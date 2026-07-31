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

// 本地成片旁白以参赛成品叙事为准；缺省回退 demo-plan.json
const LOCAL_NARRATION = {
  opening:
    '系统把衰减发现、实验评估、影子验证、人工审批和回滚，串成策略进化中枢。',
  'core-metrics':
    '首屏看偏差改善、日胜率和可信度，指标来自真实回测，不是写死演示数字。',
  'open-evolution':
    '进入策略进化中枢。发现近窗衰减后自动拉起挑战者，而不是静默沿用旧策略。',
  'champion-challenger':
    '对照冠军与挑战者：版本、参数、改善差额和近窗漂移一目了然。',
  'experiment-lab':
    '实验中心完成漂移诊断、参数搜索和滚动回测，候选策略进入影子运行。',
  'ops-and-governance':
    '运营盯漂移与回撤；治理要求影子通过、人工审批和一键回滚，禁止自动上线申报。',
  'approve-challenger':
    '人工审批挑战者上线，只切换策略版本，不会自动提交申报。',
  'return-declaration':
    '回到申报优化主视图。九十六点曲线和人工复核仍在，与进化中枢共用证据链。',
  curve:
    '逐点比较历史申报与人工智能建议，标出关键调整窗口。',
  'human-loop':
    '人工智能只生成建议，进入申报前必须人工复核，不会自动提交。',
  'audit-mode':
    '审计模式复核模型、执行、结算是否同一主体、同一交易日。',
};

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
  plan.steps = plan.steps.map((step) => ({
    ...step,
    narration: LOCAL_NARRATION[step.id] || step.narration,
  }));
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
  if (!args.smoke && skeleton.durationMs > 130_000) {
    throw new Error(`计划时长异常：${skeleton.durationMs}ms`);
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
