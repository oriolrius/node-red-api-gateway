---
id: TASK-073
title: 'OPA client: per-logical-evaluation circuit-breaker accounting'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 11:42'
labels:
  - opa
  - resilience
  - infrastructure
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-072
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - lib/opa-client.js
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move _recordFailure() out of the attempt loop in lib/opa-client.js (:519) so one evaluate() records at most one circuit-breaker failure regardless of attempts, and a retry-then-success records a success rather than a failure-then-success. Today a single dead-OPA call contributes four failures against a threshold of five, tripping the breaker after about 1.25 requests. Phase 0 (D8): makes the threshold read as N consecutive failed requests and decouples it from opaRetryAttempts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One logical evaluation that makes two attempts and ultimately fails increments the breaker failure count by exactly 1
- [x] #2 A first attempt that fails transiently followed by a successful retry records a success and zero breaker failures
- [x] #3 Five consecutive failed logical evaluations open the breaker; four do not
- [x] #4 Changing opaRetryAttempts does not change how many failed requests are needed to open the breaker
- [x] #5 A test in tests/unit/opa-client_spec.js fails if _recordFailure() is moved back inside the attempt loop
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Moved _recordFailure() out of the per-attempt loop in _evaluateWithRetry so one logical evaluate() records at most one breaker failure, and a retry-then-success records a single success. Test block 'circuit breaker accounting (task-073)' includes a regression guard (2-attempt failing eval -> _failureCount===1, fails if _recordFailure moves back inside the loop), a five-vs-four opening test, and a retryAttempts-independence test.
<!-- SECTION:NOTES:END -->
