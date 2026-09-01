---
id: TASK-084
title: 'apigw-endpoint: per-endpoint OPA overrides (runtime)'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:25'
labels:
  - api-endpoint
  - opa
  - authorization
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-080
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - nodes/api-endpoint.js
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the per-endpoint OPA runtime keys and precedence on the apigw-endpoint node: opaMode (inherit | enforce | monitor | off, default inherit; the endpoint wins unless inherit; forced off if the config is disabled or the path is blank), opaPolicyPath (empty inherits, non-empty creates its own client), opaInputMappings (allow-list, merged last) and opaIncludeBody (bool). Wire resolveOpaSettings() precedence (config defaults overlaid by endpoint overrides, tighten-only: an endpoint may move monitor to enforce or point at a stricter policy but may not set fail-open or reconfigure the connection). Activate the multi-client map keyed by resolved path. Add the x-opa-policy OpenAPI extension alongside the existing x-rate-limit and x-cache. Phase 2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An endpoint opaMode overrides the config default unless it is inherit; inherit resolves to the config value; a disabled config or a blank path forces off
- [x] #2 A non-empty endpoint opaPolicyPath creates and uses its own OpaClient with its own cache and breaker
- [x] #3 Tighten-only is enforced: an endpoint cannot set fail-open or change the connection but can move monitor to enforce or point at a stricter policy
- [x] #4 opaInputMappings are applied through the closed-whitelist builder and opaIncludeBody adds body to the input (with the cache-hit-rate caveat)
- [x] #5 The resolved OPA policy is exported as an x-opa-policy OpenAPI extension
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
api-endpoint.js reads per-endpoint opaMode(inherit default)/opaPolicyPath/opaInputMappings/opaIncludeBody. resolveOpaSettings() in api-server.js: endpoint mode wins unless inherit; disabled config or blank path forces off; non-empty endpoint path creates its own client (own cache/breaker). Tighten-only structurally enforced (no per-endpoint failOpen or connection fields; failOpen is config-only). opaInputMappings applied via the closed-whitelist buildOpaInput; opaIncludeBody adds body to input. getEndpointInfo().opa exposes the resolved policy; openapi-generator emits x-opa-policy (refreshed at generate time since the endpoint may not be wired at registration). Tests: opaMode monitor override, opaMode off (OPA not consulted), opaIncludeBody, x-opa-policy in spec, multi-client-per-path.
<!-- SECTION:NOTES:END -->
