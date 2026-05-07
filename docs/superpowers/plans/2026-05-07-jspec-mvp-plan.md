# JSPEC MVP Implementation Plan - 2026-05-07

## Execution Steps

1. Add tests for 96-point normalization.
2. Implement a standardization module that reads JSPEC capture JSON and merges P0 sources by time point.
3. Add a build command that emits JSON, CSV, summary, quality report, and a self-contained HTML dashboard.
4. Update README with the production command.
5. Run fresh tests and build the current capture session.

## Acceptance Criteria

- Existing capture tests still pass.
- New tests cover point labels, JSPEC list payloads, declaration payloads, real-time price payloads, empty actual-load rows, and wide point columns.
- Build command succeeds against `output/session-20260507-101645`.
- Generated quality report explicitly lists remaining gaps instead of hiding them.
- Dashboard opens without network dependencies.

## Safety Guardrails

- No CA/UKey automation.
- No saved `x-ticket`, cookies, authorization headers, passwords, or captcha content.
- No rapid background polling of JSPEC.
- No business write actions.
- Captured data is local-only unless the user later decides to integrate it into another system.
