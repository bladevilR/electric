# 天气、机组供给与多因素电价模型实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不猜测 JSPEC 字段、不污染历史回测的前提下，接入版本化天气和供给侧数据，构造可解释市场状态特征，并在强季节性基线之上训练、验证多因素点预测和分位数模型。

**Architecture:** 所有外部源先转换为带 `forecastIssuedAt/availableAt/targetTime/revision` 的规范事实，再由 `market-context` 生成净负荷、备用、爬坡和断面特征。Node 继续负责数据治理、API、账本和安全回退；Python 候选模型是隔离的离线/本地计算组件，输出稳定 JSON 合约，Python 不可用时系统只展示已验证 Node 基线，不伪造多因素结果。

**Tech Stack:** Node.js ESM、原生 `node:test`、Python 3.11+、`pandas`、`numpy`、`scikit-learn`、Python `unittest`、JSON/CSV 模型合约。

**Spec:** `trading-ai-system/docs/superpowers/specs/2026-09-03-point-in-time-forecast-cockpit-design.md`

## Global Constraints

- 当前电脑没有可探索的 JSPEC 页面；未现场确认的机组、供给和网络字段保持 `pending_field_confirmation`。
- 不探测隐藏接口、不绕过平台权限、不保存 Cookie、Token、Authorization、UKey PIN、证书、私钥或密码。
- 天气实际观测和 ERA5/ERA5-Land 再分析不得冒充历史天气预报版本。
- 天气预测必须同时保存预报发布时间和目标时刻；供给计划必须保存发布时间、适用时段和修订。
- 只有满足 `availableAt <= decisionCutoffAt` 的事实能进入历史回测特征。
- 未确认单位的数据不得做单位换算或进入模型。
- 模型复杂度不能成为晋级理由；所有候选均须与强季节性基线比较。
- Python 不可用、模型文件缺失或来源不足时安全回退，不生成模拟预测。
- 不自动申报、不自动交易、不自动晋级模型。

---

### Task 1: 供应商无关的天气快照合约

**Files:**
- Create: `trading-ai-system/config/weather-locations.json`
- Create: `trading-ai-system/schemas/weather-snapshot.schema.json`
- Create: `trading-ai-system/lib/weather-snapshot.mjs`
- Create: `trading-ai-system/tools/import-weather-snapshot.mjs`
- Create: `trading-ai-system/test/weather-snapshot.test.mjs`
- Create: `trading-ai-system/test/fixtures/weather/ecmwf-open-normalized.sample.json`
- Create: `trading-ai-system/test/fixtures/weather/cma-authorized-normalized.sample.json`

**Interfaces:**
- Produces: `normalizeWeatherSnapshot(payload, sourceDefinition) -> {facts, warnings}`
- Produces: `validateWeatherSnapshot(payload) -> {ok, errors}`
- Produces CLI: `node tools/import-weather-snapshot.mjs --input <file> --source-id <id> --facts <path>`
- Consumes field catalog and `appendFact()` from point-in-time store.

- [ ] **Step 1: Write schema and vintage tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeatherSnapshot } from '../lib/weather-snapshot.mjs';

test('weather forecast requires issued and target times', () => {
  assert.throws(() => normalizeWeatherSnapshot({
    provider: 'ECMWF', modelName: 'IFS', targetTime: '2026-08-24T06:00:00Z', values: { temperatureK: 300 }
  }, source), /forecast_issued_at_required/);
});

test('weather actual cannot be labeled as forecast', () => {
  assert.throws(() => normalizeWeatherSnapshot({
    provider: 'ERA5-Land', dataClass: 'reanalysis', forecastIssuedAt: '2026-08-23T00:00:00Z',
    targetTime: '2026-08-24T06:00:00Z', values: { temperatureK: 300 }
  }, source), /reanalysis_forecast_label_forbidden/);
});
```

- [ ] **Step 2: Write unit-conversion tests**

```js
test('Kelvin converts to Celsius and keeps raw provenance', () => {
  const result = normalizeWeatherSnapshot(validEcmwfFixture, source);
  const temperature = result.facts.find((fact) => fact.fieldId === 'temperatureC');
  assert.equal(temperature.value, 26.85);
  assert.equal(temperature.rawValue, 300);
  assert.equal(temperature.rawUnit, 'K');
  assert.equal(temperature.conversionVersion, 'kelvin-to-celsius-v1');
});
```

- [ ] **Step 3: Run tests and confirm missing-module failure**

Run:

```bash
cd trading-ai-system
node --test test/weather-snapshot.test.mjs
```

Expected: FAIL because the module and schema do not exist.

- [ ] **Step 4: Define the normalized snapshot schema**

Require:

```json
{
  "sourceId": "ECMWF-OPEN",
  "provider": "ECMWF",
  "modelName": "IFS",
  "dataClass": "forecast",
  "forecastIssuedAt": "2026-08-23T00:00:00Z",
  "targetTime": "2026-08-24T06:00:00Z",
  "locationId": "suzhou-grid-001",
  "nativeGranularityMinutes": 180,
  "sourceRevision": "20260823T0000Z-step30",
  "values": {}
}
```

Allowed `dataClass`: `forecast`, `observation`, `reanalysis`. `forecastIssuedAt` is mandatory only for forecast; `publishedAt` is mandatory for observation/reanalysis imports.

- [ ] **Step 5: Implement field mappings without provider guesses**

The normalizer accepts only explicit source keys configured in the field catalog. Initial test fixtures may map:

```text
temperatureK -> temperatureC
dewPointK -> dewPointC
relativeHumidityPct -> relativeHumidityPct
windU10Mps -> windU10Mps
windV10Mps -> windV10Mps
precipitationM -> precipitationAmountMm
totalCloudCoverFraction -> totalCloudCoverPct
surfaceSolarRadiationJm2 -> surfaceSolarRadiationJm2
```

Unknown keys are preserved in an `unmappedKeys` warning, not silently dropped into model features.

- [ ] **Step 6: Define weather locations and two aggregation sets**

`weather-locations.json` must distinguish:

```json
{
  "version": 1,
  "locationSets": [
    { "locationSetId": "suzhou_metro_load_v1", "status": "experimental", "members": [] },
    { "locationSetId": "jiangsu_market_weather_v1", "status": "experimental", "members": [] }
  ]
}
```

Do not populate invented station coordinates. Empty member sets produce `weather_location_set_unconfigured` and block real multi-factor use.

- [ ] **Step 7: Implement safe import CLI**

The CLI reads a local authorized/open-data snapshot, validates it, appends facts atomically, and prints only counts/status. It must reject credential-like keys and never log the entire payload.

- [ ] **Step 8: Run focused tests**

```bash
node --test test/weather-snapshot.test.mjs test/point-in-time-store.test.mjs test/field-catalog.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add trading-ai-system/config/weather-locations.json trading-ai-system/schemas/weather-snapshot.schema.json trading-ai-system/lib/weather-snapshot.mjs trading-ai-system/tools/import-weather-snapshot.mjs trading-ai-system/test/weather-snapshot.test.mjs trading-ai-system/test/fixtures/weather
git commit -m "feat: add versioned weather snapshot contract"
```

### Task 2: 天气时间对齐、累计量处理和空间聚合

**Files:**
- Create: `trading-ai-system/lib/weather-alignment.mjs`
- Create: `trading-ai-system/test/weather-alignment.test.mjs`
- Modify: `trading-ai-system/config/weather-locations.json`

**Interfaces:**
- Produces: `alignWeatherSeriesTo96(series, options) -> alignedSeries`
- Produces: `aggregateWeatherLocations(series, locationSet) -> aggregateSeries`
- Alignment methods: `native`, `linear_interpolate`, `nearest`, `forward_fill`, `accumulation_difference`, `accumulation_split`.

- [ ] **Step 1: Write instantaneous-variable interpolation test**

```js
test('hourly temperature interpolates to interval midpoints', () => {
  const result = alignWeatherSeriesTo96([
    { targetTime: '2026-08-24T00:00:00+08:00', value: 28 },
    { targetTime: '2026-08-24T01:00:00+08:00', value: 32 },
  ], { businessDate: '2026-08-24', fieldId: 'temperatureC', semantic: 'instantaneous' });
  assert.equal(result.find((row) => row.pointIndex === 2).value, 30);
  assert.equal(result.find((row) => row.pointIndex === 2).alignmentMethod, 'linear_interpolate');
});
```

- [ ] **Step 2: Write accumulated-precipitation anti-duplication test**

```js
test('hourly precipitation is not repeated four times', () => {
  const result = alignWeatherSeriesTo96(hourlyPrecipFixture, {
    businessDate: '2026-08-24', fieldId: 'precipitationAmountMm', semantic: 'accumulated', accumulationMinutes: 60
  });
  const firstHour = result.filter((row) => row.pointIndex <= 4);
  assert.equal(firstHour.reduce((sum, row) => sum + row.value, 0), 4);
  assert.equal(firstHour.every((row) => row.value === 1), true);
});
```

- [ ] **Step 3: Write solar-radiation conversion test**

```js
test('radiation energy converts to interval average irradiance', () => {
  const result = radiationEnergyToIrradiance({ joulesPerSquareMetre: 900000, intervalSeconds: 3600 });
  assert.equal(result, 250);
});
```

- [ ] **Step 4: Run tests and confirm failures**

Run: `node --test test/weather-alignment.test.mjs`

- [ ] **Step 5: Implement semantic alignment configuration**

Use field catalog metadata:

```text
instantaneous: temperatureC, dewPointC, relativeHumidityPct, windU10Mps, windV10Mps
accumulated: precipitationAmountMm, surfaceSolarRadiationJm2
categorical: weatherConditionCode
```

Never infer semantic class from a field name at runtime.

- [ ] **Step 6: Implement vector-safe wind derivation**

```js
windSpeed10Mps = Math.hypot(u, v)
windDirection10Deg = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360
```

Retain U/V components; do not average wind directions arithmetically across locations.

- [ ] **Step 7: Implement versioned spatial aggregation**

For continuous variables use configured weights normalized to 1. For wind, aggregate U/V then derive speed/direction. For missing members, return coverage and only calculate when `availableWeightPct` meets the configured threshold; otherwise return null and `spatial_coverage_insufficient`.

- [ ] **Step 8: Run focused tests**

```bash
node --test test/weather-alignment.test.mjs test/weather-snapshot.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add trading-ai-system/lib/weather-alignment.mjs trading-ai-system/test/weather-alignment.test.mjs trading-ai-system/config/weather-locations.json
git commit -m "feat: align weather vintages to 96 points"
```

### Task 3: 机组、供给、跨区和网络规范快照

**Files:**
- Create: `trading-ai-system/schemas/supply-network-snapshot.schema.json`
- Create: `trading-ai-system/lib/supply-network-snapshot.mjs`
- Create: `trading-ai-system/tools/import-supply-network-snapshot.mjs`
- Create: `trading-ai-system/test/supply-network-snapshot.test.mjs`
- Create: `trading-ai-system/test/fixtures/supply-network/confirmed-fields.sample.json`
- Modify: `trading-ai-system/config/field-catalog.json`
- Modify: `trading-ai-system/config/data-sources.json`

**Interfaces:**
- Produces: `normalizeSupplyNetworkSnapshot(payload, catalog) -> {facts, warnings, blockedFields}`
- Produces CLI: `node tools/import-supply-network-snapshot.mjs --input <file> --source-id <id> --facts <path>`
- Consumes only catalog fields whose confirmation status allows ingestion.

- [ ] **Step 1: Write confirmation-state gate tests**

```js
test('unconfirmed JSPEC field is blocked from real ingestion', () => {
  const result = normalizeSupplyNetworkSnapshot({
    sourceId: 'JSPEC-DISCLOSURE-2026',
    records: [{ rawHeader: '可用容量', rawValue: 186, eventTime: '2026-08-24T00:15:00+08:00' }]
  }, pendingCatalog);
  assert.equal(result.facts.length, 0);
  assert.deepEqual(result.blockedFields, ['availableCapacityMw']);
});
```

- [ ] **Step 2: Write revision and unknown-vs-zero tests**

```js
test('unknown outage capacity remains null and is not zero', () => {
  const result = normalizeSupplyNetworkSnapshot(confirmedFixtureWithBlankOutage, confirmedCatalog);
  const fact = result.facts.find((item) => item.fieldId === 'unplannedOutageCapacityMw');
  assert.equal(fact.value, null);
  assert.ok(fact.qualityFlags.includes('source_blank'));
});
```

- [ ] **Step 3: Run tests and confirm missing-module failure**

Run: `node --test test/supply-network-snapshot.test.mjs`

- [ ] **Step 4: Define a source-neutral snapshot contract**

Each record requires:

```text
sourceId
rawHeader
rawValue
rawUnit
eventTime or effectiveFrom/effectiveTo
publishedAt
availableAt
sourceRevision
entityType
entityId or regionId
```

Allowed entity types: `unit`, `plant`, `region`, `interchange`, `section`, `node`, `market_event`.

- [ ] **Step 5: Implement catalog-gated mapping**

A field can enter real facts only when:

```text
confirmationStatus in [confirmed_visible, confirmed_export, captured_nonempty]
sourceId is listed for the field
rawHeader/sourceKey is explicitly listed
unit is confirmed or conversion is explicitly configured
```

Test fixtures may promote selected synthetic headers in a test-only catalog; production catalog remains pending until onsite evidence is supplied.

- [ ] **Step 6: Implement safe CLI and audit summary**

Print:

```text
acceptedFacts
blockedFields
unmappedHeaders
nullFacts
sourceRevision
```

Do not print raw business values by default.

- [ ] **Step 7: Run focused tests**

```bash
node --test test/supply-network-snapshot.test.mjs test/field-catalog.test.mjs test/point-in-time-store.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/schemas/supply-network-snapshot.schema.json trading-ai-system/lib/supply-network-snapshot.mjs trading-ai-system/tools/import-supply-network-snapshot.mjs trading-ai-system/test/supply-network-snapshot.test.mjs trading-ai-system/test/fixtures/supply-network trading-ai-system/config/field-catalog.json trading-ai-system/config/data-sources.json
git commit -m "feat: add gated supply and network snapshots"
```

### Task 4: 市场状态和供需衍生特征

**Files:**
- Create: `trading-ai-system/lib/market-context.mjs`
- Create: `trading-ai-system/test/market-context.test.mjs`
- Modify: `trading-ai-system/lib/feature-snapshot.mjs`
- Modify: `trading-ai-system/test/feature-snapshot.test.mjs`
- Modify: `trading-ai-system/config/field-catalog.json`

**Interfaces:**
- Produces: `deriveMarketContext(pointRows, config) -> contextRows`
- Produces fields: `netLoadForecastMw`, `supplyTightnessRatio`, `reserveMarginPct`, `rampPressureRatio`, `sectionUtilizationPct`, `weatherTemperatureAnomalyC`, `realTimeSpreadYuanPerMwh`.

- [ ] **Step 1: Write net-load direction test**

```js
test('scheduled imports reduce provincial net load under configured sign convention', () => {
  const result = deriveMarketContext([{
    pointIndex: 1,
    systemLoadForecastMw: 1000,
    windForecastMw: 100,
    solarForecastMw: 50,
    interchangeScheduledImportMw: 200,
    availableCapacityMw: 900,
  }], { interchangeConvention: 'positive_import' });
  assert.equal(result[0].netLoadForecastMw, 650);
});
```

- [ ] **Step 2: Write missing-capacity test**

```js
test('tightness and reserve are null when available capacity is unknown', () => {
  const [row] = deriveMarketContext([{ pointIndex: 1, systemLoadForecastMw: 1000 }], config);
  assert.equal(row.supplyTightnessRatio, null);
  assert.equal(row.reserveMarginPct, null);
  assert.ok(row.qualityFlags.includes('available_capacity_missing'));
});
```

- [ ] **Step 3: Write section-direction test**

```js
test('section utilization uses the matching directional limit', () => {
  const [row] = deriveMarketContext([{
    pointIndex: 1, sectionFlowMw: -80, sectionForwardLimitMw: 100, sectionReverseLimitMw: 160
  }], config);
  assert.equal(row.sectionUtilizationPct, 50);
});
```

- [ ] **Step 4: Run tests and confirm failures**

Run: `node --test test/market-context.test.mjs test/feature-snapshot.test.mjs`

- [ ] **Step 5: Implement formula-versioned derivations**

Every derived value must carry:

```text
formulaVersion
inputFactIds
qualityFlags
```

Do not compute ratios when denominators are null or non-positive. Do not assume unknown outage or renewable values are zero.

- [ ] **Step 6: Add weather non-linear features**

Implement versioned configuration:

```json
{
  "coolingThresholdC": 24,
  "heatingThresholdC": 12,
  "heatWaveThresholdC": 35,
  "heatWaveConsecutiveDays": 3
}
```

These are initial experimental defaults, not validated Jiangsu coefficients. Surface the config version in every feature snapshot and require later calibration before model promotion.

- [ ] **Step 7: Run focused tests**

Run Step 4 command. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/lib/market-context.mjs trading-ai-system/test/market-context.test.mjs trading-ai-system/lib/feature-snapshot.mjs trading-ai-system/test/feature-snapshot.test.mjs trading-ai-system/config/field-catalog.json
git commit -m "feat: derive auditable market context features"
```

### Task 5: 模型训练数据集导出合约

**Files:**
- Create: `trading-ai-system/lib/model-dataset.mjs`
- Create: `trading-ai-system/tools/export-model-dataset.mjs`
- Create: `trading-ai-system/test/model-dataset.test.mjs`
- Create: `trading-ai-system/schemas/model-dataset.schema.json`

**Interfaces:**
- Produces: `buildModelDataset({snapshots, outcomes, targetField, splitConfig}) -> dataset`
- Produces CLI: `node tools/export-model-dataset.mjs --from YYYY-MM-DD --to YYYY-MM-DD --target <field> --output <jsonl>`
- Dataset rows include feature availability, split, target version and source coverage.

- [ ] **Step 1: Write target-leakage exclusion tests**

```js
test('dataset excludes actual and post-cutoff fields from model features', () => {
  const dataset = buildModelDataset(fixtureInput);
  const keys = Object.keys(dataset.rows[0].features);
  assert.equal(keys.includes('actualPriceFinalYuanPerMwh'), false);
  assert.equal(keys.includes('actualSystemLoadMw'), false);
  assert.equal(keys.includes('settlementAmountYuan'), false);
});
```

- [ ] **Step 2: Write split and version tests**

```js
test('every row carries non-overlapping split and feature snapshot id', () => {
  const dataset = buildModelDataset(fixtureInput);
  dataset.rows.forEach((row) => {
    assert.match(row.split, /^(train|validation|holdout|shadow)$/);
    assert.ok(row.featureSnapshotId);
    assert.ok(row.featureVersion);
    assert.ok(row.actualLabelVersion);
  });
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run: `node --test test/model-dataset.test.mjs`

- [ ] **Step 4: Define allowlisted features per task**

Use configuration, not “all numeric columns”. Initial task groups:

```text
user_load: calendar + historical user load + Suzhou weather forecasts + authorized operations plan
 day_ahead_price: price lags + system load forecast + renewable forecasts + supply/network + Jiangsu weather
 real_time_spread: known day-ahead price + forecast errors available at origin + current outages/adjustments/congestion
```

Remove the accidental leading space in the actual JSON key; the final configuration keys are `user_load`, `day_ahead_price`, and `real_time_spread`.

- [ ] **Step 5: Implement export with stable schema and manifest**

Output:

```text
<name>.jsonl
<name>.manifest.json
```

Manifest includes SHA-256, feature list, feature catalog version, target, outcome version, date range, split dates, excluded fields, row counts and missingness.

- [ ] **Step 6: Run focused tests**

```bash
node --test test/model-dataset.test.mjs test/feature-snapshot.test.mjs test/forecast-evaluation.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add trading-ai-system/lib/model-dataset.mjs trading-ai-system/tools/export-model-dataset.mjs trading-ai-system/test/model-dataset.test.mjs trading-ai-system/schemas/model-dataset.schema.json
git commit -m "feat: export leakage-audited model datasets"
```

### Task 6: Python可解释点预测与分位数候选模型

**Files:**
- Create: `trading-ai-system/python/forecasting/requirements.txt`
- Create: `trading-ai-system/python/forecasting/model_contract.py`
- Create: `trading-ai-system/python/forecasting/train_price_models.py`
- Create: `trading-ai-system/python/forecasting/predict_price_models.py`
- Create: `trading-ai-system/python/forecasting/test_model_contract.py`
- Create: `trading-ai-system/python/forecasting/test_train_price_models.py`
- Create: `trading-ai-system/lib/python-model-runner.mjs`
- Create: `trading-ai-system/test/python-model-runner.test.mjs`
- Create: `trading-ai-system/schemas/model-artifact-manifest.schema.json`

**Interfaces:**
- Python train CLI consumes model dataset JSONL and outputs a versioned model directory.
- Python predict CLI consumes model directory plus target snapshot JSON and emits forecast JSON to stdout.
- Node produces: `runPythonForecast({pythonPath, scriptPath, modelPath, snapshotPath, timeoutMs}) -> Promise<forecast>`.

- [ ] **Step 1: Pin a minimal Python environment**

`requirements.txt`:

```text
numpy>=2.0,<3
pandas>=2.2,<3
scikit-learn>=1.6,<2
joblib>=1.4,<2
```

Generate and commit a resolved lock only if the repository already adopts a Python lock tool; otherwise document environment hashes in the model manifest and avoid introducing another package manager in this task.

- [ ] **Step 2: Write Python contract tests**

```python
import unittest
from model_contract import validate_training_row, validate_forecast_output

class ContractTest(unittest.TestCase):
    def test_rejects_post_cutoff_feature(self):
        row = fixture_row()
        row['features']['actualPriceFinalYuanPerMwh'] = 320.0
        with self.assertRaisesRegex(ValueError, 'forbidden_feature'):
            validate_training_row(row)

    def test_quantiles_are_monotonic(self):
        with self.assertRaisesRegex(ValueError, 'quantile_order_invalid'):
            validate_forecast_output({'p10': 330, 'p50': 320, 'p90': 340})
```

- [ ] **Step 3: Write Node runner safety tests**

```js
test('python runner uses argument arrays and times out safely', async () => {
  await assert.rejects(
    runPythonForecast({ pythonPath: process.execPath, scriptPath: slowFixture, modelPath: modelDir, snapshotPath, timeoutMs: 25 }),
    /python_model_timeout/
  );
});
```

Assert no `shell:true`, no command-string interpolation, stdout size limit, stderr redaction, and JSON-only output.

- [ ] **Step 4: Run tests and confirm failures**

```bash
python -m unittest discover -s python/forecasting -p 'test_*.py'
node --test test/python-model-runner.test.mjs
```

Expected: FAIL because implementations do not exist.

- [ ] **Step 5: Implement model candidates**

Train these separate candidates for each target task:

```text
seasonal_naive reference imported from Node report
ElasticNetCV or explicitly cross-validated ElasticNet point model
GradientBoostingRegressor(loss='quantile', alpha=0.1)
GradientBoostingRegressor(loss='quantile', alpha=0.5)
GradientBoostingRegressor(loss='quantile', alpha=0.9)
```

Use only training/validation rows for parameter choice. Holdout and shadow rows are prediction-only. Standardize numeric features for ElasticNet inside a persisted `Pipeline`; do not scale tree features separately.

- [ ] **Step 6: Emit a complete model manifest**

```json
{
  "modelId": "day_ahead_price_elastic_net",
  "modelVersion": "...",
  "trainedAt": "...",
  "trainingDatasetSha256": "...",
  "featureCatalogVersion": 1,
  "featureList": [],
  "targetField": "dayAheadUserPriceFinalYuanPerMwh",
  "trainingStartDate": "...",
  "trainingEndDate": "...",
  "validationDates": [],
  "pythonVersion": "...",
  "libraryVersions": {},
  "artifactSha256": "...",
  "promotionStatus": "candidate_only"
}
```

- [ ] **Step 7: Implement prediction output**

For every point return:

```json
{
  "pointIndex": 1,
  "pointForecast": 318.5,
  "p10": 300.0,
  "p50": 318.5,
  "p90": 340.0,
  "modelId": "...",
  "modelVersion": "...",
  "featureSnapshotId": "...",
  "warnings": []
}
```

Apply monotonic post-processing `p10=min`, `p90=max` only after recording a `quantile_crossing_corrected` warning; do not hide crossing frequency from evaluation.

- [ ] **Step 8: Implement Node safe runner and baseline fallback**

When Python/model is unavailable return:

```json
{
  "status": "candidate_unavailable",
  "fallbackAllowed": true,
  "fallbackModelId": "strongest_validated_seasonal_baseline",
  "warnings": ["python_model_unavailable"]
}
```

Do not synthesize candidate values from Mock data.

- [ ] **Step 9: Run focused tests**

Run Step 4 commands. Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add trading-ai-system/python/forecasting trading-ai-system/lib/python-model-runner.mjs trading-ai-system/test/python-model-runner.test.mjs trading-ai-system/schemas/model-artifact-manifest.schema.json
git commit -m "feat: add explainable point and quantile candidates"
```

### Task 7: 消融回测、场景验证和模型治理接入

**Files:**
- Create: `trading-ai-system/lib/model-ablation.mjs`
- Create: `trading-ai-system/test/model-ablation.test.mjs`
- Modify: `trading-ai-system/lib/backtest-engine.mjs`
- Modify: `trading-ai-system/lib/strategy-evolution.mjs`
- Modify: `trading-ai-system/test/backtest-engine.test.mjs`
- Modify: `trading-ai-system/test/strategy-evolution.test.mjs`
- Modify: `trading-ai-system/config/model-governance.json`

**Interfaces:**
- Produces: `runFeatureAblation({baseModel, featureGroups, evaluator}) -> report`
- Produces: `assessPromotionCandidate({accuracy, calibration, regimes, economics, dataQuality, thresholds}) -> decision`

- [ ] **Step 1: Write ablation-report tests**

```js
test('weather and supply contributions are reported separately', async () => {
  const report = await runFeatureAblation(fixture);
  assert.ok(report.variants.some((item) => item.removedGroups.includes('weather')));
  assert.ok(report.variants.some((item) => item.removedGroups.includes('supply_network')));
  assert.ok(report.variants.every((item) => item.evaluationRunId));
});
```

- [ ] **Step 2: Write promotion gate tests**

```js
test('candidate cannot promote when extreme-regime performance regresses', () => {
  const decision = assessPromotionCandidate({
    ...passingCandidate,
    regimes: { heat_wave: { skillVsBaseline: -0.12 } }
  });
  assert.equal(decision.status, 'candidate_rejected');
  assert.ok(decision.reasons.includes('critical_regime_regression'));
});
```

- [ ] **Step 3: Run tests and confirm failures**

```bash
node --test test/model-ablation.test.mjs test/backtest-engine.test.mjs test/strategy-evolution.test.mjs
```

- [ ] **Step 4: Implement fixed ablation variants**

Compare at least:

```text
price_and_calendar_only
plus_system_load
plus_weather
plus_renewables
plus_supply_network
full_model
```

All variants use identical evaluation dates and outcomes. No variant may retrain on holdout outcomes.

- [ ] **Step 5: Add calibrated governance thresholds**

Configuration must include separate gates for:

```text
minimumHoldoutDays
minimumComparablePoints
minimumSkillVsStrongBaseline
minimumDailyWinRatePct
maximumCriticalRegimeSkillRegression
interval80CoverageMinPct
interval80CoverageMaxPct
maximumBrierScoreRegression
minimumFinalOutcomeCoveragePct
minimumSourceCompletenessPct
```

Initial values remain explicit experimental policy and require business approval before production; the code must not hard-code them outside configuration.

- [ ] **Step 6: Keep all promotion human-approved**

`assessPromotionCandidate()` may return `champion_review_eligible`; only an existing explicit human approval action may set Champion. No timer, scheduled job or automatic branch changes the active model.

- [ ] **Step 7: Run focused tests**

Run Step 3 command. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/lib/model-ablation.mjs trading-ai-system/test/model-ablation.test.mjs trading-ai-system/lib/backtest-engine.mjs trading-ai-system/lib/strategy-evolution.mjs trading-ai-system/test/backtest-engine.test.mjs trading-ai-system/test/strategy-evolution.test.mjs trading-ai-system/config/model-governance.json
git commit -m "feat: govern multifactor model promotion"
```

### Task 8: 后端市场上下文与模型 API

**Files:**
- Modify: `trading-ai-system/server.mjs`
- Modify: `trading-ai-system/test/server-contract.test.mjs`
- Modify: `trading-ai-system/lib/production-readiness.mjs`
- Modify: `trading-ai-system/test/production-readiness.test.mjs`

**Interfaces:**
- Produces:
  - `GET /api/market/context?date=&asOf=`
  - `GET /api/weather/coverage?date=&asOf=`
  - `GET /api/supply-network/coverage?date=&asOf=`
  - `GET /api/forecast/candidates?date=&asOf=&target=`
  - `GET /api/model/ablation?modelId=&evaluationRunId=`

- [ ] **Step 1: Write real-mode missing-source tests**

```js
test('real market context shows missing generation data instead of mock values', async () => {
  const response = await fetch(`${server.baseUrl}/api/market/context?date=2026-08-24&asOf=2026-08-23T10:00:00%2B08:00`);
  const body = await response.json();
  assert.equal(body.mode, 'real');
  assert.equal(body.summary.availableCapacityMw, null);
  assert.ok(body.missingFields.includes('availableCapacityMw'));
  assert.doesNotMatch(JSON.stringify(body), /186\s*MW|3\/3|±18/);
});
```

- [ ] **Step 2: Run server tests and confirm 404 failures**

Run: `node --test test/server-contract.test.mjs test/production-readiness.test.mjs`

- [ ] **Step 3: Implement read-only endpoints**

All endpoints require a valid `asOf` in real/replay mode, return field-level provenance and use `Cache-Control: no-store`. Demo mode uses a separate explicit route/query and labels every simulated value.

- [ ] **Step 4: Extend readiness gates**

Add independent statuses:

```text
weather_source_ready
weather_vintage_coverage_ready
supply_source_ready
network_source_ready
multifactor_dataset_ready
python_candidate_ready
multifactor_shadow_validated
```

A missing optional source must not disable strong baselines, but it must block claims that the multi-factor model is complete or validated.

- [ ] **Step 5: Run focused and full tests**

```bash
node --test test/weather-snapshot.test.mjs test/weather-alignment.test.mjs test/supply-network-snapshot.test.mjs test/market-context.test.mjs test/model-dataset.test.mjs test/python-model-runner.test.mjs test/model-ablation.test.mjs test/server-contract.test.mjs test/production-readiness.test.mjs
node --test --test-concurrency=1 test/*.test.mjs
python -m unittest discover -s python/forecasting -p 'test_*.py'
git diff --check
```

Expected: all configured tests pass; unavailable external business Excel remains an explicitly reported fixture limitation rather than a fabricated pass.

- [ ] **Step 6: Commit**

```bash
git add trading-ai-system/server.mjs trading-ai-system/test/server-contract.test.mjs trading-ai-system/lib/production-readiness.mjs trading-ai-system/test/production-readiness.test.mjs
git commit -m "feat: expose auditable market context and candidates"
```
