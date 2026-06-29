# JSPEC Offline Data Tools

This folder now treats the 2026-05-12 JSPEC capture as a frozen local dataset. The active workflow is offline inventory, schema, quality reporting, and manual-export ingest. Do not use these tools to automate JSPEC login, batch-open JSPEC routes, probe endpoints, replay requests, or trigger trading actions.

Allowed work:

1. Read local files already saved under an ignored `jspec-capture/output/session-*` directory.
2. Build offline inventory and quality reports.
3. Parse user-provided manual exports that do not contain credentials.
4. Produce read-only decision-support inputs.

Disallowed work:

- Automatic JSPEC login or CA/PIN handling.
- CDP-driven route exploration or background page probing.
- Saving Cookie, x-ticket, Authorization, private keys, certificates, or temporary tickets.
- Clicking submit/save/declaration/cancel/confirm/sign actions.
- Calling JSPEC endpoints from scripts.

Historical capture scripts remain in this directory for auditability, but the current project plan freezes automated JSPEC access. See `../docs/jspec-ca-capture-status-2026-05-12.md`, `../docs/jspec-ca-next-work-plan-2026-05-12-v2.md`, and `../docs/jspec-safe-manual-export-protocol.md`.

## Offline Session Inventory

Generate a safe index from an existing local session:

```powershell
.\index-session.ps1 -CaptureDir .\output\session-20260512-101623 -OutputDir ..\data\jspec\inventory\session-20260512-101623
```

This creates:

- `raw-response-index.json`
- `raw-response-index.csv`
- `source-endpoint-summary.md`
- `standard-output-check.md` when `standard/dataset-summary.json` exists

The index strips URL query strings and only records endpoint paths. Redacted sensitive headers such as `[REDACTED]` are treated as safe; unredacted sensitive header values are flagged.

## Archived Capture Scripts

The older Playwright/CDP scripts are retained only so prior work can be audited. Do not use them for new JSPEC access unless the project safety policy is explicitly revised. In the current plan, new data must come from user-performed manual exports, then be parsed offline.

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

The builder does not call JSPEC. It only reads local captured response JSON files.

## Coverage Summary

Summarize any already saved local capture folder:

```powershell
.\summarize-jspec-capture.ps1 -CaptureDir .\output\session-YYYYMMDD-HHMMSS
```

This creates:

- `coverage-summary.json`
- `coverage-summary.md`

## Manual Export Targets

The current P0 data gaps are filled only by user-performed exports:

| Data | Standard table |
| --- | --- |
| 能量块成交结果 | `energy_block_trades` |
| 能量块可买可卖量/限额 | `energy_block_limits` |
| 持仓量查询 | `position_curve` |

Place exported files under `data/jspec/manual-exports/` with a manifest as described in `../docs/jspec-safe-manual-export-protocol.md`.
