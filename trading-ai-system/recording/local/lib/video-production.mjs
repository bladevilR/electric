import path from 'node:path';

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FPS = 30;
const CAPTURE_WIDTH = 3840;
const CAPTURE_HEIGHT = 2160;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeFocusRect(
  rect,
  { width = CAPTURE_WIDTH, height = CAPTURE_HEIGHT, paddingRatio = 0.15 } = {}
) {
  const source = {
    x: Number(rect?.x),
    y: Number(rect?.y),
    width: Number(rect?.width),
    height: Number(rect?.height),
  };
  if (
    !Object.values(source).every(Number.isFinite) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new Error('摄影机焦点缺少有效目标矩形');
  }
  const paddingX = source.width * paddingRatio;
  const paddingY = source.height * paddingRatio;
  const paddedWidth = Math.min(width, source.width + paddingX * 2);
  const paddedHeight = Math.min(height, source.height + paddingY * 2);
  return {
    x: clamp(source.x - paddingX, 0, width - paddedWidth),
    y: clamp(source.y - paddingY, 0, height - paddedHeight),
    width: paddedWidth,
    height: paddedHeight,
  };
}

function cameraCrop(rect, scale, width, height) {
  const boundedScale = clamp(Number(scale) || 1, 1, 1.85);
  const cropWidth = width / boundedScale;
  const cropHeight = height / boundedScale;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return {
    x: clamp(centerX - cropWidth / 2, 0, width - cropWidth),
    y: clamp(centerY - cropHeight / 2, 0, height - cropHeight),
    width: cropWidth,
    height: cropHeight,
  };
}

export function buildCameraTimeline(plan, timeline) {
  const width = Number(timeline.width) || CAPTURE_WIDTH;
  const height = Number(timeline.height) || CAPTURE_HEIGHT;
  const planById = new Map((plan.steps || []).map((step) => [step.id, step]));
  const beats = [
    {
      id: 'film-open-wide',
      segmentId: timeline.segments[0]?.id || 'intro',
      startMs: 0,
      durationMs: 1,
      scale: 1,
      crop: { x: 0, y: 0, width, height },
    },
  ];
  const intro = timeline.segments?.find((segment) => segment.id === 'intro');
  if (intro && Number(intro.endMs) - Number(intro.startMs) >= 10_000) {
    const scale = 1.06;
    beats.push({
      id: 'film-open-push',
      segmentId: 'intro',
      startMs: Number(intro.startMs) + Math.round((Number(intro.endMs) - Number(intro.startMs)) * 0.56),
      durationMs: 420,
      scale,
      crop: cameraCrop({ x: 0, y: 0, width, height }, scale, width, height),
    });
  }
  for (const segment of timeline.segments || []) {
    const step = planById.get(segment.id);
    const recorded = Array.isArray(segment.focusRects) ? segment.focusRects : [];
    for (const [index, spec] of (step?.camera?.beats || []).entries()) {
      const focus = recorded[index] || recorded.find((item) => item.at === spec.at);
      if (!focus) throw new Error(`${segment.id} 缺少第 ${index + 1} 个摄影机焦点矩形`);
      const rect = normalizeFocusRect(focus, { width, height });
      const scale = clamp(Number(spec.scale) || 1, 1, 1.85);
      beats.push({
        id: `${segment.id}-camera-${index + 1}`,
        segmentId: segment.id,
        startMs:
          index === 0
            ? Number(segment.startMs)
            : Number(segment.startMs) +
              Math.round((Number(segment.endMs) - Number(segment.startMs)) * Number(spec.at)),
        durationMs: clamp(Number(spec.durationMs) || 900, 240, 1800),
        scale,
        focus: spec.focus,
        crop: cameraCrop(rect, scale, width, height),
      });
    }
  }
  beats.push({
    id: 'film-close-wide',
    segmentId: timeline.segments.at(-1)?.id || 'outro',
    startMs: Number(timeline.segments.at(-1)?.startMs || 0),
    durationMs: 500,
    scale: 1,
    crop: { x: 0, y: 0, width, height },
  });
  beats.sort((left, right) => left.startMs - right.startMs);
  if (beats.length < 16 || beats.length > 22) {
    throw new Error(`摄影机节拍必须为 16–22 个，当前为 ${beats.length}`);
  }
  if (beats.filter((beat) => beat.scale >= 1.5).length < 6) {
    throw new Error('摄影机时间线至少需要 6 个不低于 1.5 倍的特写');
  }
  let closeRun = 0;
  for (const beat of beats) {
    closeRun = beat.scale >= 1.5 ? closeRun + 1 : 0;
    if (closeRun > 2) throw new Error('摄影机时间线连续特写不得超过两个');
  }
  return { width, height, fps: DEFAULT_FPS, beats };
}

function piecewiseExpression(beats, property, fps) {
  let expression = property === 'scale' ? '1' : '0';
  let previous = property === 'scale' ? 1 : 0;
  for (const beat of beats.slice(1)) {
    const target = property === 'scale' ? beat.scale : beat.crop[property];
    const startFrame = Math.max(0, Math.round((beat.startMs / 1000) * fps));
    const frames = Math.max(1, Math.round((beat.durationMs / 1000) * fps));
    const endFrame = startFrame + frames;
    const transition = `${previous.toFixed(6)}+(${target.toFixed(6)}-${previous.toFixed(6)})*min(1,max(0,(on-${startFrame})/${frames}))`;
    expression = `if(lt(on,${startFrame}),${expression},if(lte(on,${endFrame}),${transition},${target.toFixed(6)}))`;
    previous = target;
  }
  return expression;
}

export function buildPostCameraFilter({
  camera,
  sourceWidth = CAPTURE_WIDTH,
  sourceHeight = CAPTURE_HEIGHT,
  outputWidth = DEFAULT_WIDTH,
  outputHeight = DEFAULT_HEIGHT,
} = {}) {
  if (!camera?.beats?.length) throw new Error('缺少后期摄影机时间线');
  const fps = camera.fps || DEFAULT_FPS;
  const renderBeats = camera.renderBeats || camera.beats;
  const zoom = piecewiseExpression(renderBeats, 'scale', fps);
  const x = piecewiseExpression(renderBeats, 'x', fps);
  const y = piecewiseExpression(renderBeats, 'y', fps);
  return [
    `scale=${sourceWidth}:${sourceHeight}:flags=lanczos`,
    `zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${outputWidth}x${outputHeight}:fps=${fps}`,
    `fps=${fps}`,
    'format=yuv420p',
  ].join(',');
}

export function buildSegmentedCameraFilter({
  camera,
  durationMs,
  sourceWidth = CAPTURE_WIDTH,
  sourceHeight = CAPTURE_HEIGHT,
  outputWidth = DEFAULT_WIDTH,
  outputHeight = DEFAULT_HEIGHT,
} = {}) {
  const beats = camera?.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new Error('缺少分段摄影机时间线');
  }
  const fps = camera.fps || DEFAULT_FPS;
  const splitLabels = beats.map((_, index) => `[cameraSource${index}]`).join('');
  const chains = [`[0:v]split=${beats.length}${splitLabels}`];
  const outputs = [];
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index];
    const startSeconds = (beat.startMs / 1000).toFixed(3);
    const endMs = index === beats.length - 1 ? durationMs : beats[index + 1].startMs;
    const endSeconds = (endMs / 1000).toFixed(3);
    const crop = beat.crop;
    const output = `cameraPart${index}`;
    outputs.push(`[${output}]`);
    chains.push(
      `[cameraSource${index}]trim=start=${startSeconds}:end=${endSeconds},setpts=PTS-STARTPTS,crop=${crop.width.toFixed(6)}:${crop.height.toFixed(6)}:${crop.x.toFixed(6)}:${crop.y.toFixed(6)},scale=${outputWidth}:${outputHeight}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p[${output}]`
    );
  }
  chains.push(
    `${outputs.join('')}concat=n=${outputs.length}:v=1:a=0[camera]`
  );
  return { graph: chains.join(';'), outputLabel: 'camera' };
}

export function buildCaptionOverlayFilter({
  baseLabel = 'camera',
  captions,
  firstInputIndex = 2,
} = {}) {
  if (!Array.isArray(captions) || captions.length === 0) {
    throw new Error('缺少 PNG 字幕清单');
  }
  const chains = [];
  let inputLabel = baseLabel;
  captions.forEach((caption, index) => {
    const outputLabel = `caption${index + 1}`;
    const start = (Number(caption.startMs) / 1000).toFixed(3);
    const end = (Number(caption.endMs) / 1000).toFixed(3);
    if (!(Number(caption.endMs) > Number(caption.startMs))) {
      throw new Error(`字幕 ${index + 1} 时间无效`);
    }
    chains.push(
      `[${inputLabel}][${firstInputIndex + index}:v]overlay=x=(W-w)/2:y=H-h-44:shortest=1:eof_action=endall:enable='between(t,${start},${end})'[${outputLabel}]`
    );
    inputLabel = outputLabel;
  });
  return { graph: chains.join(';'), outputLabel: inputLabel };
}

export function validateFinalMediaProbe(probe) {
  const durationSeconds = Number.parseFloat(probe?.format?.duration || '0');
  if (!(durationSeconds > 0 && durationSeconds < 300)) {
    throw new Error(`最终成片必须少于 300 秒：${durationSeconds}`);
  }
  const video = probe?.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe?.streams?.find((stream) => stream.codec_type === 'audio');
  const frameRate = video?.avg_frame_rate === '30/1' || video?.r_frame_rate === '30/1';
  if (!video || video.codec_name !== 'h264' || video.width !== 1920 || video.height !== 1080 || !frameRate) {
    throw new Error('最终视频必须为 1920×1080、30fps、H.264');
  }
  if (!audio || audio.codec_name !== 'aac' || Number(audio.sample_rate) !== 48000 || audio.channels !== 2) {
    throw new Error('最终音轨必须为 AAC 48kHz 双声道');
  }
  return { durationSeconds, video, audio };
}

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
  options = {}
) {
  const introMs = options.introMs ?? plan.intro?.durationMs ?? 10000;
  const outroMs = options.outroMs ?? plan.outro?.durationMs ?? 15000;
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

function allocateDurations(items, totalMs, minimumMs) {
  const remaining = items.map((item) => ({
    ...item,
    weight: Math.max(1, Array.from(item.text || '').length),
    durationMs: null,
  }));
  let availableMs = totalMs;
  let availableWeight = remaining.reduce((sum, item) => sum + item.weight, 0);
  while (remaining.some((item) => item.durationMs === null)) {
    let fixedAny = false;
    for (const item of remaining) {
      if (item.durationMs !== null) continue;
      const proportional = (availableMs * item.weight) / availableWeight;
      if (proportional < minimumMs) {
        item.durationMs = minimumMs;
        availableMs -= minimumMs;
        availableWeight -= item.weight;
        fixedAny = true;
      }
    }
    if (!fixedAny) break;
  }
  const flexible = remaining.filter((item) => item.durationMs === null);
  let assigned = 0;
  for (let index = 0; index < flexible.length; index += 1) {
    const item = flexible[index];
    item.durationMs =
      index === flexible.length - 1
        ? availableMs - assigned
        : Math.round((availableMs * item.weight) / availableWeight);
    assigned += item.durationMs;
  }
  return remaining;
}

export function pacePlanFromSpeech(
  plan,
  speech,
  {
    minimumSegmentMs = 6500,
    leadingPaddingMs = 500,
    trailingPaddingMs = 500,
    minimumDurationMs = 195_000,
    maximumDurationMs = 270_000,
  } = {}
) {
  const sources = [
    { id: 'intro', ...plan.intro },
    ...plan.steps.map((step) => ({
      id: step.id,
      narration: step.narration,
      narrationChapter: step.narrationChapter,
    })),
    { id: 'outro', ...plan.outro },
  ];
  const speechById = new Map(speech.map((item) => [item.id, item]));
  const chapters = [];
  for (const source of sources) {
    const id = source.narrationChapter || source.id;
    let chapter = chapters.at(-1);
    if (!chapter || chapter.id !== id) {
      if (chapters.some((item) => item.id === id)) {
        throw new Error(`旁白章节必须连续：${id}`);
      }
      const audio = speechById.get(id);
      if (!audio || !Number.isFinite(Number(audio.durationMs))) {
        throw new Error(`${id} 缺少真实 TTS 时长`);
      }
      chapter = { id, speechDurationMs: Math.ceil(Number(audio.durationMs)), sources: [] };
      chapters.push(chapter);
    }
    chapter.sources.push({ id: source.id, text: source.narration || '' });
  }

  const basePaddingMs = leadingPaddingMs + trailingPaddingMs;
  let durationMs = chapters.reduce(
    (sum, chapter) => sum + chapter.speechDurationMs + basePaddingMs,
    0
  );
  if (durationMs < minimumDurationMs) {
    let extraMs = minimumDurationMs - durationMs;
    for (const chapter of chapters) {
      const capacity = Math.max(0, 1200 - trailingPaddingMs);
      const addition = Math.min(capacity, Math.ceil(extraMs / (chapters.length - chapters.indexOf(chapter))));
      chapter.extraPaddingMs = addition;
      extraMs -= addition;
    }
    if (extraMs > 0) throw new Error('自然旁白过短，无法在不制造空停的情况下达到目标时长');
    durationMs = minimumDurationMs;
  }
  if (durationMs > maximumDurationMs) {
    throw new Error(`自然旁白成片时长 ${durationMs}ms 超过上限 ${maximumDurationMs}ms`);
  }

  const durationBySource = new Map();
  for (const chapter of chapters) {
    const chapterDurationMs =
      chapter.speechDurationMs + basePaddingMs + (chapter.extraPaddingMs || 0);
    const minimumTotal = chapter.sources.length * minimumSegmentMs;
    if (chapterDurationMs < minimumTotal) {
      throw new Error(`${chapter.id} 镜头过密，无法保证每镜头 ${minimumSegmentMs}ms`);
    }
    const allocation = allocateDurations(
      chapter.sources,
      chapterDurationMs,
      minimumSegmentMs
    );
    for (const item of allocation) durationBySource.set(item.id, item.durationMs);
    chapter.durationMs = chapterDurationMs;
    chapter.trailingSilenceMs = trailingPaddingMs + (chapter.extraPaddingMs || 0);
    delete chapter.sources;
    delete chapter.extraPaddingMs;
  }

  return {
    plan: {
      ...plan,
      steps: plan.steps.map((step) => ({
        ...step,
        holdMs: durationBySource.get(step.id),
      })),
    },
    introMs: durationBySource.get('intro'),
    outroMs: durationBySource.get('outro'),
    durationMs,
    chapters,
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

export function buildAlignedNarrationClips({
  timeline,
  speech,
  alignment,
  minimumEdgePaddingMs = 300,
}) {
  const speechById = new Map(speech.map((item) => [item.id, item]));
  const segmentById = new Map(timeline.segments.map((item) => [item.id, item]));
  return buildNarrationChapters(timeline).flatMap((chapter) => {
    const chapterSpeech = speechById.get(chapter.id);
    if (!chapterSpeech) throw new Error(`${chapter.id} 缺少旁白音频`);
    const durationMs = Math.ceil(Number(chapterSpeech.durationMs));
    const boundaries = alignment?.[chapter.id];
    if (!Array.isArray(boundaries) || boundaries.length !== chapter.sourceSegments.length - 1) {
      throw new Error(`${chapter.id} 静音对齐边界数量不正确`);
    }
    const points = [0, ...boundaries.map(Number), durationMs];
    for (let index = 1; index < points.length; index += 1) {
      if (!Number.isFinite(points[index]) || points[index] <= points[index - 1]) {
        throw new Error(`${chapter.id} 静音对齐边界必须严格递增`);
      }
    }
    if (points.at(-1) !== durationMs) {
      throw new Error(`${chapter.id} 静音对齐边界超出音频时长`);
    }
    return chapter.sourceSegments.map((source, index) => {
      const segment = segmentById.get(source.id);
      if (!segment) throw new Error(`${source.id} 缺少真实镜头时间`);
      const trimStartMs = points[index];
      const clipDurationMs = points[index + 1] - trimStartMs;
      const segmentDurationMs = segment.endMs - segment.startMs;
      const availableMs = segmentDurationMs - minimumEdgePaddingMs * 2;
      if (clipDurationMs > availableMs) {
        throw new Error(
          `${source.id} 对齐旁白超过镜头安全区：${clipDurationMs}ms > ${availableMs}ms`
        );
      }
      const startMs =
        segment.startMs + Math.round((segmentDurationMs - clipDurationMs) / 2);
      return {
        id: source.id,
        chapterId: chapter.id,
        text: source.text,
        file: chapterSpeech.file,
        trimStartMs,
        durationMs: clipDurationMs,
        startMs,
        endMs: startMs + clipDurationMs,
        segmentEndMs: segment.endMs,
      };
    });
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
  videoFilter = 'scale=1920:1080:flags=lanczos,fps=30',
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
    videoFilter,
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

  const chains = inputs.map((input, index) => {
    const trim =
      Number.isFinite(input.trimStartMs) && Number.isFinite(input.durationMs)
        ? `,atrim=start=${(input.trimStartMs / 1000).toFixed(3)}:duration=${(
            input.durationMs / 1000
          ).toFixed(3)},asetpts=PTS-STARTPTS`
        : '';
    return `[${index + 1}:a]loudnorm=I=-18:TP=-2:LRA=7${trim},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(
      input.startMs
    )}|${Math.round(input.startMs)}[voice${index + 1}]`;
  });
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
