# JSPEC Pending Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the unfinished JSPEC data and decision-support work so the local trading assistant can ingest the missing business data, produce traceable fact tables, and use them in reports and review screens.

**Architecture:** Keep JSPEC-facing data work file-based. Normalize exported or visible business tables into `data/jspec/standardized/*`, then expose read-only summaries through `trading-ai-system` APIs and UI panels. Keep the implementation testable with Node native tests and small parser modules.

**Tech Stack:** Node.js ESM, `node:test`, local CSV/JSON files, existing `trading-ai-system` HTTP server, existing JSPEC schemas under `src/electric/jspec/schemas`.

---

## Current State

- `trading-ai-system` tests pass: `node --test .\test\*.test.mjs` reports 40 passing tests.
- `jspec-capture` tests currently have 2 failures in `lib/jspec-schema-files.test.mjs` because the test resolves schemas from `jspec-capture/src/...` while the actual schemas live at `src/electric/jspec/schemas`.
- `data/jspec/manual-exports/2026-05-13/` has manifest templates, but the key business folders do not contain real sample files.
- The current open JSPEC dashboard page shows menu and subject information, but no business fact table suitable for ingestion.
- Missing decision data remains concentrated in energy block trades, energy block limits, position curve, actual daily 96-point load, and settlement files.

## File Structure

- Modify: `jspec-capture/lib/jspec-schema-files.test.mjs`
  - Resolve schema files from the repository root instead of the `jspec-capture` subdirectory.
- Create: `jspec-capture/lib/manual-export-ingest.mjs`
  - Parse CSV-like manual exports into normalized rows for each supported target table.
- Create: `jspec-capture/lib/manual-export-ingest.test.mjs`
  - Unit tests for energy block trades, limits, position curve, actual daily 96-point load, and settlement file manifests.
- Create: `jspec-capture/ingest-manual-export.mjs`
  - CLI entry point to ingest one manual export folder and write standardized outputs.
- Create: `jspec-capture/ingest-manual-export.ps1`
  - PowerShell wrapper for local operators.
- Create: `data/jspec/standardized/energy_block_trades/`
  - Output CSV/JSON and quality report for energy block result rows.
- Create: `data/jspec/standardized/energy_block_limits/`
  - Output CSV/JSON and quality report for available buy/sell and limit rows.
- Create: `data/jspec/standardized/position_curve/`
  - Output CSV/JSON and quality report for current position and adjustable boundary rows.
- Create: `data/jspec/standardized/actual_daily_96/`
  - Output CSV/JSON and quality report for actual 96-point daily load.
- Create: `data/jspec/standardized/settlement_files/`
  - Output file index and settlement summary rows.
- Create: `trading-ai-system/lib/decision-input.mjs`
  - Merge standard 96 data, business inputs, integration summary, and new fact tables into `decision_input_v0`.
- Create: `trading-ai-system/test/decision-input.test.mjs`
  - Tests for data gap reporting, position exposure, and trade boundary summaries.
- Modify: `trading-ai-system/server.mjs`
  - Add `/api/decision-input` and include decision input in refresh output.
- Modify: `trading-ai-system/app.js`
  - Display decision input gaps and trade boundary status in the data review and draft review views.
- Modify: `trading-ai-system/styles.css`
  - Add compact table/status styling if the new UI blocks need it.
- Modify: `trading-ai-system/README.md`
  - Add the operator workflow for placing exported files and rebuilding standardized data.

---

### Task 1: Unblock JSPEC Schema Tests

**Files:**
- Modify: `jspec-capture/lib/jspec-schema-files.test.mjs`

- [ ] **Step 1: Update schema path resolution**

Replace:

```js
const schemaDir = path.resolve('src/electric/jspec/schemas');
```

with:

```js
const schemaDir = path.resolve('..', 'src', 'electric', 'jspec', 'schemas');
```

- [ ] **Step 2: Run the schema tests**

Run:

```powershell
cd E:\electric\jspec-capture
node --test .\lib\jspec-schema-files.test.mjs
```

Expected: both schema tests pass.

- [ ] **Step 3: Run the full JSPEC capture test set**

Run:

```powershell
cd E:\electric\jspec-capture
node --test .\lib\*.test.mjs
```

Expected: all tests pass.

---

### Task 2: Define Manual Export Ingest Contract

**Files:**
- Create: `jspec-capture/lib/manual-export-ingest.test.mjs`
- Create: `jspec-capture/lib/manual-export-ingest.mjs`

- [ ] **Step 1: Write failing tests for CSV parsing**

Create `manual-export-ingest.test.mjs` with tests for:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDelimitedRows,
  normalizeEnergyBlockTradeRows,
  normalizeEnergyBlockLimitRows,
  normalizePositionCurveRows,
} from './manual-export-ingest.mjs';

test('parseDelimitedRows reads comma-separated rows with Chinese headers', () => {
  const rows = parseDelimitedRows('交易日期,执行日期,小时,方向,成交量,成交价\n2026-06-29,2026-06-30,1,买入,12.5,320');
  assert.deepEqual(rows[0], {
    交易日期: '2026-06-29',
    执行日期: '2026-06-30',
    小时: '1',
    方向: '买入',
    成交量: '12.5',
    成交价: '320',
  });
});

test('normalizeEnergyBlockTradeRows maps trade rows to schema fields', () => {
  const rows = normalizeEnergyBlockTradeRows(
    [{ 交易日期: '2026-06-29', 执行日期: '2026-06-30', 小时: '1', 方向: '买入', 成交量: '12.5', 成交价: '320' }],
    { sourceFile: 'trade.csv', exportedAt: '2026-06-29T06:00:00.000Z' }
  );
  assert.equal(rows[0].direction, 'buy');
  assert.equal(rows[0].quantity_mwh, 12.5);
  assert.equal(rows[0].price_yuan_per_mwh, 320);
  assert.equal(rows[0].contains_credentials, false);
});

test('normalizeEnergyBlockLimitRows maps limit rows to buy and sell boundaries', () => {
  const rows = normalizeEnergyBlockLimitRows(
    [{ 交易日期: '2026-06-29', 执行日期: '2026-06-30', 小时: '2', 可买量: '5', 可卖量: '7', 限额: '9' }],
    { sourceFile: 'limit.csv', exportedAt: '2026-06-29T06:00:00.000Z' }
  );
  assert.equal(rows[0].available_buy_mwh, 5);
  assert.equal(rows[0].available_sell_mwh, 7);
  assert.equal(rows[0].limit_mwh, 9);
});

test('normalizePositionCurveRows maps position rows to exposure fields', () => {
  const rows = normalizePositionCurveRows(
    [{ 月份: '2026-06', 执行日期: '2026-06-30', 小时: '3', 持仓: '18', 已成交: '4', 可买: '6', 可卖: '2' }],
    { sourceFile: 'position.csv', exportedAt: '2026-06-29T06:00:00.000Z' }
  );
  assert.equal(rows[0].position_mwh, 18);
  assert.equal(rows[0].traded_mwh, 4);
  assert.equal(rows[0].adjustable_buy_mwh, 6);
  assert.equal(rows[0].adjustable_sell_mwh, 2);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
cd E:\electric\jspec-capture
node --test .\lib\manual-export-ingest.test.mjs
```

Expected: fails because `manual-export-ingest.mjs` does not exist.

- [ ] **Step 3: Implement parser exports**

Implement these named exports in `manual-export-ingest.mjs`:

```js
export function parseDelimitedRows(text) {}
export function normalizeEnergyBlockTradeRows(rows, context) {}
export function normalizeEnergyBlockLimitRows(rows, context) {}
export function normalizePositionCurveRows(rows, context) {}
export function buildQualityReport(rows, keyFields) {}
```

Use these helpers inside the file:

```js
function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function numberOrNull(value) {
  const text = clean(value).replace(/,/g, '');
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function direction(value) {
  const text = clean(value);
  if (/买|buy/i.test(text)) return 'buy';
  if (/卖|sell/i.test(text)) return 'sell';
  return 'unknown';
}
```

- [ ] **Step 4: Run parser tests**

Run:

```powershell
cd E:\electric\jspec-capture
node --test .\lib\manual-export-ingest.test.mjs
```

Expected: all parser tests pass.

---

### Task 3: Add Manual Export CLI

**Files:**
- Create: `jspec-capture/ingest-manual-export.mjs`
- Create: `jspec-capture/ingest-manual-export.ps1`
- Test: `jspec-capture/lib/manual-export-ingest.test.mjs`

- [ ] **Step 1: Implement CLI arguments**

The CLI must accept:

```text
--type energy_block_trades|energy_block_limits|position_curve
--input E:\electric\data\jspec\manual-exports\2026-06-29\energy_block_trades\files\sample.csv
--output E:\electric\data\jspec\standardized\energy_block_trades
```

- [ ] **Step 2: Write output files**

For each ingest run, write:

```text
rows.json
rows.csv
quality-report.md
```

The CSV columns for `energy_block_trades` must be:

```text
trade_date,execution_date,trade_hour,time_point,direction,quantity_mwh,price_yuan_per_mwh,batch_id,sequence_id,source_file,exported_at,parsed_at,parser_version,contains_credentials,notes
```

The CSV columns for `energy_block_limits` must be:

```text
trade_date,execution_date,trade_hour,available_buy_mwh,available_sell_mwh,limit_mwh,batch_id,sequence_id,source_file,exported_at,parsed_at,parser_version,contains_credentials,notes
```

The CSV columns for `position_curve` must be:

```text
month,trade_date,execution_date,trade_hour,point_index,position_mwh,traded_mwh,adjustable_buy_mwh,adjustable_sell_mwh,product_type,source_file,exported_at,parsed_at,parser_version,contains_credentials,notes
```

- [ ] **Step 3: Add PowerShell wrapper**

`ingest-manual-export.ps1` should forward arguments to Node:

```powershell
param(
  [Parameter(Mandatory=$true)][string]$Type,
  [Parameter(Mandatory=$true)][string]$Input,
  [Parameter(Mandatory=$true)][string]$Output
)

node "$PSScriptRoot\ingest-manual-export.mjs" --type $Type --input $Input --output $Output
```

- [ ] **Step 4: Verify CLI syntax**

Run:

```powershell
cd E:\electric\jspec-capture
node --check .\ingest-manual-export.mjs
```

Expected: no syntax errors.

---

### Task 4: Build `decision_input_v0`

**Files:**
- Create: `trading-ai-system/lib/decision-input.mjs`
- Create: `trading-ai-system/test/decision-input.test.mjs`
- Modify: `trading-ai-system/server.mjs`

- [ ] **Step 1: Write failing decision input tests**

Create tests that call:

```js
import { buildDecisionInput } from '../lib/decision-input.mjs';
```

Required assertions:

```js
assert.equal(result.version, 'decision_input_v0');
assert.ok(result.dataGapReport.items.some((item) => item.id === 'energy_block_limits'));
assert.ok(result.tradeBoundaryReport.status);
assert.ok(Array.isArray(result.manualReviewSuggestions));
```

- [ ] **Step 2: Implement `buildDecisionInput()`**

The function signature:

```js
export function buildDecisionInput({ dataset, integrationClosure, businessInputs, factTables = {} }) {}
```

Return shape:

```js
{
  version: 'decision_input_v0',
  generatedAt: new Date().toISOString(),
  dataGapReport: { items: [] },
  positionExposureReport: { status: 'available' | 'insufficient_data', items: [] },
  priceContextReport: { status: 'available' | 'insufficient_data', items: [] },
  tradeBoundaryReport: { status: 'available' | 'insufficient_data', items: [] },
  manualReviewSuggestions: []
}
```

- [ ] **Step 3: Wire API route**

Add `GET /api/decision-input` in `trading-ai-system/server.mjs`.

Expected response:

```json
{
  "version": "decision_input_v0",
  "dataGapReport": { "items": [] },
  "tradeBoundaryReport": { "status": "insufficient_data", "items": [] }
}
```

- [ ] **Step 4: Verify API tests**

Run:

```powershell
cd E:\electric\trading-ai-system
node --test .\test\decision-input.test.mjs
node --test .\test\server-contract.test.mjs
```

Expected: both tests pass.

---

### Task 5: Surface Gaps And Boundaries In The UI

**Files:**
- Modify: `trading-ai-system/app.js`
- Modify: `trading-ai-system/styles.css`
- Test: `trading-ai-system/test/server-contract.test.mjs`

- [ ] **Step 1: Load decision input during startup**

Add state:

```js
decisionInput: null,
decisionInputError: '',
```

Fetch:

```js
const decisionInput = await fetchJson('/api/decision-input');
state.decisionInput = decisionInput;
```

- [ ] **Step 2: Render decision input in data review**

Add a compact block showing:

```text
数据缺口
持仓敞口
交易边界
人工复核候选
```

The UI should show actual item counts and status labels from `decision_input_v0`.

- [ ] **Step 3: Update server contract assertions**

Add checks that `app.js` contains:

```js
/api/decision-input
decisionInput
tradeBoundaryReport
manualReviewSuggestions
```

- [ ] **Step 4: Run frontend contract tests**

Run:

```powershell
cd E:\electric\trading-ai-system
node --test .\test\server-contract.test.mjs
```

Expected: pass.

---

### Task 6: Use The New Fact Tables In Strategy Reports

**Files:**
- Modify: `trading-ai-system/lib/strategy-report.mjs`
- Modify: `trading-ai-system/test/strategy-report.test.mjs`

- [ ] **Step 1: Add tests for fact-table evidence**

Add assertions that a report includes:

```js
assert.ok(report.closureItems.some((item) => item.id === 'energy_block_trades'));
assert.ok(report.closureItems.some((item) => item.id === 'energy_block_limits'));
assert.ok(report.closureItems.some((item) => item.id === 'position_curve'));
```

- [ ] **Step 2: Extend report inputs**

Allow `buildStrategyReport()` to accept:

```js
{
  dataset,
  summary,
  strategy,
  integrationClosure,
  decisionInput
}
```

- [ ] **Step 3: Render evidence in Markdown**

The Markdown output should include one section:

```markdown
## 交易边界数据

- 能量块成交结果：...
- 能量块限额：...
- 持仓曲线：...
```

- [ ] **Step 4: Verify strategy report tests**

Run:

```powershell
cd E:\electric\trading-ai-system
node --test .\test\strategy-report.test.mjs
```

Expected: pass.

---

### Task 7: Rebuild Operator README

**Files:**
- Modify: `trading-ai-system/README.md`
- Modify: `docs/system-handoff-2026-05-14.md` only if the handoff needs a current status addendum.

- [ ] **Step 1: Add data folder convention**

Document:

```text
data/jspec/manual-exports/YYYY-MM-DD/energy_block_trades/files/
data/jspec/manual-exports/YYYY-MM-DD/energy_block_limits/files/
data/jspec/manual-exports/YYYY-MM-DD/position_curve/files/
```

- [ ] **Step 2: Add ingest commands**

Document examples:

```powershell
cd E:\electric\jspec-capture
.\ingest-manual-export.ps1 -Type energy_block_trades -Input E:\electric\data\jspec\manual-exports\2026-06-29\energy_block_trades\files\sample.csv -Output E:\electric\data\jspec\standardized\energy_block_trades
```

- [ ] **Step 3: Add verification commands**

Document:

```powershell
cd E:\electric\jspec-capture
node --test .\lib\*.test.mjs

cd E:\electric\trading-ai-system
node --test .\test\*.test.mjs
```

---

### Task 8: Full Verification

**Files:**
- All files touched above.

- [ ] **Step 1: Run JSPEC tests**

```powershell
cd E:\electric\jspec-capture
node --test .\lib\*.test.mjs
node --check .\ingest-manual-export.mjs
```

Expected: all tests pass and syntax check passes.

- [ ] **Step 2: Run trading system tests**

```powershell
cd E:\electric\trading-ai-system
node --test .\test\*.test.mjs
node --check .\server.mjs
node --check .\app.js
```

Expected: all tests pass and syntax checks pass.

- [ ] **Step 3: Start local server**

```powershell
cd E:\electric\trading-ai-system
$p = Start-Process -FilePath node -ArgumentList ".\server.mjs","--port","5177" -PassThru -WindowStyle Hidden
Invoke-RestMethod http://127.0.0.1:5177/api/decision-input
Stop-Process -Id $p.Id
```

Expected: JSON response contains `version = decision_input_v0`.

---

## Priority Order

1. Fix schema test path so the current JSPEC test set is green.
2. Implement manual export ingest for energy block trades, energy block limits, and position curve.
3. Generate standardized fact table outputs and quality reports.
4. Build `decision_input_v0`.
5. Add `/api/decision-input`.
6. Render decision input status in the UI.
7. Feed decision input into strategy reports.
8. Update operator README and handoff notes.

## Open Inputs Needed From Operator

- Energy block trade result export file.
- Energy block limit or quota export file.
- Position curve export file.
- Actual daily 96-point load export file, if available.
- Settlement or downloadable file index, if available.

## Completion Definition

The work is complete when:

- `jspec-capture` and `trading-ai-system` test suites both pass.
- Manual export files can be normalized into CSV/JSON fact tables.
- Each fact table has a quality report with row count, source files, key completeness, and duplicate key checks.
- `/api/decision-input` returns `decision_input_v0`.
- The UI shows data gaps, position exposure, trade boundary status, and manual review suggestions.
- Strategy report output names the available fact table evidence and clearly distinguishes missing data from available data.
