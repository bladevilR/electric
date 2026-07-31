import path from 'node:path';

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 30;

function chineseLength(value) {
  return Array.from(value).length;
}

function hardWrapText(text, limit) {
  const characters = Array.from(text);
  const chunks = [];
  for (let index = 0; index < characters.length; index += limit) {
    chunks.push(characters.slice(index, index + limit).join(''));
  }
  return chunks;
}

function splitLongSentence(sentence, maxCueChars) {
  if (chineseLength(sentence) <= maxCueChars) return [sentence];
  const phrases = sentence.match(/[^，、：,]+[，、：,]?/gu) || [sentence];
  const chunks = [];
  let current = '';
  for (const phrase of phrases) {
    if (chineseLength(phrase) > maxCueChars) {
      if (current) chunks.push(current);
      chunks.push(...hardWrapText(phrase, maxCueChars));
      current = '';
      continue;
    }
    if (current && chineseLength(current + phrase) > maxCueChars) {
      chunks.push(current);
      current = phrase;
    } else {
      current += phrase;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitCaptionCues(
  text,
  { maxCharsPerLine = 24, maxLines = 2 } = {}
) {
  if (!Number.isInteger(maxCharsPerLine) || maxCharsPerLine < 8) {
    throw new Error('maxCharsPerLine 必须是至少 8 的整数');
  }
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 2) {
    throw new Error('maxLines 必须是 1 或 2');
  }
  const normalized = String(text || '').replace(/\s+/gu, '').trim();
  if (!normalized) return [];
  const maxCueChars = maxCharsPerLine * maxLines;
  const sentences = normalized.match(/[^。！？；]+[。！？；]?/gu) || [normalized];
  return sentences
    .flatMap((sentence) => splitLongSentence(sentence, maxCueChars))
    .filter(Boolean)
    .map((cueText) => ({
      text: cueText,
      lines: hardWrapText(cueText, maxCharsPerLine),
    }));
}

export function buildTimedCaptionCues(
  segment,
  { minimumCueMs = 1200, maxCharsPerLine = 24, maxLines = 2 } = {}
) {
  const durationMs = Math.round(
    Number(segment.durationMs) || Number(segment.endMs) - Number(segment.startMs)
  );
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('字幕镜头缺少有效时长');
  }
  const cues = splitCaptionCues(segment.narration, {
    maxCharsPerLine,
    maxLines,
  });
  if (cues.length === 0) return [];
  if (cues.length * minimumCueMs > durationMs) {
    throw new Error(`字幕短句过密：${cues.length} 条无法放入 ${durationMs}ms`);
  }
  const weights = cues.map((cue) => Math.max(1, chineseLength(cue.text)));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const flexibleMs = durationMs - cues.length * minimumCueMs;
  let cursorMs = 0;
  let consumedWeight = 0;
  return cues.map((cue, index) => {
    const startMs = cursorMs;
    consumedWeight += weights[index];
    const endMs =
      index === cues.length - 1
        ? durationMs
        : Math.round(
            (index + 1) * minimumCueMs +
              (consumedWeight / weightTotal) * flexibleMs
          );
    cursorMs = endMs;
    return { ...cue, startMs, endMs };
  });
}

export function buildProductionStages(stage = 'all', { smoke = false } = {}) {
  if (smoke) return ['record'];
  if (stage === 'all') return ['record', 'tts', 'final'];
  if (['record', 'tts', 'final'].includes(stage)) return [stage];
  throw new Error(`不支持的制作阶段：${stage}`);
}

export function validateProductionConfig(config) {
  const parsedUrl = new URL(config.baseUrl);
  if (!['reviewable', 'settled'].includes(parsedUrl.searchParams.get('demo'))) {
    throw new Error('录制入口必须包含 demo=reviewable 或 demo=settled 演示标识');
  }
  if (
    config.width !== DEFAULT_WIDTH ||
    config.height !== DEFAULT_HEIGHT ||
    config.fps !== DEFAULT_FPS
  ) {
    throw new Error('录制规格必须为 1920×1080、30fps');
  }
  return config;
}

export function buildTimelineSkeleton(
  plan,
  { introMs = 10000, outroMs = 15000 } = {}
) {
  let cursorMs = 0;
  const segments = [];
  const append = (segment) => {
    const startMs = cursorMs;
    const endMs = startMs + segment.durationMs;
    segments.push({
      ...segment,
      startMs,
      endMs,
    });
    cursorMs = endMs;
  };

  append({
    id: 'intro',
    title: plan.intro?.title || '电力交易 AI · 智能交易副驾驶',
    narration:
      plan.intro?.narration ||
      '电力交易中，每一次申报偏差都会形成真实成本。',
    narrationChapter: plan.intro?.narrationChapter || 'chapter-cost',
    durationMs: introMs,
  });
  for (const step of plan.steps) {
    append({
      id: step.id,
      title: step.title,
      narration: step.narration,
      narrationChapter: step.narrationChapter || step.id,
      durationMs: step.holdMs,
    });
  }
  append({
    id: 'outro',
    title: plan.outro?.title || '让每一笔节约都有依据',
    narration:
      plan.outro?.narration ||
      'AI帮助交易员降低偏差成本，让每一次决策可解释、可复核。',
    narrationChapter: plan.outro?.narrationChapter || 'chapter-outro',
    durationMs: outroMs,
  });

  return {
    version: 1,
    title: plan.title,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    fps: DEFAULT_FPS,
    durationMs: cursorMs,
    segments,
  };
}

export function buildNarrationSegments(
  timeline,
  durationsById,
  { leadingPaddingMs = 500, trailingPaddingMs = 500 } = {}
) {
  return timeline.segments
    .filter((segment) => segment.narration)
    .map((segment) => {
      const durationMs = Math.ceil(Number(durationsById[segment.id]));
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw new Error(`${segment.id} 缺少有效旁白时长`);
      }
      const startMs = segment.startMs + leadingPaddingMs;
      const endMs = startMs + durationMs;
      if (endMs > segment.endMs - trailingPaddingMs) {
        throw new Error(
          `${segment.id} 旁白超过镜头安全区：${durationMs}ms > ${
            segment.endMs - segment.startMs - leadingPaddingMs - trailingPaddingMs
          }ms`
        );
      }
      return {
        id: segment.id,
        text: segment.narration,
        startMs,
        endMs,
        durationMs,
      };
    });
}

export function buildNarrationChapters(timeline) {
  const chapters = [];
  for (const segment of timeline.segments.filter((item) => item.narration)) {
    const chapterId = segment.narrationChapter || segment.id;
    let chapter = chapters.at(-1);
    if (!chapter || chapter.id !== chapterId) {
      if (chapters.some((item) => item.id === chapterId)) {
        throw new Error(`旁白章节必须连续：${chapterId}`);
      }
      chapter = {
        id: chapterId,
        text: '',
        sourceSegmentIds: [],
        sourceSegments: [],
        startMs: segment.startMs,
        endMs: segment.endMs,
      };
      chapters.push(chapter);
    }
    chapter.sourceSegmentIds.push(segment.id);
    chapter.sourceSegments.push({
      id: segment.id,
      text: segment.narration,
    });
    chapter.text += segment.narration;
    chapter.endMs = segment.endMs;
  }
  return chapters;
}

export function buildChapterCaptionSegments(
  chapter,
  durationMs,
  { leadingPaddingMs = 500, trailingPaddingMs = 500 } = {}
) {
  const audioDurationMs = Math.ceil(Number(durationMs));
  if (!Number.isFinite(audioDurationMs) || audioDurationMs <= 0) {
    throw new Error(`${chapter.id} 缺少有效旁白时长`);
  }
  const availableMs =
    chapter.endMs - chapter.startMs - leadingPaddingMs - trailingPaddingMs;
  if (audioDurationMs > availableMs) {
    throw new Error(
      `${chapter.id} 旁白超过章节安全区：${audioDurationMs}ms > ${availableMs}ms`
    );
  }
  const weights = chapter.sourceSegments.map((segment) =>
    Math.max(1, Array.from(segment.text).length)
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const audioStartMs = chapter.startMs + leadingPaddingMs;
  let consumedWeight = 0;
  return chapter.sourceSegments.map((segment, index) => {
    const startMs =
      audioStartMs + Math.round((consumedWeight / totalWeight) * audioDurationMs);
    consumedWeight += weights[index];
    const endMs =
      index === chapter.sourceSegments.length - 1
        ? audioStartMs + audioDurationMs
        : audioStartMs +
          Math.round((consumedWeight / totalWeight) * audioDurationMs);
    return {
      id: segment.id,
      text: segment.text,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      chapterId: chapter.id,
    };
  });
}

function formatSrtTimestamp(milliseconds) {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const millis = value % 1000;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
    .concat(',', String(millis).padStart(3, '0'));
}

export function buildSrt(segments) {
  return `${segments
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTimestamp(
          segment.startMs
        )} --> ${formatSrtTimestamp(segment.endMs)}\n${segment.text}`
    )
    .join('\n\n')}\n`;
}

export function buildOutputPaths(projectRoot) {
  const root = path.join(path.resolve(projectRoot), 'output', 'video');
  return {
    root,
    rawVideo: path.join(root, 'raw', 'browser-recording.webm'),
    timeline: path.join(root, 'timeline.json'),
    subtitles: path.join(root, 'subtitles.srt'),
    narrationDirectory: path.join(root, 'narration'),
    narrationAudio: path.join(root, 'narration.wav'),
    finalVideo: path.join(root, '电力交易AI-智能交易副驾驶-参赛版.mp4'),
    log: path.join(root, 'production.log'),
    screenshots: path.join(root, 'acceptance'),
  };
}

export function buildFfmpegArgs({
  rawVideo,
  narrationAudio,
  finalVideo,
  durationSeconds = null,
  maxDurationSeconds = 300,
}) {
  const args = [
    '-y',
    '-i',
    rawVideo,
    '-i',
    narrationAudio,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    'scale=1920:1080:flags=lanczos,fps=30',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    '-shortest',
  ];
  // 以实际成片时长为准，比赛规定最长不超过五分钟。
  let limit = durationSeconds;
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    limit = maxDurationSeconds;
  } else {
    limit = Math.min(limit, maxDurationSeconds);
  }
  args.push('-t', limit.toFixed(3), finalVideo);
  return args;
}

export function buildNarrationMixArgs({
  inputs,
  durationMs,
  output,
}) {
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-t',
    (durationMs / 1000).toFixed(3),
    '-i',
    'anullsrc=r=48000:cl=stereo',
  ];
  for (const input of inputs) {
    args.push('-i', input.file);
  }

  const chains = inputs.map(
    (input, index) =>
      `[${index + 1}:a]loudnorm=I=-18:TP=-2:LRA=7,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(
        input.startMs
      )}|${Math.round(input.startMs)}[voice${index + 1}]`
  );
  const mixInputs = ['[0:a]', ...inputs.map((_, index) => `[voice${index + 1}]`)]
    .join('');
  chains.push(
    `${mixInputs}amix=inputs=${
      inputs.length + 1
    }:duration=first:normalize=0,alimiter=limit=0.95[out]`
  );

  args.push(
    '-filter_complex',
    chains.join(';'),
    '-map',
    '[out]',
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    output
  );
  return args;
}

export function buildEdgeTtsArgs({
  text,
  ratePercent = 0,
  output,
}) {
  const signedRate =
    ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;
  return [
    'edge-tts',
    '--voice',
    'zh-CN-XiaoxiaoNeural',
    `--rate=${signedRate}`,
    '--pitch=-2Hz',
    '--text',
    text,
    '--write-media',
    output,
  ];
}

export function buildQwenTtsManifest(timeline, narrationDirectory) {
  const chapters = buildNarrationChapters(timeline);
  return {
    modelDirectory:
      '/Users/r/Models/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    speaker: 'Serena',
    language: 'Chinese',
    // 全片统一推理种子，避免分段各自随机导致音色/情绪漂移
    seed: 20260731,
    instruct:
      '同一女声主播连续讲解电力交易产品演示。语气专业、稳定、亲切，语速一致，情绪平稳，不要切换人设，不要夸张播音腔。',
    segments: chapters.map((chapter) => ({
        id: chapter.id,
        text: chapter.text,
        output: path.join(narrationDirectory, `${chapter.id}.wav`),
        sourceSegmentIds: chapter.sourceSegmentIds,
        startMs: chapter.startMs,
        endMs: chapter.endMs,
      })),
  };
}

export function buildSpeechFitArgs({ input, output, speedFactor }) {
  if (!Number.isFinite(speedFactor) || speedFactor < 1 || speedFactor > 1.15) {
    throw new Error(`无效旁白适配倍率：${speedFactor}`);
  }
  return [
    '-y',
    '-i',
    input,
    '-filter:a',
    `atempo=${speedFactor.toFixed(4)}`,
    '-ar',
    '24000',
    '-c:a',
    'pcm_s16le',
    output,
  ];
}
