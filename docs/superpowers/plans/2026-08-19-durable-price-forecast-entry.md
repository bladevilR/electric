# Durable Price Forecast Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make price forecasting discoverable in the current workbench and automatically usable after five durably accumulated historical trading dates.

**Architecture:** A focused `visible-history` module owns normalized upsert and atomic persistence. `server.mjs` composes that history with the standard dataset and existing forecasting service. The current workbench lazily loads the existing model API for a new forecast stage, while the Windows launcher routes runtime history to LocalAppData.

**Tech Stack:** Node.js ESM, native `node:test`, browser JavaScript/CSS, PowerShell, OpenSpec.

**Spec:** `openspec/changes/add-durable-price-forecast-entry/design.md`

## Global Constraints

- No new third-party runtime dependency.
- Never store browser credentials, Cookie, Token, certificate material or UKey PIN.
- Never automatically submit declarations or trades.
- Forecast unlock requires at least 5 valid dates before the selected target date, target-date rows and comparable price points.
- Preserve the dirty cinematic worktree and all backup/archive/rescue branches.

---

### Task 1: Durable history module

**Files:**
- Create: `trading-ai-system/lib/visible-history.mjs`
- Create: `trading-ai-system/test/visible-history.test.mjs`
- Modify: `trading-ai-system/server.mjs`
- Modify: `trading-ai-system/test/server-contract.test.mjs`

**Interfaces:**
- Produces: `mergeVisibleHistory(history, snapshot) -> historyDocument`
- Produces: `readVisibleHistory(path, legacySnapshotPath) -> Promise<historyDocument>`
- Produces: `writeVisibleHistoryAtomic(path, history) -> Promise<void>`
- Consumes: validated snapshots from `validateVisibleSnapshot(payload)`.

- [ ] **Step 1: Write failing persistence tests**

```js
test('mergeVisibleHistory keeps prior dates and enriches the same date-point key', () => {
  const merged = mergeVisibleHistory(existingHistory, acceptedSnapshot);
  assert.deepEqual(merged.dates, ['2026-08-17', '2026-08-18']);
  assert.equal(merged.rows.filter((row) => row.date === '2026-08-18' && row.pointIndex === 1).length, 1);
});
```

- [ ] **Step 2: Run the focused test and confirm missing-module failure**

Run: `node --test test/visible-history.test.mjs`
Expected: FAIL because `lib/visible-history.mjs` does not exist.

- [ ] **Step 3: Implement normalized upsert, migration and atomic write**

Use `${row.date}:${row.pointIndex}` keys, merge only values other than `null` and `''`, sort by date then point, write a sibling temporary file and rename it over the target.

- [ ] **Step 4: Connect server read/write paths**

Add `--visible-history` / `TRADING_VISIBLE_HISTORY_PATH`. `loadDataset()` merges the full history. Accepted snapshots update history after validation; rejected snapshots only append audit evidence.

- [ ] **Step 5: Run focused persistence and server tests**

Run: `node --test test/visible-history.test.mjs test/ukey-assistant.test.mjs test/server-contract.test.mjs`
Expected: PASS with zero failures.

### Task 2: Durable Windows launcher path

**Files:**
- Modify: `trading-ai-system/start-system.ps1`
- Modify: `trading-ai-system/test/windows-launcher.test.mjs`
- Modify: `trading-ai-system/test/windows-batch-format.test.mjs`

**Interfaces:**
- Produces environment variable `TRADING_VISIBLE_HISTORY_PATH` for `server.mjs`.

- [ ] **Step 1: Add a failing launcher assertion**

```js
assert.match(script, /LOCALAPPDATA/);
assert.match(script, /TRADING_VISIBLE_HISTORY_PATH/);
assert.match(script, /ElectricTradingAI/);
```

- [ ] **Step 2: Run the launcher test and confirm it fails on the missing path**

Run: `node --test test/windows-launcher.test.mjs test/windows-batch-format.test.mjs`
Expected: FAIL on LocalAppData history configuration.

- [ ] **Step 3: Configure and validate the user data directory**

Before launching Node, require a non-empty `$env:LOCALAPPDATA`, create `ElectricTradingAI\data`, set `TRADING_VISIBLE_HISTORY_PATH`, and report an actionable startup error when creation fails.

- [ ] **Step 4: Run launcher tests**

Run: `node --test test/windows-launcher.test.mjs test/windows-batch-format.test.mjs`
Expected: PASS.

### Task 3: Forecast navigation and rendering

**Files:**
- Modify: `trading-ai-system/workbench.js`
- Modify: `trading-ai-system/workbench.css`
- Modify: `trading-ai-system/test/workbench-ui.test.mjs`

**Interfaces:**
- Consumes: `GET /api/forecast/model?date=YYYY-MM-DD`.
- Produces browser state `forecastReport`, `forecastLoading`, `forecastError` and stage `forecast`.

- [ ] **Step 1: Add failing UI tests**

```js
assert.match(html, /data-dashboard-nav="forecast"/);
assert.match(html, /累计 3\/5 个历史交易日/);
assert.match(readyHtml, /历史同点位中位数基线/);
```

- [ ] **Step 2: Run the UI test and confirm the entry is absent**

Run: `node --test test/workbench-ui.test.mjs`
Expected: FAIL because the current sidebar has no forecast stage.

- [ ] **Step 3: Implement the minimal forecast stage**

Add the sidebar item, lazy API fetch on click/date change, readiness copy for the existing missing-reason codes, progress bar, model label, and a 96-point forecast table showing point forecast/P10/P90/evidence count.

- [ ] **Step 4: Run the UI and contract tests**

Run: `node --test test/workbench-ui.test.mjs test/server-contract.test.mjs`
Expected: PASS.

### Task 4: Guide, full verification and package delivery

**Files:**
- Modify: `trading-ai-system/一分钟上手.html`
- Modify: `trading-ai-system/README.md`
- Modify: `trading-ai-system/tools/package-one-minute.mjs`
- Modify: `trading-ai-system/test/server-contract.test.mjs`

**Interfaces:**
- Produces a self-contained Windows zip with portable Node runtime and no user history or secrets.

- [ ] **Step 1: Add failing guide/package assertions**

Assert the guide names the current sidebar, explains `5/5` historical-date accumulation, and the package excludes `ukey-visible-history.json`.

- [ ] **Step 2: Run the contract test and confirm the old copy fails**

Run: `node --test test/server-contract.test.mjs`
Expected: FAIL on the outdated navigation text.

- [ ] **Step 3: Update documentation and package manifest**

Explain that successful daily collection, not merely opening the program, advances the counter; on day six the forecast unlocks automatically. Keep upgrade and privacy boundaries explicit.

- [ ] **Step 4: Run full automated verification**

Run: `npm test`
Expected: all repository-configured tests pass, or exact external fixture blockers are reported without claiming success.

- [ ] **Step 5: Run real service and browser acceptance**

Start on an unused local port with an isolated history file. Verify both an insufficient-history dataset and a six-date dataset through the API and current workbench in Chrome/Playwright.

- [ ] **Step 6: Build and inspect the Windows package**

Run the package script, extract the zip to a fresh directory, verify required files/runtime, ensure no history/credentials are included, run the packaged launcher contract, and calculate SHA-256.

- [ ] **Step 7: Send to Wang Ying**

Send the verified zip to user ID `14a1be50-846d-413e-a406-8c5ece88284a` with instructions to close the old process, extract the new package, use Chrome, and note the five-valid-day automatic unlock rule.
