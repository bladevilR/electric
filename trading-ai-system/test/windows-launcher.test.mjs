import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const systemRoot = process.env.TRADING_SYSTEM_ROOT
  ? path.resolve(process.env.TRADING_SYSTEM_ROOT)
  : fileURLToPath(new URL('..', import.meta.url));

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function runPowerShell(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh', ['-NoProfile', '-File', path.join(systemRoot, 'start-system.ps1'), ...args], {
      cwd: systemRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

async function waitFor(check, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await Promise.resolve().then(check).catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

test('launcher failure stays diagnosable through a persistent startup log', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-launcher-'));
  const logPath = path.join(temp, 'startup.log');
  const missingNode = path.join(temp, 'missing-node');

  try {
    const result = await runPowerShell([
      '-Port',
      '7599',
      '-NodePath',
      missingNode,
      '-LogFile',
      logPath,
      '-NoBrowser',
      '-NoPause',
    ]);

    assert.equal(result.code, 1);
    assert.match(result.stdout, /Startup failed/);
    assert.match(result.stdout, /startup\.log/);

    const log = await readFile(logPath, 'utf8');
    assert.match(log, /Node runtime was not found/);
    assert.match(log, new RegExp(missingNode.replaceAll('\\', '\\\\')));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('successful launcher keeps the service alive while the launch window remains open', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-launcher-live-'));
  const logPath = path.join(temp, 'startup.log');
  const port = await getFreePort();
  const child = spawn(
    'pwsh',
    [
      '-NoProfile',
      '-File',
      path.join(systemRoot, 'start-system.ps1'),
      '-Port',
      String(port),
      '-NodePath',
      process.execPath,
      '-LogFile',
      logPath,
      '-NoBrowser',
      '-NoPause',
      '-KeepAliveSeconds',
      '2',
    ],
    {
      cwd: systemRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  try {
    const startedAt = Date.now();
    while (!stdout.includes(`Started: http://127.0.0.1:${port}/`)) {
      if (child.exitCode !== null) {
        assert.fail(`launcher exited before readiness (${child.exitCode})\n${stdout}\n${stderr}`);
      }
      if (Date.now() - startedAt > 10_000) {
        assert.fail(`launcher did not become ready\n${stdout}\n${stderr}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(child.exitCode, null, 'launcher window exited instead of keeping the service alive');

    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const exitCode = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(exitCode, 0, `${stdout}\n${stderr}`);
    assert.match(stdout, /Keep this window open/);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
    }
    await rm(temp, { recursive: true, force: true });
  }
});

test('launcher replaces an existing trading assistant process before starting this package', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-launcher-replace-'));
  const logPath = path.join(temp, 'startup.log');
  const port = await getFreePort();
  const standardPath = path.join(systemRoot, 'data', 'standard-96.sample.json');
  const oldServer = spawn(
    process.execPath,
    ['server.mjs', '--port', String(port), '--standard', standardPath],
    { cwd: systemRoot, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let launcher = null;

  try {
    const oldHealth = await waitFor(() =>
      fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json())
    );
    assert.equal(oldHealth.name, 'trading-ai-system');
    assert.equal(oldHealth.pid, oldServer.pid);

    launcher = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        path.join(systemRoot, 'start-system.ps1'),
        '-Port',
        String(port),
        '-NodePath',
        process.execPath,
        '-LogFile',
        logPath,
        '-NoBrowser',
        '-NoPause',
        '-KeepAliveSeconds',
        '2',
      ],
      { cwd: systemRoot, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    launcher.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    launcher.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    await waitFor(() => stdout.includes(`Started: http://127.0.0.1:${port}/`));
    const replacementHealth = await fetch(`http://127.0.0.1:${port}/api/health`).then(
      (response) => response.json()
    );
    assert.notEqual(replacementHealth.pid, oldServer.pid);
    assert.match(stdout, /Stopped existing trading assistant/);
    await waitFor(() => oldServer.exitCode !== null || oldServer.signalCode !== null);

    const exitCode = await new Promise((resolve) => launcher.once('exit', resolve));
    assert.equal(exitCode, 0, `${stdout}\n${stderr}`);
  } finally {
    if (launcher?.exitCode === null) launcher.kill('SIGTERM');
    if (oldServer.exitCode === null) oldServer.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});
