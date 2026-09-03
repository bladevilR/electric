import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDataSourcesView } from '../ui/views/data-sources-view.js';

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
