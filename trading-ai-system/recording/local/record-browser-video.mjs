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

function buildRunCode(segment, step, { smoke = false, disableCamera = false } = {}) {
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
    // 交给 OpenScreen / Screen Studio 做后处理运镜时，禁止 DOM scale 空推
    disableCamera: Boolean(disableCamera),
  });
  return `async (page) => {
    const payload = ${payload};
    const { segment, step, captionCues, holdMs, replayWorkbenchMotion, disableCamera } = payload;
    // hold 时钟在页面就绪后启动：避免点击/滚动吃掉旁白时长，导致段尾 3–5 秒空静音
    let segmentStartedAt = Date.now();
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
            position: fixed; z-index: 2147483646; left: 50%; bottom: 118px;
            width: min(1440px, calc(100vw - 240px)); max-width: 1440px;
            transform: translate(-50%, 8px); opacity: 0;
            padding: 16px 32px 17px; border-radius: 18px;
            color: #fff; background: rgba(7,25,48,.92);
            border: 1px solid rgba(112,196,255,.28);
            box-shadow: 0 24px 70px rgba(0,18,42,.34);
            font: 650 36px/1.42 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            letter-spacing: .01em; text-align: center; white-space: normal;
            pointer-events: none; backdrop-filter: blur(24px) saturate(1.15);
            transition: opacity .18s ease, transform .22s ease;
          }
          #local-demo-caption.visible { opacity: 1; transform: translate(-50%, 0); }
          .local-demo-caption-keyword {
            color: #7ce7d8; font-weight: 800;
            text-shadow: 0 0 24px rgba(58,221,199,.28);
          }
          /* 录制态：隐藏「当前不可执行」等评委易误解文案，仅展示优化结果 */
          body.local-demo-recording .decision-state strong,
          body.local-demo-recording .decision-state .status-badge {
            display: none !important;
          }
          body.local-demo-recording .decision-state::after {
            content: '演示口径 · 优化结果可核算';
            display: block;
            margin-top: 6px;
            color: #0b6b5f;
            font: 700 18px/1.35 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
          }
          .local-demo-focus {
            outline: 3px solid rgba(18, 110, 246, 0.72) !important;
            outline-offset: 6px;
            box-shadow:
              0 0 0 10px rgba(18, 110, 246, 0.12),
              0 18px 48px rgba(12, 60, 110, 0.18) !important;
            border-radius: 16px;
            transition: outline-color .25s ease, box-shadow .25s ease;
          }
          .local-demo-focus-hero {
            outline-color: rgba(8, 160, 130, 0.85) !important;
            box-shadow:
              0 0 0 12px rgba(8, 160, 130, 0.14),
              0 22px 56px rgba(8, 100, 80, 0.18) !important;
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
        document.body.classList.add('local-demo-recording');
        document.body.append(badge, chapter, caption, cursor, card);
        window.__localDemoVideo = {
          badge,
          chapter,
          caption,
          cursor,
          card,
          focusEl: null,
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
        const current = ui.camera.transform || { scale: 1, x: 0, y: 0 };
        if ((current.scale || 1) === 1) return;
        const originX = Number.isFinite(current.originX) ? current.originX : innerWidth / 2;
        const originY = Number.isFinite(current.originY) ? current.originY : innerHeight / 2;
        workbenchRoot.style.transformOrigin = originX + 'px ' + originY + 'px';
        const from = 'scale(' + (current.scale || 1) + ')';
        const to = 'scale(1)';
        const animation = workbenchRoot.animate(
          [{ transform: from }, { transform: to }],
          { duration: 700, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' }
        );
        await animation.finished;
        workbenchRoot.style.transform = to;
        animation.cancel();
        ui.camera.transform = { scale: 1, x: 0, y: 0, originX, originY };
      });
    };
    const applyCamera = async (beat) => {
      let focus;
      try {
        focus = await resolveLocator(beat.focus);
      } catch (error) {
        throw new Error('camera target not found: ' + JSON.stringify(beat.focus));
      }
      await focus.waitFor({ state: 'visible', timeout: step.timeoutMs });

      await page.evaluate(() => {
        const workbenchRoot = document.querySelector('#workbenchRoot');
        if (!workbenchRoot) throw new Error('camera target not found: #workbenchRoot');
        workbenchRoot.style.transition = 'none';
        workbenchRoot.style.transform = 'none';
        workbenchRoot.style.filter = 'none';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.body.style.background = '#f5f8fc';
        const ui = window.__localDemoVideo;
        if (ui?.focusEl) {
          ui.focusEl.classList.remove('local-demo-focus', 'local-demo-focus-hero');
          ui.focusEl = null;
        }
      });

      await focus.evaluate((element) => {
        element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
      });
      await page.waitForTimeout(280);

      let box = await focus.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) {
        throw new Error('camera target not found: empty bounding box');
      }
      const viewport = page.viewportSize() || { width: 1920, height: 1080 };
      // 字幕抬到 118px 后，安全区中心略上移
      const centerY = box.y + box.height / 2;
      if (centerY > viewport.height * 0.5) {
        await page.evaluate((delta) => window.scrollBy(0, delta), Math.round(centerY - viewport.height * 0.38));
        await page.waitForTimeout(140);
        box = await focus.boundingBox();
        if (!box || box.width <= 0 || box.height <= 0) {
          throw new Error('camera target not found: empty bounding box');
        }
      }

      // Node 侧先算好是否禁止 DOM 缩放，避免 page.evaluate 闭包丢变量
      const forceNoZoom = disableCamera === true;
      return page.evaluate(async ({ beat, box, forceNoZoom }) => {
        const ui = window.__localDemoVideo;
        const workbenchRoot = document.querySelector('#workbenchRoot');
        if (!workbenchRoot) throw new Error('camera target not found: #workbenchRoot');

        // 重新定位焦点元素并上高亮（硬切/弱推镜时用高亮代替假推轨）
        const locators = beat.focus || [];
        let focusEl = null;
        for (const locator of locators) {
          if (locator.type === 'css') {
            focusEl = document.querySelector(locator.value);
          } else if (locator.type === 'text') {
            focusEl = Array.from(document.querySelectorAll('*')).find(
              (node) => node.childNodes.length === 1 && node.textContent?.trim() === locator.value
            );
          }
          if (focusEl) break;
        }
        if (focusEl) {
          focusEl.classList.add('local-demo-focus');
          if (!forceNoZoom && (beat.scale || 1) >= 1.45) focusEl.classList.add('local-demo-focus-hero');
          ui.focusEl = focusEl;
        }

        const width = innerWidth;
        const height = innerHeight;
        const safeTop = 72;
        const safeBottom = 170;
        const padding = 36;
        const safeHeight = Math.max(240, height - safeTop - safeBottom);
        const focusX = box.x + box.width / 2;
        const focusY = box.y + box.height / 2;

        let requested = Math.min(1.9, Math.max(1, Number(beat.scale) || 1));
        // 外部工具（OpenScreen 等）负责运镜时，只保留光标/高亮，绝不 DOM scale
        if (forceNoZoom) requested = 1;
        // 弱推镜（<1.22）改为仅高亮 + 硬切，避免「假电影感」空推
        if (requested < 1.22) requested = 1;
        const maxZoomForFit = Math.max(
          1,
          Math.min(
            1.75,
            (width - padding * 2) / Math.max(box.width, 1),
            (safeHeight - padding) / Math.max(box.height, 1)
          )
        );
        let zoom = Math.min(requested, maxZoomForFit);
        zoom = Math.round(zoom * 1000) / 1000;

        const origin = Math.round(focusX) + 'px ' + Math.round(focusY) + 'px';
        const from = 'scale(1)';
        const to = 'scale(' + zoom + ')';
        workbenchRoot.style.transformOrigin = origin;
        workbenchRoot.style.willChange = 'transform';
        workbenchRoot.style.transform = from;
        void workbenchRoot.offsetWidth;

        if (zoom <= 1.001) {
          ui.camera.transform = { scale: 1, x: 0, y: 0, originX: focusX, originY: focusY };
          return { scale: 1, x: 0, y: 0, focus: beat.focus, durationMs: beat.durationMs, at: beat.at, mode: 'highlight' };
        }

        const animation = workbenchRoot.animate(
          [{ transform: from }, { transform: to }],
          {
            duration: Math.min(beat.durationMs, 900),
            easing: 'cubic-bezier(.22,.72,.18,1)',
            fill: 'forwards',
          }
        );
        await animation.finished;
        workbenchRoot.style.transform = to;
        animation.cancel();
        const next = { scale: zoom, x: 0, y: 0, originX: focusX, originY: focusY };
        ui.camera.transform = next;
        return { ...next, focus: beat.focus, durationMs: beat.durationMs, at: beat.at, mode: 'zoom' };
      }, { beat, box, forceNoZoom });
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
      await page.waitForTimeout(320);
    }
    const box = await target.boundingBox();
    if (box) {
      await page.evaluate(({ x, y }) => {
        window.__localDemoVideo.cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      }, {
        x: Math.round(Math.max(18, Math.min(1900, box.x + box.width / 2))),
        y: Math.round(Math.max(18, Math.min(1060, box.y + box.height / 2))),
      });
      await page.waitForTimeout(220);
    }
    if (step.action.type === 'click') {
      await page.evaluate(() => window.__localDemoVideo.cursor.classList.add('clicking'));
      await target.evaluate((element) => element.click());
      await page.waitForTimeout(320);
      await page.evaluate(() => window.__localDemoVideo.cursor.classList.remove('clicking'));
    }
    let ready = null;
    try {
      ready = await resolveLocator(step.ready.locators);
    } catch (error) {
      if (step.ready.state !== 'hidden') throw error;
    }
    if (ready) {
      await ready.waitFor({
        state: step.ready.state,
        timeout: Math.min(step.timeoutMs, 12_000),
      });
      if (step.ready.state === 'visible' && step.action.type === 'click') {
        await ready.evaluate((element) => {
          element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
        });
        await page.waitForTimeout(200);
      }
    }
    // 旁白预算从内容就绪后起算
    segmentStartedAt = Date.now();
    const camera = [];
    for (const beat of step.camera.beats) {
      const dueAt = segmentStartedAt + Math.round(holdMs * beat.at);
      const waitMs = Math.max(0, dueAt - Date.now());
      if (waitMs > 0) await page.waitForTimeout(waitMs);
      // 超时则跳过后续运镜，优先守住 hold 结束点
      if (Date.now() - segmentStartedAt > holdMs - 200) break;
      camera.push(await applyCamera(beat));
    }
    await page.evaluate((exit) => {
      window.__localDemoVideo.camera.exit = exit;
    }, step.camera.exit);
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
  disableCamera = process.env.LOCAL_DEMO_DISABLE_CAMERA === '1',
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
          ['run-code', buildRunCode(source, step, { smoke, disableCamera })],
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
