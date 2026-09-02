## ADDED Requirements

### Requirement: Exact formal upload set
The final formal upload directory SHALL contain exactly `traces.json`, `traces-dynamic.json`, and `information.json`, all encoded as UTF-8 JSON without secrets or placeholder values.

#### Scenario: Final upload inventory
- **WHEN** the delivery build succeeds
- **THEN** the upload directory contains three regular files with the exact required names and no QA, executable, cache, report, or temporary file

### Requirement: Evidence-derived information document
`information.json` MUST be generated from current static trace identifiers and the implemented API/tool/memory contracts, and MUST include non-empty C1, C2, E1, E2, MEMORY, and local API sections accepted by the official information validator.

#### Scenario: Evidence identifiers resolve
- **WHEN** `information.json` names a Trace ID or Span ID for a task stage or handoff
- **THEN** that identifier exists in `traces.json`, belongs to the declared trace, and describes the declared actual stage

#### Scenario: Local API contract
- **WHEN** `information.json` is passed to the official runner
- **THEN** its protocol, endpoint, model, no-auth method, response text mapping, and Trace ID mappings match the running local service

### Requirement: Official validator gates
Both static and dynamic trace files MUST pass the downloaded `genai-log-validator`, and `information.json` MUST pass the downloaded `information-validator` before delivery replacement.

#### Scenario: Validator success
- **WHEN** the delivery build reaches its validation phase
- **THEN** all three validators exit with code 0 and their machine-readable reports are stored in the QA directory

#### Scenario: Validator failure
- **WHEN** any validator returns an error or produces an invalid report
- **THEN** the build fails, reports the failing path and code, and preserves the previous complete delivery

### Requirement: Real dynamic runner gate
The official dynamic runner MUST execute its generated C4/E3 batch against the local competition endpoint and report three successful HTTP calls with non-null Trace IDs.

#### Scenario: Successful dynamic batch
- **WHEN** static trace and information validation have passed
- **THEN** `execution-report.json` records total 3, succeeded 3, failed 0, and a non-null Trace ID for every test

### Requirement: QA provenance and integrity
The QA directory SHALL contain the dynamic execution report, trace and information validation reports, Trace reconciliation report, data-source report, build manifest, and SHA-256 checksums for the three formal files.

#### Scenario: Honest sample provenance
- **WHEN** the effective dataset is the repository fallback sample
- **THEN** the data-source report and build manifest state that fact and explicitly deny production-data, executable-trade, and realized-savings claims

#### Scenario: Checksum verification
- **WHEN** a reviewer recomputes SHA-256 for each formal file
- **THEN** every digest matches the QA checksum manifest

### Requirement: Secret and placeholder gate
The delivery build MUST reject secrets, credential-like values, example endpoint hosts, `YOUR_TOKEN`, unresolved template markers, and fabricated success language in the formal upload files.

#### Scenario: Sensitive or placeholder content detected
- **WHEN** the formal files contain a bearer token, API key pattern, password field with a value, private-key marker, example.com endpoint, unresolved placeholder, or a production/realized-savings claim while using sample data
- **THEN** the build fails before publishing the delivery directory
