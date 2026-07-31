import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { validateDemoPlan } from './lib/demo-plan.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument.slice(2);
    if (key === 'validate-only') {
      result.validateOnly = true;
      continue;
    }
    result[key] = argv[index + 1];
    index += 1;
  }
  return result;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readPlan(planPath) {
  const raw = await readFile(planPath, 'utf8');
  return validateDemoPlan(JSON.parse(raw));
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (event) => {
        cleanup();
        reject(new Error(`CDP WebSocket 连接失败：${event.message || '未知错误'}`));
      };
      const cleanup = () => {
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('error', onError);
      };
      this.socket.addEventListener('open', onOpen);
      this.socket.addEventListener('error', onError);
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(`${pending.method} 失败：${message.error.message}`)
          );
        } else {
          pending.resolve(message.result || {});
        }
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params || {});
      }
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error('CDP WebSocket 已关闭'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket?.close();
  }
}

async function findPageTarget(debugPort, expectedBaseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
        cache: 'no-store',
      });
      const targets = await response.json();
      const page = targets.find(
        (target) =>
          target.type === 'page' &&
          target.webSocketDebuggerUrl &&
          String(target.url || '').startsWith(expectedBaseUrl)
      );
      if (page) return page;
      lastError = `未找到 ${expectedBaseUrl} 对应页面`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(250);
  }
  throw new Error(`Edge 调试端点未就绪：${lastError}`);
}

function browserLocatorSource(locators) {
  return `
    const locators = ${JSON.stringify(locators)};
    const isVisible = (element) => {
      if (!element || !element.isConnected) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const normalizedText = (value) => String(value || '').replace(/\\s+/g, '');
    const findTarget = () => {
      for (const locator of locators) {
        if (locator.type === 'css') {
          const element = document.querySelector(locator.value);
          if (element) return element;
          continue;
        }
        const candidates = Array.from(document.querySelectorAll(
          'button, a, h1, h2, h3, [role="button"], [role="heading"], section, aside'
        ));
        const wanted = normalizedText(locator.value);
        const element = candidates.find((candidate) => {
          const actual = normalizedText(candidate.textContent);
          return locator.exact ? actual === wanted : actual.includes(wanted);
        });
        if (element) return element;
      }
      return null;
    };
  `;
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    const description =
      response.exceptionDetails.exception?.description ||
      response.exceptionDetails.text ||
      '页面脚本执行失败';
    throw new Error(description);
  }
  return response.result?.value;
}

async function installOverlay(client) {
  await evaluate(
    client,
    `(async () => {
      if (window.__competitionDemoOverlay) return true;
      const style = document.createElement('style');
      style.dataset.competitionDemo = 'true';
      style.textContent = \`
        #competition-demo-cursor {
          position: fixed; z-index: 2147483646; left: 0; top: 0;
          width: 22px; height: 22px; pointer-events: none;
          transform: translate(-80px, -80px);
          transition: transform 520ms cubic-bezier(.22,.8,.24,1);
          filter: drop-shadow(0 4px 8px rgba(15, 54, 85, .24));
        }
        #competition-demo-cursor::before {
          content: ''; position: absolute; inset: 2px;
          background: #0a66ff; border: 3px solid white;
          clip-path: polygon(0 0, 78% 58%, 47% 64%, 36% 100%);
        }
        #competition-demo-cursor.is-clicking::after {
          content: ''; position: absolute; left: -17px; top: -17px;
          width: 54px; height: 54px; border: 3px solid rgba(10,102,255,.7);
          border-radius: 50%; animation: competition-demo-ripple 650ms ease-out;
        }
        #competition-demo-chapter {
          position: fixed; z-index: 2147483645; left: 50%; top: 8%;
          transform: translate(-50%, -14px); opacity: 0; pointer-events: none;
          padding: 13px 24px; border: 1px solid rgba(10,102,255,.24);
          border-radius: 999px; color: #093665; background: rgba(255,255,255,.94);
          box-shadow: 0 16px 44px rgba(15,54,85,.16);
          font: 650 18px/1.2 "Microsoft YaHei UI", sans-serif;
          letter-spacing: .04em; transition: opacity 260ms ease, transform 260ms ease;
          backdrop-filter: blur(14px);
        }
        #competition-demo-chapter.is-visible {
          opacity: 1; transform: translate(-50%, 0);
        }
        @keyframes competition-demo-ripple {
          from { opacity: 1; transform: scale(.25); }
          to { opacity: 0; transform: scale(1); }
        }
      \`;
      document.head.appendChild(style);
      const cursor = document.createElement('div');
      cursor.id = 'competition-demo-cursor';
      const chapter = document.createElement('div');
      chapter.id = 'competition-demo-chapter';
      document.body.append(cursor, chapter);
      window.__competitionDemoOverlay = { cursor, chapter };
      return true;
    })()`
  );
}

async function showChapter(client, text) {
  if (!text) return;
  await evaluate(
    client,
    `(async () => {
      const chapter = window.__competitionDemoOverlay?.chapter;
      if (!chapter) return false;
      chapter.textContent = ${JSON.stringify(text)};
      chapter.classList.add('is-visible');
      await new Promise((resolve) => setTimeout(resolve, 1350));
      chapter.classList.remove('is-visible');
      return true;
    })()`
  );
}

async function performAction(client, step) {
  const locatorSource = browserLocatorSource(step.action.locators);
  return evaluate(
    client,
    `(async () => {
      ${locatorSource}
      const target = findTarget();
      if (!target || !isVisible(target)) {
        return { ok: false, reason: '目标元素不存在或不可见' };
      }
      target.scrollIntoView({
        behavior: 'smooth',
        block: ${JSON.stringify(step.action.align || 'center')},
        inline: 'nearest'
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const rect = target.getBoundingClientRect();
      const cursor = window.__competitionDemoOverlay?.cursor;
      if (cursor) {
        const x = Math.max(16, Math.min(innerWidth - 16, rect.left + rect.width / 2));
        const y = Math.max(16, Math.min(innerHeight - 16, rect.top + rect.height / 2));
        cursor.style.transform = \`translate(\${Math.round(x)}px, \${Math.round(y)}px)\`;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      if (${JSON.stringify(step.action.type)} === 'click') {
        cursor?.classList.add('is-clicking');
        target.click();
        await new Promise((resolve) => setTimeout(resolve, 700));
        cursor?.classList.remove('is-clicking');
      }
      return {
        ok: true,
        tag: target.tagName,
        text: String(target.textContent || '').trim().slice(0, 120),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    })()`
  );
}

async function readyState(client, ready) {
  const locatorSource = browserLocatorSource(ready.locators);
  return evaluate(
    client,
    `(() => {
      ${locatorSource}
      const target = findTarget();
      const visible = isVisible(target);
      return {
        ready: ${JSON.stringify(ready.state)} === 'visible' ? visible : !visible,
        visible,
        found: Boolean(target)
      };
    })()`
  );
}

async function waitForReady(client, step) {
  const deadline = Date.now() + step.timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await readyState(client, step.ready);
    if (lastState.ready) return lastState;
    await sleep(150);
  }
  throw new Error(
    `${step.id} 等待 ready 超时：${JSON.stringify(lastState)}`
  );
}

function createNetworkTracker(client) {
  const inFlight = new Set();
  client.on('Network.requestWillBeSent', (event) => {
    if (!['WebSocket', 'EventSource'].includes(event.type)) {
      inFlight.add(event.requestId);
    }
  });
  const finish = (event) => inFlight.delete(event.requestId);
  client.on('Network.loadingFinished', finish);
  client.on('Network.loadingFailed', finish);
  return {
    async waitForIdle(idleMs, timeoutMs) {
      if (idleMs === 0) return;
      const deadline = Date.now() + timeoutMs;
      let idleStartedAt = inFlight.size === 0 ? Date.now() : 0;
      while (Date.now() < deadline) {
        if (inFlight.size === 0) {
          if (!idleStartedAt) idleStartedAt = Date.now();
          if (Date.now() - idleStartedAt >= idleMs) return;
        } else {
          idleStartedAt = 0;
        }
        await sleep(100);
      }
      throw new Error(`网络在 ${timeoutMs}ms 内未连续空闲 ${idleMs}ms`);
    },
  };
}

async function saveScreenshot(client, directory, stepId) {
  await mkdir(directory, { recursive: true });
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const filePath = path.join(
    directory,
    `${new Date().toISOString().replaceAll(':', '-')}-${stepId}.png`
  );
  await writeFile(filePath, Buffer.from(result.data, 'base64'));
  return filePath;
}

async function waitForSignal(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return;
    await sleep(100);
  }
  throw new Error(`等待录制握手超时：${filePath}`);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runTour(args, plan) {
  const debugPort = Number(args['debug-port'] || 9223);
  const baseUrl = args['base-url'] || 'http://127.0.0.1:5177';
  const readyFile = path.resolve(args['ready-file']);
  const goFile = path.resolve(args['go-file']);
  const timelineFile = path.resolve(args.timeline);
  const screenshotDirectory = path.resolve(args['screenshot-dir']);
  const target = await findPageTarget(debugPort, baseUrl);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');
  const network = createNetworkTracker(client);
  await installOverlay(client);
  await waitForReady(client, {
    id: 'preflight',
    ready: plan.steps[0].ready,
    timeoutMs: 30_000,
  });
  await network.waitForIdle(900, 20_000);

  const timeline = {
    version: 1,
    title: plan.title,
    pageUrl: target.url,
    startedAt: null,
    completedAt: null,
    status: 'ready',
    steps: [],
  };
  await writeJson(timelineFile, timeline);
  await writeFile(readyFile, `${new Date().toISOString()}\n`, 'utf8');
  await waitForSignal(goFile, 90_000);
  const recordingStart = Date.now();
  timeline.startedAt = new Date(recordingStart).toISOString();
  timeline.status = 'recording';
  await writeJson(timelineFile, timeline);
  await sleep(800);

  try {
    for (const step of plan.steps) {
      const stepStartedAt = Date.now();
      const record = {
        id: step.id,
        title: step.title,
        status: 'running',
        startMs: stepStartedAt - recordingStart,
        endMs: null,
        waitMs: null,
        error: '',
        screenshot: '',
      };
      timeline.steps.push(record);
      await writeJson(timelineFile, timeline);
      try {
        await showChapter(client, step.chapter);
        const actionStartedAt = Date.now();
        const actionResult = await performAction(client, step);
        if (!actionResult?.ok) {
          throw new Error(
            `${step.id} 操作失败：${actionResult?.reason || '未知原因'}`
          );
        }
        await waitForReady(client, step);
        await network.waitForIdle(step.networkIdleMs, step.timeoutMs);
        record.waitMs = Date.now() - actionStartedAt;
        await sleep(step.holdMs);
        record.endMs = Date.now() - recordingStart;
        record.status = 'completed';
        await writeJson(timelineFile, timeline);
      } catch (error) {
        record.endMs = Date.now() - recordingStart;
        record.status = 'failed';
        record.error = error.message;
        record.screenshot = await saveScreenshot(
          client,
          screenshotDirectory,
          step.id
        ).catch(() => '');
        timeline.status = 'failed';
        await writeJson(timelineFile, timeline);
        throw error;
      }
    }
    timeline.status = 'completed';
    timeline.completedAt = new Date().toISOString();
    await writeJson(timelineFile, timeline);
  } finally {
    client.close();
  }
  return timeline;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const planPath = path.resolve(args.plan || 'demo-plan.json');
  const plan = await readPlan(planPath);
  if (args.validateOnly) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        title: plan.title,
        stepCount: plan.steps.length,
        totalHoldMs: plan.totalHoldMs,
        maxDurationMs: plan.maxDurationMs,
      })}\n`
    );
    return;
  }
  for (const required of [
    'ready-file',
    'go-file',
    'timeline',
    'screenshot-dir',
  ]) {
    if (!args[required]) throw new Error(`缺少参数 --${required}`);
  }
  const result = await runTour(args, plan);
  process.stdout.write(
    `${JSON.stringify({
      ok: result.status === 'completed',
      status: result.status,
      stepCount: result.steps.length,
    })}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
