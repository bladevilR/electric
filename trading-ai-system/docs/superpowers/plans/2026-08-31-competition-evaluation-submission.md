# Competition Evaluation Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从现有电力交易辅助系统的实际本地运行中产出高质量、可对账、通过官方门禁的 `traces.json`、`traces-dynamic.json` 和 `information.json`。

**Architecture:** 在现有 Node.js 服务增加独立 OpenAI-compatible 路由，调用只读竞赛 Agent 并为每次实际执行追加完整 OTLP document。交付编排器分离静态和动态运行，从 Trace 生成说明材料，通过官方校验和一一对账后再发布正式目录。

**Tech Stack:** Node.js ESM、`node:test`、原生 HTTP/Fetch/crypto/fs、赛事附件 Python validators/runner。

**Spec:** `/Users/r/Documents/electric/openspec/changes/competition-evaluation-submission/design.md`

## Global Constraints

- 正式 `upload/` 根目录只允许三个官方文件。
- 完整动态验收必须是 3/3 成功、Trace ID 非空且一一对应。
- 所有 Trace 必须由实际 Agent 请求生成，禁止手填成功证据。
- 当默认数据为 `data/standard-96.sample.json` 时，回答和 QA 必须标记 `repository_sample`。
- 新接口始终保持 `human_decision_only`，禁止自动申报、下单、凭证读取或 UKey 操作。
- 不修改或回退用户在 `server.mjs`、限额模块、数据和前端中的未提交改动。
- 不创建 Git commit，因为主工作区已包含用户未提交改动。

---

### Task 1: Pure competition Agent

**Files:**
- Create: `lib/competition-agent.mjs`
- Test: `test/competition-agent.test.mjs`

**Interfaces:**
- Consumes: `{ model, messages, stream, user, metadata }` and `{ dataset, advice, suggestions, readiness, dataSource }`.
- Produces: `parseCompetitionChatRequest(body)` and `executeCompetitionAgent({ request, context, memoryStore }) -> { content, finishReason, classification, toolExecutions, memoryExecutions }`.

- [ ] Write failing tests that require exact model validation, stable structured Chinese output, `repository_sample` disclosure, clarification for damaged instructions, conflict rejection, nonexistent-tool rejection, unsafe-action rejection, and preference store/use.
- [ ] Run `node --test test/competition-agent.test.mjs` and confirm failure because the module is absent.
- [ ] Implement only request normalization, classifiers, read-only context rendering, and bounded preference memory needed by the tests.
- [ ] Run the focused test and require zero failures.

### Task 2: OTLP trace builder and store

**Files:**
- Create: `lib/competition-trace.mjs`
- Test: `test/competition-trace.test.mjs`

**Interfaces:**
- Consumes: normalized request, Agent result, start/end timestamps, model, service name, root operation, context source.
- Produces: `buildCompetitionTrace(execution)`, `appendCompetitionTrace(logPath, document)`, `exportCompetitionTraces(logPath, outputPath)`, `indexCompetitionEvidence(document)`.

- [ ] Write failing tests for 32/16 hexadecimal IDs, positive monotonic nanosecond timestamps, integer status, serialized GenAI input/output messages, tool definitions/calls/results, memory records, failed capability span, and valid parents.
- [ ] Run `node --test test/competition-trace.test.mjs` and confirm the missing-module failure.
- [ ] Implement AnyValue serialization and one-request OTLP document construction with `crypto.randomBytes` identifiers.
- [ ] Implement complete-line append and strict merge/export; reject malformed JSONL and duplicate span IDs.
- [ ] Validate a generated fixture with `node tools/competition-tools.mjs validate-traces <fixture> --format json` and require exit 0.

### Task 3: OpenAI-compatible server route

**Files:**
- Modify: `server.mjs` imports, isolated competition context/handler, and top-level route dispatch only
- Modify: `test/server-contract.test.mjs` only where shared server fixture arguments/environment are needed
- Test: `test/competition-server.test.mjs`

**Interfaces:**
- Consumes: Task 1 Agent and Task 2 trace store.
- Produces: `POST /v1/chat/completions`, JSON `trace_id`, response `traceparent`, optional `--competition-trace-log` runtime path.

- [ ] Add failing HTTP tests for 200 schema, header/body Trace match, malformed JSON 400, body limit 413, bad model 400, empty messages 400, stream 400, and unsafe request response.
- [ ] Run the new server test and confirm route-not-found or invalid-response failure.
- [ ] Add a bounded body reader and isolated handler; reuse only read-only dataset/advice/readiness loaders and never call mutation endpoints or execution proposal functions.
- [ ] Run new and existing server contract tests and require zero failures.

### Task 4: Evidence-derived material builder

**Files:**
- Create: `lib/competition-materials.mjs`
- Create: `tools/build-competition-delivery.mjs`
- Test: `test/competition-materials.test.mjs`
- Modify: `package.json` scripts only
- Modify: `../.gitignore` runtime-only patterns only

**Interfaces:**
- Consumes: static/dynamic OTLP documents, runner report, API base URL, data provenance.
- Produces: `buildCompetitionInformation(evidence)`, `reconcileDynamicTraces(report, traces)`, `validateFormalInventory(dir)`, `scanFormalFiles(files)`, `buildChecksumManifest(files)`.

- [ ] Write failing tests that require real Trace/Span resolution for every E1 stage, five non-empty material groups, exact local API mapping, exact three-file inventory, sample provenance, secret/placeholder rejection, and SHA-256 verification.
- [ ] Run the material tests and confirm missing implementations fail.
- [ ] Implement evidence indexing and information generation without hardcoded Trace or Span IDs.
- [ ] Implement strict inventory, secret scan, dynamic reconciliation, checksum generation, and publish-to-staging-before-replace behavior.
- [ ] Add `competition:build-delivery` and `competition:verify-delivery` npm scripts.

### Task 5: Fresh real local delivery build

**Files:**
- Generate: `competition-delivery/upload/traces.json`
- Generate: `competition-delivery/upload/traces-dynamic.json`
- Generate: `competition-delivery/upload/information.json`
- Generate: `competition-delivery/qa/*.json`
- Generate: `competition-delivery/qa/SHA256SUMS.txt`

**Interfaces:**
- Consumes: official downloaded validators/runner via `tools/competition-tools.mjs`.
- Produces: final formal files and QA evidence.

- [ ] Start a static-phase local server with an owned trace log and execute the complete domain task plus store/use memory requests.
- [ ] Export and officially validate `traces.json`; generate and officially validate `information.json`.
- [ ] Start a clean dynamic-phase server and execute the official runner `run` command with an explicit report path.
- [ ] Export and officially validate `traces-dynamic.json`; require report `total=3`, `succeeded=3`, `failed=0`.
- [ ] Reconcile every report Trace ID exactly once, run secret/placeholder/provenance gates, and atomically publish the delivery.

### Task 6: Final review and acceptance

**Files:**
- Modify: `docs/competition-macos-tools.md`
- Modify: OpenSpec `tasks.md` checkboxes

**Interfaces:**
- Consumes: completed implementation and final delivery.
- Produces: reproducible Chinese handoff with exact hashes and limitations.

- [ ] Run syntax checks, all focused tests, official validators, delivery verification, and `git diff --check`.
- [ ] Run `XDG_CACHE_HOME=<owned-temp> node --test --test-concurrency=1 test/*.test.mjs`; require zero failures and report legitimate skips.
- [ ] Request independent read-only code and artifact review; fix every Critical/Important finding and rerun the complete gate.
- [ ] Update Chinese documentation with exact upload path, QA path, one-command reproduction, evidence source, non-production boundary, and final SHA-256 values.
