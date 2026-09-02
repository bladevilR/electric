## 1. Competition Agent

- [x] 1.1 Add failing unit tests for valid domain analysis, sample-data disclosure, ambiguous input, conflicting input, unsupported tools, unsafe actions, and bounded memory
- [x] 1.2 Implement the pure competition request parser and deterministic domain Agent until the unit tests pass

## 2. OTLP Trace Evidence

- [x] 2.1 Add failing tests for OTLP IDs, timestamps, GenAI message fields, tool spans, memory spans, error spans, append integrity, export, and correlation
- [x] 2.2 Implement the competition trace builder, append-only runtime store, OTLP merger, and evidence lookup until trace tests and the official validator pass

## 3. OpenAI-Compatible HTTP Contract

- [x] 3.1 Add failing server contract tests for valid chat, trace headers, malformed or oversized requests, invalid model, streaming, and no-write safety boundaries
- [x] 3.2 Add the isolated `/v1/chat/completions` route to `server.mjs` without overwriting existing dirty business changes and make all contract tests pass

## 4. Submission Material Builder

- [x] 4.1 Add failing tests for evidence-derived `information.json`, exact upload inventory, secret/placeholder rejection, Trace reconciliation, provenance, and checksums
- [x] 4.2 Implement the static seed, information builder, trace reconciliation, QA manifest, and atomic delivery publisher until material tests pass

## 5. Real Local Evaluation

- [x] 5.1 Build fresh static traces from actual local Agent requests and pass the official Trace and information validators
- [x] 5.2 Run the official three-request dynamic evaluation against the real local endpoint and export the resulting dynamic traces
- [x] 5.3 Require dynamic summary 3/3, non-null and one-to-one Trace IDs, official dynamic Trace validation, secret scan, exact inventory, and SHA-256 verification

## 6. Regression and Handoff

- [x] 6.1 Run focused tests, the complete project suite with an isolated PowerShell cache, syntax checks, and diff checks
- [x] 6.2 Independently review the implementation and final three upload files, fix all Critical/Important findings, and rerun the complete acceptance gate
- [x] 6.3 Update the Chinese competition delivery guide with exact upload and QA paths, reproduction command, evidence limitations, and final hashes
