# Savings Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the feature-inventory dashboard with a truthful, fast four-step cost-saving workbench.

**Architecture:** Add a pure domain builder that converts dataset, UKey, business-input, and audit evidence into one lightweight workbench contract. Expose that contract through a fast API and render it with a dedicated frontend, while keeping heavy forecasting and settlement computations lazy.

**Tech Stack:** Node.js ESM, native `node:test`, vanilla HTML/CSS/JavaScript, Playwright Chromium.

## Global Constraints

- Default date is the current China trading date.
- Missing monetary and business values render as `未获取`, never zero.
- Stale or cross-date evidence cannot authorize execution.
- No automatic trade submission or UKey bypass.
- One primary action per state.

---

### Task 1: Truthful workbench domain contract

**Files:**
- Create: `lib/savings-workbench.mjs`
- Create: `test/savings-workbench.test.mjs`

**Interfaces:**
- Produces: `buildSavingsWorkbench(options) -> WorkbenchPayload`
- Consumes: dataset, business inputs, UKey status, audit events, selected date, and injected current time.

- [ ] Write failing tests proving that today does not fall back to historical data, stale snapshots block execution, and missing savings remain null.
- [ ] Run `node --test test/savings-workbench.test.mjs` and confirm module-not-found failure.
- [ ] Implement the minimum pure builder and rerun until green.
- [ ] Add the complete-data and settlement-verification cases, verify red, then implement and verify green.

### Task 2: Fast workbench API

**Files:**
- Modify: `server.mjs`
- Modify: `test/server-contract.test.mjs`

**Interfaces:**
- Produces: `GET /api/workbench?date=YYYY-MM-DD`
- Consumes: `buildSavingsWorkbench`.

- [ ] Add an integration assertion for the workbench route and its null/blocked contract.
- [ ] Run the targeted server test and confirm the missing-route failure.
- [ ] Add a lightweight loader that avoids forecast, backtest, data-asset and settlement-reference work.
- [ ] Rerun the targeted server test and confirm it passes.

### Task 3: Four-step frontend

**Files:**
- Modify: `index.html`
- Create: `workbench.js`
- Modify: `styles.css`
- Modify: `test/server-contract.test.mjs`

**Interfaces:**
- Consumes: `/api/workbench`, UKey browser/sample endpoints, execution proposal/review endpoints.
- Produces: four-step navigation, operation/review modes, evidence drawer, primary-action state.

- [ ] Add contract assertions for the new shell and script; verify they fail.
- [ ] Replace the old shell with the selected savings workbench visual structure.
- [ ] Implement loading, empty, blocked, ready, and review states with safe HTML escaping.
- [ ] Implement date changes, mode switching, evidence drawer, refresh, open-window and sample actions.
- [ ] Rerun server and unit tests.

### Task 4: Truthful production readiness

**Files:**
- Modify: `lib/production-readiness.mjs`
- Modify: `test/production-readiness.test.mjs`

**Interfaces:**
- Extends: `buildProductionReadiness(options)` with selected-date evidence.

- [ ] Add failing tests proving empty actual-load/settlement and missing current-date data cannot report full readiness.
- [ ] Implement decision-support versus executable/verified capability separation.
- [ ] Verify all readiness tests and the complete suite.

### Task 5: Browser and visual verification

**Files:**
- Create: `design-qa.md`

**Interfaces:**
- Verifies: `http://127.0.0.1:5177/` against the selected generated dashboard direction.

- [ ] Run the full Node test suite.
- [ ] Open the app in Playwright Chromium at 1440×1024 and capture the initial blocked state.
- [ ] Verify four-step navigation, mode switch, evidence drawer, date change, and primary action.
- [ ] Check console and failed network requests.
- [ ] Repeat at a narrow desktop viewport and fix P0/P1/P2 layout issues.
- [ ] Write `design-qa.md` with `final result: passed`.
