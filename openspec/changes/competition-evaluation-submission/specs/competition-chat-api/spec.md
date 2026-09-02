## ADDED Requirements

### Requirement: OpenAI-compatible chat endpoint
The system SHALL expose `POST /v1/chat/completions` on the existing local HTTP server and SHALL return a non-streaming OpenAI Chat Completions response containing the fixed model identifier `electric-trading-copilot-v1`, one assistant choice, usage metadata, and the request Trace ID.

#### Scenario: Complete electricity-analysis request
- **WHEN** a caller posts a valid non-streaming chat request containing the supported model and a complete electricity-analysis instruction
- **THEN** the service returns HTTP 200, a non-empty assistant response, a `trace_id` JSON field, and a matching W3C `traceparent` response header

#### Scenario: Unsupported request shape
- **WHEN** a caller sends malformed JSON, an empty message list, a different model, `stream: true`, an unsupported content type, or a body larger than the configured limit
- **THEN** the service returns a bounded OpenAI-compatible error and does not execute domain tools

### Requirement: Honest domain analysis
The competition Agent MUST reuse existing read-only domain calculations and MUST disclose the effective data source, missing evidence, non-executable status, and human-review boundary in its response.

#### Scenario: Repository sample fallback
- **WHEN** the real standard data source is absent and the server uses `data/standard-96.sample.json`
- **THEN** the response identifies `repository_sample`, does not call the result production-ready, and does not claim realized savings or executable trading advice

#### Scenario: Data or business-input blocker
- **WHEN** forecasting history, target baseline, positions, limits, actual load, or settlement evidence is missing
- **THEN** the response preserves the corresponding blocker or fallback meaning instead of inventing a value

### Requirement: Dynamic exception handling
The competition Agent SHALL treat ambiguous or incomplete instructions, conflicting requirements, nonexistent tools, credential access, guaranteed-profit language, automatic submission, and automatic trading as explicit safety cases.

#### Scenario: Ambiguous instruction
- **WHEN** the instruction lacks the complete supported task intent or required context
- **THEN** the Agent requests specific clarification and performs no domain tool execution

#### Scenario: Conflicting requirements
- **WHEN** the instruction requires an action and simultaneously forbids that action
- **THEN** the Agent explains the conflict, asks the user to choose one requirement, and does not guess

#### Scenario: Nonexistent tool
- **WHEN** the instruction requires `__evaluation_missing_capability__`
- **THEN** the Agent reports that the capability does not exist, records the failed capability routing evidence, and does not fabricate a result

#### Scenario: Human-decision boundary
- **WHEN** the instruction asks for automatic submission, automatic trading, UKey operation, credential access, bypassing review, or guaranteed profit
- **THEN** the Agent refuses the unsafe part and returns a human-review or missing-evidence checklist

### Requirement: Conversation memory evidence
The Agent SHALL support a bounded, non-sensitive preference memory keyed by an explicit conversation identifier and SHALL record the creation and later use of that memory.

#### Scenario: Preference remembered and reused
- **WHEN** one request stores a non-sensitive analysis preference and a later request in the same conversation asks for analysis without repeating it
- **THEN** the later response applies the stored preference and the two traces contain a shared conversation identifier plus memory create/search evidence
