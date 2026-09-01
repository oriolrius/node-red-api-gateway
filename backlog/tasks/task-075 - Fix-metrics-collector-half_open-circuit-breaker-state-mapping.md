---
id: TASK-075
title: Fix metrics-collector half_open circuit-breaker state mapping
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 11:42'
labels:
  - observability
  - metrics
  - opa
milestone: OPA Policy Enforcement v1
dependencies: []
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - lib/metrics-collector.js
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
lib/metrics-collector.js:409 maps half-open while CircuitState.HALF_OPEN is half_open (lib/opa-client.js:9-13), so a half-open breaker is reported to Prometheus as CLOSED. Normalise the state once inside the collector (lowercase and replace underscores with hyphens) rather than at each call site.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 opa_circuit_breaker_state gauge reports 1 for a half-open breaker
- [x] #2 The state normalisation is applied inside the collector, not duplicated at call sites
- [x] #3 A unit test in tests/unit/lib/metrics-collector_spec.js asserts the half_open state maps to gauge value 1
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
setOpaCircuitState() in lib/metrics-collector.js normalises state once (String(state).toLowerCase().replace(/_/g,'-')) before mapping, so OpaClient's 'half_open' maps to gauge value 1 instead of CLOSED. Two tests assert half_open and half-open both map to 1.
<!-- SECTION:NOTES:END -->
