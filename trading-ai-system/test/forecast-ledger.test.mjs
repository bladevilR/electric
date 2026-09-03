import test from 'node:test';
import assert from 'node:assert/strict';
import { createForecastRun, appendForecastRun, findForecastRuns } from '../lib/forecast-ledger.mjs';

const input = {
  forecastRunId: 'run-1', forecastRunType: 'live_issued', targetField: 'dayAheadUserPriceFinalYuanPerMwh',
  targetTradingDate: '2026-08-24', forecastGeneratedAt: '2026-08-23T09:58:00+08:00', decisionCutoffAt: '2026-08-23T10:00:00+08:00',
  featureSnapshotId: 'snapshot-1', featureVersion: 'features-v1', modelId: 'median', modelVersion: '1.0.0', codeCommitSha: 'abc1234',
  trainingStartDate: '2026-08-01', trainingEndDate: '2026-08-22', backtestSplitLabel: 'live', inputCompletenessPct: 100,
  rows: [{ pointIndex: 1, pointForecast: 318.5, p10: 300, p50: 318.5, p90: 340 }],
};

test('forecast runs are immutable and run types stay isolated', () => {
  const live = createForecastRun(input);
  const replay = createForecastRun({ ...input, forecastRunId: 'replay-1', forecastRunType: 'point_in_time_replay' });
  const ledger = appendForecastRun(appendForecastRun({ version: 1, runs: [] }, live), replay);
  assert.throws(() => appendForecastRun(ledger, live), /forecast_run_already_exists/);
  assert.deepEqual(findForecastRuns(ledger, { forecastRunType: 'live_issued' }).map((run) => run.forecastRunId), ['run-1']);
});

test('forecast run requires provenance and rejects invalid quantiles or secrets', () => {
  assert.throws(() => createForecastRun({ ...input, decisionCutoffAt: '' }), /decision_cutoff_required/);
  assert.throws(() => createForecastRun({ ...input, featureSnapshotId: '' }), /feature_snapshot_required/);
  assert.throws(() => createForecastRun({ ...input, rows: [{ pointIndex: 1, p10: 20, p50: 10, p90: 30 }] }), /quantiles_not_monotonic/);
  assert.throws(() => createForecastRun({ ...input, metadata: { accessToken: 'x' } }), /sensitive_key_rejected/);
});
