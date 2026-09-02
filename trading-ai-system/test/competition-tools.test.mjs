import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildChildEnvironment,
  buildPythonInvocation,
  checkPinnedDependencies,
  parseCli,
  resolveToolPaths,
} from '../tools/competition-tools.mjs';

test('resolveToolPaths keeps downloaded attachments read-only and runtime local to the project', () => {
  const paths = resolveToolPaths({
    projectRoot: '/workspace/trading-ai-system',
    homeDir: '/Users/example',
    env: {},
  });

  assert.equal(
    paths.attachmentsDir,
    path.join('/Users/example', 'Downloads', '智能体运行日志格式校验工具', 'competition-attachments')
  );
  assert.equal(paths.runtimeDir, '/workspace/trading-ai-system/.competition-tools');
  assert.equal(paths.venvPython, '/workspace/trading-ai-system/.competition-tools/venv/bin/python');
  assert.equal(
    paths.genaiMain,
    path.join(paths.attachmentsDir, 'genai-log-validator', 'src', 'main.py')
  );
});

test('buildChildEnvironment isolates uv cache from a broken user-level cache symlink', () => {
  const paths = resolveToolPaths({
    projectRoot: '/workspace/trading-ai-system',
    homeDir: '/Users/example',
    env: {},
  });
  const childEnv = buildChildEnvironment(paths, {
    UV_CACHE_DIR: '/Users/example/.cache/uv',
    PATH: '/usr/bin',
  });

  assert.equal(childEnv.UV_CACHE_DIR, '/workspace/trading-ai-system/.competition-tools/uv-cache');
  assert.equal(childEnv.PYTHONDONTWRITEBYTECODE, '1');
  assert.equal(childEnv.PYTHONNOUSERSITE, '1');
  assert.equal(childEnv.PATH, '/usr/bin');
});

test('resolveToolPaths accepts explicit attachment and runtime overrides', () => {
  const paths = resolveToolPaths({
    projectRoot: '/workspace/trading-ai-system',
    homeDir: '/Users/example',
    env: {
      COMPETITION_ATTACHMENTS_DIR: '/opt/competition/source',
      COMPETITION_TOOLS_RUNTIME_DIR: '/tmp/competition-runtime',
    },
  });

  assert.equal(paths.attachmentsDir, '/opt/competition/source');
  assert.equal(paths.runtimeDir, '/tmp/competition-runtime');
});

test('parseCli never defaults to a networked dynamic run', () => {
  assert.throws(() => parseCli([]), /必须指定命令/);
  assert.deepEqual(parseCli(['dynamic-check', 'information.json', 'traces.json']), {
    command: 'dynamic-check',
    args: ['information.json', 'traces.json'],
  });
});

test('parseCli requires an explicit report path before dynamic-run is allowed', () => {
  assert.throws(
    () => parseCli(['dynamic-run', 'information.json', 'traces.json']),
    /--output/
  );
  assert.deepEqual(
    parseCli([
      'dynamic-run',
      'information.json',
      'traces.json',
      '--output',
      'competition-runtime/execution-report.json',
      '--timeout',
      '20',
    ]),
    {
      command: 'dynamic-run',
      args: [
        'information.json',
        'traces.json',
        '--output',
        'competition-runtime/execution-report.json',
        '--timeout',
        '20',
      ],
    }
  );
  assert.deepEqual(
    parseCli(['dynamic-run', 'information.json', 'traces.json', '--output=report.json']),
    {
      command: 'dynamic-run',
      args: ['information.json', 'traces.json', '--output=report.json'],
    }
  );
});

test('validate-information requires explicit network permission for URLs and manifests', () => {
  assert.throws(
    () => parseCli(['validate-information', 'https://example.invalid/information.json', '--json']),
    /--allow-network/
  );
  assert.throws(
    () => parseCli(['validate-information', '--json', 'https://example.invalid/information.json']),
    /--allow-network/
  );
  assert.throws(
    () => parseCli(['validate-information', 'teams.csv', '--json']),
    /--allow-network/
  );
  assert.deepEqual(
    parseCli([
      'validate-information',
      '--allow-network',
      '--json',
      'https://example.invalid/information.json',
    ]),
    {
      command: 'validate-information',
      args: ['--json', 'https://example.invalid/information.json'],
      allowNetwork: true,
    }
  );
});

test('checkPinnedDependencies rejects importable but mismatched dependency versions', () => {
  const requirements = 'pydantic==2.13.4\npyyaml==6.0.2\n';

  assert.deepEqual(
    checkPinnedDependencies(requirements, { pydantic: '2.13.4', pyyaml: '6.0.2' }),
    {
      ok: true,
      expected: { pydantic: '2.13.4', pyyaml: '6.0.2' },
      mismatches: [],
    }
  );
  assert.deepEqual(
    checkPinnedDependencies(requirements, { pydantic: '2.12.0', pyyaml: '6.0.2' }),
    {
      ok: false,
      expected: { pydantic: '2.13.4', pyyaml: '6.0.2' },
      mismatches: ['pydantic: 期望 2.13.4，实际 2.12.0'],
    }
  );
});

test('buildPythonInvocation routes commands to the original Python sources without a shell', () => {
  const paths = resolveToolPaths({
    projectRoot: '/workspace/trading-ai-system',
    homeDir: '/Users/example',
    env: { COMPETITION_ATTACHMENTS_DIR: '/opt/competition/source' },
  });

  assert.deepEqual(
    buildPythonInvocation(
      { command: 'validate-traces', args: ['trace.json', '--format', 'json'] },
      paths
    ),
    {
      executable: paths.venvPython,
      args: [paths.genaiMain, 'trace.json', '--format', 'json'],
      network: false,
    }
  );
  assert.deepEqual(
    buildPythonInvocation(
      { command: 'dynamic-check', args: ['information.json', 'trace.json'] },
      paths
    ),
    {
      executable: paths.venvPython,
      args: [paths.dynamicRunner, 'check', 'information.json', 'trace.json'],
      network: false,
    }
  );
  assert.equal(
    buildPythonInvocation(
      {
        command: 'dynamic-run',
        args: ['information.json', 'trace.json', '--output', 'report.json'],
      },
      paths
    ).network,
    true
  );
});
