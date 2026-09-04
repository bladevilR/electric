import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDataSourcesView } from '../ui/views/data-sources-view.js';
import { renderAccuracyHistory } from '../ui/components/foundation-forecast-chart.js';

test('history chart and provenance modes render distinct real data surfaces',()=>{
  const base={historyFacts:{query:{fieldId:'actualAverageLoadMw'},rows:[{businessDate:'2026-02-28',pointIndex:1,fieldId:'actualAverageLoadMw',value:40,unit:'MW',sourceId:'LOCAL-LOAD:核对单.xlsx'}]}};
  const chart=renderDataSourcesView({foundationInput:{...base,historyMode:'chart'}});
  assert.match(chart,/历史曲线 · 2026-02-28/);
  const evidence=renderDataSourcesView({foundationInput:{...base,historyMode:'evidence',historyCaptures:{captures:[{businessDate:'2026-02-28',sourceId:'LOCAL-LOAD:核对单.xlsx',contentSha256:'a'.repeat(64),evidence:{sourceFile:'核对单.xlsx',sourceSheet:'28',conversion:'MW = kWh / 1000 / 0.25'}}]}}});
  assert.match(evidence,/MW = kWh \/ 1000 \/ 0.25/);
  assert.match(evidence,/来源文件/);
  assert.doesNotMatch(evidence,/foundation-history-table/);
});

test('load workbench exposes historical backtest identity, real-load filters and every returned point',()=>{
  const html=renderDataSourcesView({mode:'real',targetDate:'2026-02-28',activeForecastTab:'load',foundationInput:{loadForecastReport:{kind:'historical_backtest',status:'ready',rows:[{pointIndex:1,pointForecast:42,actualValue:40}],metrics:{mae:2},sources:['LOCAL-LOAD:核对单.xlsx'],coverage:{dateCount:214,latestDate:'2026-05-05'},latestComparableDate:'2026-02-28',caveat:'事后回测，不是当时发布的预测'},historyFacts:{query:{from:'2026-02-28',to:'2026-02-28',fieldId:'actualAverageLoadMw'},rows:Array.from({length:96},(_,i)=>({businessDate:'2026-02-28',pointIndex:i+1,fieldId:'actualAverageLoadMw',value:40,unit:'MW',sourceId:'LOCAL-LOAD:核对单.xlsx'}))}}});
  assert.match(html,/事后回测/);assert.match(html,/查看最近可回测日/);
  assert.match(html,/value="actualAverageLoadMw" selected/);
  assert.match(html,/<td>96<\/td>/);
  assert.match(html,/核对单/);
});

function render(overrides = {}) {
  return renderDataSourcesView({
    mode: 'real',
    targetDate: '2026-09-03',
    activeForecastTab: 'price',
    openExplanation: '',
    provenanceOpen: false,
    sandboxControls: {
      priceWeight: 0.7,
      temperatureWeight: 0.5,
      loadWeight: 0.6,
      riskProfile: 'balanced',
    },
    foundationInput: {
      ukeyStatus: {
        collector: { state: 'stopped' },
        visibleHistory: { dates: ['2026-06-29'], rowCount: 79 },
      },
      workbench: {
        metrics: { marketPricePointCount: 0 },
        readiness: { status: 'data_blocked' },
      },
    },
    fieldCatalog: {
      fields: [{ fieldId: 'temperatureC', confirmationStatus: 'code_supported' }],
    },
    ...overrides,
  });
}

test('foundation view presents three forecast tabs and truthful collection state', () => {
  const html = render();

  ['价格预测', '温度预测', '负荷预测'].forEach((label) =>
    assert.match(html, new RegExp(label))
  );
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-forecast-tab="price"[^>]*aria-selected="true"/);
  assert.match(html, /今日数据未闭环/);
  assert.match(html, /采集器已停止/);
  assert.match(html, /历史真实数据/);
  assert.match(html, /79\/96点/);
  assert.doesNotMatch(html, /数据已就绪/);
});

test('foundation view renders unit-aware forecast chart and honest empty evidence', () => {
  const html = render();

  assert.match(html, /价格预测曲线/);
  assert.match(html, /元\/MWh/);
  assert.match(html, /当前页签尚无可用预测曲线/);
  assert.match(html, /MAE/);
  assert.match(html, /RMSE/);
  assert.match(html, /MAPE/);
  assert.doesNotMatch(html, /MAE[^<]*0(?:\.0+)?/);
});

test('foundation view renders contextual formula and in-window evidence drawer', () => {
  const html = render({ openExplanation: 'mape' });

  assert.match(html, /MAPE 平均绝对百分比误差/);
  assert.match(html, /1\/n/);
  assert.match(html, /aria-controls="foundationEvidenceDrawer"/);
  assert.match(html, /id="foundationEvidenceDrawer"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /核心公式/);
  assert.match(html, /数据血缘/);
});

test('foundation view exposes optimizer explanation with variables, units, and evidence', () => {
  const html = render({ openExplanation: 'optimizer' });

  assert.match(html, /依据说明 · 申报优化器/);
  assert.match(html, /申报电量ₜ/);
  assert.match(html, /MWh/);
  assert.match(html, /模型版本/);
  assert.match(html, /约束版本/);
  assert.match(html, /数据截止/);
});

test('foundation view labels tuning outputs as simulation and excludes trade submission', () => {
  const html = render();

  assert.match(html, /策略微调沙盒/);
  assert.match(html, /仅模拟，不会提交交易/);
  assert.match(html, /模拟测算/);
  assert.match(html, /应用到模拟方案/);
  assert.doesNotMatch(html, /自动提交|确认交易|立即下单/);
});

test('foundation view keeps field catalog available as progressive evidence', () => {
  const html = render();

  assert.match(html, /完整字段目录/);
  assert.match(html, /代码已支持，尚无非空实值/);
  assert.match(html, /页面原始表头/);
});

test('forecast comparison exposes semantic line roles and working evidence actions', () => {
  const html = render({
    foundationInput: {
      workbench: { metrics: { marketPricePointCount: 96 } },
      forecastReport: {
        forecasts: [{ pointIndex: 1, pointForecast: 420 }],
        actuals: [{ pointIndex: 1, value: 405 }],
        previousForecasts: [{ pointIndex: 1, value: 438 }],
      },
    },
  });

  assert.match(html, /data-series-role="actual"/);
  assert.match(html, /data-series-role="forecast"/);
  assert.match(html, /data-series-role="previous"[^>]*stroke-dasharray/);
  assert.match(html, /data-foundation-action="focus-versions"/);
  assert.match(html, /id="foundationVersionPanel"/);
  assert.match(
    html,
    /data-foundation-action="open-explanation" data-explanation-id="baselineSkill"/
  );
});

test('collection status links to the exact local data storage evidence', () => {
  const html = render({
    provenanceOpen: true,
    foundationInput: {
      workbench: { metrics: { marketPricePointCount: 0 } },
      ukeyStatus: {
        collector: { state: 'stopped', lastPageTitle: '实时价格' },
        visibleSnapshot: { storagePath: 'E:\\electric\\data\\snapshot.json' },
        visibleHistory: {
          storagePath: 'C:\\Users\\R\\history.json',
          rowCount: 79,
          dates: ['2026-06-29'],
        },
      },
    },
  });

  assert.match(html, /data-foundation-trigger="storage-location"/);
  assert.match(html, /采集数据存放/);
  assert.match(html, /E:\\electric\\data\\snapshot\.json/);
  assert.match(html, /C:\\Users\\R\\history\.json/);
  assert.match(html, /实时价格/);
});

test('short accuracy histories span the chart width instead of collapsing at the left edge', () => {
  const html = renderAccuracyHistory(
    [
      { value: 8.4 },
      { value: 7.1 },
      { value: 6.8 },
      { value: 7.5 },
      { value: 6.3 },
    ],
    '元/MWh'
  );

  assert.match(html, /points="10,/);
  assert.match(html, /960,/);
});

test('every derivation stage opens evidence and disclosure state is announced', () => {
  const html = render({ openExplanation: 'sources', provenanceOpen: false });

  for (const id of ['sources', 'quality', 'forecasts', 'fusion', 'optimizer', 'risk', 'review']) {
    assert.match(html, new RegExp(`data-explanation-id="${id}"`));
  }
  assert.match(
    html,
    /data-foundation-trigger="derivation-sources"[^>]*aria-expanded="true"/
  );
  assert.match(html, /foundation-provenance-trigger[^>]*aria-expanded="false"/);
});

test('collector errors and honest unavailable sandbox outcomes are visible', () => {
  const html = render({
    foundationInput: {
      workbench: {
        metrics: { marketPricePointCount: 0 },
        declarationRecommendation: { rows: [{ pointIndex: 1, recommendedPowerMw: 100 }] },
      },
      ukeyStatus: {
        loadError: '采集状态接口不可用',
        collector: { state: 'error', lastError: 'Chrome 调试端口未连接' },
        visibleHistory: { rowCount: 0, dates: [] },
      },
    },
  });

  assert.match(html, /采集状态不可用/);
  assert.match(html, /Chrome 调试端口未连接/);
  assert.equal((html.match(/证据不足/g) || []).length >= 3, true);
});

test('running collector and forecast request failures remain visible with attempt time', () => {
  const html = render({
    foundationInput: {
      workbench: { metrics: { marketPricePointCount: 0 }, status: 'blocked' },
      ukeyStatus: {
        collector: {
          state: 'running',
          lastError: '页面表格暂未出现',
          lastSampleAt: '2026-09-03T09:00:00Z',
        },
        visibleHistory: { rowCount: 0, dates: [] },
      },
      forecastReport: { loadError: '预测模型接口 503' },
      accuracyReport: { loadError: '准确度接口 500' },
    },
  });

  assert.match(html, /运行中，但最近采集失败/);
  assert.match(html, /页面表格暂未出现/);
  assert.match(html, /最近尝试：2026-09-03 17:00/);
  assert.match(html, /预测模型接口 503/);
  assert.match(html, /准确度接口 500/);
});

test('strategy explanation drawer shows only its node-level trace evidence', () => {
  const html = render({
    openExplanation: 'risk',
    foundationInput: {
      workbench: { metrics: { marketPricePointCount: 0 } },
      forecastReport: {
        modelVersion: 'price-v3',
        decisionCutoffAt: '2026-09-03T07:30:00+08:00',
      },
      strategyTrace: {
        stages: [
          {
            id: 'positionLimits',
            title: '持仓与限额',
            status: 'degraded',
            conclusion: {
              conclusionId: 'decision:risk',
              inputRefs: ['fact:limit:1'],
              constraintRefs: ['constraint-v7'],
              warnings: ['limit_missing'],
            },
          },
        ],
      },
    },
  });

  assert.match(html, /节点级真实证据/);
  assert.match(html, /持仓与限额：degraded/);
  assert.match(html, /decision:risk/);
  assert.match(html, /fact:limit:1/);
  assert.match(html, /constraint-v7/);
  assert.match(html, /limit_missing/);
  assert.doesNotMatch(html, /<dt>模型版本<\/dt><dd>price-v3<\/dd>/);
});

test('real explanation drawer does not claim real node evidence when no trace references exist', () => {
  const html = render({
    openExplanation: 'sources',
    foundationInput: {
      workbench: { metrics: { marketPricePointCount: 0 } },
      strategyTrace: {
        stages: [
          {
            id: 'evidence',
            title: '时点证据',
            status: 'unavailable',
            conclusion: {
              conclusionId: null,
              inputRefs: [],
              forecastRunIds: [],
              modelVersions: [],
              constraintRefs: [],
              warnings: ['source_evidence_missing'],
            },
          },
        ],
      },
    },
  });

  assert.match(html, /节点级证据状态（未形成）/);
  assert.doesNotMatch(html, /节点级真实证据/);
  assert.match(html, /source_evidence_missing/);
});

test('approved evidence workbench shows operational strip, strategy flow, history modes and simulation guard', () => {
  const html = render({
    foundationInput: {
      workbench: { metrics: { marketPricePointCount: 0 } },
      collectorStatus: {
        browser: { state: 'ready' },
        weather: { provider: 'Open-Meteo', forecastLeadHours: 24 },
        jobs: [{ id: 'job-1', state: 'running', completedChunks: 43, totalChunks: 50 }],
        storage: { engine: 'SQLite', path: 'C:\\evidence.sqlite' },
      },
      historyCoverage: { coverage: { dateCount: 611, earliestDate: '2024-01-01', latestDate: '2026-09-02' } },
    },
  });

  for (const label of ['专用 Chrome', 'UKey', '历史覆盖', '价格预测', '温度预测', '负荷预测', '预测依据', '策略形成', '仅演示，不修改正式策略', '基础数据历史', '曲线', '明细', '采集证据']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /Open-Meteo/);
  assert.match(html, /86%/);
  assert.match(html, /SQLite/);
});

test('price forecast renders a P10-P90 interval role when an issued run supplies quantiles', () => {
  const rows = Array.from({ length: 96 }, (_, index) => ({ pointIndex: index + 1, pointForecast: 300 + index, p10: 280 + index, p50: 300 + index, p90: 325 + index }));
  const html = render({
    foundationInput: {
      workbench: { metrics: { marketPricePointCount: 0 } },
      forecastRuns: { runs: [{
        forecastRunId: 'live-1', forecastRunType: 'live_issued', targetField: 'dayAheadUserPriceFinalYuanPerMwh',
        modelVersion: '1.0.0', forecastGeneratedAt: '2026-09-02T10:05:00.000Z', decisionCutoffAt: '2026-09-02T10:00:00.000Z', rows,
      }] },
    },
  });
  assert.match(html, /data-series-role="interval"/);
  assert.match(html, /P10–P90/);
});
