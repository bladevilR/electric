/**
 * 全自动全屏录制（用户无需操作）：
 * 1) 临时自动隐藏 Dock
 * 2) Chromium kiosk 全屏打开 settled 演示
 * 3) ffmpeg 录 Capture screen 0（带系统光标）
 * 4) 自动走演示点击
 * 5) 裁掉菜单栏+Dock 区域，导出 1920×1080
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 5210);
const BASE = `http://127.0.0.1:${PORT}/?demo=settled`;
const OUT_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../output/video'
);
const RAW = path.join(OUT_DIR, 'auto-screen-raw.mp4');
const FINAL = path.join(
  OUT_DIR,
  '电力交易AI-智能交易副驾驶-参赛版.mp4'
);

// 1920×1080 屏：菜单栏约 30px，Dock 约 72px（启动时会再探测）
let CROP = { top: 30, bottom: 72, width: 1920, height: 1080 };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => {
      stdout += c;
    });
    child.stderr?.on('data', (c) => {
      stderr += c;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || opts.allowFail) resolve({ code, stdout, stderr });
      else reject(new Error(`${cmd} failed ${code}\n${stderr.slice(-1500)}`));
    });
  });
}

async function detectCrop() {
  try {
    const { stdout } = await run('python3', [
      '-c',
      `import AppKit
f=AppKit.NSScreen.mainScreen().frame()
vf=AppKit.NSScreen.mainScreen().visibleFrame()
# Cocoa y 从下往上；top menubar = totalH - visibleH - dockH
dock=vf.origin.y
menubar=f.size.height-vf.size.height-dock
print(int(f.size.width), int(f.size.height), int(menubar), int(dock))
`,
    ]);
    const [w, h, menubar, dock] = stdout.trim().split(/\s+/).map(Number);
    if (w && h) {
      CROP = {
        width: w,
        height: h,
        top: Math.max(0, menubar || 30),
        bottom: Math.max(0, dock || 0),
      };
    }
  } catch {
    // keep defaults
  }
  console.log('crop', CROP);
}

function setDockAutohide(on) {
  const flag = on ? 'true' : 'false';
  return run(
    'osascript',
    [
      '-e',
      `do shell script "defaults write com.apple.dock autohide -bool ${flag}; killall Dock"`,
    ],
    { allowFail: true }
  );
}

function startFfmpegScreenCapture(outFile) {
  const args = [
    '-y',
    '-f',
    'avfoundation',
    '-capture_cursor',
    '1',
    '-framerate',
    '30',
    '-i',
    'Capture screen 0:none',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-an',
    outFile,
  ];
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => {
    err += c;
  });
  return {
    child,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode != null) {
          resolve({ ok: child.exitCode === 0, err });
          return;
        }
        child.once('close', (code) =>
          resolve({ ok: code === 0 || code === 255, err })
        );
        child.kill('SIGINT');
        setTimeout(() => {
          if (child.exitCode == null) child.kill('SIGKILL');
        }, 4000);
      }),
  };
}

async function clickIfVisible(page, selector, timeout = 5000) {
  const loc = page.locator(selector).first();
  if ((await loc.count()) === 0) return false;
  try {
    await loc.waitFor({ state: 'visible', timeout });
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
        steps: 16,
      });
      await sleep(180);
    }
    await loc.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function dwell(page, ms, selector) {
  if (selector) {
    const loc = page.locator(selector).first();
    if (await loc.count()) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      const box = await loc.boundingBox();
      if (box) {
        // 轻微扫过焦点区域，方便后处理/观感
        await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, {
          steps: 10,
        });
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, {
          steps: 14,
        });
      }
    }
  }
  await sleep(ms);
}

async function runTour(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#declarationDashboardTitle', {
    state: 'visible',
    timeout: 30000,
  });
  // 尽量占满可视区
  await page.evaluate(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      /* ignore */
    }
  }).catch(() => {});
  await sleep(1500);

  await dwell(page, 4500, '#declarationDashboardTitle');
  await dwell(page, 5500, '.dashboard-metrics');

  await clickIfVisible(page, '.dashboard-audit-summary > summary');
  await sleep(900);
  await dwell(page, 5500, '.savings-hero');
  await dwell(page, 7000, '.savings-projection-grid');
  await dwell(page, 5500, '.savings-projection-item:nth-child(3)');

  await clickIfVisible(page, '[data-dashboard-nav="validate"]');
  await sleep(1200);
  await dwell(page, 5500, '.decision-panel, .dashboard-context-alert');
  await clickIfVisible(page, '.dashboard-audit-summary > summary');
  await dwell(page, 5000, '.validation-table, .validation-panel');
  await dwell(page, 5000, '.validation-metrics, .strategy-validation');

  await clickIfVisible(page, '[data-dashboard-nav="curve"][data-stage="connect"]');
  await sleep(1200);
  await dwell(page, 5500, '.declaration-curve-panel, .curve-canvas');
  await dwell(page, 5000, '.curve-insight, #declarationCurveTitle');
  await dwell(page, 5000, '.recommendation-impact, #recommendationTitle');

  await clickIfVisible(page, '[data-action="open-evidence"]');
  await sleep(900);
  await dwell(page, 5500, '.evidence-drawer, .evidence-list');
  await clickIfVisible(page, '[data-action="close-evidence"]');
  await sleep(600);
  await dwell(page, 4500, '#optimizationFlowTitle, .optimization-flow');

  await clickIfVisible(page, '[data-mode="review"]');
  await sleep(1200);
  await dwell(page, 5500, '.review-workspace, .review-summary');
  await dwell(page, 5000, '.review-rule');

  await clickIfVisible(page, '[data-dashboard-nav="evolution"]');
  await sleep(1200);
  await dwell(page, 4500, '.evolution-version.is-champion, #strategyEvolutionTitle');
  await dwell(page, 5500, '.evolution-loop, #evolutionCenter');

  await sleep(2000);
}

async function cropAndExport() {
  const { top, bottom, width, height } = CROP;
  const cropH = Math.max(100, height - top - bottom);
  // 裁掉顶菜单 + 底 Dock，再铺成 1920x1080
  const vf = `crop=${width}:${cropH}:0:${top},scale=1920:1080:flags=lanczos`;
  await run('ffmpeg', [
    '-y',
    '-i',
    RAW,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    FINAL,
  ]);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await detectCrop();

  // 关掉 OpenScreen 弹层，避免录进语言提示
  await run('killall', ['Openscreen'], { allowFail: true });
  await sleep(400);

  console.log('临时隐藏 Dock…');
  await setDockAutohide(true);
  await sleep(1500);
  await detectCrop();
  // 再裁一层浏览器顶栏（标签/地址栏），Dock 已自动隐藏
  CROP.top = Math.max(CROP.top, 28) + 86;
  CROP.bottom = 0;
  console.log('effective crop', CROP);

  console.log('启动全屏录制…', RAW);
  const cap = startFfmpegScreenCapture(RAW);
  await sleep(1800);
  if (cap.child.exitCode != null) {
    await setDockAutohide(false);
    throw new Error(`ffmpeg 录屏启动失败:\n${cap.err.slice(-1000)}`);
  }

  console.log('kiosk Chromium 自动演示…', BASE);
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: [
        '--kiosk',
        '--start-fullscreen',
        '--disable-infobars',
        '--noerrdialogs',
        '--disable-session-crashed-bubble',
        '--disable-features=TranslateUI',
        '--window-position=0,0',
        `--window-size=${CROP.width},${CROP.height}`,
      ],
    });
    const context = await browser.newContext({
      viewport: { width: CROP.width, height: CROP.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    // 注入：录制态隐藏「当前不可执行」
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = `
        .decision-state strong, .decision-state .status-badge { display:none !important; }
        .decision-state::after { content:'演示口径 · 优化结果可核算'; display:block; color:#0b6b5f; font-weight:700; }
      `;
      document.documentElement.appendChild(style);
    });
    await runTour(page);
  } finally {
    if (browser) await browser.close().catch(() => {});
    console.log('停止录屏…');
    const stop = await cap.stop();
    console.log('恢复 Dock…');
    await setDockAutohide(false);
    if (!stop.ok) {
      console.error(stop.err.slice(-1500));
      throw new Error('ffmpeg 录屏结束异常');
    }
  }

  console.log('裁切菜单栏/浏览器顶栏/Dock 并导出…', FINAL);
  await cropAndExport();

  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size',
    '-show_entries',
    'stream=width,height,codec_name',
    '-of',
    'json',
    FINAL,
  ]);
  await writeFile(path.join(OUT_DIR, 'auto-screen-probe.json'), stdout);
  const { stdout: sha } = await run('shasum', ['-a', '256', FINAL]);
  await writeFile(path.join(OUT_DIR, 'auto-screen.sha256'), sha);
  console.log(
    JSON.stringify(
      {
        ok: true,
        final: FINAL,
        sha: sha.trim(),
        crop: CROP,
        probe: JSON.parse(stdout),
      },
      null,
      2
    )
  );
}

main().catch(async (error) => {
  try {
    await setDockAutohide(false);
  } catch {
    /* ignore */
  }
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
