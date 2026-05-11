import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUkeyAssistantStatus,
  mergeVisibleSnapshot,
  validateVisibleSnapshot,
} from '../lib/ukey-assistant.mjs';

test('buildUkeyAssistantStatus describes a local-only compliant UKey workflow', () => {
  const status = buildUkeyAssistantStatus({
    env: { JSPEC_URL: 'https://www.jspec.com.cn/' },
    summary: { fieldCompleteness: { realTimeAvgPrice: 57 } },
  });

  assert.equal(status.mode, 'local_integrated_ukey_assistant');
  assert.equal(status.launch.url, 'https://www.jspec.com.cn/');
  assert.equal(status.capabilities.localOnly, true);
  assert.equal(status.capabilities.serverReadsUkey, false);
  assert.equal(status.capabilities.serverReadsCredential, false);
  assert.equal(status.realtimeData.status, 'snapshot_available');
  assert.equal(status.realtimeData.pointCount, 57);
  assert.ok(status.workflow.some((item) => item.id === 'login_with_ukey'));
  assert.ok(status.collectionModes.some((item) => item.id === 'visible_page_snapshot'));
  assert.ok(status.prohibitedActions.includes('read_cookie'));
  assert.ok(status.prohibitedActions.includes('auto_submit_trade'));
});

test('validateVisibleSnapshot keeps visible business fields and rejects credentials', () => {
  const snapshot = validateVisibleSnapshot({
    source: 'jspec_visible_page',
    rows: [
      {
        date: '2026-05-09',
        pointIndex: '1',
        timePoint: '00:15',
        realTimeAvgPrice: '301.5',
        cookie: 'must-not-pass',
      },
    ],
  });

  assert.equal(snapshot.accepted, false);
  assert.match(snapshot.errors.join('\n'), /cookie/);

  const clean = validateVisibleSnapshot({
    source: 'jspec_visible_page',
    rows: [
      {
        date: '2026-05-09',
        pointIndex: '1',
        timePoint: '00:15',
        realTimeAvgPrice: '301.5',
        defaultDeclarationPower: '35.2',
      },
    ],
  });

  assert.equal(clean.accepted, true);
  assert.equal(clean.rows[0].pointIndex, 1);
  assert.equal(clean.rows[0].realTimeAvgPrice, 301.5);
  assert.equal(clean.rows[0].defaultDeclarationPower, 35.2);
  assert.equal(clean.rows[0].cookie, undefined);
});

test('mergeVisibleSnapshot overlays realtime rows without replacing unrelated fields', () => {
  const dataset = {
    quality: { dates: ['2026-05-09'], fieldCompleteness: { realTimeAvgPrice: 1 }, gaps: [] },
    rows: [
      {
        date: '2026-05-09',
        pointIndex: 1,
        timePoint: '00:15',
        defaultDeclarationPower: 30,
        realTimeAvgPrice: 280,
      },
    ],
  };
  const snapshot = validateVisibleSnapshot({
    rows: [{ date: '2026-05-09', pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: 315 }],
  });
  const merged = mergeVisibleSnapshot(dataset, snapshot);

  assert.equal(merged.rows[0].realTimeAvgPrice, 315);
  assert.equal(merged.rows[0].defaultDeclarationPower, 30);
  assert.equal(merged.quality.fieldCompleteness.realTimeAvgPrice, 1);
  assert.equal(merged.visibleSnapshot.applied, true);
});
