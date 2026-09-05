import test from 'node:test';import assert from 'node:assert/strict';import {buildPriceForecastModel} from '../ui/view-models/price-forecast-model.js';import {renderPriceForecastView} from '../ui/views/price-forecast-view.js';
test('forecast page explains uncertainty without exposing internal roles or claiming missing accuracy',()=>{const m=buildPriceForecastModel({forecastRuns:[],outcomes:[]});assert.deepEqual(m.series.map(s=>s.role),['baseline','champion','challenger','actual']);const html=renderPriceForecastView({mode:'real',forecastReport:{}});assert.match(html,/价格可能范围/);assert.match(html,/不会显示虚假的准确度/);assert.doesNotMatch(html,/导致|造成|baseline|champion|challenger/);});

test('forecast page consumes the issued ledger without inventing actual outcomes', () => {
  const html = renderPriceForecastView({
    mode: 'real',
    targetDate: '2026-09-04',
    forecastRuns: {
      runs: [{
        forecastRunId: 'live-20260904-verified-v1',
        forecastRunType: 'live_issued',
        targetField: 'dayAheadUserPriceFinalYuanPerMwh',
        modelId: 'rolling_same_slot_median_28',
        modelVersion: '1.0.0',
        targetTradingDate: '2026-09-04',
        readiness: { status: 'baseline_only' },
        rows: Array.from({ length: 96 }, (_, index) => ({ pointIndex: index + 1, p50: 300 })),
      }],
    },
  });

  assert.match(html, /历史同一时段的中间价格/);
  assert.equal(html.match(/<polyline[^>]*data-series-role="forecast"[^>]*points="([^"]*)"/)?.[1].split(' ').length,96);
  assert.doesNotMatch(html, /data-series-role="actual"/);
});
