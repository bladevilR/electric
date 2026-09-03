# 数据源目录、字段语义与时点数据仓实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 P0/P1 字段探索结果变成机器可读目录，修复用户日前出清字段语义，并建立不会泄漏未来修订的 point-in-time 事实仓和特征快照。

**Architecture:** `data-source-registry` 管来源状态，`field-catalog` 管原始字段到规范字段的明确映射，`point-in-time-store` 追加保存来源修订，`feature-snapshot` 按决策截止时点生成不可变输入。现有 `visible-history` 仅保留兼容缓存职责，不再承担历史预测复原。

**Tech Stack:** Node.js ESM、原生 `node:test`、JSON 配置、现有 JSPEC 可见页面采集器、原子文件写入。

**Spec:** `trading-ai-system/docs/superpowers/specs/2026-09-03-point-in-time-forecast-cockpit-design.md`

## Global Constraints

- 不读取、记录或回显 Cookie、Token、Authorization、UKey PIN、证书、私钥或密码。
- 只处理页面可见业务数据、平台允许导出、公开或正式授权数据。
- 主动申报、缺省申报、用户日前出清电力和实际负荷不得互相回填。
- 临时价、最终价和有效价必须分字段保存；有效价只是派生视图。
- 任何时变字段都不得因缺少日期而复制到所有历史日期。
- 所有真实预测输入必须满足 `availableAt <= decisionCutoffAt`。
- 不自动申报、不自动交易，`executionAllowed` 始终为 `false`。
- 不新增运行时第三方依赖。

---

### Task 1: 机器可读数据源目录和字段目录

**Files:**
- Create: `trading-ai-system/config/data-sources.json`
- Create: `trading-ai-system/config/field-catalog.json`
- Create: `trading-ai-system/lib/data-source-registry.mjs`
- Create: `trading-ai-system/lib/field-catalog.mjs`
- Create: `trading-ai-system/test/data-source-registry.test.mjs`
- Create: `trading-ai-system/test/field-catalog.test.mjs`

**Interfaces:**
- Produces: `loadDataSourceRegistry(filePath) -> Promise<{version, sources}>`
- Produces: `getDataSource(registry, sourceId) -> object | null`
- Produces: `loadFieldCatalog(filePath) -> Promise<{version, fields}>`
- Produces: `getFieldDefinition(catalog, fieldId) -> object | null`
- Produces: `validateCanonicalValue(definition, value) -> {ok, normalizedValue, errors}`
- Consumes: statuses and fields defined in `docs/data-source-field-dictionary-v1.md`.

- [ ] **Step 1: Write registry contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadDataSourceRegistry, getDataSource } from '../lib/data-source-registry.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('registry contains every P0/P1 source and never embeds secrets', async () => {
  const registry = await loadDataSourceRegistry(path.join(root, 'config/data-sources.json'));
  const required = [
    'JSPEC-P0-1','JSPEC-P0-2','JSPEC-P0-3','JSPEC-P0-4','JSPEC-P0-5','JSPEC-P0-6','JSPEC-P0-7','JSPEC-P0-8',
    'JSPEC-P1-1','JSPEC-P1-2','JSPEC-P1-3'
  ];
  required.forEach((id) => assert.ok(getDataSource(registry, id), id));
  assert.doesNotMatch(JSON.stringify(registry), /cookie|token|authorization|pin|private[_ -]?key|password/i);
});
```

- [ ] **Step 2: Write field semantic isolation tests**

```js
import { loadFieldCatalog, getFieldDefinition } from '../lib/field-catalog.mjs';

test('declaration, clearing and actual load use distinct canonical fields', async () => {
  const catalog = await loadFieldCatalog(path.join(root, 'config/field-catalog.json'));
  const ids = [
    'userDeclaredPowerMw',
    'defaultDeclaredPowerMw',
    'dayAheadUserClearedPowerMw',
    'actualIntervalEnergyKwh',
    'actualAverageLoadMw'
  ];
  assert.equal(new Set(ids.map((id) => getFieldDefinition(catalog, id)?.fieldId)).size, ids.length);
});

test('temporary, final and effective day-ahead prices are separate fields', async () => {
  const catalog = await loadFieldCatalog(path.join(root, 'config/field-catalog.json'));
  assert.ok(getFieldDefinition(catalog, 'dayAheadUserPriceTemporaryYuanPerMwh'));
  assert.ok(getFieldDefinition(catalog, 'dayAheadUserPriceFinalYuanPerMwh'));
  assert.ok(getFieldDefinition(catalog, 'dayAheadUserPriceEffectiveYuanPerMwh'));
});
```

- [ ] **Step 3: Run tests and confirm missing-module failures**

Run:

```bash
cd trading-ai-system
node --test test/data-source-registry.test.mjs test/field-catalog.test.mjs
```

Expected: FAIL because modules and configuration files do not exist.

- [ ] **Step 4: Create the source registry**

Use this minimum structure for every source:

```json
{
  "version": 1,
  "sources": [
    {
      "sourceId": "JSPEC-P0-3",
      "domain": "dayahead_user_clearing",
      "displayName": "用户侧日前出清",
      "accessClass": "authorized_visible_page",
      "status": "confirmed_visible",
      "routeHints": ["/pxf-spotgoods-province-extranet/Dd2jyUserClearingResult/Dd2jyRqClearing"],
      "nativeGranularity": "15m_candidate",
      "historyDepth": "pending_field_confirmation",
      "updateLatency": "pending_field_confirmation",
      "containsCredentials": false
    }
  ]
}
```

Include all source IDs from the field dictionary. Do not include URLs containing tickets, credentials or query secrets.

- [ ] **Step 5: Create the field catalog**

Each field entry must include:

```json
{
  "fieldId": "dayAheadUserClearedPowerMw",
  "domain": "dayahead_user_clearing",
  "sourceIds": ["JSPEC-P0-3"],
  "sourceHeaders": ["出清电力"],
  "sourceKeys": ["clearingPower"],
  "businessMeaning": "用户日前实际出清电力，独立于主动申报和缺省申报",
  "unit": "MW_pending_confirmation",
  "dataType": "number",
  "granularity": "15m_candidate",
  "requiredness": "required_when_source_present",
  "nullTokens": ["", "-", "--", null],
  "zeroIsNull": false,
  "confirmationStatus": "page_visible_code_missing",
  "substitutionPolicy": "forbidden"
}
```

At minimum include every canonical field named in Sections 3–7 of `docs/data-source-field-dictionary-v1.md`.

- [ ] **Step 6: Implement strict loaders and validators**

```js
export function validateCanonicalValue(definition, value) {
  const errors = [];
  if (!definition) return { ok: false, normalizedValue: null, errors: ['field_definition_missing'] };
  if (definition.nullTokens.some((item) => Object.is(item, value) || String(item) === String(value))) {
    return { ok: true, normalizedValue: null, errors };
  }
  if (definition.dataType === 'number') {
    const normalizedValue = Number(String(value).replace(/,/g, '').trim());
    if (!Number.isFinite(normalizedValue)) errors.push('number_invalid');
    return { ok: errors.length === 0, normalizedValue: errors.length ? null : normalizedValue, errors };
  }
  return { ok: true, normalizedValue: String(value).trim(), errors };
}
```

Reject duplicate `sourceId`/`fieldId`, unknown statuses, missing `containsCredentials:false`, and fields whose `substitutionPolicy` is omitted.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test test/data-source-registry.test.mjs test/field-catalog.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/config trading-ai-system/lib/data-source-registry.mjs trading-ai-system/lib/field-catalog.mjs trading-ai-system/test/data-source-registry.test.mjs trading-ai-system/test/field-catalog.test.mjs
git commit -m "feat: add source registry and field catalog"
```

### Task 2: 修复用户日前出清和价格版本语义

**Files:**
- Modify: `trading-ai-system/lib/ukey-browser-collector.mjs`
- Modify: `trading-ai-system/lib/data-assets.mjs`
- Modify: `trading-ai-system/lib/forecast-feature-store.mjs`
- Modify: `jspec-capture/lib/standard-96.mjs`
- Modify: `trading-ai-system/test/ukey-browser-collector.test.mjs`
- Modify: `trading-ai-system/test/data-assets.test.mjs`
- Modify: `trading-ai-system/test/forecast-feature-store.test.mjs`
- Modify: `jspec-capture/lib/standard-96.test.mjs`

**Interfaces:**
- Produces canonical fields:
  - `dayAheadUserClearedPowerMw`
  - `dayAheadUserPriceTemporaryYuanPerMwh`
  - `dayAheadUserPriceFinalYuanPerMwh`
  - `dayAheadUserPriceEffectiveYuanPerMwh`
  - `dayAheadUserPriceEffectiveSource`
- Produces: `selectEffectivePrice({temporary, final, finalPublished}) -> {value, source}`
- Consumes field definitions from `field-catalog.mjs`.

- [ ] **Step 1: Add a visible-table fixture for the confirmed P0-3 headers**

Use a fixture with exact headers:

```js
const table = {
  headers: ['时间', '出清电力', '统一结算点电价临时结果', '统一结算点电价最终结果'],
  rows: [
    ['00:15', '612.4', '318.50', '-'],
    ['00:30', '615.1', '320.00', '319.80']
  ]
};
```

Assert the first row preserves final price as `null` and effective source as `temporary`; the second preserves both values and effective source as `final`.

- [ ] **Step 2: Add semantic non-substitution tests**

```js
test('user cleared power never populates declaration fields', () => {
  const row = normalizeVisibleDayAheadUserRow(table.rows[0], table.headers);
  assert.equal(row.dayAheadUserClearedPowerMw, 612.4);
  assert.equal(row.userDeclaredPowerMw, undefined);
  assert.equal(row.defaultDeclaredPowerMw, undefined);
});
```

- [ ] **Step 3: Run tests and confirm failures**

Run:

```bash
node --test test/ukey-browser-collector.test.mjs test/data-assets.test.mjs test/forecast-feature-store.test.mjs ../jspec-capture/lib/standard-96.test.mjs
```

Expected: FAIL on missing canonical fields and selection function.

- [ ] **Step 4: Implement exact header aliases**

Add aliases only for confirmed headers. Do not invent aliases for other P0 pages. Preserve raw header/value pairs in evidence metadata.

```js
const CONFIRMED_VISIBLE_HEADERS = {
  '出清电力': 'dayAheadUserClearedPowerMw',
  '统一结算点电价临时结果': 'dayAheadUserPriceTemporaryYuanPerMwh',
  '统一结算点电价最终结果': 'dayAheadUserPriceFinalYuanPerMwh'
};
```

- [ ] **Step 5: Implement explicit price selection**

```js
export function selectEffectivePrice({ temporary, final, finalPublished = null } = {}) {
  const finalValue = numeric(final);
  const temporaryValue = numeric(temporary);
  if (finalValue !== null && finalPublished !== false) return { value: finalValue, source: 'final' };
  if (temporaryValue !== null) return { value: temporaryValue, source: 'temporary' };
  return { value: null, source: 'unavailable' };
}
```

Keep `finalPublished=null` as “status not separately known”; add a quality warning rather than discarding a visible numeric final value.

- [ ] **Step 6: Add backward-compatible aliases at API boundaries only**

Existing consumers may continue to read `dayAheadUserPrice` and `dayAheadUserClearingPower` during migration. Populate them from canonical fields at the final view layer, never as storage keys:

```js
legacy.dayAheadUserPrice = row.dayAheadUserPriceEffectiveYuanPerMwh;
legacy.dayAheadUserClearingPower = row.dayAheadUserClearedPowerMw;
```

- [ ] **Step 7: Run focused tests**

Run the Step 3 command. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/lib trading-ai-system/test jspec-capture/lib/standard-96.mjs jspec-capture/lib/standard-96.test.mjs
git commit -m "fix: preserve cleared power and price revisions"
```

### Task 3: Point-in-time事实仓

**Files:**
- Create: `trading-ai-system/lib/point-in-time-store.mjs`
- Create: `trading-ai-system/test/point-in-time-store.test.mjs`
- Modify: `trading-ai-system/server.mjs`
- Modify: `trading-ai-system/test/server-contract.test.mjs`

**Interfaces:**
- Produces: `appendFact(store, fact) -> store`
- Produces: `factsAvailableAt(store, {asOf, sourceId, fieldId, businessDate}) -> fact[]`
- Produces: `currentFactAt(store, query) -> fact | null`
- Produces: `readPointInTimeStore(filePath) -> Promise<store>`
- Produces: `writePointInTimeStoreAtomic(filePath, store) -> Promise<void>`
- Fact key: `sourceId + fieldId + businessDate + pointIndex + sourceRevision`.

- [ ] **Step 1: Write revision-preservation tests**

```js
test('appendFact keeps preliminary and final revisions', () => {
  const first = appendFact(emptyStore(), {
    sourceId: 'JSPEC-P0-3', fieldId: 'dayAheadUserPriceTemporaryYuanPerMwh',
    businessDate: '2026-08-24', pointIndex: 1, value: 318.5,
    availableAt: '2026-08-23T10:00:00+08:00', capturedAt: '2026-08-23T10:01:00+08:00', sourceRevision: 'r1'
  });
  const second = appendFact(first, {
    sourceId: 'JSPEC-P0-3', fieldId: 'dayAheadUserPriceFinalYuanPerMwh',
    businessDate: '2026-08-24', pointIndex: 1, value: 319.8,
    availableAt: '2026-08-25T09:00:00+08:00', capturedAt: '2026-08-25T09:01:00+08:00', sourceRevision: 'r2'
  });
  assert.equal(second.facts.length, 2);
});
```

- [ ] **Step 2: Write as-of leakage test**

```js
test('as-of query excludes facts published after the decision cutoff', () => {
  const visible = factsAvailableAt(storeWithTwoRevisions, {
    asOf: '2026-08-23T12:00:00+08:00', businessDate: '2026-08-24'
  });
  assert.equal(visible.some((fact) => fact.sourceRevision === 'r2'), false);
});
```

- [ ] **Step 3: Run test and confirm missing module failure**

Run: `node --test test/point-in-time-store.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement append-only normalized facts**

A fact must include:

```js
const REQUIRED = ['sourceId','fieldId','businessDate','value','availableAt','capturedAt','sourceRevision'];
```

Require either `pointIndex` or an event/entity key. Reject credential-like property names recursively. Use content hash or controlled capture sequence when the source exposes no revision ID.

- [ ] **Step 5: Implement deterministic as-of selection**

Sort candidates by `availableAt`, then `capturedAt`, then `sourceRevision`; return the latest record whose `availableAt <= asOf`. Never use `capturedAt` alone as proof that data was publicly available.

- [ ] **Step 6: Add atomic persistence and server paths**

Add:

```text
--point-in-time-store
TRADING_POINT_IN_TIME_STORE_PATH
```

Default Windows path: `%LOCALAPPDATA%\ElectricTradingAI\data\point-in-time-facts.json`.

- [ ] **Step 7: Run tests**

```bash
node --test test/point-in-time-store.test.mjs test/server-contract.test.mjs test/windows-launcher.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/lib/point-in-time-store.mjs trading-ai-system/test/point-in-time-store.test.mjs trading-ai-system/server.mjs trading-ai-system/test/server-contract.test.mjs trading-ai-system/start-system.ps1 trading-ai-system/test/windows-launcher.test.mjs
git commit -m "feat: add point-in-time fact store"
```

### Task 4: Feature snapshot and removal of undated time-varying replication

**Files:**
- Create: `trading-ai-system/lib/feature-snapshot.mjs`
- Create: `trading-ai-system/test/feature-snapshot.test.mjs`
- Modify: `trading-ai-system/lib/forecast-feature-store.mjs`
- Modify: `trading-ai-system/test/forecast-feature-store.test.mjs`

**Interfaces:**
- Produces: `buildFeatureSnapshot({facts, catalog, targetDate, decisionCutoffAt, requiredFields}) -> snapshot`
- Produces snapshot fields: `featureSnapshotId`, `targetDate`, `decisionCutoffAt`, `catalogVersion`, `rows`, `missingFields`, `warnings`, `contentHash`.
- Consumes `factsAvailableAt()` and field catalog definitions.

- [ ] **Step 1: Add regression test for undated time-varying rows**

```js
test('undated system forecast is not copied across all dates', () => {
  const featureStore = buildForecastFeatureStore(dataset, { assets: { systemLoadForecasts: [undatedForecast] } });
  assert.equal(featureStore.rows.some((row) => row.systemLoadForecast !== null), false);
  assert.ok(featureStore.summary.warnings.includes('undated_time_varying_fact_rejected'));
});
```

- [ ] **Step 2: Add snapshot hash and cutoff tests**

```js
test('snapshot is stable for identical point-in-time inputs', () => {
  const a = buildFeatureSnapshot(input);
  const b = buildFeatureSnapshot(input);
  assert.equal(a.contentHash, b.contentHash);
  assert.deepEqual(a.rows, b.rows);
});
```

- [ ] **Step 3: Run tests and confirm failures**

```bash
node --test test/forecast-feature-store.test.mjs test/feature-snapshot.test.mjs
```

Expected: FAIL.

- [ ] **Step 4: Classify field temporal behavior**

Add `temporalBehavior` to the field catalog:

```text
static_with_effective_period
forecast_vintage
event_revision
actual_revision
derived
```

Only `static_with_effective_period` may expand across dates, and only when `effectiveFrom/effectiveTo` cover the target time.

- [ ] **Step 5: Implement canonical snapshot construction**

Use a stable JSON serialization ordered by date, point and field before SHA-256 hashing. Include selected fact IDs so the exact inputs can be replayed.

- [ ] **Step 6: Keep legacy feature store as a compatibility view**

Make `buildForecastFeatureStore()` consume canonical snapshot rows when supplied. Retain old dataset import for demos/tests, but return an explicit `sourceMode: 'legacy_dataset' | 'point_in_time_snapshot'`.

- [ ] **Step 7: Run tests**

Run Step 3 command. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add trading-ai-system/lib/feature-snapshot.mjs trading-ai-system/lib/forecast-feature-store.mjs trading-ai-system/test/feature-snapshot.test.mjs trading-ai-system/test/forecast-feature-store.test.mjs trading-ai-system/config/field-catalog.json
git commit -m "feat: build leakage-safe feature snapshots"
```

### Task 5: 数据源、字段目录和时点上下文 API

**Files:**
- Modify: `trading-ai-system/server.mjs`
- Modify: `trading-ai-system/test/server-contract.test.mjs`
- Modify: `trading-ai-system/lib/production-readiness.mjs`
- Modify: `trading-ai-system/test/production-readiness.test.mjs`

**Interfaces:**
- Produces:
  - `GET /api/data-sources`
  - `GET /api/field-catalog`
  - `GET /api/point-in-time/context?date=YYYY-MM-DD&asOf=<ISO>`
- Consumes registry, catalog, point-in-time store and feature snapshot.

- [ ] **Step 1: Add API contract tests**

```js
test('field catalog API exposes status and never secrets', async () => {
  const response = await fetch(`${server.baseUrl}/api/field-catalog`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.fields.some((field) => field.fieldId === 'dayAheadUserClearedPowerMw'));
  assert.doesNotMatch(JSON.stringify(body), /cookie|token|authorization|pin|private[_ -]?key|password/i);
});
```

For `/api/point-in-time/context`, assert an invalid or future `asOf` returns `400`, missing inputs return structured `missingFields`, and no post-cutoff revision is returned.

- [ ] **Step 2: Run server tests and confirm 404 failures**

Run: `node --test test/server-contract.test.mjs test/production-readiness.test.mjs`

- [ ] **Step 3: Implement read-only endpoints**

Return `Cache-Control: no-store`. Do not expose local evidence file absolute paths; return opaque `evidenceRef` values.

- [ ] **Step 4: Extend production readiness**

Add gates:

```text
field_catalog_loaded
source_registry_loaded
p0_semantics_confirmed
point_in_time_store_writable
feature_snapshot_leakage_guard_enabled
```

`p0_semantics_confirmed` stays false until required field statuses are updated from onsite evidence.

- [ ] **Step 5: Run focused and full tests**

```bash
node --test test/data-source-registry.test.mjs test/field-catalog.test.mjs test/point-in-time-store.test.mjs test/feature-snapshot.test.mjs test/forecast-feature-store.test.mjs test/server-contract.test.mjs test/production-readiness.test.mjs
node --test --test-concurrency=1 test/*.test.mjs
```

Expected: all tests pass, except an existing explicitly skipped external business Excel test if its ignored fixture is unavailable.

- [ ] **Step 6: Commit**

```bash
git add trading-ai-system/server.mjs trading-ai-system/lib/production-readiness.mjs trading-ai-system/test/server-contract.test.mjs trading-ai-system/test/production-readiness.test.mjs
git commit -m "feat: expose source and point-in-time APIs"
```

### Task 6: 文档与现场回填闭环

**Files:**
- Modify: `trading-ai-system/docs/ukey现场字段探索任务单.md`
- Modify: `trading-ai-system/docs/data-source-field-dictionary-v1.md`
- Modify: `trading-ai-system/README.md`
- Modify: `trading-ai-system/test/server-contract.test.mjs`

**Interfaces:**
- Produces a documented workflow from onsite evidence to catalog update, tests and UI.

- [ ] **Step 1: Add documentation assertions**

Assert README and task sheet name:

```text
dayAheadUserClearedPowerMw
临时价、最终价、有效价
availableAt <= decisionCutoffAt
只读页面可见数据
```

- [ ] **Step 2: Run contract tests and confirm documentation failure**

Run: `node --test test/server-contract.test.mjs`

- [ ] **Step 3: Document the field confirmation workflow**

Required sequence:

```text
现场截图/导出/记录
→ 更新 source status 和 sourceHeaders
→ 添加脱敏 fixture
→ 添加解析测试
→ 更新字段目录版本
→ 运行全量测试
→ 人工评审
```

Do not put raw sensitive business exports into the public repository.

- [ ] **Step 4: Run full verification**

```bash
node --test --test-concurrency=1 test/*.test.mjs
node --check server.mjs lib/data-source-registry.mjs lib/field-catalog.mjs lib/point-in-time-store.mjs lib/feature-snapshot.mjs
git diff --check
```

Expected: no failures and no whitespace errors, with any unavailable ignored fixture reported exactly.

- [ ] **Step 5: Commit**

```bash
git add trading-ai-system/docs trading-ai-system/README.md trading-ai-system/test/server-contract.test.mjs
git commit -m "docs: connect onsite evidence to canonical catalog"
```
