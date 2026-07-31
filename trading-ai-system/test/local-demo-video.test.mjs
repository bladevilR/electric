import assert from 'node:assert/strict';
import test from 'node:test';

import * as browserRecording from '../recording/local/record-browser-video.mjs';
import * as videoProduction from '../recording/local/lib/video-production.mjs';
import {
  buildEdgeTtsArgs,
  buildFfmpegArgs,
  buildNarrationMixArgs,
  buildNarrationSegments,
  buildOutputPaths,
  buildSrt,
  buildTimelineSkeleton,
  validateProductionConfig,
} from '../recording/local/lib/video-production.mjs';

const demoPlan = {
  title: '电力交易 AI · 申报优化比赛演示',
  url: '/?demo=reviewable',
  steps: [
    {
      id: 'opening',
      title: 'AI 申报优化',
      narration: '第一段旁白。',
      holdMs: 6500,
    },
    {
      id: 'curve',
      title: '96 点申报曲线',
      narration: '第二段旁白。',
      holdMs: 7500,
    },
  ],
};

test('拒绝不带 reviewable 演示标识的录制入口', () => {
  assert.throws(
    () =>
      validateProductionConfig({
        baseUrl: 'http://127.0.0.1:5177/',
        width: 1920,
        height: 1080,
        fps: 30,
      }),
    /demo=reviewable/
  );
});

test('生成 1920x1080、30 帧且带开场结尾的连续时间线', () => {
  const timeline = buildTimelineSkeleton(demoPlan, {
    introMs: 10000,
    outroMs: 15000,
  });

  assert.equal(timeline.width, 1920);
  assert.equal(timeline.height, 1080);
  assert.equal(timeline.fps, 30);
  assert.deepEqual(
    timeline.segments.map(({ id, startMs, endMs }) => ({
      id,
      startMs,
      endMs,
    })),
    [
      { id: 'intro', startMs: 0, endMs: 10000 },
      { id: 'opening', startMs: 10000, endMs: 16500 },
      { id: 'curve', startMs: 16500, endMs: 24000 },
      { id: 'outro', startMs: 24000, endMs: 39000 },
    ]
  );
});

test('旁白片段与字幕使用真实时间线且不会越过镜头', () => {
  const actualTimeline = {
    segments: [
      {
        id: 'intro',
        startMs: 0,
        endMs: 8000,
        narration: '开场旁白',
      },
      {
        id: 'opening',
        startMs: 8000,
        endMs: 15000,
        narration: '核心旁白',
      },
    ],
  };

  const narration = buildNarrationSegments(actualTimeline, {
    intro: 4200,
    opening: 5100,
  });

  assert.deepEqual(narration, [
    {
      id: 'intro',
      text: '开场旁白',
      startMs: 500,
      endMs: 4700,
      durationMs: 4200,
    },
    {
      id: 'opening',
      text: '核心旁白',
      startMs: 8500,
      endMs: 13600,
      durationMs: 5100,
    },
  ]);
  assert.match(
    buildSrt(narration),
    /1\n00:00:00,500 --> 00:00:04,700\n开场旁白/
  );
  assert.match(
    buildSrt(narration),
    /2\n00:00:08,500 --> 00:00:13,600\n核心旁白/
  );
});

test('旁白超过镜头安全区时明确失败而不是截断', () => {
  assert.throws(
    () =>
      buildNarrationSegments(
        {
          segments: [
            {
              id: 'opening',
              startMs: 1000,
              endMs: 5000,
              narration: '过长旁白',
            },
          ],
        },
        { opening: 3900 }
      ),
    /超过镜头/
  );
});

test('输出路径全部收敛到 output/video', () => {
  const paths = buildOutputPaths('/tmp/electric');

  assert.equal(paths.root, '/tmp/electric/output/video');
  assert.equal(
    paths.finalVideo,
    '/tmp/electric/output/video/电力交易AI-智能交易副驾驶-参赛版.mp4'
  );
  for (const value of Object.values(paths)) {
    assert.match(value, /^\/tmp\/electric\/output\/video(?:\/|$)/);
  }
});

test('FFmpeg 合成参数固定为交付编码规格', () => {
  const args = buildFfmpegArgs({
    rawVideo: '/tmp/raw.webm',
    narrationAudio: '/tmp/narration.wav',
    finalVideo: '/tmp/final.mp4',
    durationSeconds: 124.5,
  });

  assert.deepEqual(args.slice(0, 6), [
    '-y',
    '-i',
    '/tmp/raw.webm',
    '-i',
    '/tmp/narration.wav',
    '-map',
  ]);
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.ok(args.some((argument) => argument.includes('1920:1080')));
  assert.ok(args.some((argument) => argument.includes('fps=30')));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('160k'));
  assert.deepEqual(
    args.slice(args.indexOf('-t'), args.indexOf('-t') + 2),
    ['-t', '124.500']
  );
  assert.equal(args.at(-1), '/tmp/final.mp4');

  const capped = buildFfmpegArgs({
    rawVideo: '/tmp/raw.webm',
    narrationAudio: '/tmp/narration.wav',
    finalVideo: '/tmp/final.mp4',
    durationSeconds: 360,
    maxDurationSeconds: 300,
  });
  assert.deepEqual(
    capped.slice(capped.indexOf('-t'), capped.indexOf('-t') + 2),
    ['-t', '300.000']
  );

  const awardLength = buildFfmpegArgs({
    rawVideo: '/tmp/raw.webm',
    narrationAudio: '/tmp/narration.wav',
    finalVideo: '/tmp/final.mp4',
    durationSeconds: 225,
  });
  assert.deepEqual(
    awardLength.slice(awardLength.indexOf('-t'), awardLength.indexOf('-t') + 2),
    ['-t', '225.000']
  );
});

test('旁白混音按实际镜头起点延迟并保持完整视频时长', () => {
  const args = buildNarrationMixArgs({
    inputs: [
      { file: '/tmp/intro.aiff', startMs: 500 },
      { file: '/tmp/opening.aiff', startMs: 8500 },
    ],
    durationMs: 20_000,
    output: '/tmp/narration.wav',
  });

  assert.deepEqual(args.slice(0, 7), [
    '-y',
    '-f',
    'lavfi',
    '-t',
    '20.000',
    '-i',
    'anullsrc=r=48000:cl=stereo',
  ]);
  assert.ok(args.includes('/tmp/intro.aiff'));
  assert.ok(args.includes('/tmp/opening.aiff'));
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /adelay=500\|500/);
  assert.match(filter, /adelay=8500\|8500/);
  assert.equal(
    (filter.match(/loudnorm=I=-18:TP=-2:LRA=7/g) || []).length,
    2
  );
  assert.match(filter, /amix=inputs=3:duration=first/);
  assert.equal(args.at(-1), '/tmp/narration.wav');
});

test('神经网络旁白固定使用晓晓声线并允许按镜头提速', () => {
  assert.deepEqual(
    buildEdgeTtsArgs({
      text: '这是一段测试旁白。',
      ratePercent: 10,
      output: '/tmp/voice.mp3',
    }),
    [
      'edge-tts',
      '--voice',
      'zh-CN-XiaoxiaoNeural',
      '--rate=+10%',
      '--pitch=-2Hz',
      '--text',
      '这是一段测试旁白。',
      '--write-media',
      '/tmp/voice.mp3',
    ]
  );
});

test('本地 Qwen 旁白清单固定使用 Serena 中文声线并逐段输出 WAV', () => {
  assert.equal(typeof videoProduction.buildQwenTtsManifest, 'function');

  const manifest = videoProduction.buildQwenTtsManifest(
    {
      segments: [
        {
          id: 'opening',
          narration: '这是一段测试旁白。',
          startMs: 1000,
          endMs: 9000,
        },
      ],
    },
    '/tmp/narration'
  );

  assert.deepEqual(manifest, {
    modelDirectory:
      '/Users/r/Models/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    speaker: 'Serena',
    language: 'Chinese',
    seed: 20260731,
    instruct:
      '同一女声主播连续讲解电力交易产品演示。语气专业、稳定、亲切，语速一致，情绪平稳，不要切换人设，不要夸张播音腔。',
    segments: [
      {
        id: 'opening',
        text: '这是一段测试旁白。',
        output: '/tmp/narration/opening.wav',
      },
    ],
  });
});

test('Qwen 旁白轻微超时使用高质量时长适配且保留 WAV', () => {
  assert.equal(typeof videoProduction.buildSpeechFitArgs, 'function');

  assert.deepEqual(
    videoProduction.buildSpeechFitArgs({
      input: '/tmp/opening.wav',
      output: '/tmp/opening.fit.wav',
      speedFactor: 1.08,
    }),
    [
      '-y',
      '-i',
      '/tmp/opening.wav',
      '-filter:a',
      'atempo=1.0800',
      '-ar',
      '24000',
      '-c:a',
      'pcm_s16le',
      '/tmp/opening.fit.wav',
    ]
  );
});

test('开场卡退场后的首个工作台镜头会重新播放完整动效', () => {
  assert.equal(typeof browserRecording.shouldReplayWorkbenchMotion, 'function');
  assert.equal(browserRecording.shouldReplayWorkbenchMotion('intro'), false);
  assert.equal(browserRecording.shouldReplayWorkbenchMotion('opening'), true);
  assert.equal(browserRecording.shouldReplayWorkbenchMotion('core-metrics'), false);
});
