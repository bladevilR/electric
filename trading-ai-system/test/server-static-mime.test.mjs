import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const systemRoot = fileURLToPath(new URL('..', import.meta.url));

test('local server serves browser ESM modules with a JavaScript MIME type', async () => {
  const port = 8100 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, ['server.mjs', '--port', String(port)], {
    cwd: systemRoot,
    env: { ...process.env, JSPEC_MANAGED_BROWSER_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await new Promise((resolve, reject) => {
      let stderr = '';
      server.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      server.stdout.on('data', (chunk) => {
        if (chunk.toString('utf8').includes(`http://127.0.0.1:${port}`)) {
          resolve();
        }
      });
      server.on('exit', (code) => {
        reject(new Error(`server exited before ready: ${code}\n${stderr}`));
      });
    });

    const response = await fetch(
      `http://127.0.0.1:${port}/lib/declaration-dashboard-view.mjs`
    );

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') || '',
      /^text\/javascript\b/
    );
  } finally {
    server.kill();
    await once(server, 'exit').catch(() => {});
  }
});
