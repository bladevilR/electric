import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as browserRecording from '../recording/local/record-browser-video.mjs';
import * as videoProduction from '../recording/local/lib/video-production.mjs';
import {
  cameraTransformCss,
  computeCameraTransform,
  normalizeCameraSpec,
} from '../recording/local/lib/cinematic-camera.mjs';
import {
  buildEdgeTtsArgs,
  buildFfmpegArgs,
  buildNarrationMixArgs,
  buildNarrationChapters,
  buildAlignedNarrationClips,
  buildChapterMixClips,
  buildChapterSyncedFfmpegArgs,
  buildChapterCaptionSegments,
  buildNarrationSegments,
  buildOutputPaths,
  pacePlanFromSpeech,
  buildProductionStages,
  buildSrt,
  buildTimedCaptionCues,
  buildTimelineSkeleton,
  splitCaptionCues,
  validateProductionConfig,
} from '../recording/local/lib/video-production.mjs';

const demoPlan = {
  title: '电力交易 AI · 申报优化比赛演示',
  url: '/?demo=reviewable',
  intro: {
    title: '成本优化开场',
    narration: '开场成本旁白。',
    narrationChapter: 'chapter-cost',
  },
  outro: {
    title: '价值收束',
    narration: '结尾价值旁白。',
    narrationChapter: 'chapter-outro',
  },
  steps: [
    {
      id: 'opening',
      title: 'AI 申报优化',
      narration: '第一段旁白。',
      narrationChapter: 'chapter-cost',
      holdMs: 6500,
    },
    {
      id: 'curve',
      title: '96 点申报曲线',
      narration: '第二段旁白。',
      narrationChapter: 'chapter-optimize',
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

test('允许 settled 演示入口用于录制已核验成本证据', () => {
  const config = validateProductionConfig({
    baseUrl: 'http://127.0.0.1:5177/?demo=settled',
    width: 1920,
    height: 1080,
    fps: 30,
  });
  assert.match(config.baseUrl, /demo=settled/);
});

test('生成 1920x1080、30 帧且带开场结尾的连续时间线', () => {
  const timeline = buildTimelineSkeleton(demoPlan, {
    introMs: 10000,
    outroMs: 15000,
  });

  assert.equal(timeline.width, 1920);
  assert.equal(timeline.height, 1080);
  assert.equal(timeline.fps, 30);
  assert.equal(timeline.segments[0].title, '成本优化开场');
  assert.equal(timeline.segments[0].narration, '开场成本旁白。');
  assert.equal(timeline.segments[0].narrationChapter, 'chapter-cost');
  assert.equal(timeline.segments.at(-1).title, '价值收束');
  assert.equal(timeline.segments.at(-1).narrationChapter, 'chapter-outro');
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

test('本地 Qwen 旁白清单固定使用 Serena 中文声线并按连续章节输出 WAV', () => {
  assert.equal(typeof videoProduction.buildQwenTtsManifest, 'function');

  const manifest = videoProduction.buildQwenTtsManifest(
    {
      segments: [
        {
          id: 'intro',
          narrationChapter: 'chapter-cost',
          narration: '电力交易的偏差会形成真实成本。',
          startMs: 0,
          endMs: 7000,
        },
        {
          id: 'opening',
          narrationChapter: 'chapter-cost',
          narration: 'AI帮助交易员减少偏差。',
          startMs: 7000,
          endMs: 14000,
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
        id: 'chapter-cost',
        text: '电力交易的偏差会形成真实成本。AI帮助交易员减少偏差。',
        output: '/tmp/narration/chapter-cost.wav',
        sourceSegmentIds: ['intro', 'opening'],
        startMs: 0,
        endMs: 14000,
      },
    ],
  });
});

test('五个连续章节保留源镜头并按实际音频时长生成章内字幕', () => {
  const timeline = {
    segments: [
      { id: 'intro', narrationChapter: 'chapter-cost', narration: '成本问题。', startMs: 0, endMs: 6000 },
      { id: 'opening', narrationChapter: 'chapter-cost', narration: '降本目标。', startMs: 6000, endMs: 12000 },
      { id: 'data', narrationChapter: 'chapter-data', narration: '数据校验。', startMs: 12000, endMs: 20000 },
      { id: 'optimize', narrationChapter: 'chapter-optimize', narration: '申报优化。', startMs: 20000, endMs: 30000 },
      { id: 'review', narrationChapter: 'chapter-review', narration: '人工复核。', startMs: 30000, endMs: 40000 },
      { id: 'outro', narrationChapter: 'chapter-outro', narration: '结果回流。', startMs: 40000, endMs: 50000 },
    ],
  };

  const chapters = buildNarrationChapters(timeline);
  assert.equal(chapters.length, 5);
  assert.deepEqual(chapters[0].sourceSegmentIds, ['intro', 'opening']);
  assert.equal(chapters[0].text, '成本问题。降本目标。');

  const captions = buildChapterCaptionSegments(chapters[0], 9000);
  assert.deepEqual(captions.map((item) => item.id), ['intro', 'opening']);
  assert.equal(captions[0].startMs, 500);
  assert.equal(captions.at(-1).endMs, 9500);
  assert.ok(captions[0].endMs <= captions[1].startMs);
});

test('章节连续旁白在静音边界切分后前对齐并链式贴紧', () => {
  const timeline = {
    segments: [
      { id: 'intro', narrationChapter: 'chapter-value', narration: '成本问题。', startMs: 0, endMs: 7000 },
      { id: 'savings', narrationChapter: 'chapter-value', narration: '节约金额。', startMs: 7000, endMs: 15000 },
    ],
  };
  const clips = buildAlignedNarrationClips({
    timeline,
    speech: [{ id: 'chapter-value', file: '/tmp/value.wav', durationMs: 12000 }],
    alignment: { 'chapter-value': [5200] },
  });

  assert.deepEqual(clips.map((clip) => clip.id), ['intro', 'savings']);
  assert.deepEqual(clips.map((clip) => clip.trimStartMs), [0, 5200]);
  assert.deepEqual(clips.map((clip) => clip.durationMs), [5200, 6800]);
  // 前对齐：首镜贴近起点；次镜在下一镜头最早可入点起声（不再居中留白）
  assert.equal(clips[0].startMs, 120);
  assert.equal(clips[0].endMs, 5320);
  assert.equal(clips[1].startMs, 7120);
  assert.ok(clips[1].startMs - clips[0].endMs < 2000);
  assert.ok(clips.every((clip) => clip.endMs <= clip.segmentEndMs));

  const args = buildNarrationMixArgs({
    inputs: clips,
    durationMs: 15000,
    output: '/tmp/aligned.wav',
  });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /atrim=start=0\.000:duration=5\.200,asetpts=PTS-STARTPTS/);
  assert.match(filter, /atrim=start=5\.200:duration=6\.800,asetpts=PTS-STARTPTS/);
});

test('章节声画同步计划按旁白时长裁画面并链式贴紧音轨', () => {
  const timeline = {
    segments: [
      {
        id: 'intro',
        narrationChapter: 'chapter-value',
        narration: '成本问题。',
        startMs: 0,
        endMs: 8000,
      },
      {
        id: 'savings',
        narrationChapter: 'chapter-value',
        narration: '节约金额。',
        startMs: 8000,
        endMs: 20000,
      },
      {
        id: 'data',
        narrationChapter: 'chapter-data',
        narration: '数据门禁。',
        startMs: 20000,
        endMs: 36000,
      },
    ],
  };
  const speech = [
    { id: 'chapter-value', file: '/tmp/value.wav', durationMs: 12000 },
    { id: 'chapter-data', file: '/tmp/data.wav', durationMs: 9000 },
  ];
  const clips = buildChapterMixClips({ timeline, speech, chainGapMs: 80 });
  assert.equal(clips.length, 2);
  assert.equal(clips[0].id, 'chapter-value');
  assert.equal(clips[0].videoStartMs, 0);
  // 画面窗口 0–20000，旁白 12000 → 取 12000
  assert.equal(clips[0].videoDurationMs, 12000);
  assert.equal(clips[0].durationMs, 12000);
  assert.equal(clips[0].startMs, 0);
  assert.equal(clips[1].id, 'chapter-data');
  assert.equal(clips[1].videoStartMs, 20000);
  assert.equal(clips[1].videoDurationMs, 9000);
  // 第二段音轨紧跟第一段，仅 80ms 间隙
  assert.equal(clips[1].startMs, 12080);
  assert.equal(clips[1].startMs - clips[0].endMs, 80);

  const args = buildChapterSyncedFfmpegArgs({
    rawVideo: '/tmp/raw.webm',
    chapterClips: clips,
    finalVideo: '/tmp/final.mp4',
  });
  assert.equal(args[0], '-y');
  assert.ok(args.includes('/tmp/raw.webm'));
  assert.ok(args.includes('/tmp/value.wav'));
  assert.ok(args.includes('/tmp/data.wav'));
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /trim=start=0\.000:duration=12\.000/);
  assert.match(filter, /trim=start=20\.000:duration=9\.000/);
  assert.match(filter, /concat=n=2:v=1:a=0\[vout\]/);
  assert.match(filter, /concat=n=2:v=0:a=1/);
  assert.ok(args.includes('[vout]'));
  assert.ok(args.includes('[aout]'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
});

test('录制脚本在演示态隐藏不可执行并抬高字幕', () => {
  const source = browserRecording.buildRunCodeForTest(
    {
      id: 'savings-copy-test',
      narration: '年度节约潜力约633.6万元。',
      startMs: 0,
      endMs: 8000,
      durationMs: 8000,
    },
    {
      chapter: '01 · 先看能省多少钱',
      holdMs: 8000,
      camera: {
        beats: [
          {
            at: 0.1,
            scale: 1.48,
            focus: [{ type: 'css', value: '.savings-projection-grid' }],
            durationMs: 800,
            motionBlur: 0.1,
          },
        ],
        exit: 'reset',
      },
    }
  );
  assert.match(source, /local-demo-recording/);
  assert.match(source, /当前不可执行|decision-state/);
  assert.match(source, /演示口径/);
  assert.match(source, /bottom:\s*118px/);
  assert.match(source, /local-demo-focus/);
  assert.match(source, /requested < 1\.22/);
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

  assert.throws(
    () =>
      videoProduction.buildSpeechFitArgs({
        input: '/tmp/opening.wav',
        output: '/tmp/opening.fit.wav',
        speedFactor: 1.151,
      }),
    /无效旁白适配倍率/
  );
});

test('开场卡退场后的首个工作台镜头会重新播放完整动效', () => {
  assert.equal(typeof browserRecording.shouldReplayWorkbenchMotion, 'function');
  assert.equal(browserRecording.shouldReplayWorkbenchMotion('intro'), false);
  assert.equal(browserRecording.shouldReplayWorkbenchMotion('opening'), true);
  assert.equal(browserRecording.shouldReplayWorkbenchMotion('core-metrics'), false);
});

test('smoke 快速遍历全部镜头且不把完整章节旁白塞进短时间线', () => {
  assert.equal(typeof browserRecording.selectRecordingSegments, 'function');
  const skeleton = {
    segments: [{ id: 'intro' }, { id: 'opening' }, { id: 'curve' }, { id: 'outro' }],
  };
  assert.deepEqual(
    browserRecording.selectRecordingSegments(skeleton, { smoke: true }).map((item) => item.id),
    ['intro', 'opening', 'curve', 'outro']
  );
  assert.deepEqual(buildProductionStages('all', { smoke: true }), ['record']);
  assert.deepEqual(buildProductionStages('all'), ['record', 'tts', 'final']);
});

test('镜头停留预算会扣除点击滚动耗时而不是重复叠加', () => {
  assert.equal(typeof browserRecording.remainingHoldMs, 'function');
  assert.equal(browserRecording.remainingHoldMs(16_000, 3_800), 12_200);
  assert.equal(browserRecording.remainingHoldMs(4_000, 5_200), 0);
});

test('电影化摄影机配置有硬边界并可确定性聚焦页面区域', () => {
  const camera = normalizeCameraSpec(
    {
      beats: [
        {
          at: 0,
          scale: 1.35,
          focus: [{ type: 'css', value: '.savings-projection-grid' }],
          durationMs: 1200,
          motionBlur: 0.12,
        },
        {
          at: 0.45,
          scale: 1.9,
          focus: [{ type: 'css', value: '#savingsValue' }],
          durationMs: 750,
          motionBlur: 0.18,
        },
      ],
      exit: 'connect',
    },
    'savings.camera'
  );
  assert.equal(camera.beats[1].scale, 1.9);
  assert.equal(camera.beats[0].durationMs, 1200);
  assert.throws(
    () => normalizeCameraSpec({ beats: [{ at: 0, scale: 1.91, focus: [], durationMs: 800 }], exit: 'reset' }, 'bad.camera'),
    /1\.9/
  );
  assert.throws(
    () => normalizeCameraSpec({
      beats: [
        { at: 0.5, scale: 1.2, focus: [{ type: 'css', value: '#a' }], durationMs: 800 },
        { at: 0.4, scale: 1.3, focus: [{ type: 'css', value: '#b' }], durationMs: 800 },
      ],
      exit: 'reset',
    }, 'bad-order.camera'),
    /递增/
  );

  const transform = computeCameraTransform({
    viewportWidth: 1920,
    viewportHeight: 1080,
    focusRect: { x: 1200, y: 240, width: 400, height: 260 },
    scale: 1.2,
  });
  assert.equal(transform.scale, 1.2);
  assert.ok(transform.x <= 0 && transform.y <= 0);
  assert.match(cameraTransformCss(transform), /translate3d\(.+\) scale\(1\.2\)/);
});

test('长旁白拆为最多两行的醒目短句字幕并按镜头时间切换', () => {
  const cues = splitCaptionCues(
    '候选优化策略先经过历史回测，再使用同一交易日数据进行实时并行验证，只对比结果，不参与真实申报。指标确认领先后仍须人工审批。',
    { maxCharsPerLine: 24, maxLines: 2 }
  );
  assert.ok(cues.length >= 2);
  assert.ok(cues.every((cue) => cue.lines.length <= 2));
  assert.ok(
    cues.every((cue) => cue.lines.every((line) => Array.from(line).length <= 24))
  );

  const timed = buildTimedCaptionCues({
    narration: cues.map((cue) => cue.text).join(''),
    durationMs: 12_000,
  });
  assert.ok(timed.length >= 2);
  assert.equal(timed[0].startMs, 0);
  assert.equal(timed.at(-1).endMs, 12_000);
  assert.ok(timed.every((cue) => cue.endMs - cue.startMs >= 1200));
});

test('真实录制脚本使用固定的大字号电影感字幕层', () => {
  assert.equal(typeof browserRecording.buildRunCodeForTest, 'function');
  const source = browserRecording.buildRunCodeForTest(
    {
      id: 'camera-caption-test',
      narration: '年度节约潜力约633.6万元，并保留人工审批。',
      startMs: 0,
      endMs: 8000,
      durationMs: 8000,
    },
    { chapter: '测试章节', holdMs: 8000 }
  );
  assert.match(source, /font:\s*650 36px\/1\.42/);
  assert.match(source, /1440px/);
  assert.match(source, /bottom:\s*118px/);
  assert.match(source, /local-demo-caption-keyword/);
  assert.match(source, /#workbenchRoot/);
  assert.doesNotMatch(source, /AI 解说/);
});

test('真实录制脚本在主体层执行连续运镜且目标缺失会明确失败', () => {
  const source = browserRecording.buildRunCodeForTest(
    {
      id: 'camera-runtime-test',
      narration: '聚焦成本证据。',
      startMs: 0,
      endMs: 8000,
      durationMs: 8000,
    },
    {
      chapter: '测试章节',
      holdMs: 8000,
      camera: {
        beats: [
          {
            at: 0.1,
            scale: 1.45,
            focus: [{ type: 'css', value: '.savings-projection-grid' }],
            durationMs: 1200,
            motionBlur: 0.12,
          },
          {
            at: 0.55,
            scale: 1.9,
            focus: [{ type: 'css', value: '#savingsValue' }],
            durationMs: 750,
            motionBlur: 0.18,
          },
        ],
        exit: 'connect',
      },
    }
  );
  assert.match(source, /camera target not found/i);
  assert.match(source, /workbenchRoot\.animate/);
  assert.match(source, /transformOrigin\s*=/);
  assert.match(source, /scale\(/);
  assert.match(source, /exit === ['"]connect['"]/);
  assert.match(source, /for \(const beat of step\.camera\.beats\)/);
});

test('真实录制使用无灰边 1080p 源并在成片阶段统一尺寸', async () => {
  const source = await readFile(
    new URL('../recording/local/record-browser-video.mjs', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /deviceScaleFactor:\s*2/);
  assert.match(source, /video-start['"],\s*rawVideo,\s*['"]--size['"],\s*['"]1920x1080/);

  const args = buildFfmpegArgs({
    rawVideo: 'raw.webm',
    narrationAudio: 'narration.wav',
    finalVideo: 'final.mp4',
    durationSeconds: 120,
    maxDurationSeconds: 300,
  });
  assert.ok(args.includes('scale=1920:1080:flags=lanczos,fps=30'));
});

test('真实 TTS 时长反推镜头预算并把章尾空白控制在 1.2 秒内', () => {
  const pacingPlan = {
    intro: { narration: '价值开场。', narrationChapter: 'chapter-value' },
    outro: { narration: '价值收束。', narrationChapter: 'chapter-close' },
    steps: [
      { id: 'value', narration: '节约价值。', narrationChapter: 'chapter-value' },
      { id: 'data', narration: '数据校验。', narrationChapter: 'chapter-data' },
      { id: 'decision', narration: '优化决策。', narrationChapter: 'chapter-decision' },
      { id: 'close', narration: '策略验证。', narrationChapter: 'chapter-close' },
    ],
  };
  const paced = pacePlanFromSpeech(pacingPlan, [
    { id: 'chapter-value', durationMs: 42_000 },
    { id: 'chapter-data', durationMs: 39_000 },
    { id: 'chapter-decision', durationMs: 66_000 },
    { id: 'chapter-close', durationMs: 42_000 },
  ]);
  assert.ok(paced.durationMs >= 195_000 && paced.durationMs <= 210_000);
  assert.ok(paced.chapters.every((chapter) => chapter.trailingSilenceMs <= 1200));
  assert.ok(paced.plan.steps.every((step) => step.holdMs >= 6500));
});
