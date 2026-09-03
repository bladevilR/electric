import test from 'node:test';import assert from 'node:assert/strict';import {buildPriceForecastModel} from '../ui/view-models/price-forecast-model.js';import {renderPriceForecastView} from '../ui/views/price-forecast-view.js';
test('forecast page separates roles, vintages and uncertainty',()=>{const m=buildPriceForecastModel({forecastRuns:[],outcomes:[]});assert.deepEqual(m.series.map(s=>s.role),['baseline','champion','challenger','actual']);const html=renderPriceForecastView({mode:'real',forecastReport:{}});['用户日前临时价','用户日前最终价','实时当前价','实时最终价','P10 / P50 / P90'].forEach(label=>assert.match(html,new RegExp(label)));assert.doesNotMatch(html,/导致|造成/);});

test('forecast page consumes the issued ledger without inventing actual outcomes', () => {
  const html = renderPriceForecastView({
    mode: 'real',
    forecastRuns: {
      runs: [{
        forecastRunId: 'live-20260904-verified-v1',
        forecastRunType: 'live_issued',
        modelId: 'rolling_same_slot_median_28',
        modelVersion: '1.0.0',
        targetTradingDate: '2026-09-04',
        readiness: { status: 'baseline_only' },
        rows: Array.from({ length: 96 }, (_, index) => ({ pointIndex: index + 1, p50: 300 })),
      }],
    },
  });

  assert.match(html, /rolling_same_slot_median_28 · 1\.0\.0/);
  assert.match(html, /96 点/);
  assert.match(html, /actual[\s\S]*尚无可用实际结果/);
});
