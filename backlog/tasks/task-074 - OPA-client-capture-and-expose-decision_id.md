---
id: TASK-074
title: 'OPA client: capture and expose decision_id'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 11:42'
labels:
  - opa
  - observability
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
evaluate() in lib/opa-client.js currently discards everything but response.result (:583-587). Also return the OPA decision_id when present (the response body is already available via _makeRequest and _evaluateWithRetry). Additive change. Captured on every evaluation that reaches OPA, ALLOW and DENY alike, independent of the derived HTTP outcome; omitted (not null) when OPA supplies none; never used for authorization logic or the cache key. Phase 0 (D8).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 evaluate() returns decision_id alongside the result whenever OPA includes one in the response body
- [x] #2 decision_id is omitted (key absent, not null) when OPA does not supply one
- [x] #3 The cache key (md5 of the input) is unchanged; decision_id never enters it and never affects allow/deny
- [x] #4 decision_id is captured identically for ALLOW and DENY responses
- [x] #5 Additive tests are added; the existing opa-client tests, which assert with should.have.property rather than deepEqual, still pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
evaluate() now adds decision_id to its return object when OPA supplies one in the response body (ALLOW and DENY alike), omitting the key entirely (never null) when absent. decision_id never enters the cache or the md5 cache key; cache hits carry no decision_id. Additive test block 'decision_id (task-074)'; existing property-based assertions unaffected.
<!-- SECTION:NOTES:END -->
