# Active collection handoff — 2026-09-04

User authorized full real-data collection and safe low-rate continuation. Price forecasts and readable monthly/day comparisons are priority. Never equate queried dates with complete data.

## Live single session

- Node PTY session 11300, process 27172 owns the authenticated persistent Chrome context.
- Preserve this process, context `ctx`, page `pg`, and SQLite `evidenceStore`. Do not navigate `pg` while its promise is running.
- `continuationPromise` runs `continuePriceHistoryV2`; `continuationControl.stop` is false while collecting.
- Current phase/checkpoint is `collection-progress-20260904.json` here. Mirrored owner file: C:/Users/R/AppData/Local/ElectricTradingAI/data/collector-owner.json.
- Profile: C:/Users/R/AppData/Local/ElectricTradingAI/data/jspec-playwright-profile.
- Current loop walks backwards from 2026-07-02 through 2025-06-01, skipping already complete dates. Previously collected July/August/September and settlement imports are preserved.
- Each query waits at least 45 seconds. Confirmed empty dates are rejected evidence, never fabricated data. Auth errors pause. Maintenance/rate-limit waits at least30min and honors longer Retry-After. HTTP/body success is checked before DOM extraction.
- To change source or safely stop, set `continuationControl.stop=true` and wait for continuationPromise to settle. Then and only then reuse the same browser page. Do not launch a second context.
- If context must close, close it first, then mark the owner phase released while preserving any future nextAttemptAt. Never erase a future cooldown by deleting lock files.
- After this range is checked, inspect coverage and earlier-date availability before continuing the older part of the previously requested 2024-01-01..2026-09-03 range. Do not report all collected merely because this loop finishes.

## Monitoring

Existing heartbeat automation id `automation` checks every30minutes in this task. Keep normal/unchanged updates quiet. Do not create a duplicate. Examine this note plus checkpoint and process liveness before resuming. Password is in Windows Credential Manager, never copy it into notes/logs.

## Known remaining gaps

- Actual recent user-load endpoint still returned platform maintenance on latest cautious retry around18:12 local September4. Local accepted load is215 days, latest2026-05-05. Do not claim no account restriction is possible; no ban established by current evidence.
- Current positions, transaction limits, original full transaction detail, and supply/network factors are not all verified. Historical settlement imports cannot substitute for current positions.
- One November18 settlement sheet title says October18;480 newly imported conflicting facts were quarantined with backup. Do not guess the correct business date or reimport that capture.
- Historical weather is reanalysis, not a local physical station observation; original hourly records aligned to15min.

## User-visible prediction review

- Read-only `/api/forecast/review?month=2026-02&date=2026-02-03&type=price` supports all calendar days,96points, price/temperature/load.
- Price missing auxiliary inputs uses labelled historical price baseline. Original issued predictions require matching trading date and pre-day issuance. Past recomputation explicitly labelled historical, not archived original performance.
- User route: `/?view=data-sources&date=2026-02-03&dimension=price&v=daily-price-review-20260904`.
- January/February real prices and February monthly comparisons verified. September5 has96-point pre-day issued forecast and no fabricated actual.
- Keep independent headless local UI tests separate from live collector browser.
