---
id: TASK-072
title: 'OPA client: retry classification (isRetryable + budget check)'
status: Done
assignee: []
created_date: '2026-09-01 09:46'
updated_date: '2026-09-01 11:42'
labels:
  - opa
  - resilience
  - infrastructure
milestone: OPA Policy Enforcement v1
dependencies: []
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - lib/opa-client.js
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add an isRetryable(err) predicate to lib/opa-client.js _evaluateWithRetry (:493-534) so only transient failures retry and deterministic or counter-productive failures fail after one attempt. Add a remaining-budget check before starting a retry so a per-attempt TIMEOUT only retries when another attempt fits inside opaDeadline. Today the client retries every error unconditionally, so a 404 costs four round trips. Phase 0 (D8): lands first, with its own table-driven tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Retried once (2 attempts total): connection refused/reset, DNS failure, socket hang-up, TLS handshake failure, and HTTP 500/502/503/504
- [x] #2 Not retried (exactly 1 attempt): HTTP 400, 401, 403, 404, 429, and a malformed or non-conforming policy response (POLICY_UNDEFINED)
- [x] #3 A per-attempt TIMEOUT starts a second attempt only when another attempt fits before opaDeadline; otherwise it surfaces as DEADLINE with no second attempt
- [x] #4 CONFIG_INVALID never reaches the wire (zero attempts)
- [x] #5 Table-driven tests in tests/unit/opa-client_spec.js, one case per classification row, assert the attempt count seen by an injected fetchFn
- [x] #6 The existing opa-client unit tests still pass, with expectations updated only where the retry count legitimately changed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added _isRetryable(err) to lib/opa-client.js (5xx retryable; 4xx/POLICY_UNDEFINED/CONFIG_INVALID non-retryable; TIMEOUT retryable subject to budget; transport errors retryable) and rewrote _evaluateWithRetry to retry only retryable failures. Added a remaining-budget check: a TIMEOUT retry is skipped and surfaced as a DEADLINE-coded error when accumulated elapsed (nominal per-attempt timeout) has reached the new advisory 'deadline' config. Table-driven test block 'retry classification (task-072)' in tests/unit/opa-client_spec.js asserts injected fetchFn call counts, one case per classification row, plus TIMEOUT fit/no-fit and CONFIG_INVALID predicate cases. Full suite green.
<!-- SECTION:NOTES:END -->
