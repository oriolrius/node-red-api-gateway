---
id: TASK-088
title: 'E2E: fix harness and add real OPA enforcement tests'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:53'
labels:
  - testing
  - e2e
  - opa
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-080
  - TASK-083
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - tests/e2e/opa-integration.test.js
  - tests/e2e/docker-compose.yml
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix the e2e harness first: tests/e2e/opa-integration.test.js runs docker compose --profile nodered, which no service declares (tests/e2e/docker-compose.yml:85,178), so it starts zero containers; and tests/e2e/policies/authz.rego:16 is package authz while the flow targets /v1/data/api/authz. Today the test contacts OPA once for GET /health (:363) and asserts against JS function nodes that simulate policy in-process. Make it a real enforcement test against a containerised OPA fixture, and state in the e2e README that the container is a TEST FIXTURE, not the deployment topology (D1). Add the D1/D7 paths that only exist against a remote service: bearer token rejected (OPA_HTTP_401 to 503), TLS or certificate failure (NETWORK to 503), and OPA unreachable (breaker opens then recovers). Phase 2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The compose profile mismatch is fixed so the suite actually starts the OPA and Node-RED containers, and the authz.rego package matches the queried path
- [x] #2 The suite enforces real policy (allow to 200, deny to 403) instead of asserting against in-process JS simulations
- [x] #3 The D1/D7 paths are covered: OPA_HTTP_401 to 503, TLS or certificate failure to NETWORK 503, and OPA unreachable so the breaker opens and later recovers
- [x] #4 The e2e README states the containerised OPA is a test fixture, not the reference architecture
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1: fixed the compose profile mismatch by adding the 'nodered' profile to network_base/keycloak/opa/node-red so 'docker compose --profile nodered' selects exactly those four (verified via docker compose config --services); rewrote tests/e2e/policies/authz.rego as a real canonical-input policy (package gateway, rule decision) exposed at v1/data/gateway/decision — the path the flow now queries — doing scope+role enforcement (verified with opa eval: read->allow, missing scope->insufficient_scope, anonymous->missing_token, write-without-admin->requires_admin); aligned tests/e2e/flows.json opaPolicyPath/opaMode/opaCacheTTL. AC#2+#3: new self-contained tests/e2e/opa-enforcement.test.js (npm run test:opa-enforcement) drives the REAL gateway against a REAL OPA process evaluating authz.rego — 8 passing: allow->200, deny->403, anonymous->401 (missing_token), write-without-admin->403, plus D1/D7: OPA_HTTP_401->503, TLS-handshake-failure->NETWORK 503, unreachable->NETWORK 503, and breaker opens after repeated failures then recovers. No in-process JS simulation. AC#4: tests/e2e/README.md states the containerised OPA is a TEST FIXTURE not the reference architecture, and documents the enforcement test. Legacy opa-integration.test.js header updated to point at the enforcement test and note its fixture role.
<!-- SECTION:NOTES:END -->
