import { spawn } from 'node:child_process';
import path from 'node:path';

import { readFile } from 'node:fs/promises';

import {
  buildCaptionOverlayFilter,
  buildSegmentedCameraFilter,
  validateFinalMediaProbe,
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
  const timeline = JSON.parse(await readFile(paths.timeline, 'utf8'));
  const cameraFilter = buildSegmentedCameraFilter({
    camera: timeline.camera,
    durationMs: timeline.durationMs,
    sourceWidth: timeline.width,
    sourceHeight: timeline.height,
  });
  const captionDirectory = path.join(paths.root, 'caption-overlays');
  const captionManifest = path.join(captionDirectory, 'manifest.json');
  await run(
    'python3',
    [
      path.join(projectRoot, 'recording', 'local', 'render-caption-overlays.py'),
      paths.subtitles,
      captionDirectory,
      captionManifest,
    ],
    { cwd: projectRoot, log }
  );
  const captions = JSON.parse(await readFile(captionManifest, 'utf8'));
  const captionFilter = buildCaptionOverlayFilter({
    baseLabel: 'camera',
    captions,
    firstInputIndex: 2,
  });
  const args = ['-y', '-i', paths.rawVideo, '-i', paths.narrationAudio];
  for (const caption of captions) {
    args.push('-loop', '1', '-framerate', '30', '-i', caption.file);
  }
  args.push(
    '-filter_complex',
    `${cameraFilter.graph};${captionFilter.graph}`,
    '-map',
    `[${captionFilter.outputLabel}]`,
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '17',
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
    '-t',
    Math.min(durationSeconds, 300).toFixed(3),
    paths.finalVideo
  );
  await run(
    'ffmpeg',
    args,
    { cwd: projectRoot, log }
  );
  const finalProbe = await probeMedia(paths.finalVideo, { cwd: projectRoot, log });
  validateFinalMediaProbe(finalProbe);
  return finalProbe;
}
