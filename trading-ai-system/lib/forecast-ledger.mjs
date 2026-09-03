import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REQUIRED = ['forecastRunId','forecastRunType','targetField','targetTradingDate','forecastGeneratedAt','decisionCutoffAt','featureSnapshotId','featureVersion','modelId','modelVersion','codeCommitSha','trainingStartDate','trainingEndDate','backtestSplitLabel'];
const SENSITIVE = /cookie|token|ticket|authorization|password|secret|credential|cert|private.?key|pin/i;
const TYPES = new Set(['live_issued', 'point_in_time_replay']);

function rejectSensitive(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE.test(key)) throw new Error(`sensitive_key_rejected:${key}`);
    rejectSensitive(child);
  }
}

export function createForecastRun(input = {}) {
  rejectSensitive(input);
  for (const field of REQUIRED) {
    if (input[field] === undefined || input[field] === null || input[field] === '') {
      if (field === 'decisionCutoffAt') throw new Error('decision_cutoff_required');
      if (field === 'featureSnapshotId') throw new Error('feature_snapshot_required');
      throw new Error(`forecast_run_field_required:${field}`);
    }
  }
  if (!TYPES.has(input.forecastRunType)) throw new Error('forecast_run_type_invalid');
  const inheritedCompleteness = Number(input.inputCompletenessPct);
  const rows = (input.rows || []).map((row) => {
    if (!Number.isInteger(row.pointIndex) || row.pointIndex < 1 || row.pointIndex > 96) throw new Error('point_index_invalid');
    if ([row.p10, row.p50, row.p90].every(Number.isFinite) && !(row.p10 <= row.p50 && row.p50 <= row.p90)) throw new Error('quantiles_not_monotonic');
    const inputCompletenessPct = Number.isFinite(Number(row.inputCompletenessPct)) ? Number(row.inputCompletenessPct) : inheritedCompleteness;
    if (!Number.isFinite(inputCompletenessPct)) throw new Error('input_completeness_required');
    return { ...row, inputCompletenessPct };
  });
  return Object.freeze({ ...input, rows: Object.freeze(rows.map(Object.freeze)), executionAllowed: false });
}

export function appendForecastRun(ledger, run) {
  if ((ledger?.runs || []).some((item) => item.forecastRunId === run.forecastRunId)) throw new Error('forecast_run_already_exists');
  return { version: ledger?.version || 1, runs: [...(ledger?.runs || []), run].sort((a,b) => Date.parse(a.forecastGeneratedAt)-Date.parse(b.forecastGeneratedAt) || a.targetTradingDate.localeCompare(b.targetTradingDate) || a.forecastRunId.localeCompare(b.forecastRunId)) };
}

export function findForecastRuns(ledger, filter = {}) {
  return (ledger?.runs || []).filter((run) => Object.entries(filter).every(([key, value]) => value === undefined || run[key] === value));
}

export async function readForecastLedger(filePath) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return { version: 1, runs: [] }; throw error; }
}

export async function writeForecastLedgerAtomic(filePath, ledger) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}
