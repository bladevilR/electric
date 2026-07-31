import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      options.onOutput?.(String(chunk));
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      options.onOutput?.(String(chunk));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${path.basename(command)} ${args[0] || ''} 失败（${code}）\n${
            stderr || stdout
          }`
        )
      );
    });
  });
}

export function shouldReplayWorkbenchMotion(segmentId) {
  return segmentId === 'opening';
}

function buildRunCode(segment, step, { smoke = false } = {}) {
  const payload = JSON.stringify({
    segment,
    step,
    replayWorkbenchMotion: shouldReplayWorkbenchMotion(segment.id),
    holdMs: smoke
      ? Math.min(1200, segment.endMs - segment.startMs)
      : step?.holdMs ?? segment.endMs - segment.startMs,
  });
  return `async (page) => {
    const payload = ${payload};
    const { segment, step, holdMs, replayWorkbenchMotion } = payload;
    const ensureOverlay = async () => {
      await page.evaluate(() => {
        if (window.__localDemoVideo) return;
        const style = document.createElement('style');
        style.dataset.localDemoVideo = 'true';
        style.textContent = \`
          #local-demo-badge {
            position: fixed; z-index: 2147483644; right: 28px; top: 24px;
            padding: 9px 15px; border-radius: 999px;
            color: #0b4b85; background: rgba(240,248,255,.94);
            border: 1px solid rgba(24,119,242,.24);
            box-shadow: 0 10px 28px rgba(20,61,102,.14);
            font: 650 15px/1.2 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            backdrop-filter: blur(16px);
          }
          #local-demo-chapter {
            position: fixed; z-index: 2147483645; left: 50%; top: 27px;
            transform: translate(-50%, -12px); opacity: 0;
            padding: 11px 22px; border-radius: 999px;
            color: #0a3d70; background: rgba(255,255,255,.95);
            border: 1px solid rgba(24,119,242,.22);
            box-shadow: 0 14px 36px rgba(20,61,102,.15);
            font: 700 17px/1.2 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            transition: opacity .3s ease, transform .3s ease;
            pointer-events: none; backdrop-filter: blur(16px);
          }
          #local-demo-chapter.visible { opacity: 1; transform: translate(-50%, 0); }
          #local-demo-caption {
            position: fixed; z-index: 2147483646; left: 50%; bottom: 30px;
            width: min(1280px, calc(100vw - 180px)); transform: translateX(-50%);
            padding: 17px 26px 18px; border-radius: 16px;
            color: #fff; background: rgba(5,24,46,.88);
            border: 1px solid rgba(132,196,255,.24);
            box-shadow: 0 18px 48px rgba(0,14,34,.28);
            font: 600 22px/1.55 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            letter-spacing: .01em; text-align: center;
            pointer-events: none; backdrop-filter: blur(16px);
          }
          #local-demo-caption strong {
            margin-right: 13px; color: #7fc5ff; font-size: 14px;
            letter-spacing: .12em; vertical-align: 2px;
          }
          #local-demo-cursor {
            position: fixed; z-index: 2147483647; left: 0; top: 0;
            width: 23px; height: 23px; pointer-events: none;
            transform: translate(-80px,-80px);
            transition: transform .55s cubic-bezier(.22,.8,.24,1);
            filter: drop-shadow(0 4px 8px rgba(10,55,100,.28));
          }
          #local-demo-cursor::before {
            content: ''; position: absolute; inset: 1px;
            background: #126ef6; border: 3px solid #fff;
            clip-path: polygon(0 0, 80% 58%, 48% 64%, 36% 100%);
          }
          #local-demo-cursor.clicking::after {
            content: ''; position: absolute; left: -18px; top: -18px;
            width: 56px; height: 56px; border: 3px solid rgba(18,110,246,.72);
            border-radius: 50%; animation: local-demo-ripple .7s ease-out;
          }
          #local-demo-card {
            position: fixed; z-index: 2147483643; inset: 0;
            display: none; align-items: center; justify-content: center;
            color: #072c52; background:
              radial-gradient(circle at 18% 22%, rgba(55,155,255,.22), transparent 35%),
              radial-gradient(circle at 82% 72%, rgba(48,213,186,.18), transparent 34%),
              linear-gradient(135deg, rgba(248,252,255,.97), rgba(231,243,255,.95));
            backdrop-filter: blur(10px);
          }
          #local-demo-card.visible { display: flex; }
          #local-demo-card .inner {
            width: min(1240px, calc(100vw - 220px)); padding: 70px 80px;
            border-radius: 34px; background: rgba(255,255,255,.82);
            border: 1px solid rgba(42,128,210,.2);
            box-shadow: 0 32px 90px rgba(20,67,113,.18);
          }
          #local-demo-card .eyebrow {
            margin-bottom: 20px; color: #1472d3; font: 750 17px/1.3 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            letter-spacing: .16em;
          }
          #local-demo-card h1 {
            margin: 0; font: 760 56px/1.18 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            letter-spacing: -.025em;
          }
          #local-demo-card p {
            margin: 28px 0 0; max-width: 1000px; color: #355d83;
            font: 520 25px/1.65 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
          }
          #local-demo-card .flow {
            display: flex; gap: 14px; margin-top: 38px; flex-wrap: wrap;
          }
          #local-demo-card .flow span {
            padding: 11px 17px; border-radius: 12px; color: #0a5ba8;
            background: rgba(220,240,255,.85); border: 1px solid rgba(29,128,221,.18);
            font: 680 17px/1.2 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
          }
          @keyframes local-demo-ripple {
            from { opacity: 1; transform: scale(.22); }
            to { opacity: 0; transform: scale(1); }
          }
        \`;
        document.head.appendChild(style);
        const badge = document.createElement('div');
        badge.id = 'local-demo-badge';
        badge.textContent = '本地演示 · 标准样本';
        const chapter = document.createElement('div');
        chapter.id = 'local-demo-chapter';
        const caption = document.createElement('div');
        caption.id = 'local-demo-caption';
        const cursor = document.createElement('div');
        cursor.id = 'local-demo-cursor';
        const card = document.createElement('div');
        card.id = 'local-demo-card';
        document.body.append(badge, chapter, caption, cursor, card);
        window.__localDemoVideo = { badge, chapter, caption, cursor, card };
      });
    };
    const showText = async () => {
      await page.evaluate(({ segment, step }) => {
        const ui = window.__localDemoVideo;
        ui.caption.innerHTML = '<strong>AI 解说</strong>' + segment.narration;
        if (step?.chapter) {
          ui.chapter.textContent = step.chapter;
          ui.chapter.classList.add('visible');
          setTimeout(() => ui.chapter.classList.remove('visible'), 1800);
        }
      }, { segment, step });
    };
    const showCard = async (kind) => {
      await page.evaluate(({ kind }) => {
        const ui = window.__localDemoVideo;
        const intro = kind === 'intro';
        ui.card.innerHTML = intro
          ? '<div class="inner"><div class="eyebrow">ELECTRICITY TRADING AI</div><h1>电力交易 AI · 智能申报决策</h1><p>把数据校验、AI 申报优化、人工复核和审计证据，整合为一条可追溯的决策闭环。</p><div class="flow"><span>数据校验</span><span>模型优化</span><span>人工复核</span><span>审计留痕</span></div></div>'
          : '<div class="inner"><div class="eyebrow">DECISION SUPPORT · HUMAN IN THE LOOP</div><h1>数据、模型、建议、复核、审计</h1><p>用可解释、可复核、可追溯的方式提升申报质量。系统只提供决策支持，未经人工复核不会自动提交。</p><div class="flow"><span>标准样本演示</span><span>不会自动交易</span><span>完整证据链</span></div></div>';
        ui.card.classList.add('visible');
        ui.cursor.style.transform = 'translate(-80px,-80px)';
      }, { kind });
    };
    const resolveLocator = async (locators) => {
      for (const locator of locators || []) {
        const candidate = locator.type === 'css'
          ? page.locator(locator.value).first()
          : page.getByText(locator.value, { exact: Boolean(locator.exact) }).first();
        if (await candidate.count()) return candidate;
      }
      throw new Error('未找到目标元素：' + JSON.stringify(locators));
    };

    await ensureOverlay();
    await showText();
    if (segment.id === 'intro' || segment.id === 'outro') {
      await showCard(segment.id);
      await page.waitForTimeout(holdMs);
      if (segment.id === 'intro') {
        await page.evaluate(() => window.__localDemoVideo.card.classList.remove('visible'));
      }
      return { id: segment.id, status: 'completed' };
    }

    await page.evaluate(() => window.__localDemoVideo.card.classList.remove('visible'));
    if (replayWorkbenchMotion) {
      await page.evaluate(async () => {
        const root = document.querySelector('#workbenchRoot');
        const { startWorkbenchMotion } = await import('/workbench-motion.js');
        startWorkbenchMotion(root, { fullSequence: true });
        root.dataset.recordingMotionReplay = String(Date.now());
      });
    }
    const target = await resolveLocator(step.action.locators);
    await target.waitFor({ state: 'visible', timeout: step.timeoutMs });
    if (step.action.type !== 'show') {
      await target.evaluate((element, align) => {
        element.scrollIntoView({ behavior: 'smooth', block: align || 'center', inline: 'nearest' });
      }, step.action.align || 'center');
      await page.waitForTimeout(850);
    }
    const box = await target.boundingBox();
    if (box) {
      await page.evaluate(({ x, y }) => {
        window.__localDemoVideo.cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      }, {
        x: Math.round(Math.max(18, Math.min(1900, box.x + box.width / 2))),
        y: Math.round(Math.max(18, Math.min(1060, box.y + box.height / 2))),
      });
      await page.waitForTimeout(550);
    }
    if (step.action.type === 'click') {
      await page.evaluate(() => window.__localDemoVideo.cursor.classList.add('clicking'));
      await target.evaluate((element) => element.click());
      await page.waitForTimeout(700);
      await page.evaluate(() => window.__localDemoVideo.cursor.classList.remove('clicking'));
    }
    let ready = null;
    try {
      ready = await resolveLocator(step.ready.locators);
    } catch (error) {
      if (step.ready.state !== 'hidden') throw error;
    }
    if (ready) {
      await ready.waitFor({ state: step.ready.state, timeout: step.timeoutMs });
      if (step.ready.state === 'visible' && step.action.type === 'click') {
        await ready.evaluate((element) => {
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        });
        await page.waitForTimeout(850);
      }
    }
    await page.waitForTimeout(holdMs);
    return { id: segment.id, status: 'completed' };
  }`;
}

async function cli(wrapper, session, args, options) {
  return run(wrapper, [`-s=${session}`, ...args], options);
}

export async function recordBrowserVideo({
  projectRoot,
  baseUrl,
  plan,
  skeleton,
  rawVideo,
  timelineFile,
  screenshotDirectory,
  log,
  smoke = false,
}) {
  const wrapper =
    process.env.PWCLI ||
    '/Users/r/.codex/skills/playwright/scripts/playwright_cli.sh';
  const session = `local-demo-${process.pid}`;
  await mkdir(path.dirname(rawVideo), { recursive: true });
  await mkdir(screenshotDirectory, { recursive: true });
  const timeline = {
    ...skeleton,
    pageUrl: baseUrl,
    status: 'recording',
    startedAt: new Date().toISOString(),
    segments: [],
  };

  try {
    await cli(wrapper, session, ['open', baseUrl], {
      cwd: projectRoot,
    });
    log?.(`浏览器会话已打开：${session}`);
    await cli(wrapper, session, ['resize', '1920', '1080'], {
      cwd: projectRoot,
    });
    await cli(
      wrapper,
      session,
      [
        'run-code',
        'async (page) => { await page.waitForSelector("#declarationDashboardTitle", { state: "visible", timeout: 30000 }); await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}); }',
      ],
      { cwd: projectRoot }
    );
    await cli(
      wrapper,
      session,
      ['video-start', rawVideo, '--size', '1920x1080'],
      { cwd: projectRoot }
    );
    log?.('Playwright 页面级录制已开始');

    const recordingStart = Date.now();
    const sourceSegments = smoke
      ? [skeleton.segments[0], skeleton.segments[1], skeleton.segments.at(-1)]
      : skeleton.segments;
    for (const source of sourceSegments) {
      const step = plan.steps.find((candidate) => candidate.id === source.id);
      const segmentStart = Date.now() - recordingStart;
      const record = {
        ...source,
        startMs: segmentStart,
        endMs: null,
        status: 'running',
      };
      timeline.segments.push(record);
      await writeFile(timelineFile, `${JSON.stringify(timeline, null, 2)}\n`);
      try {
        await cli(
          wrapper,
          session,
          ['run-code', buildRunCode(source, step, { smoke })],
          { cwd: projectRoot }
        );
        record.endMs = Date.now() - recordingStart;
        record.status = 'completed';
        log?.(`镜头完成：${source.id}（${record.endMs - record.startMs}ms）`);
      } catch (error) {
        record.endMs = Date.now() - recordingStart;
        record.status = 'failed';
        record.error = error.message;
        await cli(
          wrapper,
          session,
          ['screenshot', path.join(screenshotDirectory, `failed-${source.id}.png`)],
          { cwd: projectRoot }
        ).catch(() => {});
        throw error;
      } finally {
        await writeFile(timelineFile, `${JSON.stringify(timeline, null, 2)}\n`);
      }
    }
    timeline.durationMs = Date.now() - recordingStart;
    timeline.status = 'completed';
    timeline.completedAt = new Date().toISOString();
    await writeFile(timelineFile, `${JSON.stringify(timeline, null, 2)}\n`);
    await cli(wrapper, session, ['video-stop'], {
      cwd: projectRoot,
    });
    log?.('Playwright 页面级录制已停止');
    return timeline;
  } finally {
    await cli(wrapper, session, ['close'], {
      cwd: projectRoot,
    }).catch(() => {});
  }
}
