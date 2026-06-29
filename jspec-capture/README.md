# JSPEC Offline Data Tools

This folder contains the JSPEC data engineering tools for the electric trading assistant. The current useful work is inventory, schema, quality reporting, standard 96-point dataset generation, and manual-export ingest.

Active work:

1. Read local files already saved under an ignored `jspec-capture/output/session-*` directory.
2. Build offline inventory and quality reports.
3. Parse operator-provided business exports into standardized fact tables.
4. Produce decision-support inputs for the local trading assistant.

Open build items:

- Add manual-export ingest for `energy_block_trades`.
- Add manual-export ingest for `energy_block_limits`.
- Add manual-export ingest for `position_curve`.
- Feed those fact tables into `decision_input_v0`.
- Surface data gaps and trade boundaries in `trading-ai-system`.

Related planning docs:

- `../docs/jspec-ca-capture-status-2026-05-12.md`
- `../docs/jspec-ca-next-work-plan-2026-05-12-v2.md`
- `../docs/superpowers/plans/2026-06-29-jspec-pending-work.md`

## Offline Session Inventory

Generate an index from an existing local session:

```powershell
.\index-session.ps1 -CaptureDir .\output\session-20260512-101623 -OutputDir ..\data\jspec\inventory\session-20260512-101623
```

This creates:

- `raw-response-index.json`
- `raw-response-index.csv`
- `source-endpoint-summary.md`
- `standard-output-check.md` when `standard/dataset-summary.json` exists

The index records endpoint paths, business category, response shape, record-count guesses, and standardized-table links.

## Legacy Capture Scripts

The older Playwright/CDP scripts remain in this directory because they explain how the current local datasets were produced. Keep them available for inspection while the next implementation work focuses on parsers, fact tables, and reports.

## Inspect Response Fields

For an already saved local capture folder:

```powershell
.\inspect-jspec-capture.ps1 -CaptureDir .\output\session-YYYYMMDD-HHMMSS
```

This creates:

- `inspection-summary.json`
- `inspection-summary.md`

The inspection summary identifies array/object shape, request keys, sample data keys, and likely 96-point payloads.

## Build Standard 96-Point Dataset

For an already saved local capture folder, rebuild the downstream product dataset:

```powershell
.\build-standard-dataset.ps1 -CaptureDir .\output\session-YYYYMMDD-HHMMSS
```

This creates a `standard` folder inside the capture directory:

- `standard-96.json`: canonical merged 96-point rows.
- `standard-96.csv`: spreadsheet-friendly export.
- `dataset-summary.json`: machine-readable coverage and quality summary.
- `quality-report.md`: source coverage, field completeness, and data gaps.
- `system-dashboard.html`: self-contained local cockpit with no network dependencies.

The builder reads a capture folder and writes a normalized `standard` folder.

## Coverage Summary

Summarize any already saved local capture folder:

```powershell
.\summarize-jspec-capture.ps1 -CaptureDir .\output\session-YYYYMMDD-HHMMSS
```

This creates:

- `coverage-summary.json`
- `coverage-summary.md`

## Manual Export Targets

The current P0 data gaps map to these standard tables:

| Data | Standard table |
| --- | --- |
| 能量块成交结果 | `energy_block_trades` |
| 能量块可买可卖量/限额 | `energy_block_limits` |
| 持仓量查询 | `position_curve` |

Place source files under `data/jspec/manual-exports/` and write parser outputs under `data/jspec/standardized/`.
