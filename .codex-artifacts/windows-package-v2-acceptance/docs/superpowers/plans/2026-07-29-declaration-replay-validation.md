# Historical Declaration Replay Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate historical submitted declarations against the system default declaration baseline without inventing cost savings.

**Architecture:** Add a pure declaration replay module that aligns submitted power, default power, and actual interval energy. Merge its result into the existing strategy-validation contract and render it in the existing evidence-first dashboard.

**Tech Stack:** Node.js ESM, `node:test`, existing HTTP server, vanilla JavaScript/CSS, Playwright.

## Global Constraints

- Convert MW to 15-minute MWh with `powerMw * 0.25`.
- Convert actual kWh to MWh with `actualKwh / 1000`.
- Never claim cost savings from deviation accuracy alone.
- Keep `executionAllowed` false until attributable cost evidence exists.

---

### Task 1: Pure declaration replay

**Files:**
- Create: `lib/declaration-replay.mjs`
- Create: `test/declaration-replay.test.mjs`

**Interfaces:**
- Consumes: `{ rows: Array<Record<string, unknown>> }`
- Produces: `buildDeclarationReplay(featureStore): DeclarationReplay`

- [ ] Write a failing test with literal MW, MWh, and kWh fixtures.
- [ ] Run `node --test test/declaration-replay.test.mjs` and confirm the missing export fails.
- [ ] Implement aligned-point filtering, unit conversion, MAE, improvement percentage, win rate, and evidence thresholds.
- [ ] Re-run the targeted test and confirm both improved and not-improved branches pass.

### Task 2: Strategy-validation integration

**Files:**
- Modify: `lib/backtest-engine.mjs`
- Modify: `server.mjs`
- Modify: `test/backtest-engine.test.mjs`

**Interfaces:**
- Consumes: `buildDeclarationReplay(context.allFeatureStore)`
- Produces: `strategyValidation.declarationReplay`

- [ ] Write a failing assertion that the validation contract exposes replay metrics while retaining `executionAllowed: false`.
- [ ] Run `node --test test/backtest-engine.test.mjs` and confirm the contract assertion fails.
- [ ] Pass declaration replay into `buildStrategyValidation` and expose it through `/api/strategy-validation`.
- [ ] Re-run the targeted tests.

### Task 3: Evidence-first UI

**Files:**
- Modify: `workbench.js`
- Modify: `workbench.css`
- Modify: `test/workbench-ui.test.mjs`

**Interfaces:**
- Consumes: `payload.strategyValidation.declarationReplay`
- Produces: visible “申报偏差回放” evidence with MAE, improvement, win rate, and verdict.

- [ ] Write a failing markup test for “未优于默认申报”, `-6.41%`, and `20,544`.
- [ ] Run `node --test test/workbench-ui.test.mjs` and confirm the text is absent.
- [ ] Add the replay evidence row without creating a second primary action.
- [ ] Re-run the UI tests.

### Task 4: End-to-end verification

**Files:**
- Update: `docs/strategy-validation-2026-07-29.md`
- Update: `design-qa.md`

**Interfaces:**
- Consumes: live `/api/strategy-validation`
- Produces: verified real-state and Mock-state evidence.

- [ ] Run `node --test test/*.test.mjs`.
- [ ] Restart the local server and inspect the live validation JSON.
- [ ] Use Playwright at 1536×1024 and 1024×768 for real, reviewable Mock, and settled Mock states.
- [ ] Confirm console errors/warnings are empty and update the reports with exact metrics.
