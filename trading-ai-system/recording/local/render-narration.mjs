import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildNarrationMixArgs,
  buildChapterCaptionSegments,
  buildNarrationChapters,
  buildQwenTtsManifest,
  buildSpeechFitArgs,
  buildSrt,
  buildTimedCaptionCues,
} from './lib/video-production.mjs';

function run(command, args, { cwd, env, log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      log?.(String(chunk).trimEnd());
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      log?.(String(chunk).trimEnd());
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${path.basename(command)} 执行失败（${code}）\n${stderr || stdout}`
        )
      );
    });
  });
}

async function probeDurationMs(file, { cwd, log }) {
  const result = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      file,
    ],
    { cwd, log }
  );
  const milliseconds = Number.parseFloat(result.stdout.trim()) * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error(`无法读取旁白时长：${file}`);
  }
  return Math.ceil(milliseconds);
}

async function generateQwenSpeech({
  timeline,
  paths,
  projectRoot,
  log,
}) {
  const manifest = buildQwenTtsManifest(
    timeline,
    paths.narrationDirectory
  );
  const manifestFile = path.join(
    paths.narrationDirectory,
    'qwen-manifest.json'
  );
  const signature = (value) =>
    JSON.stringify({
      modelDirectory: value?.modelDirectory,
      speaker: value?.speaker,
      language: value?.language,
      seed: value?.seed,
      instruct: value?.instruct,
      segments: value?.segments?.map((segment) => ({
        id: segment.id,
        text: segment.text,
        output: segment.output,
        sourceSegmentIds: segment.sourceSegmentIds,
      })),
    });
  const previousManifest = await readFile(manifestFile, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const canReuse =
    signature(previousManifest) === signature(manifest) &&
    manifest.segments.length > 0;
  await writeFile(
    manifestFile,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  await run(
    '/Users/r/Models/qwen3-tts-runtime/bin/python',
    [
      path.join(
        projectRoot,
        'recording',
        'local',
        'qwen-tts-render.py'
      ),
      manifestFile,
    ],
    {
      cwd: projectRoot,
      env: {
        PYTORCH_ENABLE_MPS_FALLBACK: '1',
        QWEN_TTS_REUSE_EXISTING:
          process.env.QWEN_TTS_REUSE_EXISTING || (canReuse ? '1' : '0'),
      },
      log,
    }
  );
  log?.(canReuse ? '旁白参数与文案未变，已复用 Serena 音频' : '旁白清单已变化，已重新生成 Serena 音频');

  const speech = [];
  for (const segment of manifest.segments) {
    let output = segment.output;
    let speedFactorApplied = 1;
    let durationMs = await probeDurationMs(output, {
      cwd: projectRoot,
      log,
    });
    // 与 buildNarrationSegments 的 500+500 安全边距对齐
    const availableMs = Math.max(
      1000,
      segment.endMs - segment.startMs - 1000
    );
    if (durationMs > availableMs) {
      let speedFactor = (durationMs / availableMs) * 1.01;
      // 只允许轻微时长适配，超过 1.15 会显著破坏自然声线。
      if (speedFactor > 1.15) {
        throw new Error(
          `${segment.id} Qwen 旁白超时过多，拒绝强行提速：${durationMs}ms > ${availableMs}ms`
        );
      }
      speedFactor = Math.min(1.15, Math.max(1.01, speedFactor));
      speedFactorApplied *= speedFactor;
      const fittedOutput = path.join(
        paths.narrationDirectory,
        `${segment.id}.fit.wav`
      );
      await run(
        'ffmpeg',
        buildSpeechFitArgs({
          input: output,
          output: fittedOutput,
          speedFactor,
        }),
        { cwd: projectRoot, log }
      );
      await rename(fittedOutput, output);
      durationMs = await probeDurationMs(output, {
        cwd: projectRoot,
        log,
      });
      // atempo 有舍入误差时再补一次精确贴合
      if (durationMs > availableMs) {
        const secondFactor = Math.min(
          1.15,
          Math.max(1.01, (durationMs / availableMs) * 1.005)
        );
        speedFactorApplied *= secondFactor;
        await run(
          'ffmpeg',
          buildSpeechFitArgs({
            input: output,
            output: fittedOutput,
            speedFactor: secondFactor,
          }),
          { cwd: projectRoot, log }
        );
        await rename(fittedOutput, output);
        durationMs = await probeDurationMs(output, {
          cwd: projectRoot,
          log,
        });
      }
      if (durationMs > availableMs) {
        throw new Error(
          `${segment.id} 提速后仍超安全区：${durationMs}ms > ${availableMs}ms`
        );
      }
    }
    speech.push({
      id: segment.id,
      file: output,
      engine: 'qwen3-tts',
      model: manifest.modelDirectory,
      voice: manifest.speaker,
      instruct: manifest.instruct,
      seed: manifest.seed,
      durationMs,
      speedFactor: Number(speedFactorApplied.toFixed(4)),
      sourceSegmentIds: segment.sourceSegmentIds,
      startMs: segment.startMs,
      endMs: segment.endMs,
    });
  }
  return speech;
}

export async function renderNarration({
  projectRoot,
  timeline,
  paths,
  log,
}) {
  await mkdir(paths.narrationDirectory, { recursive: true });
  const speech = await generateQwenSpeech({
    timeline,
    paths,
    projectRoot,
    log,
  });
  const speechById = new Map(speech.map((item) => [item.id, item]));
  const chapters = buildNarrationChapters(timeline);
  const narrationSegments = chapters.flatMap((chapter) => {
    const chapterSpeech = speechById.get(chapter.id);
    if (!chapterSpeech) throw new Error(`${chapter.id} 缺少旁白音频`);
    return buildChapterCaptionSegments(chapter, chapterSpeech.durationMs);
  });
  const subtitleCues = narrationSegments.flatMap((segment) =>
    buildTimedCaptionCues(
      { narration: segment.text, durationMs: segment.durationMs },
      { maxCharsPerLine: 24, maxLines: 2, minimumCueMs: 1200 }
    ).map((cue) => ({
      text: cue.lines.join('\n'),
      startMs: segment.startMs + cue.startMs,
      endMs: segment.startMs + cue.endMs,
    }))
  );
  await writeFile(paths.subtitles, buildSrt(subtitleCues), 'utf8');
  await writeFile(
    path.join(paths.narrationDirectory, 'metadata.json'),
    `${JSON.stringify(speech, null, 2)}\n`,
    'utf8'
  );
  const audioInputs = chapters.map((chapter) => {
    const chapterSpeech = speechById.get(chapter.id);
    return {
      file: chapterSpeech.file,
      startMs: chapter.startMs + 500,
    };
  });
  await run(
    'ffmpeg',
    buildNarrationMixArgs({
      inputs: audioInputs,
      durationMs: timeline.durationMs,
      output: paths.narrationAudio,
    }),
    { cwd: projectRoot, log }
  );
  return { speech, narrationSegments };
}
