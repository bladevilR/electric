import { spawn } from 'node:child_process';
import path from 'node:path';

import { buildFfmpegArgs } from './lib/video-production.mjs';

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
  return probeMedia(paths.finalVideo, { cwd: projectRoot, log });
}
