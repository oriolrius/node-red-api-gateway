---
id: TASK-082
title: OPA admin test route and editor Test button (SSRF-safe)
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:34'
labels:
  - api-server
  - editor
  - opa
  - security
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-077
  - TASK-078
  - TASK-079
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - nodes/api-server.js
  - nodes/api-config.html
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add RED.httpAdmin.post(/api-gateway/test-opa, RED.auth.needsPermission(flows.read), handler) in nodes/api-server.js next to the existing import-openapi and preview-openapi routes, using the same success and 400 envelope and called from the editor with a RELATIVE URL. It reports three things: reachable (GET /health); policy defined (policyDefined = result !== undefined from a REAL evaluate(), catching the configured-but-nonexistent policy that createOpaHealthCheck reports healthy today); and a sample decision (allow, reason, and the exact input document from the production builder). Constraints: use a throwaway client (cacheEnabled false, retryAttempts 0, circuitBreakerEnabled false, then shutdown) so a test cannot pollute the live cache or trip the live breaker; read the token server-side via RED.nodes.getCredentials and handle the __PWRD__ sentinel; and take opaUrl from the STORED config node, never the request body, to avoid an SSRF primitive. Add the Test button to the config editor with hidden success and error divs. Phase 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The route reports reachability, whether the configured policy path is DEFINED via a real evaluate() (catching the case createOpaHealthCheck misses), and a sample decision with the exact production input document
- [x] #2 opaUrl is taken from the stored config node, never from the request body, so a body-supplied URL cannot redirect the probe (no SSRF)
- [x] #3 The test uses a throwaway client with no cache, retry or breaker and shuts it down; the production cache and breaker are never affected
- [x] #4 The token is read server-side via RED.nodes.getCredentials and the __PWRD__ sentinel is handled
- [x] #5 The editor Test button calls the route with a relative URL so httpAdminRoot is respected, and shows success or error inline
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added RED.httpAdmin.post('/api-gateway/test-opa', needsPermission('flows.read'), ...) in nodes/api-server.js next to preview-openapi, same success/400 envelope. Reports reachable (client.getHealthStatus), policyDefined (!isUndefinedDecision from a REAL evaluate(), catching the configured-but-nonexistent path the health check misses), and a sample decision (allowed/reason/decisionId) + the exact production input from buildOpaInput. SSRF-safe: opaUrl and policyPath from the STORED config node (RED.nodes.getNode), never the body; token via RED.nodes.getCredentials with __PWRD__ sentinel handled. Throwaway OpaClient (cacheEnabled false, retryAttempts 0, circuitBreakerEnabled false, shutdown in finally) so the live cache/breaker are untouched. Editor Test button handler in api-config.html posts the relative URL 'api-gateway/test-opa' with {config: node.id}, HTML-escapes output, shows inline success/error. 6 tests in tests/unit/api-server_opa-testroute_spec.js (reachability/policyDefined/input, undefined-doc detection, SSRF URL-from-stored, bearer server-side, throwaway-not-live-cache, 400 missing config).
<!-- SECTION:NOTES:END -->
