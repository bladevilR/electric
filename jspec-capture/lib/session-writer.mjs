import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildCaptureSummary, formatCoverageMarkdown } from './capture-summary.mjs';
import { formatTimestamp } from './capture-utils.mjs';
import { summarizeTargetCoverage } from './jspec-targets.mjs';

function toIndexResponse(capture) {
  return {
    fileName: capture.fileName,
    businessTarget: capture.businessTarget,
    ...capture.meta,
  };
}

export async function createSessionWriter({
  outputRoot,
  pageUrl,
  session = {},
  now = new Date(),
}) {
  const captureDir = path.join(outputRoot, `session-${formatTimestamp(now)}`);
  const responsesDir = path.join(captureDir, 'responses');
  const captures = [];
  const createdAt = now.toISOString();
  let pending = Promise.resolve();
  let latestPageUrl = pageUrl;
  let latestSession = { ...session };

  await mkdir(responsesDir, { recursive: true });

  async function writeDerivedFiles() {
    const indexPayload = {
      pageUrl: latestPageUrl,
      captureCount: captures.length,
      createdAt,
      updatedAt: new Date().toISOString(),
      targetCoverage: summarizeTargetCoverage(captures),
      responses: captures.map(toIndexResponse),
    };

    await writeFile(
      path.join(captureDir, 'index.json'),
      JSON.stringify(indexPayload, null, 2),
      'utf8'
    );

    const summary = buildCaptureSummary(captures);
    await writeFile(
      path.join(captureDir, 'coverage-summary.json'),
      JSON.stringify(summary, null, 2),
      'utf8'
    );
    await writeFile(
      path.join(captureDir, 'coverage-summary.md'),
      formatCoverageMarkdown(summary),
      'utf8'
    );
  }

  async function writeSessionFile() {
    await writeFile(
      path.join(captureDir, 'session.json'),
      JSON.stringify(
        {
          ...latestSession,
          createdAt,
          updatedAt: new Date().toISOString(),
          captureCount: captures.length,
        },
        null,
        2
      ),
      'utf8'
    );
  }

  async function enqueue(task) {
    pending = pending.then(task, task);
    return pending;
  }

  await writeDerivedFiles();
  await writeSessionFile();

  return {
    captureDir,
    responsesDir,

    async writeCapture(capture) {
      return enqueue(async () => {
        captures.push(capture);
        await writeFile(
          path.join(responsesDir, capture.fileName),
          JSON.stringify(capture, null, 2),
          'utf8'
        );
        await appendFile(
          path.join(captureDir, 'events.jsonl'),
          `${JSON.stringify(toIndexResponse(capture))}\n`,
          'utf8'
        );
        await writeDerivedFiles();
        await writeSessionFile();
      });
    },

    async finalize({
      pageUrl: finalPageUrl,
      snapshotHtml,
      snapshotText,
      session: finalSession = {},
    } = {}) {
      return enqueue(async () => {
        latestPageUrl = finalPageUrl ?? latestPageUrl;
        latestSession = {
          ...latestSession,
          ...finalSession,
        };
        await writeFile(path.join(captureDir, 'dashboard.html'), snapshotHtml ?? '', 'utf8');
        await writeFile(path.join(captureDir, 'dashboard.txt'), snapshotText ?? '', 'utf8');
        await writeDerivedFiles();
        await writeSessionFile();
      });
    },

    async flush() {
      return pending;
    },
  };
}
