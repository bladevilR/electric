# JSPEC MVP Design - 2026-05-07

## Goal

Build the safest practical path from JSPEC platform data to the Suzhou Metro electricity trading decision system:

- Do not bypass CA/UKey login or persist long-lived auth secrets.
- Capture only authenticated browser traffic that the user intentionally triggers.
- Convert raw JSPEC responses into a stable 96-point trading dataset.
- Produce files that the downstream system can consume without needing the JSPEC page open.

## Data Required For The First Useful Product

P0 data is enough to build a decision cockpit and a conservative strategy assistant:

- `user_bid_96`: user-side day-ahead declaration curve.
- `user_default_bid_96`: default declaration curve.
- `dayahead_user_clearing`: user-side day-ahead clearing result.
- `dayahead_public_clearing`: public day-ahead clearing price/result.
- `realtime_public_clearing`: public real-time clearing result.
- `realtime_average_price`: public real-time weighted average price.
- `actual_load_96`: actual 96-point electricity/load.
- `settle_day`: day settlement detail.

P1/P2 data is useful later for forecasting and reconciliation: monthly settlement, contracts, positions, historical statements, system load, and downloadable market files.

## Collection Strategy

The lowest-risk route is passive capture:

- Start Chrome with a local debug port.
- User logs in normally with CA/UKey.
- Listener records `fetch`/`xhr` JSON responses from `jspec.com.cn`.
- Sensitive headers and auth-like body keys are redacted.
- Automation opens routes slowly only when needed; it does not submit bids or click business confirmation buttons.

This behaves like reading the pages the account can already see. It avoids replaying hidden tokens, brute-force polling, high-frequency scraping, or login circumvention.

## Product Shape

The local pipeline should output:

- `standard-96.json`: canonical merged 96-point dataset.
- `standard-96.csv`: spreadsheet-friendly canonical table.
- `dataset-summary.json`: machine-readable health summary.
- `quality-report.md`: human-readable coverage and gaps.
- `system-dashboard.html`: self-contained local cockpit for review and downstream handoff.

## Current Known Gap

The May 7, 2026 capture has all P0 endpoint coverage. However, the actual-load endpoint returned table headers but no rows for the selected date range, and day settlement returned total `0`. The system should mark these as data gaps, not fabricate values.
