# Daily Forecast Review Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, task-by-task. Keep the authenticated collection worker running.

**Goal:** Implement the user's specified month → day → 96-point prediction/actual/error comparison for price, temperature, and user load.

**Architecture:** A read-only review service constructs one coherent monthly snapshot from canonical facts and date-matched forecast records. A dedicated UI component shows monthly daily averages, a clickable daily table with miniature intraday comparisons, and selected-day 96-point values. Request sequencing prevents an older response from replacing a newer date selection.

**Tech Stack:** Node.js, existing SQLite evidence store, native ES modules, SVG, Playwright Chrome.

**Spec:** The user's September 4 explicit instructions in this task: a monthly overview of every day, forecast/actual comparison curves, clickable days, 96-point details, and price/temperature/load dimensions. This implements that instructed design without another approval round.

## Global Constraints

- Never show February 28 or any other day's curve in place of the selected date.
- Preserve the running authenticated Chrome collector and all unrelated workspace changes.
- Only claim original issued predictions when the immutable run was generated before its target trading day; historical recomputation is explicitly labelled, never backdated.
- Price is the primary dimension. Missing temperature/load never blocks a price baseline. Use preceding 28 complete price dates; with sparse history fall back to previous same-slot price or preceding daily mean, labelled limited-history reference. Never use target/future actuals as prediction inputs. Only no prior price evidence at all may remain unforecastable, with an explicit reason. Load retains existing 5-day/42-day/7-day freshness constraints.
- Missing values stay null; zero/negative prices remain real values; errors are computed only on matched time slots.
- Weather historical actuals are labelled reanalysis; historical settlement is not current position.
- No credentials, filesystem paths, internal variable names or job IDs in business-facing presentation.
- No git commit, reset, or unrelated file restoration.

## Task 1: Read-only monthly comparison

Files: create `lib/forecast-review.mjs`, `test/forecast-review.test.mjs`; integrate `server.mjs`.

Interface: `buildForecastReview({facts,runs,month,targetDate,type,now})` returns `{month,targetDate,type,unit,days,selected,summary}`. Every calendar day has `date`, `rows` (96), forecast/actual means, paired count, MAE, RMSE, bias, MAPE and forecast kind. Each row is `{pointIndex,predicted,actual,difference,absoluteError}`.

- [ ] Write failing tests for month length, day-specific values, same-slot-only history, no future leakage, partial/zero values, temperature comparison and date-scoped issued forecasts.
- [ ] Run `node --test test/forecast-review.test.mjs` and verify red.
- [ ] Implement the pure service and paginated transaction-scoped input reader. Example invariant: `assert.equal(result.days.find(d=>d.date==='2026-02-01').rows.length,96)`.
- [ ] Add GET `/api/forecast/review?month=2026-02&date=2026-02-01&type=load` without issuing predictions or writing facts. Validate month/date/type and return explicit errors.
- [ ] Verify service and actual API against stored data.

## Task 2: Month → day presentation and race-safe selection

Files: create `ui/components/forecast-review.js`, `ui/review-controller.js`, tests; modify `ui/views/data-sources-view.js`, `workbench.js`, `workbench.css`.

Interface: `renderForecastReview(report,{loading,error})` renders the monthly and selected-day sections. `createReviewController({fetchReport,onState})` exposes `select({month,date,type})`; only the latest selection may update state.

- [ ] Write tests that fail for fixed-date previews, incorrect selected-date headings, missing daily buttons, missing paired 96-point columns, and stale response replacement.
- [ ] Run new tests to confirm red.
- [ ] Render all month days, daily forecast/actual averages, per-day miniature 96-point curves, MAE and a drill-down button; add previous/next month and day controls.
- [ ] Render a single selected-day comparison with three explicit columns: predicted, actual, difference; keep absent values labelled and unplotted.
- [ ] Remove the fixed February 28 preview from the business page. Retain source/algorithm explanation below the actual comparison.
- [ ] Route date/month/type clicks through the review controller; do not let unrelated workbench refresh reset the selection.
- [ ] Run unit and existing UI tests; correct obsolete tests to assert the user's new date-bound requirement.

## Task 3: Real browser acceptance and collector verification

- [ ] Restart only the verified local server process with latest code; never stop the authenticated collection worker.
- [ ] Use Playwright to open January and February, click several different days and all three dimensions; compare displayed values with the read-only API.
- [ ] Test rapid date switches, an unavailable day, desktop and mobile widths, real charts and page errors.
- [ ] Capture and inspect actual screenshots of monthly and 96-point comparisons.
- [ ] Verify worker checkpoints continue advancing, and owner guard rejects a second collector browser.
- [ ] Request bounded code review, fix concrete findings, rerun affected tests.
- [ ] Hand off the real updated page and report any data gaps honestly; full collection remains monitored until completed.
