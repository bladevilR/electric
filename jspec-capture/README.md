# JSPEC Platform Capture

This folder contains Playwright-based tools for reading JSPEC platform data from an authenticated Chrome session.

The recommended long-term path is:

1. Start a dedicated Chrome window with remote debugging.
2. Sign in normally with CA/UKey.
3. Run the session listener.
4. Open the target JSPEC pages in that Chrome window.
5. Review `coverage-summary.md` and `inspection-summary.md`.

The tools do not reproduce CA login and do not reuse long-term tickets. New captures redact sensitive request headers such as `x-ticket`, `cookie`, and `authorization`.

## Quick Start

1. Run `.\open-chrome-debug.ps1`
2. In the Chrome window that opens, complete the normal login flow if needed.
3. Run the session listener:

```powershell
.\run-jspec-session.ps1 -DebugUrl http://127.0.0.1:9333 -DurationMinutes 30
```

4. In the debug Chrome window, open the P0 target pages listed below.

The listener writes immediately while it runs:

- `output/session-*/index.json`
- `output/session-*/responses/*.json`
- `output/session-*/coverage-summary.md`
- `output/session-*/session.json`

## Open Target Pages

For read-only page triggering from an already logged-in debug Chrome:

```powershell
.\open-jspec-target-pages.ps1 -Targets actual_load_96,settle_day
```

This only opens SPA routes and waits for the page's own queries. It does not click submit/confirm buttons.

## Inspect Response Fields

After a capture run:

```powershell
.\inspect-jspec-capture.ps1 -CaptureDir .\output\session-YYYYMMDD-HHMMSS
```

This creates:

- `inspection-summary.json`
- `inspection-summary.md`

The inspection summary identifies array/object shape, request keys, sample data keys, and likely 96-point payloads.

## Build Standard 96-Point Dataset

After a P0 capture is complete, build the downstream product dataset:

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

## P0 Target Pages

Open these first. They are the minimum useful JSPEC data sources for the project.

| Data | JSPEC page route |
| --- | --- |
| 96点日前申报曲线 | `/pxf-spotgoods-province-extranet/userBid96/index` |
| 96点缺省申报曲线 | `/pxf-spotgoods-province-extranet/userDefaultBid96/index` |
| 用户侧日前出清 | `/pxf-spotgoods-province-extranet/Dd2jyUserClearingResult/Dd2jyRqClearing` |
| 日前公开出清价格 | `/pxf-spotgoods-province-extranet/afterDiscloseInformation/xrdClearingResultOnlyJiesuan/DayClearingResult` |
| 实时公开出清结果 | `/pxf-spotgoods-province-extranet/afterDiscloseInformation/xrdClearingResultOnlyJiesuan/CurClearingResult` |
| 实时加权均价 | `/pxf-spotgoods-province-extranet/realTimeClearingRelease/RealTimeMarAvePricePublic` |
| 96点实际电量/负荷 | `/pxf-js-outer-deferrableload/dayElectricity` |
| 日结算明细 | `/pxf-js-outer-deferrableload/settleDay` |

## Coverage Summary

After a capture run, summarize any capture folder:

```powershell
.\summarize-jspec-capture.ps1 -CaptureDir .\output\session-YYYYMMDD-HHMMSS
```

This creates:

- `coverage-summary.json`
- `coverage-summary.md`

## One-Shot Dashboard Capture

This older command is still useful for quick debugging of a single page:

```powershell
.\run-capture.ps1 -DebugUrl http://127.0.0.1:9333
```

The script reloads the dashboard, saves XHR/fetch responses from `jspec.com.cn`, and writes `output/capture-*`.

## HAR Fallback

If you already have the dashboard open in a normal Chrome window and do not want to relaunch it with a debug port:

1. Open Chrome DevTools on that page.
2. Go to `Network`.
3. Check `Preserve log`.
4. Refresh the page once.
5. Right-click the request list and choose `Save all as HAR with content`.
6. Run:

```powershell
.\parse-har.ps1 -Har C:\path\to\your.har
```

If the HAR contains authenticated request headers but not response bodies, you can replay the captured XHR/fetch calls:

```powershell
.\replay-har.ps1 -Har C:\path\to\your.har
```
