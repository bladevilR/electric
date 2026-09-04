import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const systemRoot = fileURLToPath(new URL('..', import.meta.url));
const chromePath =
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : '/usr/bin/google-chrome';

async function startServer() {
  const port = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
  const temp = await mkdtemp(path.join(os.tmpdir(), 'workbench-a11y-'));
  const server = spawn(
    process.execPath,
    [
      'server.mjs',
      '--port',
      String(port),
      '--evidence-store',
      path.join(temp, 'evidence.sqlite'),
      '--point-in-time-store',
      path.join(temp, 'facts.json'),
      '--forecast-ledger',
      path.join(temp, 'forecast.json'),
      '--outcome-ledger',
      path.join(temp, 'outcomes.json'),
      '--audit',
      path.join(temp, 'audit.ndjson'),
      '--visible-snapshot',
      path.join(temp, 'snapshot.json'),
      '--visible-history',
      path.join(temp, 'history.json'),
    ],
    {
      cwd: systemRoot,
      env: { ...process.env, JSPEC_MANAGED_BROWSER_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stderr = '';
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => {
      if (chunk.toString('utf8').includes('Trading AI System running at')) resolve();
    });
    server.on('exit', (code) => reject(new Error(`server exited before ready: ${code}\n${stderr}`)));
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      server.kill();
      await once(server, 'exit').catch(() => {});
      await rm(temp, { recursive: true, force: true });
    },
  };
}

test(
  'evidence dialog takes focus, traps Tab, closes with Escape, and restores focus',
  { skip: existsSync(chromePath) ? false : `未找到系统 Chrome：${chromePath}` },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

    try {
      await page.goto(`${server.baseUrl}/?demo=submission&v=a11y-test`, {
        waitUntil: 'networkidle',
      });
      const trigger = page.getByRole('button', { name: '证据与审计' });
      await trigger.click();
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === '关闭成本优化证据链'
      );

      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        '关闭成本优化证据链'
      );

      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await page.evaluate(() => Boolean(document.activeElement?.closest('.evidence-drawer'))),
        true
      );

      await page.keyboard.press('Escape');
      await page.waitForSelector('.evidence-drawer', { state: 'detached' });
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === '证据与审计'
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        '证据与审计'
      );

      await page.locator('#evidence-trigger-curve').click();
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === '关闭成本优化证据链'
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () => document.activeElement?.id === 'evidence-trigger-curve'
      );
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'evidence-trigger-curve');

      await page.getByRole('button', { name: '查看复核与结算记录' }).first().click();
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === '关闭成本优化证据链'
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        '关闭成本优化证据链'
      );
    } finally {
      await browser.close();
      await server.close();
    }
  }
);

test(
  'submission demo identity stays visible without causing responsive overflow',
  { skip: existsSync(chromePath) ? false : `未找到系统 Chrome：${chromePath}` },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const page = await browser.newPage();

    try {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1024, height: 768 },
        { width: 768, height: 1024 },
        { width: 390, height: 844 },
        { width: 320, height: 740 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(`${server.baseUrl}/?demo=submission&v=demo-label-test`, {
          waitUntil: 'networkidle',
        });

        const banner = page.getByText('比赛演示 · 模拟数据', { exact: false });
        assert.equal(await banner.isVisible(), true);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth),
          true
        );
        assert.equal(await page.getByRole('button', { name: '申报优化' }).count(), 1);
        assert.equal(await page.getByLabel('交易日').isVisible(), true);
        assert.equal(await page.getByRole('button', { name: '决策', exact: true }).isVisible(), true);
        assert.equal(await page.getByRole('button', { name: '审计', exact: true }).isVisible(), true);
        assert.equal(await page.getByText('历史申报', { exact: true }).isVisible(), true);
        assert.equal(await page.getByText('AI 建议申报', { exact: true }).isVisible(), true);
        assert.equal(await page.getByText('查看 96 点数据表', { exact: true }).isVisible(), true);
        if (viewport.width === 320) {
          await page.getByText('查看 96 点数据表', { exact: true }).click();
          const tableMetrics = await page.locator('.curve-data-table-region').evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }));
          assert.ok(tableMetrics.clientWidth <= 290);
          assert.ok(tableMetrics.scrollWidth > tableMetrics.clientWidth);
        }
      }
    } finally {
      await browser.close();
      await server.close();
    }
  }
);

test(
  'mobile forecast keeps the wide table inside a locally scrollable region',
  { skip: existsSync(chromePath) ? false : `未找到系统 Chrome：${chromePath}` },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    try {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`${server.baseUrl}/?demo=submission&v=forecast-scroll-test`, {
          waitUntil: 'networkidle',
        });
        await page.getByRole('button', { name: '价格预测', exact: true }).click();
        await page.waitForSelector('.forecast-table-region');
        const metrics = await page.locator('.forecast-table-region').evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }));

        assert.ok(metrics.clientWidth <= width - 20, `滚动区不应超过手机内容宽度：${metrics.clientWidth}`);
        assert.ok(metrics.scrollWidth > metrics.clientWidth, '宽表应由局部滚动区承载');
        assert.ok(metrics.clientHeight <= 520, `96 行结果应限制在可控高度：${metrics.clientHeight}`);
        assert.ok(metrics.scrollHeight > metrics.clientHeight, '96 行结果应在局部区域内上下滚动');
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth),
          true
        );
      }
    } finally {
      await browser.close();
      await server.close();
    }
  }
);

test(
  'mobile derivation keeps all six sections available in a sticky horizontal index',
  { skip: existsSync(chromePath) ? false : `未找到系统 Chrome：${chromePath}` },
  async () => {
    const server = await startServer();
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    try {
      await page.goto(`${server.baseUrl}/?demo=submission&v=derivation-nav-test`, {
        waitUntil: 'networkidle',
      });
      await page.locator('[data-action="open-derivation"]').first().click();
      await page.waitForSelector('.strategy-derivation-page');
      const index = page.locator('.derivation-index');
      const metrics = await index.evaluate((element) => ({
        position: getComputedStyle(element).position,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));

      assert.equal(await index.locator('a').count(), 6);
      assert.equal(metrics.position, 'sticky');
      assert.ok(metrics.scrollWidth > metrics.clientWidth, '六个推导入口应横向滚动而不是纵向占满首屏');
      const objectiveLink = index.locator('a[href="#deriveObjective"]');
      await objectiveLink.click();
      await page.waitForFunction(() => location.hash === '#deriveObjective');
      assert.equal(await objectiveLink.getAttribute('aria-current'), 'location');
      const alignment = await page.evaluate(() => {
        const indexElement = document.querySelector('.derivation-index');
        const target = document.querySelector('#deriveObjective');
        return {
          indexBottom: indexElement.getBoundingClientRect().bottom,
          targetTop: target.getBoundingClientRect().top,
        };
      });
      assert.ok(
        alignment.targetTop >= alignment.indexBottom,
        `章节标题不应被吸顶目录遮挡：${JSON.stringify(alignment)}`
      );
    } finally {
      await browser.close();
      await server.close();
    }
  }
);
