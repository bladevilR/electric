import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildTtsAssets,
  validateDemoPlan,
} from '../recording/lib/demo-plan.mjs';

function validPlan() {
  return {
    version: 1,
    title: 'AI 申报优化比赛演示',
    url: '/?demo=reviewable',
    maxDurationMs: 240_000,
    steps: [
      {
        id: 'opening',
        title: 'AI 申报优化',
        narration: '系统首先展示申报优化的核心结论。',
        camera: {
          scale: 1,
          focus: [{ type: 'css', value: '#declarationDashboardTitle' }],
          enterMs: 800,
          exit: 'reset',
          motionBlur: 0,
        },
        action: {
          type: 'show',
          locators: [{ type: 'css', value: '#declarationDashboardTitle' }],
        },
        ready: {
          state: 'visible',
          locators: [{ type: 'css', value: '#declarationDashboardTitle' }],
        },
        networkIdleMs: 700,
        holdMs: 4_000,
        timeoutMs: 20_000,
      },
      {
        id: 'open-evidence',
        title: '可审计证据链',
        narration: '每个结论都能追溯到数据与计算依据。',
        camera: {
          scale: 1.18,
          focus: [{ type: 'css', value: '#evidenceTitle' }],
          enterMs: 900,
          exit: 'connect',
          motionBlur: 0.12,
        },
        action: {
          type: 'click',
          locators: [{ type: 'css', value: '[data-action="open-evidence"]' }],
        },
        ready: {
          state: 'visible',
          locators: [{ type: 'css', value: '#evidenceTitle' }],
        },
        networkIdleMs: 700,
        holdMs: 5_000,
        timeoutMs: 20_000,
      },
    ],
  };
}

test('accepts a bounded plan that waits for observable page states', () => {
  const result = validateDemoPlan(validPlan());

  assert.equal(result.totalHoldMs, 9_000);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].ready.state, 'visible');
});

test('rejects a plan that clicks a primary submit or trading action', () => {
  const plan = validPlan();
  plan.steps[1].action.locators = [
    { type: 'css', value: '[data-primary-action="submit_declaration"]' },
  ];

  assert.throws(
    () => validateDemoPlan(plan),
    /禁止自动点击.*submit_declaration/
  );
});

test('rejects fixed-delay-only steps without an observable ready condition', () => {
  const plan = validPlan();
  delete plan.steps[0].ready;

  assert.throws(
    () => validateDemoPlan(plan),
    /opening.*ready/
  );
});

test('rejects plans whose display budget reaches the competition duration limit', () => {
  const plan = validPlan();
  plan.steps[0].holdMs = 299_000;

  assert.throws(
    () => validateDemoPlan(plan),
    /展示时长预算/
  );
});

test('builds narration and subtitles from actual step timing instead of planned delays', () => {
  const plan = validPlan();
  const timeline = {
    startedAt: '2026-07-31T08:00:00.000Z',
    steps: [
      { id: 'opening', status: 'completed', startMs: 1_200, endMs: 6_800 },
      { id: 'open-evidence', status: 'completed', startMs: 7_350, endMs: 13_900 },
    ],
  };

  const assets = buildTtsAssets(plan, timeline);

  assert.match(assets.script, /01 AI 申报优化/);
  assert.match(assets.script, /系统首先展示申报优化的核心结论/);
  assert.match(
    assets.srt,
    /1\n00:00:01,200 --> 00:00:06,800\n系统首先展示申报优化的核心结论。/
  );
  assert.match(
    assets.srt,
    /2\n00:00:07,350 --> 00:00:13,900\n每个结论都能追溯到数据与计算依据。/
  );
  assert.match(assets.ssml, /<speak version="1\.0"/);
});

test('the shipped competition plan centers AI cost savings and leaves failure headroom', async () => {
  const raw = await readFile(
    new URL('../recording/demo-plan.json', import.meta.url),
    'utf8'
  );
  const plan = validateDemoPlan(JSON.parse(raw));

  assert.equal(plan.url, '/?demo=settled');
  assert.match(plan.title, /智能交易副驾驶/);
  assert.ok(plan.steps.length >= 12);
  assert.ok(plan.totalHoldMs >= 190_000);
  assert.ok(plan.totalHoldMs <= 210_000);
  assert.ok(plan.maxDurationMs <= 270_000);
  assert.ok(plan.steps.every((step) => step.ready.locators.length > 0));
  assert.ok(plan.steps.every((step) => step.camera.focus.length > 0));
  assert.ok(plan.steps.every((step) => step.camera.scale <= 1.26));
  const cameraMoves = plan.steps.filter((step) => step.camera.scale > 1);
  assert.ok(cameraMoves.length >= 10 && cameraMoves.length <= 14);
  let consecutiveCloseups = 0;
  for (const step of plan.steps) {
    consecutiveCloseups = step.camera.scale > 1 ? consecutiveCloseups + 1 : 0;
    assert.ok(consecutiveCloseups <= 2);
    if (step.camera.exit === 'reset') consecutiveCloseups = 0;
  }
  assert.equal(new Set(plan.steps.map((step) => step.narrationChapter)).size, 4);
  assert.ok(plan.steps.some((step) => /24,000|2\.4\s*万/.test(step.narration)));
  assert.ok(plan.steps.some((step) => /6,336,000|633\.6\s*万/.test(step.narration)));
  const allNarration = [
    plan.intro.narration,
    ...plan.steps.map((step) => step.narration),
    plan.outro.narration,
  ].join('');
  assert.equal((allNarration.match(/633\.6/g) || []).length, 1);
  assert.match(allNarration, /历史回测.*实时并行验证.*人工审批/s);
  assert.doesNotMatch(allNarration, /影子运行|Champion|Challenger/);
  assert.doesNotMatch(plan.outro.narration, /633\.6|6,336,000/);
  const evolutionHoldMs = plan.steps
    .filter((step) => step.id.includes('evolution'))
    .reduce((sum, step) => sum + step.holdMs, 0);
  assert.ok(evolutionHoldMs / plan.totalHoldMs <= 0.1);
});

test('the tour command validates the shipped plan without launching a browser', () => {
  const result = spawnSync(
    process.execPath,
    [
      new URL('../recording/run-demo-tour.mjs', import.meta.url).pathname,
      '--validate-only',
      '--plan',
      new URL('../recording/demo-plan.json', import.meta.url).pathname,
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.ok(output.stepCount >= 12);
  assert.ok(output.totalHoldMs >= 190000);
});

test('the TTS command writes script, SSML, and SRT from a real timeline file', async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'demo-recording-tts-')
  );
  try {
    const timelinePath = path.join(temporaryRoot, 'timeline.json');
    const outputDirectory = path.join(temporaryRoot, 'tts');
    await writeFile(
      timelinePath,
      JSON.stringify({
        steps: [
          {
            id: 'opening',
            status: 'completed',
            startMs: 800,
            endMs: 6400,
          },
          {
            id: 'core-metrics',
            status: 'completed',
            startMs: 7000,
            endMs: 13200,
          },
        ],
      }),
      'utf8'
    );

    const result = spawnSync(
      process.execPath,
      [
        new URL('../recording/build-tts-assets.mjs', import.meta.url).pathname,
        '--plan',
        new URL('../recording/demo-plan.json', import.meta.url).pathname,
        '--timeline',
        timelinePath,
        '--output',
        outputDirectory,
      ],
      { encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      await readFile(path.join(outputDirectory, '解说稿.txt'), 'utf8'),
      /降低交易成本|单日净成本优化额|九十六个交易时点/
    );
    assert.match(
      await readFile(path.join(outputDirectory, '字幕.srt'), 'utf8'),
      /00:00:00,800 --> 00:00:06,400/
    );
    assert.match(
      await readFile(path.join(outputDirectory, '配音.ssml'), 'utf8'),
      /zh-CN-XiaoxiaoNeural/
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('the PowerShell controller validates the plan without starting recording', () => {
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
    encoding: 'utf8',
  });
  if (probe.error?.code === 'ENOENT') return;

  const result = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-File',
      new URL('../recording/record-demo.ps1', import.meta.url).pathname,
      '-ValidatePlanOnly',
      '-NodePath',
      process.execPath,
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Recording plan validated: 14 steps, 191000 ms/);
});

test('the TTS mux controller accepts a separate video and WAV without overwriting either', async () => {
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
    encoding: 'utf8',
  });
  if (probe.error?.code === 'ENOENT') return;

  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'demo-recording-mux-')
  );
  try {
    const videoPath = path.join(temporaryRoot, 'raw.mp4');
    const audioPath = path.join(temporaryRoot, 'voice.wav');
    await writeFile(videoPath, 'video-fixture');
    await writeFile(audioPath, 'audio-fixture');

    const result = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        new URL('../recording/mux-tts.ps1', import.meta.url).pathname,
        '-ValidateOnly',
        '-VideoPath',
        videoPath,
        '-AudioPath',
        audioPath,
      ],
      { encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TTS mux inputs validated/);
    assert.equal(await readFile(videoPath, 'utf8'), 'video-fixture');
    assert.equal(await readFile(audioPath, 'utf8'), 'audio-fixture');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('the recording packager validates all zero-install source entries', () => {
  const result = spawnSync(
    process.execPath,
    [
      new URL('../tools/package-recording.mjs', import.meta.url).pathname,
      '--validate-source-only',
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.ok(output.files.includes('录制比赛视频.bat'));
  assert.ok(output.directories.includes('recording'));
  assert.ok(output.directories.includes('assets'));
  assert.ok(output.directories.includes('lib'));
});
