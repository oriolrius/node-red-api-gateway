---
id: TASK-079
title: 'apigw-server: OPA client lifecycle and gateway credential'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:25'
labels:
  - api-server
  - opa
  - security
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-076
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - nodes/api-server.js
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add initializeOpaClient() to nodes/api-server.js (a line-for-line analogue of initializeKeycloakClient, :96-137) and node.opaClientsByPath = new Map() - one OpaClient per distinct resolved policy path, because the cache key contains neither opaUrl nor policyPath so a shared client would cross-serve decisions. Map config keys to OpaClient options (opaCacheTTL seconds to ms; 0 maps to cacheEnabled false; a defensive node.warn on ms-looking values such as 60000). Call validateOpaConfig() (first production caller) plus the D1/D7 checks: opaUrl parses and is https (warn otherwise) and credentials.opaToken is present (warn otherwise); on failure force mode off with red status and node.error, never falling back to DEFAULT_OPA_CONFIG.policyPath. Inject the gateway bearer token via a fetchFn wrapper covering both _makeRequest and getHealthStatus. Attach circuitOpen and circuitClosed listeners plus a defensive error listener. Re-point the health check at the live client. Add the node._opaFetchFn test seam. Tear down in stopServer() (shutdown each client). Handle getNode() returning null and stale resolveOpaSettings on partial deploy. Mark isAllowed() deprecated. Phase 1 (D3, D7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 One OpaClient is created per distinct resolved policy path and reused; more than 16 distinct paths logs a warning
- [x] #2 Every outbound OPA request, decisions and the health check alike, carries Authorization Bearer opaToken via the fetchFn wrapper, and the user token is never used
- [x] #3 validateOpaConfig plus the https, token and path checks run at init; invalid config forces mode off with a red node.status and node.error and never falls back to the built-in default policy path
- [x] #4 A non-https opaUrl or a missing opaToken emits a startup node.warn naming the risk
- [x] #5 A deleted or unwired config node (getNode returns null) on a previously OPA-enabled server goes red and refuses to enforce rather than starting unprotected
- [x] #6 Clients survive restartServer() (which only calls fastify.close) and are shut down via shutdown() by stopServer()
- [x] #7 A node._opaFetchFn seam lets tests inject a fake fetch, and isAllowed() is marked deprecated so nobody wires it later
- [x] #8 Config-to-client unit tests cover the seconds-to-ms mapping and the 0-means-disable-cache case
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
nodes/api-server.js: initializeOpaClient() (analogue of initializeKeycloakClient) + node.opaClientsByPath Map (one OpaClient per resolved path; >16 warns). opaClientOptions() maps config->client at the unit boundary (opaCacheTTL s->ms; 0 or opaIncludeAuditFields -> cacheEnabled false; ms-looking TTL warns). validateOpaConfig() (first prod caller) + URL-parse + https/token soft warns; blank URL soft-disables, malformed URL/invalid config -> _opaConfigInvalid + red status + node.error, never DEFAULT policyPath. buildOpaFetchWrapper() injects Bearer opaToken on every call (decisions AND getHealthStatus) reading token+_opaFetchFn dynamically; user token never used. circuitOpen/Closed/HalfOpen + defensive error listeners; health check re-pointed to live client. getNode-null (set-but-missing config) -> red/refuse. stopServer shuts down all clients; restartServer only closes fastify so caches survive. isAllowed() @deprecated. Tests: config-to-client mapping (s->ms, 0-disable), one-client-per-path, invalid-url, missing-config in tests/unit/api-server_opa_spec.js.
<!-- SECTION:NOTES:END -->
