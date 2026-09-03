# Playwright History Collection and Forecast Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent Playwright-driven JSPEC collector that backfills all queryable history into SQLite, publishes immutable forecasts, evaluates them against actual outcomes, and powers the “数据与预测依据” workbench.

**Architecture:** A dedicated persistent Chrome context is controlled through Playwright and source-specific page adapters. A single SQLite evidence store owns collection jobs, normalized facts, forecast runs, outcomes, and metrics; the server exposes stable local APIs and the workbench consumes only those APIs.

**Tech Stack:** Node.js 24, ECMAScript modules, `node:sqlite`, Playwright 1.52, Node test runner, vanilla HTML/CSS/JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-03-playwright-historical-collection-and-forecast-evidence-design.md`

## Global Constraints

- Use a dedicated visible Chrome persistent context at `.browser/jspec-playwright-profile`.
- UKey login is always manual; never read or store cookies, passwords, PINs, certificates, tokens, or authorization headers.
- Backfill the full date range exposed by each source and checkpoint after every successful business date.
- SQLite at `data/trading-evidence.sqlite` is the canonical store; JSON and CSV are import/export formats only.
- Only immutable `live_issued` forecasts may contribute to historical live accuracy.
- Empty pages, login redirects, rate limits, and schema changes must never be reported as successful collection.
- Preserve the existing simulation-only strategy sandbox and do not enable trade execution.

---

## File Structure

- Create `lib/trading-evidence-store.mjs`: SQLite schema, migrations, transactions, facts, jobs, captures, forecasts, outcomes, and metrics.
- Create `lib/evidence-json-migration.mjs`: idempotent import of existing JSON stores.
- Create `lib/playwright-collector-runtime.mjs`: persistent Chrome lifecycle and state machine.
- Create `lib/collection-job-runner.mjs`: full-range job planning, chunk execution, checkpointing, pause/resume, and retry policy.
- Create `lib/jspec-page-adapter.mjs`: shared adapter helpers and extraction validation.
- Create `lib/jspec-adapters/price.mjs`: price source queries and normalization.
- Create `lib/jspec-adapters/weather.mjs`: temperature forecast and actual queries.
- Create `lib/jspec-adapters/load.mjs`: load forecast and actual queries.
- Create `lib/forecast-publisher.mjs`: readiness gates, immutable forecast publication, and outcome evaluation.
- Modify `server.mjs`: initialize the evidence subsystem and expose stable APIs.
- Modify `ui/view-models/strategy-foundation-model.js`: map collection, history, forecast, and evidence API responses.
- Modify `ui/views/data-sources-view.js`: render the approved target layout.
- Modify `app.js`: load APIs and wire collector, history, tab, evidence, and simulation actions.
- Modify `styles.css`: implement responsive workbench styling.
- Create focused tests under `test/` for every new module and one Playwright end-to-end flow.

---

### Task 1: Canonical SQLite Evidence Store

**Files:**
- Create: `lib/trading-evidence-store.mjs`
- Create: `test/trading-evidence-store.test.mjs`

**Interfaces:**
- Produces: `openTradingEvidenceStore({ filePath, clock? })` returning `{ close, transaction, createCollectionJob, getCollectionJob, listCollectionJobs, upsertCollectionChunk, listCollectionChunks, appendCapture, queryCaptures, appendFacts, queryFacts, getCoverage, appendFeatureSnapshot, queryFeatureSnapshots, appendForecastRun, queryForecastRuns, appendOutcomes, queryOutcomes, upsertAccuracyMetric, queryAccuracyMetrics, hasImportMarker, recordImportMarker }`.
- Facts use `{ sourceId, fieldId, businessDate, pointIndex?, eventKey?, entityKey?, value, unit?, availableAt, capturedAt, sourceRevision }`.
- Forecast runs use the existing `createForecastRun` contract and remain append-only.

- [x] **Step 1: Write the failing store tests**

```js
test('facts are idempotent and queryable by date and field', () => {
  const store = openTradingEvidenceStore({ filePath });
  store.appendFacts([fact]);
  store.appendFacts([fact]);
  assert.equal(store.queryFacts({ fieldId: fact.fieldId }).length, 1);
  assert.deepEqual(store.getCoverage({ fieldId: fact.fieldId }), {
    dateCount: 1,
    earliestDate: '2026-06-29',
    latestDate: '2026-06-29',
    pointsByDate: { '2026-06-29': 1 },
  });
});

test('forecast runs cannot be overwritten', () => {
  const store = openTradingEvidenceStore({ filePath });
  store.appendForecastRun(run);
  assert.throws(() => store.appendForecastRun(run), /forecast_run_already_exists/);
});
```

- [x] **Step 2: Run the store tests and verify failure**

Run: `node --test test/trading-evidence-store.test.mjs`

Expected: FAIL because `lib/trading-evidence-store.mjs` does not exist.

- [x] **Step 3: Implement the schema and store facade**

Create schema version 1 in a transaction:

```sql
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE import_markers(id TEXT PRIMARY KEY, source_path TEXT NOT NULL, source_sha256 TEXT NOT NULL, imported_at TEXT NOT NULL, summary_json TEXT NOT NULL);
CREATE TABLE collection_jobs(id TEXT PRIMARY KEY, mode TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, earliest_date TEXT, latest_date TEXT, total_chunks INTEGER NOT NULL DEFAULT 0, completed_chunks INTEGER NOT NULL DEFAULT 0, failed_chunks INTEGER NOT NULL DEFAULT 0, last_error_code TEXT, last_error_message TEXT);
CREATE TABLE collection_chunks(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES collection_jobs(id), source_id TEXT NOT NULL, month_key TEXT NOT NULL, state TEXT NOT NULL, cursor_date TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error_code TEXT, last_error_message TEXT, UNIQUE(job_id, source_id, month_key));
CREATE TABLE raw_captures(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, business_date TEXT, page_url TEXT NOT NULL, captured_at TEXT NOT NULL, row_count INTEGER NOT NULL, accepted INTEGER NOT NULL, structure_fingerprint TEXT, content_sha256 TEXT NOT NULL, screenshot_path TEXT, evidence_json TEXT NOT NULL);
CREATE TABLE facts(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, field_id TEXT NOT NULL, business_date TEXT NOT NULL, point_index INTEGER, dimension_key TEXT NOT NULL DEFAULT '', value_json TEXT NOT NULL, unit TEXT, available_at TEXT NOT NULL, captured_at TEXT NOT NULL, source_revision TEXT NOT NULL, UNIQUE(source_id, field_id, business_date, point_index, dimension_key, source_revision));
CREATE INDEX facts_query_idx ON facts(field_id, business_date, point_index);
CREATE TABLE feature_snapshots(id TEXT PRIMARY KEY, target_trading_date TEXT NOT NULL, cutoff_at TEXT NOT NULL, completeness_pct REAL NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE forecast_runs(id TEXT PRIMARY KEY, run_type TEXT NOT NULL, target_field TEXT NOT NULL, target_trading_date TEXT NOT NULL, generated_at TEXT NOT NULL, cutoff_at TEXT NOT NULL, feature_snapshot_id TEXT NOT NULL, model_id TEXT NOT NULL, model_version TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE forecast_points(run_id TEXT NOT NULL REFERENCES forecast_runs(id), point_index INTEGER NOT NULL, point_forecast REAL, p10 REAL, p50 REAL, p90 REAL, input_completeness_pct REAL NOT NULL, PRIMARY KEY(run_id, point_index));
CREATE TABLE outcomes(id TEXT PRIMARY KEY, target_field TEXT NOT NULL, business_date TEXT NOT NULL, point_index INTEGER NOT NULL, actual_value REAL NOT NULL, label_version TEXT NOT NULL, source_id TEXT NOT NULL, source_revision TEXT NOT NULL, published_at TEXT NOT NULL, backfilled_at TEXT NOT NULL, UNIQUE(target_field, business_date, point_index, label_version, source_revision));
CREATE TABLE accuracy_metrics(id TEXT PRIMARY KEY, run_type TEXT NOT NULL, model_id TEXT, target_field TEXT NOT NULL, from_date TEXT, to_date TEXT, actual_label_version TEXT NOT NULL, metrics_json TEXT NOT NULL, computed_at TEXT NOT NULL, UNIQUE(run_type, model_id, target_field, from_date, to_date, actual_label_version));
```

Use prepared statements, `BEGIN IMMEDIATE` transactions, ISO date validation, 1–96 point validation, stable JSON serialization, SHA-256 IDs, and the existing sensitive-key rejection pattern.

- [x] **Step 4: Run focused and regression tests**

Run: `node --test test/trading-evidence-store.test.mjs test/point-in-time-store.test.mjs test/forecast-ledger.test.mjs`

Expected: all tests PASS.

- [x] **Step 5: Commit the store**

```bash
git add lib/trading-evidence-store.mjs test/trading-evidence-store.test.mjs
git commit -m "feat(data): add canonical SQLite evidence store"
```

---

### Task 2: Idempotent Legacy JSON Migration

**Files:**
- Create: `lib/evidence-json-migration.mjs`
- Create: `test/evidence-json-migration.test.mjs`
- Modify: `lib/trading-evidence-store.mjs`

**Interfaces:**
- Consumes: `openTradingEvidenceStore` from Task 1.
- Produces: `migrateLegacyEvidence({ store, visibleHistoryPath, pointInTimePath, forecastLedgerPath, outcomeLedgerPath }) -> { importedFacts, importedForecastRuns, importedOutcomes, skipped, sources }`.

- [ ] **Step 1: Write failing migration tests**

```js
test('legacy migration imports each logical record once', async () => {
  const first = await migrateLegacyEvidence(paths);
  const second = await migrateLegacyEvidence(paths);
  assert.equal(first.importedFacts, 2);
  assert.equal(second.importedFacts, 0);
  assert.equal(store.queryFacts({}).length, 2);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --test test/evidence-json-migration.test.mjs`

Expected: FAIL because the migration module does not exist.

- [ ] **Step 3: Implement migration adapters**

Map visible rows to a stable source revision derived from file SHA-256, import point-in-time facts without changing their timestamps, insert existing forecast runs through the append-only API, and import outcome revisions. Record each source file path and SHA-256 in `import_markers`; reruns skip a file only when the same path and hash already exist.

- [ ] **Step 4: Verify focused tests**

Run: `node --test test/evidence-json-migration.test.mjs test/trading-evidence-store.test.mjs test/visible-history.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit migration**

```bash
git add lib/evidence-json-migration.mjs lib/trading-evidence-store.mjs test/evidence-json-migration.test.mjs
git commit -m "feat(data): migrate legacy evidence into SQLite"
```

---

### Task 3: Persistent Playwright Chrome Runtime

**Files:**
- Create: `lib/playwright-collector-runtime.mjs`
- Create: `test/playwright-collector-runtime.test.mjs`

**Interfaces:**
- Produces: `createPlaywrightCollectorRuntime({ rootDir, playwright, executablePath?, profileDir?, launchUrl?, headless?, clock? })`.
- Runtime methods: `start()`, `stop()`, `getPage()`, `healthCheck()`, `status()`, `subscribe(listener)`.
- Runtime states: `uninitialized`, `login_required`, `ready`, `collecting`, `paused`, `rate_limited`, `login_expired`, `page_changed`, `error`, `stopped`.

- [ ] **Step 1: Write failing runtime tests with an injected fake Playwright**

```js
test('runtime starts one persistent visible context and reports login_required', async () => {
  const runtime = createPlaywrightCollectorRuntime({ rootDir, playwright: fakePlaywright });
  const result = await runtime.start();
  assert.equal(fakePlaywright.launches[0].headless, false);
  assert.match(fakePlaywright.launches[0].userDataDir, /jspec-playwright-profile/);
  assert.equal(result.state, 'login_required');
});

test('runtime never exposes storage state or cookies', async () => {
  assert.doesNotMatch(JSON.stringify(await runtime.status()), /cookie|token|storageState/i);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/playwright-collector-runtime.test.mjs`

Expected: FAIL because the runtime module does not exist.

- [ ] **Step 3: Implement the runtime**

Launch with:

```js
await playwright.chromium.launchPersistentContext(profileDir, {
  executablePath,
  headless: false,
  viewport: null,
  args: ['--start-maximized'],
});
```

Select or create one JSPEC page, detect `#/outNet` and login UI as `login_required`, detect known business landmarks as `ready`, serialize state transitions, and close only the dedicated context. Do not call `context.cookies()`, `storageState()`, request routing, or response-body interception.

- [ ] **Step 4: Run tests**

Run: `node --test test/playwright-collector-runtime.test.mjs test/ukey-browser-collector.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit runtime**

```bash
git add lib/playwright-collector-runtime.mjs test/playwright-collector-runtime.test.mjs
git commit -m "feat(collector): add persistent Playwright Chrome runtime"
```

---

### Task 4: JSPEC Adapters and Full-Range Job Runner

**Files:**
- Create: `lib/jspec-page-adapter.mjs`
- Create: `lib/jspec-adapters/price.mjs`
- Create: `lib/jspec-adapters/weather.mjs`
- Create: `lib/jspec-adapters/load.mjs`
- Create: `lib/collection-job-runner.mjs`
- Create: `test/jspec-page-adapters.test.mjs`
- Create: `test/collection-job-runner.test.mjs`
- Create: `test/fixtures/jspec-pages/*.html`

**Interfaces:**
- Consumes: runtime from Task 3 and store from Task 1.
- Produces: `createJspecAdapter(config)` with `detect`, `navigate`, `discoverBounds`, `setQuery`, `submit`, `waitForResult`, `extract`, `validate`, `nextPage`, and `fingerprint`.
- Produces: `createCollectionJobRunner({ store, runtime, adapters, clock?, random?, sleep? })` with `createFullBackfill()`, `runNext()`, `pause(jobId)`, `resume(jobId)`, and `status(jobId)`.

- [ ] **Step 1: Write adapter contract tests against local HTML fixtures**

```js
for (const adapter of [priceAdapter, weatherAdapter, loadAdapter]) {
  test(`${adapter.id} rejects a result for the wrong business date`, async () => {
    const extracted = await adapter.extract(page);
    assert.throws(() => adapter.validate(extracted, { businessDate: '2026-07-31' }), /query_date_mismatch/);
  });
}
```

Fixtures must cover a valid 96-point result, pagination, empty result, login redirect, rate-limit banner, and renamed required column.

- [ ] **Step 2: Write scheduler tests**

```js
test('full backfill creates monthly chunks and resumes after last committed date', async () => {
  const job = await runner.createFullBackfill();
  assert.deepEqual(job.monthKeys, ['2026-05', '2026-06', '2026-07']);
  await runner.runNext();
  const resumed = createCollectionJobRunner(dependencies);
  assert.equal((await resumed.status(job.id)).cursorDate, '2026-05-02');
});
```

- [ ] **Step 3: Verify failures**

Run: `node --test test/jspec-page-adapters.test.mjs test/collection-job-runner.test.mjs`

Expected: FAIL because adapters and runner do not exist.

- [ ] **Step 4: Implement shared adapter behavior and three source adapters**

Use role/label/text locators before CSS selectors, verify the visible date after submission, normalize units, require unique point indices, hash normalized column names for the structure fingerprint, and return typed errors: `login_expired`, `rate_limited`, `no_data`, `query_date_mismatch`, `required_column_missing`, `coverage_incomplete`, and `page_timeout`.

- [ ] **Step 5: Implement job planning and checkpointing**

Discover source bounds, split inclusive ranges by calendar month, run one browser action at a time, commit capture and facts in one SQLite transaction, then advance the chunk cursor. Use a 20-second default inter-query delay with deterministic jitter injection in tests and exponential rate-limit delays capped at 30 minutes.

- [ ] **Step 6: Run tests**

Run: `node --test test/jspec-page-adapters.test.mjs test/collection-job-runner.test.mjs test/trading-evidence-store.test.mjs`

Expected: all tests PASS.

- [ ] **Step 7: Commit adapters and runner**

```bash
git add lib/jspec-page-adapter.mjs lib/jspec-adapters lib/collection-job-runner.mjs test/jspec-page-adapters.test.mjs test/collection-job-runner.test.mjs test/fixtures/jspec-pages
git commit -m "feat(collector): backfill JSPEC history with Playwright adapters"
```

---

### Task 5: Forecast Publication and Outcome Evaluation

**Files:**
- Create: `lib/forecast-publisher.mjs`
- Create: `test/forecast-publisher.test.mjs`
- Modify: `lib/forecast-evaluation.mjs`

**Interfaces:**
- Consumes: store from Task 1 and existing forecast model report functions.
- Produces: `createForecastPublisher({ store, buildModelReport, clock?, codeCommitSha })` with `readiness(targetDate)`, `publishLiveForecast(targetDate)`, `backfillOutcomes(query)`, and `evaluate(query)`.

- [ ] **Step 1: Write failing readiness and immutability tests**

```js
test('publisher blocks fewer than five complete dates and labels 5-29 as baseline', () => {
  assert.equal(publisher.readiness('2026-09-03').status, 'blocked');
  seedCompleteDates(store, 5);
  assert.equal(publisher.readiness('2026-09-03').status, 'baseline_only');
  seedCompleteDates(store, 25);
  assert.equal(publisher.readiness('2026-09-03').status, 'model_allowed');
});

test('a live issued run cannot be regenerated over the same run id', () => {
  publisher.publishLiveForecast('2026-09-03');
  assert.throws(() => publisher.publishLiveForecast('2026-09-03'), /forecast_run_already_exists/);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/forecast-publisher.test.mjs`

Expected: FAIL because the publisher does not exist.

- [ ] **Step 3: Implement feature snapshot and publication**

Read only facts available at the decision cutoff, calculate completeness, persist a frozen feature snapshot, call the existing model report, validate 96 points and monotonic quantiles, and append an immutable `live_issued` run in one transaction.

- [ ] **Step 4: Implement outcome evaluation**

Match on target field, business date and point index; select the requested actual label revision; calculate MAE, RMSE, Bias, MAPE, MASE, spike metrics, Brier score, pinball loss, interval coverage and interval width; return `no_comparable_outcomes` with null metrics when no pairs exist.

- [ ] **Step 5: Run tests**

Run: `node --test test/forecast-publisher.test.mjs test/forecast-evaluation.test.mjs test/forecast-ledger.test.mjs test/outcome-ledger.test.mjs`

Expected: all tests PASS.

- [ ] **Step 6: Commit forecast loop**

```bash
git add lib/forecast-publisher.mjs lib/forecast-evaluation.mjs test/forecast-publisher.test.mjs
git commit -m "feat(forecast): publish and evaluate immutable live forecasts"
```

---

### Task 6: Stable Local Service APIs

**Files:**
- Modify: `server.mjs`
- Create: `test/evidence-api-contract.test.mjs`

**Interfaces:**
- Consumes: store, migration, runtime, runner, and publisher from Tasks 1–5.
- Produces: collector, history, forecast publication, and accuracy endpoints defined in the design spec.

- [ ] **Step 1: Write failing API contract tests**

```js
test('collector status omits credentials and exposes stable state', async () => {
  const response = await fetch(`${baseUrl}/api/collector/status`).then((item) => item.json());
  assert.equal(response.browser.state, 'stopped');
  assert.doesNotMatch(JSON.stringify(response), /cookie|token|password|pin/i);
});

test('history facts supports indexed filters and pagination', async () => {
  const response = await fetch(`${baseUrl}/api/history/facts?fieldId=price&from=2026-07-01&to=2026-07-31&limit=50`).then((item) => item.json());
  assert.equal(response.query.fieldId, 'price');
  assert.ok(response.rows.length <= 50);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test test/evidence-api-contract.test.mjs`

Expected: FAIL with HTTP 404 for the new endpoints.

- [ ] **Step 3: Initialize the subsystem and add endpoints**

Add:

```text
POST /api/collector/browser/start
POST /api/collector/browser/stop
GET  /api/collector/status
POST /api/collector/jobs/backfill
POST /api/collector/jobs/:id/pause
POST /api/collector/jobs/:id/resume
GET  /api/collector/jobs/:id
GET  /api/history/facts
GET  /api/history/coverage
POST /api/forecast/publish
GET  /api/forecast/runs
GET  /api/forecast/accuracy
```

Validate all dates, limits, run types and label versions; map typed domain errors to stable 400/409/422/503 status codes; record audit events without raw Playwright errors or credentials.

- [ ] **Step 4: Run API and regression tests**

Run: `node --test test/evidence-api-contract.test.mjs test/server-contract.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit APIs**

```bash
git add server.mjs test/evidence-api-contract.test.mjs
git commit -m "feat(api): expose collection and forecast evidence endpoints"
```

---

### Task 7: Data and Forecast Evidence Workbench

**Files:**
- Modify: `ui/view-models/strategy-foundation-model.js`
- Modify: `ui/views/data-sources-view.js`
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `test/ui-strategy-foundation-model.test.mjs`
- Modify: `test/ui-strategy-foundation-view.test.mjs`

**Interfaces:**
- Consumes: Task 6 API response contracts.
- Produces: one “数据与预测依据” view with operational status, three forecast tabs, evidence inspector, strategy flow, simulation sandbox, and history explorer.

- [ ] **Step 1: Write failing model tests**

```js
test('workbench separates actual, p50 and interval series for each domain', () => {
  const model = buildStrategyFoundationModel(input);
  assert.deepEqual(model.forecast.tabs.map((tab) => tab.id), ['price', 'temperature', 'load']);
  assert.equal(model.forecast.tabs[0].series.p50.length, 96);
  assert.equal(model.collection.backfill.progressPct, 86);
});
```

- [ ] **Step 2: Write failing view tests**

Assert exact visible labels: `专用 Chrome`, `UKey`, `历史覆盖`, `价格预测`, `温度预测`, `负荷预测`, `预测依据`, `策略形成`, `仅演示，不修改正式策略`, `基础数据历史`, `曲线`, `明细`, and `采集证据`.

- [ ] **Step 3: Verify failures**

Run: `node --test test/ui-strategy-foundation-model.test.mjs test/ui-strategy-foundation-view.test.mjs`

Expected: FAIL because the approved layout contract is absent.

- [ ] **Step 4: Implement model and rendering**

Match `docs/design-reference/data-forecast-evidence-playwright-target-v1.png`: one top status strip, one main chart/evidence split, connected strategy nodes, compact simulation panel, and collapsible history query. Empty and error states must state concrete missing evidence instead of showing fabricated metrics.

- [ ] **Step 5: Wire interactions**

Load status, history, runs, and accuracy independently; wire browser start/stop, backfill start/pause/resume, date/field/source filters, three tabs, evidence sections, strategy nodes, and simulation controls. Preserve keyboard focus trapping for drawers and the simulation-only guard.

- [ ] **Step 6: Implement responsive CSS**

Use the existing design tokens; at desktop widths use a chart plus evidence panel grid, at widths below 900px stack sections, and at 390/320px collapse filters without horizontal document overflow.

- [ ] **Step 7: Run UI tests**

Run: `node --test test/ui-strategy-foundation-model.test.mjs test/ui-strategy-foundation-view.test.mjs test/workbench-accessibility.test.mjs`

Expected: all tests PASS.

- [ ] **Step 8: Commit workbench**

```bash
git add ui/view-models/strategy-foundation-model.js ui/views/data-sources-view.js app.js styles.css test/ui-strategy-foundation-model.test.mjs test/ui-strategy-foundation-view.test.mjs
git commit -m "feat(ui): build data and forecast evidence workbench"
```

---

### Task 8: End-to-End Verification and Operational Documentation

**Files:**
- Create: `test/playwright-evidence-loop.test.mjs`
- Modify: `docs/production-runbook.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: automated mock-platform proof and a precise manual UKey acceptance procedure.

- [ ] **Step 1: Write the failing Playwright end-to-end test**

Start a local mock JSPEC server with login, price, weather and load pages; start the application with a temporary SQLite path; launch the collector in headless test mode; backfill three dates; publish one forecast; import actuals; and assert that the workbench renders comparison curves and non-null accuracy metrics.

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test test/playwright-evidence-loop.test.mjs`

Expected: FAIL at the first missing integration behavior.

- [ ] **Step 3: Complete integration seams exposed by the test**

Use only the public interfaces defined in Tasks 1–7. Do not add test-only production branches other than dependency injection for browser executable, launch URL, clock, sleep and SQLite path.

- [ ] **Step 4: Document operation and recovery**

Document exact buttons and states for first UKey login, starting full backfill, pausing, resuming after restart, handling login expiry, handling rate limits, exporting data, publishing a forecast, and reading live accuracy. State that the dedicated Chrome window must remain open during collection.

- [ ] **Step 5: Run the complete verification suite**

Run: `node --test test/*.test.mjs`

Run: `npm run competition:verify-delivery`

Run: `git diff --check`

Expected: all tests PASS, delivery verification succeeds, and diff check emits no output.

- [ ] **Step 6: Perform the real-session smoke test**

Start the app, launch the dedicated visible Chrome, let the user complete UKey login, query one known historical date for each of price, temperature and load, verify accepted rows in SQLite, and leave the full backfill job paused or running according to the user's final choice. Do not claim full-history completion until the job itself reports all chunks complete.

- [ ] **Step 7: Commit verification and docs**

```bash
git add test/playwright-evidence-loop.test.mjs docs/production-runbook.md README.md
git commit -m "test: verify Playwright evidence loop end to end"
```
