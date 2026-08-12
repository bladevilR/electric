import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validateFinalMediaProbe } from './lib/video-production.mjs';
import { probeMedia } from './render-final.mjs';

function run(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${path.basename(command)} 验收命令失败（${code}）\n${stderr || stdout}`));
    });
  });
}

function matches(text, expression) {
  return Array.from(text.matchAll(expression), (match) => match.slice(1));
}

async function main() {
  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const videoRoot = path.join(projectRoot, 'output', 'video');
  const finalVideo = path.join(videoRoot, '电力交易AI-智能交易副驾驶-参赛版.mp4');
  const acceptance = path.join(videoRoot, 'acceptance-final');
  await mkdir(acceptance, { recursive: true });

  const probe = await probeMedia(finalVideo, { cwd: projectRoot });
  const media = validateFinalMediaProbe(probe);
  const buffer = await readFile(finalVideo);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const visual = await run(
    'ffmpeg',
    [
      '-hide_banner', '-nostats', '-i', finalVideo,
      '-vf', "blackdetect=d=0.5:pix_th=0.02,freezedetect=n=-55dB:d=3,signalstats,metadata=print",
      '-an', '-f', 'null', '-',
    ],
    { cwd: projectRoot }
  );
  const audio = await run(
    'ffmpeg',
    [
      '-hide_banner', '-nostats', '-i', finalVideo,
      '-af', 'silencedetect=n=-50dB:d=1.5,volumedetect',
      '-vn', '-f', 'null', '-',
    ],
    { cwd: projectRoot }
  );
  const blackStarts = matches(visual.stderr, /black_start:([0-9.]+)/g).map(Number);
  const freezeDurations = matches(visual.stderr, /freeze_duration: ([0-9.]+)/g).map(Number);
  const silenceDurations = matches(audio.stderr, /silence_duration: ([0-9.]+)/g).map(Number);
  const yMin = matches(visual.stderr, /lavfi\.signalstats\.YMIN=([0-9.]+)/g).map(Number);
  const pureWhiteFrames = yMin.filter((value) => value >= 250).length;
  const meanVolume = Number(matches(audio.stderr, /mean_volume: (-?[0-9.]+) dB/g).at(-1)?.[0]);
  const maxVolume = Number(matches(audio.stderr, /max_volume: (-?[0-9.]+) dB/g).at(-1)?.[0]);
  const timeline = JSON.parse(await readFile(path.join(videoRoot, 'timeline.json'), 'utf8'));
  const captions = JSON.parse(
    await readFile(path.join(videoRoot, 'caption-overlays', 'manifest.json'), 'utf8')
  );

  await run(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', finalVideo,
      '-vf', 'fps=1/2,scale=480:-1,tile=5x6',
      path.join(acceptance, 'contact-%02d.png'),
    ],
    { cwd: projectRoot }
  );
  for (const second of [1, 10, 35, 42, 52, 75, 110, 145, 180, 215, 227]) {
    await run(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(second),
        '-i', finalVideo, '-frames:v', '1',
        path.join(acceptance, `critical-${String(second).padStart(3, '0')}.png`),
      ],
      { cwd: projectRoot }
    );
  }
  await run(
    'ffmpeg',
    ['-hide_banner', '-v', 'error', '-i', finalVideo, '-f', 'null', '-'],
    { cwd: projectRoot }
  );

  const checks = {
    media: true,
    durationUnderFiveMinutes: media.durationSeconds < 300,
    noBlackFrames: blackStarts.length === 0,
    noPureWhiteFrames: pureWhiteFrames === 0,
    noLongFreeze: freezeDurations.every((duration) => duration < 8),
    audioPresent: Number.isFinite(maxVolume) && maxVolume > -12,
    silenceBounded: silenceDurations.every((duration) => duration < 6),
    cameraTimeline: timeline.camera?.beats?.length >= 16 && timeline.camera.beats.length <= 22,
    captionsGenerated: captions.length >= 1,
    fullDecode: true,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    finalVideo,
    sha256,
    media: {
      durationSeconds: media.durationSeconds,
      video: { codec: media.video.codec_name, width: media.video.width, height: media.video.height, fps: media.video.avg_frame_rate },
      audio: { codec: media.audio.codec_name, sampleRate: media.audio.sample_rate, channels: media.audio.channels },
    },
    camera: {
      beats: timeline.camera.beats.length,
      closeUps: timeline.camera.beats.filter((beat) => beat.scale >= 1.5).length,
      maximumScale: Math.max(...timeline.camera.beats.map((beat) => beat.scale)),
    },
    captions: captions.length,
    detections: { blackStarts, freezeDurations, silenceDurations, pureWhiteFrames, meanVolume, maxVolume },
    checks,
    passed: Object.values(checks).every(Boolean),
  };
  await writeFile(path.join(acceptance, 'automated-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
