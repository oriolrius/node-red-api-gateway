---
id: TASK-081
title: 'OPA observability: opa_policy_check log, error taxonomy and metrics'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:25'
labels:
  - observability
  - opa
  - metrics
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-075
  - TASK-080
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - nodes/api-endpoint.js
  - lib/metrics-collector.js
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Emit the opa_policy_check structured log (mirroring authorization_check at nodes/api-endpoint.js:1235-1244) with allowed, enforced, mode, policyPath, reason, cached, durationMs, decisionId (flat top-level so it is greppable and indexable), method, path, route and sub - and never the input document. Implement the stable error-taxonomy enum that appears identically in the 503/403 body details.reason, the log field, the Prometheus label and msg.opa.error.code. Populate the Prometheus metrics: api_gateway_opa_policy_duration_ms (advertised but empty today), decision counters by allowed and reason, cache hit rate, and opa_circuit_breaker_state (needs the metrics-collector fix). Document the required alerts. Phase 1 (D8, observability).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Exactly one opa_policy_check record is emitted per request, and no authorization_check record is emitted for an OPA-active endpoint
- [x] #2 decisionId is a flat top-level field in the log, present on ALLOW and DENY and absent on a cache hit; the input document is never logged
- [x] #3 The error-taxonomy code is identical across the response body details.reason, the log field, the metric label and msg.opa.error.code
- [x] #4 api_gateway_opa_policy_duration_ms and the decision, cache and breaker metrics are populated, and opa_circuit_breaker_state reads 1 for a half-open breaker
- [x] #5 OPA_HTTP_401 (our token rejected) and NETWORK or CIRCUIT_OPEN (OPA down) are distinguishable in logs and metrics and neither is counted as a policy denial
- [x] #6 The alert set (breaker open, deny-rate step change, POLICY_UNDEFINED greater than 0 pages, p99 vs budget, sustained NETWORK/TIMEOUT/DEADLINE pages, OPA_HTTP_401/403 pages, cache hit-rate drop) is documented alongside the metrics
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
logOpaCheck() emits one flat opa_policy_check record (allowed/enforced/mode/policyPath/reason/cached/durationMs/decisionId/method/path/route/sub; decisionId omitted on cache hit; input never logged); no authorization_check for OPA-active endpoints. classifyOpaError() stable taxonomy (TIMEOUT/DEADLINE/CIRCUIT_OPEN/NETWORK/OPA_HTTP_4xx-5xx/POLICY_UNDEFINED/CONFIG_INVALID) identical across 503/403 body details.reason, log reason, metric reason label and msg.opa.error.code. metrics-collector: reason label added to opa_operations_total, new recordOpaError() records result=error (never deny). meterOpa() populates duration + decision + cache; circuit state via listeners; half_open->1 (task-075). Alert set documented in docs/opa-observability.md. Tests in metrics-collector_spec.js + visible opa_policy_check logs in api-server_opa_spec.js.
<!-- SECTION:NOTES:END -->
