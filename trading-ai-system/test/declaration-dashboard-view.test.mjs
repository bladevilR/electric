import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeclarationCurveGeometry,
  buildDeclarationDashboardView,
  summarizeAdjustmentWindows,
} from '../lib/declaration-dashboard-view.mjs';

test('buildDeclarationDashboardView maps validated optimizer evidence without fixed demo values', () => {
  const view = buildDeclarationDashboardView({
    strategyValidation: {
      declarationOptimizer: {
        status: 'validated',
        holdout: {
          improvementPct: 9.64,
          dailyWinRatePct: 86.05,
          pointCount: 4128,
          dateCount: 43,
        },
        promotion: { eligible: true, reasons: [] },
      },
    },
    declarationRecommendation: {
      status: 'ready',
      coverage: {
        recommendedPointCount: 2,
        requiredPointCount: 2,
        optimizerPointCount: 2,
        fallbackPointCount: 0,
      },
      rows: [
        {
          pointIndex: 1,
          timePoint: '00:15',
          baselinePowerMw: 10,
          recommendedPowerMw: 12,
          deltaPowerMw: 2,
        },
        {
          pointIndex: 2,
          timePoint: '00:30',
          baselinePowerMw: 11,
          recommendedPowerMw: 9,
          deltaPowerMw: -2,
        },
      ],
    },
    costStrategy: { dataConfidence: { score: 88 } },
    execution: { dataReady: true, reviewed: false },
  });

  assert.equal(view.metrics.improvement.display, '+9.64%');
  assert.equal(view.metrics.winRate.display, '86.05%');
  assert.equal(view.metrics.coverage.display, '4,128 点 / 43 日');
  assert.equal(view.metrics.confidence.display, '88/100');
  assert.equal(view.recommendation.canReview, true);
  assert.equal(view.curve.rows.length, 2);
});

test('buildDeclarationDashboardView keeps missing evidence explicit instead of turning it into zero', () => {
  const view = buildDeclarationDashboardView({});

  assert.equal(view.metrics.improvement.display, '待验证');
  assert.equal(view.metrics.winRate.display, '待验证');
  assert.equal(view.metrics.coverage.display, '待验证');
  assert.equal(view.metrics.confidence.display, '待校验');
  assert.deepEqual(view.curve.rows, []);
});

test('summarizeAdjustmentWindows groups contiguous positive and negative points', () => {
  const windows = summarizeAdjustmentWindows([
    { pointIndex: 1, timePoint: '00:15', deltaPowerMw: 2 },
    { pointIndex: 2, timePoint: '00:30', deltaPowerMw: 1 },
    { pointIndex: 3, timePoint: '00:45', deltaPowerMw: -1 },
  ]);

  assert.deepEqual(
    windows.map((item) => item.direction),
    ['up', 'down']
  );
  assert.equal(windows[0].label, '00:15–00:30');
  assert.equal(windows[1].label, '00:45');
});

test('buildDeclarationCurveGeometry returns bounded SVG paths and point coordinates', () => {
  const geometry = buildDeclarationCurveGeometry(
    [
      { pointIndex: 1, baselinePowerMw: 10, recommendedPowerMw: 12 },
      { pointIndex: 2, baselinePowerMw: 20, recommendedPowerMw: 18 },
    ],
    { width: 800, height: 300 }
  );

  assert.match(geometry.baselinePath, /^M /);
  assert.match(geometry.recommendedPath, /^M /);
  assert.equal(geometry.points.length, 2);
  assert.ok(
    geometry.points.every(
      (point) =>
        point.x >= 0 &&
        point.x <= 800 &&
        point.baselineY >= 0 &&
        point.baselineY <= 300 &&
        point.recommendedY >= 0 &&
        point.recommendedY <= 300
    )
  );
});
