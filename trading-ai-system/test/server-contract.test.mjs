import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

async function startServer() {
  const port = 6200 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ['server.mjs', '--port', String(port)], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = new Promise((resolve, reject) => {
    let stderr = '';
    server.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    server.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (text.includes(`http://127.0.0.1:${port}`)) {
        resolve();
      }
    });
    server.on('exit', (code) => {
      reject(new Error(`server exited before ready: ${code}\n${stderr}`));
    });
  });

  await ready;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      server.kill();
      await once(server, 'exit').catch(() => {});
    },
  };
}

test('local server exposes the P0 system loop', async () => {
  const server = await startServer();

  try {
    const [home, health, summary, strategy] = await Promise.all([
      fetch(`${server.baseUrl}/`).then((response) => response.text()),
      fetch(`${server.baseUrl}/api/health`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/summary`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/strategy?date=2026-05-07`).then((response) => response.json()),
    ]);

    assert.match(home, /苏州地铁电力交易 AI 辅助策略系统/);
    assert.match(home, /<script src="\.\/app\.js"><\/script>/);
    assert.doesNotMatch(home, /data\/standard-96\.js/);

    assert.equal(health.ok, true);
    assert.equal(health.name, 'trading-ai-system');

    assert.equal(summary.rowCount, 192);
    assert.equal(summary.p0SourceCoverage.present, 8);
    assert.equal(summary.p0SourceCoverage.total, 8);
    assert.ok(summary.gapCount >= 1);

    assert.ok(Array.isArray(strategy.suggestions));
    assert.ok(strategy.suggestions.some((item) => item.type === 'low_price'));
    assert.ok(strategy.suggestions.some((item) => item.type === 'high_price_risk'));
    assert.ok(strategy.suggestions.some((item) => item.type === 'data_gap'));
  } finally {
    await server.close();
  }
});
