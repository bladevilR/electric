# Trading AI System MVP Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `E:\electric\trading-ai-system` from a static HTML prototype into a locally runnable electricity-trading decision system with API-backed data loading, refresh workflow, and verification.

**Architecture:** Keep the first upgrade lightweight: Node.js native HTTP server serves the existing frontend and exposes JSON APIs backed by local JSPEC standardized data. The frontend fetches `/api/dataset` when running through the server and falls back to `data/standard-96.js` when opened as `file://`.

**Tech Stack:** Node.js ESM, native `node:test`, native `http`, vanilla HTML/CSS/JS, local JSPEC `standard-96.json`.

---

## File Structure

- Create `E:\electric\trading-ai-system\lib\system-data.mjs`: read, compact, summarize, and export local dataset bundles.
- Create `E:\electric\trading-ai-system\lib\strategy-engine.mjs`: deterministic strategy suggestions from 96-point data.
- Create `E:\electric\trading-ai-system\test\system-data.test.mjs`: unit tests for data bundle and summary behavior.
- Create `E:\electric\trading-ai-system\test\strategy-engine.test.mjs`: unit tests for strategy suggestions.
- Create `E:\electric\trading-ai-system\server.mjs`: local HTTP server, static file serving, `/api/*` routes, refresh endpoint.
- Modify `E:\electric\trading-ai-system\build-data.mjs`: reuse `system-data.mjs` instead of duplicating compaction logic.
- Modify `E:\electric\trading-ai-system\app.js`: load data through `/api/dataset` in server mode, fall back to static data in file mode, and wire refresh button to `/api/refresh`.
- Create `E:\electric\trading-ai-system\run-system.ps1`: one-command local server launcher.
- Modify `E:\electric\trading-ai-system\README.md`: document server run, static fallback, and refresh workflow.

## Task 1: Data Core

**Files:**
- Create: `E:\electric\trading-ai-system\test\system-data.test.mjs`
- Create: `E:\electric\trading-ai-system\lib\system-data.mjs`
- Modify: `E:\electric\trading-ai-system\build-data.mjs`

- [ ] **Step 1: Write failing tests**

Test these behaviors:
- `compactDataset()` preserves `generatedAt`, `quality`, `sources`, and compact rows.
- `summarizeDataset()` returns row count, dates, P0 coverage, gap count, and field completeness.
- `writeBrowserDataFile()` writes `window.TRADING_SYSTEM_DATA = ...`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test .\test\system-data.test.mjs
```

Expected: fails because `lib/system-data.mjs` does not exist.

- [ ] **Step 3: Implement data core**

Implement:
- `compactRow(row)`
- `compactDataset(dataset)`
- `summarizeDataset(dataset)`
- `readJson(filePath)`
- `readStandardDataset(filePath)`
- `writeBrowserDataFile({ sourcePath, outputPath })`

- [ ] **Step 4: Update build-data CLI**

Change `build-data.mjs` to call `writeBrowserDataFile()` with `--source` and `--output`.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
node --test .\test\system-data.test.mjs
node --check .\build-data.mjs
node .\build-data.mjs
```

Expected: tests pass, syntax passes, `data/standard-96.js` is generated.

## Task 2: Strategy Engine

**Files:**
- Create: `E:\electric\trading-ai-system\test\strategy-engine.test.mjs`
- Create: `E:\electric\trading-ai-system\lib\strategy-engine.mjs`

- [ ] **Step 1: Write failing tests**

Test these behaviors:
- `buildStrategySuggestions()` identifies low-price windows.
- `buildStrategySuggestions()` identifies high-price risk windows.
- `buildStrategySuggestions()` reports data gaps when actual load or settlement is empty.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test .\test\strategy-engine.test.mjs
```

Expected: fails because `lib/strategy-engine.mjs` does not exist.

- [ ] **Step 3: Implement strategy engine**

Implement:
- `numeric(value)`
- `quantile(values, ratio)`
- `windowLabel(rows)`
- `buildStrategySuggestions(dataset, options)`

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node --test .\test\strategy-engine.test.mjs
```

Expected: all strategy tests pass.

## Task 3: Local API Server

**Files:**
- Create: `E:\electric\trading-ai-system\server.mjs`
- Create: `E:\electric\trading-ai-system\run-system.ps1`
- Test through Node syntax checks and browser smoke test.

- [ ] **Step 1: Implement server routes**

Routes:
- `GET /` -> `index.html`
- `GET /api/health` -> status, version, uptime
- `GET /api/dataset` -> compact dataset
- `GET /api/summary` -> summary from `summarizeDataset()`
- `GET /api/strategy` -> suggestions from `buildStrategySuggestions()`
- `POST /api/refresh` -> rebuild `data/standard-96.js` from local JSPEC standard dataset and return summary

- [ ] **Step 2: Add launcher**

Create `run-system.ps1` with optional `-Port`, default `5177`, and run `node .\server.mjs --port <Port>`.

- [ ] **Step 3: Verify server**

Run:

```powershell
node --check .\server.mjs
$p = Start-Process -FilePath node -ArgumentList ".\server.mjs","--port","5177" -PassThru -WindowStyle Hidden
Invoke-RestMethod http://127.0.0.1:5177/api/health
Stop-Process -Id $p.Id
```

Expected: JSON response with `ok = true`.

## Task 4: Frontend Service Mode

**Files:**
- Modify: `E:\electric\trading-ai-system\app.js`
- Modify: `E:\electric\trading-ai-system\index.html`
- Modify: `E:\electric\trading-ai-system\styles.css`

- [ ] **Step 1: Refactor startup**

Make startup async:
- Try `fetch('/api/dataset')` if protocol starts with `http`.
- Fall back to `window.TRADING_SYSTEM_DATA`.
- Store service status in `state.serviceMode`.

- [ ] **Step 2: Wire refresh**

Refresh button behavior:
- Server mode: `POST /api/refresh`, then reload dataset and render.
- Static mode: show existing explanation that user should run `build-data.mjs`.

- [ ] **Step 3: Render service status**

Show a small pill in the top bar:
- `服务模式` when API is available.
- `静态模式` when opened through `file://`.

- [ ] **Step 4: Browser smoke test**

Run Chrome against `http://127.0.0.1:5177`, click all modules, verify no page errors.

## Task 5: Documentation And Verification

**Files:**
- Modify: `E:\electric\trading-ai-system\README.md`

- [ ] **Step 1: Update README**

Document:
- Static mode path.
- Server mode command.
- API endpoints.
- JSPEC data refresh command.
- Current data gaps.

- [ ] **Step 2: Full verification**

Run:

```powershell
node --test .\test\*.test.mjs
node --check .\app.js
node --check .\server.mjs
node --check .\build-data.mjs
node .\build-data.mjs
```

Then run a browser smoke test against local server.

Expected:
- All tests pass.
- Syntax checks pass.
- Browser smoke test reports all module titles and no console/page errors.
