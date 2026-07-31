import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTimedCaptionCues } from './lib/video-production.mjs';

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

export function selectRecordingSegments(skeleton) {
  return skeleton.segments;
}

export function remainingHoldMs(plannedMs, elapsedMs) {
  return Math.max(0, Math.round(Number(plannedMs) - Number(elapsedMs)));
}

function buildRunCode(segment, step, { smoke = false } = {}) {
  const payload = JSON.stringify({
    segment,
    step,
    captionCues: buildTimedCaptionCues({
      ...segment,
      durationMs: smoke
        ? Math.min(1200, segment.endMs - segment.startMs)
        : step?.holdMs ?? segment.endMs - segment.startMs,
    }, { minimumCueMs: smoke ? 1 : 1200 }),
    replayWorkbenchMotion: shouldReplayWorkbenchMotion(segment.id),
    holdMs: smoke
      ? Math.min(1200, segment.endMs - segment.startMs)
      : step?.holdMs ?? segment.endMs - segment.startMs,
  });
  return `async (page) => {
    const payload = ${payload};
    const { segment, step, captionCues, holdMs, replayWorkbenchMotion } = payload;
    const segmentStartedAt = Date.now();
    const waitForRemainingHold = async () => {
      const remaining = Math.max(0, holdMs - (Date.now() - segmentStartedAt));
      if (remaining > 0) await page.waitForTimeout(remaining);
    };
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
            position: fixed; z-index: 2147483646; left: 50%; bottom: 50px;
            width: min(1440px, calc(100vw - 240px)); max-width: 1440px;
            transform: translate(-50%, 8px); opacity: 0;
            padding: 24px 34px 25px; border-radius: 18px;
            color: #fff; background: rgba(7,25,48,.92);
            border: 1px solid rgba(112,196,255,.28);
            box-shadow: 0 24px 70px rgba(0,18,42,.34);
            font: 650 36px/1.42 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            letter-spacing: .01em; text-align: center; white-space: normal;
            pointer-events: none; backdrop-filter: blur(24px) saturate(1.15);
            transition: opacity .18s ease, transform .22s ease;
          }
          #local-demo-caption.visible { opacity: 1; transform: translate(-50%, 0); }
          #local-demo-caption strong {
            display: block; margin: 0 0 7px; color: #7fc5ff; font-size: 15px;
            letter-spacing: .16em; line-height: 1.2;
          }
          .local-demo-caption-keyword {
            color: #7ce7d8; font-weight: 800;
            text-shadow: 0 0 24px rgba(58,221,199,.28);
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
          #local-demo-card .impact {
            margin-top: 28px; color: #087c70;
            font: 800 52px/1.1 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            letter-spacing: -.035em;
          }
          #local-demo-card .impact small {
            display: block; margin-top: 8px; color: #53728f;
            font: 650 15px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            letter-spacing: .04em;
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
        window.__localDemoVideo = {
          badge,
          chapter,
          caption,
          cursor,
          card,
          camera: { transform: { scale: 1, x: 0, y: 0 }, exit: 'reset' },
        };
      });
    };
    const showText = async () => {
      await page.evaluate(({ captionCues, step }) => {
        const ui = window.__localDemoVideo;
        const keywords = ['633.6万元', '2.4万元', '52.8万元', '96 点', '九十六点', '人工审批', '实时并行验证', '不参与真实申报'];
        const renderCue = (cue) => {
          ui.caption.classList.remove('visible');
          setTimeout(() => {
            ui.caption.replaceChildren();
            const label = document.createElement('strong');
            label.textContent = 'AI 解说';
            ui.caption.appendChild(label);
            const copy = document.createElement('span');
            let remaining = cue.text;
            while (remaining) {
              const matches = keywords
                .map((keyword) => ({ keyword, index: remaining.indexOf(keyword) }))
                .filter((item) => item.index >= 0)
                .sort((a, b) => a.index - b.index || b.keyword.length - a.keyword.length);
              const match = matches[0];
              if (!match) {
                copy.appendChild(document.createTextNode(remaining));
                break;
              }
              if (match.index > 0) copy.appendChild(document.createTextNode(remaining.slice(0, match.index)));
              const mark = document.createElement('span');
              mark.className = 'local-demo-caption-keyword';
              mark.textContent = match.keyword;
              copy.appendChild(mark);
              remaining = remaining.slice(match.index + match.keyword.length);
            }
            ui.caption.appendChild(copy);
            ui.caption.classList.add('visible');
          }, 180);
        };
        for (const cue of captionCues) setTimeout(() => renderCue(cue), cue.startMs);
        if (step?.chapter) {
          ui.chapter.textContent = step.chapter;
          ui.chapter.classList.add('visible');
          setTimeout(() => ui.chapter.classList.remove('visible'), 1800);
        }
      }, { captionCues, step });
    };
    const showCard = async (kind) => {
      await page.evaluate(({ kind }) => {
        const ui = window.__localDemoVideo;
        const intro = kind === 'intro';
        ui.card.innerHTML = intro
          ? '<div class="inner"><div class="eyebrow">AI ELECTRICITY TRADING COPILOT</div><h1>让每一次申报，更接近真实需求</h1><p>AI协助交易员完成数据校验、预测、九十六点申报优化、人工复核和结算回流。</p><div class="impact">¥6,336,000<small>年度节约潜力 · 按当前演示交易规模等比例测算</small></div><div class="flow"><span>减少申报偏差</span><span>降低交易成本</span><span>每笔节约可核算</span></div></div>'
          : '<div class="inner"><div class="eyebrow">AI COMPUTES · HUMAN DECIDES</div><h1>让每一次申报，更省、更稳、更有依据</h1><p>AI负责计算与解释，交易员负责最终决策。所有建议都保留数据来源、成本口径、人工审批与版本回滚记录。</p><div class="flow"><span>可执行</span><span>可解释</span><span>可复核</span><span>可追溯</span></div></div>';
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
    const resetCameraIfNeeded = async () => {
      await page.evaluate(async () => {
        const ui = window.__localDemoVideo;
        const workbenchRoot = document.querySelector('#workbenchRoot');
        if (!workbenchRoot) throw new Error('camera target not found: #workbenchRoot');
        const shouldConnect = ui.camera.exit === 'connect';
        if (shouldConnect) return;
        const current = ui.camera.transform;
        if (current.scale === 1 && current.x === 0 && current.y === 0) return;
        const from = 'translate3d(' + current.x + 'px,' + current.y + 'px,0) scale(' + current.scale + ')';
        const to = 'translate3d(0px,0px,0) scale(1)';
        workbenchRoot.style.transformOrigin = '0 0';
        const animation = workbenchRoot.animate(
          [{ transform: from }, { transform: to }],
          { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' }
        );
        await animation.finished;
        workbenchRoot.style.transform = to;
        animation.cancel();
        ui.camera.transform = { scale: 1, x: 0, y: 0 };
      });
    };
    const applyCamera = async (camera) => {
      let focus;
      try {
        focus = await resolveLocator(camera.focus);
      } catch (error) {
        throw new Error('camera target not found: ' + JSON.stringify(camera.focus));
      }
      await focus.waitFor({ state: 'visible', timeout: step.timeoutMs });
      await focus.evaluate((element) => {
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      });
      await page.waitForTimeout(500);
      const box = await focus.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) {
        throw new Error('camera target not found: empty bounding box');
      }
      return page.evaluate(async ({ camera, box }) => {
        const ui = window.__localDemoVideo;
        const workbenchRoot = document.querySelector('#workbenchRoot');
        if (!workbenchRoot) throw new Error('camera target not found: #workbenchRoot');
        const current = ui.camera.transform;
        const natural = {
          x: (box.x - current.x) / current.scale,
          y: (box.y - current.y) / current.scale,
          width: box.width / current.scale,
          height: box.height / current.scale,
        };
        const focusX = natural.x + natural.width / 2;
        const focusY = natural.y + natural.height / 2;
        const rawX = innerWidth / 2 - focusX * camera.scale;
        const rawY = innerHeight / 2 - focusY * camera.scale;
        const next = {
          scale: camera.scale,
          x: Math.min(0, Math.max(innerWidth - innerWidth * camera.scale, rawX)),
          y: Math.min(0, Math.max(innerHeight - innerHeight * camera.scale, rawY)),
        };
        const css = (value) =>
          'translate3d(' + value.x + 'px,' + value.y + 'px,0) scale(' + value.scale + ')';
        workbenchRoot.style.transformOrigin = '0 0';
        workbenchRoot.style.willChange = 'transform, filter';
        const blurPx = Math.min(1, camera.motionBlur * 4);
        const animation = workbenchRoot.animate(
          [
            { transform: css(current), filter: 'blur(0px)' },
            { offset: .55, filter: 'blur(' + blurPx + 'px)' },
            { transform: css(next), filter: 'blur(0px)' },
          ],
          { duration: camera.enterMs, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' }
        );
        await animation.finished;
        workbenchRoot.style.transform = css(next);
        workbenchRoot.style.filter = 'none';
        animation.cancel();
        ui.camera = { transform: next, exit: camera.exit };
        return { ...next, focus: camera.focus, enterMs: camera.enterMs, exit: camera.exit };
      }, { camera, box });
    };

    await ensureOverlay();
    await showText();
    if (segment.id === 'intro' || segment.id === 'outro') {
      await showCard(segment.id);
      await waitForRemainingHold();
      if (segment.id === 'intro') {
        await page.evaluate(() => window.__localDemoVideo.card.classList.remove('visible'));
      }
      return { id: segment.id, status: 'completed' };
    }

    await page.evaluate(() => window.__localDemoVideo.card.classList.remove('visible'));
    await resetCameraIfNeeded();
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
    const camera = await applyCamera(step.camera);
    await waitForRemainingHold();
    return { id: segment.id, status: 'completed', camera };
  }`;
}

export function buildRunCodeForTest(segment, step, options = {}) {
  return buildRunCode(segment, step, options);
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
    const sourceSegments = selectRecordingSegments(skeleton, { smoke });
    for (const source of sourceSegments) {
      const step = plan.steps.find((candidate) => candidate.id === source.id);
      const segmentStart = Date.now() - recordingStart;
      const record = {
        ...source,
        startMs: segmentStart,
        endMs: null,
        status: 'running',
        camera: step?.camera || null,
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
