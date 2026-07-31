import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildNarrationMixArgs,
  buildNarrationSegments,
  buildQwenTtsManifest,
  buildSpeechFitArgs,
  buildSrt,
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
          process.env.QWEN_TTS_REUSE_EXISTING || '0',
      },
      log,
    }
  );

  const speech = [];
  for (const segment of timeline.segments) {
    if (!segment.narration) continue;
    let output = path.join(
      paths.narrationDirectory,
      `${segment.id}.wav`
    );
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
      // 允许为贴合镜头适度提速；超过 1.45 仍拒绝
      if (speedFactor > 1.45) {
        throw new Error(
          `${segment.id} Qwen 旁白超时过多，拒绝强行提速：${durationMs}ms > ${availableMs}ms`
        );
      }
      speedFactor = Math.min(1.45, Math.max(1.01, speedFactor));
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
          1.45,
          Math.max(1.01, (durationMs / availableMs) * 1.005)
        );
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
      durationMs,
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
  const durationsById = Object.fromEntries(
    speech.map((item) => [item.id, item.durationMs])
  );
  const narrationSegments = buildNarrationSegments(
    timeline,
    durationsById
  );
  await writeFile(paths.subtitles, buildSrt(narrationSegments), 'utf8');
  await writeFile(
    path.join(paths.narrationDirectory, 'metadata.json'),
    `${JSON.stringify(speech, null, 2)}\n`,
    'utf8'
  );
  const audioInputs = narrationSegments.map((segment) => ({
    file: speech.find((item) => item.id === segment.id).file,
    startMs: segment.startMs,
  }));
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
