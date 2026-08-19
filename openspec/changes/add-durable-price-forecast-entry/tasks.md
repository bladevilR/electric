## 1. Durable visible history

- [x] 1.1 Add failing unit tests for cross-date accumulation, same-key enrichment, rejection preservation and legacy snapshot migration
- [x] 1.2 Implement atomic persistent history storage and connect accepted snapshots to it
- [x] 1.3 Add Windows LocalAppData history configuration and launcher tests

## 2. Workbench price forecast

- [x] 2.1 Add failing UI tests for a real price forecast navigation entry and readiness/result states
- [x] 2.2 Implement lazy forecast loading, progress display and forecast result rendering in the current workbench
- [x] 2.3 Update guide and README to match the real navigation and five-day accumulation rule

## 3. Verification and delivery

- [x] 3.1 Run focused tests, full automated tests and OpenSpec validation
- [x] 3.2 Run real local service and browser acceptance for insufficient-history and baseline-ready data
- [ ] 3.3 Build the Windows package, verify extracted contents/runtime/startup contract and calculate SHA-256
- [ ] 3.4 Send the verified package and concise upgrade instructions to engineering-group Wang Ying through DingTalk
