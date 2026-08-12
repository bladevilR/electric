import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildChapterSyncedFfmpegArgs,
  buildFfmpegArgs,
} from './lib/video-production.mjs';

function run(command, args, { cwd, log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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

export async function probeMedia(file, { cwd, log } = {}) {
  const result = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      file,
    ],
    { cwd, log }
  );
  return JSON.parse(result.stdout);
}

export async function renderFinalVideo({ projectRoot, paths, log }) {
  const rawProbe = await probeMedia(paths.rawVideo, { cwd: projectRoot, log });
  const audioProbe = await probeMedia(paths.narrationAudio, {
    cwd: projectRoot,
    log,
  });
  const rawSeconds = Number.parseFloat(rawProbe?.format?.duration || '0');
  const audioSeconds = Number.parseFloat(audioProbe?.format?.duration || '0');
  const durationSeconds = Math.max(rawSeconds, audioSeconds);

  // 优先：章节声画同步剪辑（裁掉墙钟拖尾静音）
  let chapterClips = null;
  try {
    const meta = JSON.parse(
      await readFile(path.join(paths.narrationDirectory, 'metadata.json'), 'utf8')
    );
    chapterClips = meta?.chapterMixClips;
  } catch {
    chapterClips = null;
  }

  if (Array.isArray(chapterClips) && chapterClips.length > 0) {
    log?.('使用章节声画同步剪辑生成成片（裁剪跨章静音拖尾）');
    await run(
      'ffmpeg',
      buildChapterSyncedFfmpegArgs({
        rawVideo: paths.rawVideo,
        chapterClips,
        finalVideo: paths.finalVideo,
        maxDurationSeconds: 300,
      }),
      { cwd: projectRoot, log }
    );
  } else {
    await run(
      'ffmpeg',
      buildFfmpegArgs({
        rawVideo: paths.rawVideo,
        narrationAudio: paths.narrationAudio,
        finalVideo: paths.finalVideo,
        durationSeconds,
        maxDurationSeconds: 300,
      }),
      { cwd: projectRoot, log }
    );
  }
  return probeMedia(paths.finalVideo, { cwd: projectRoot, log });
}
