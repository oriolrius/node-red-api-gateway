---
id: TASK-078
title: 'lib/opa-input.js: canonical OPA input builder (new module)'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 11:48'
labels:
  - opa
  - api-server
  - security
milestone: OPA Policy Enforcement v1
dependencies: []
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - lib/opa-input.js
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New shared module lib/opa-input.js that produces the canonical OPA input document with a fixed, load-bearing key order (JSON.stringify order is what the cache key hashes). It is the union of what the five templates read: method, path (STRING, query stripped), route (template), params, query, endpoint.requiredScopes and operator (declarative context only), token (verified claims, present only when authenticated - omitted, never null), plus opt-in resource, environment, timestamp, audit and body blocks. Implements the optional-key presence rules (absent source means the key is omitted, never null and never empty object). opaTokenMode full, claims or none; scope preserved verbatim as a space-delimited string. Closed-whitelist extra-input mapping. Shared by the runtime and the admin test route. Phase 1 (D6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 token is present only for authenticated requests and is omitted (not null, not empty object) for anonymous ones
- [x] #2 path is a string with the query string removed, and route is the route template
- [x] #3 params is an empty object for a static route; body is omitted for GET and unparsed content types; absent claims such as email are omitted
- [x] #4 input.token.scope is preserved verbatim as a space-delimited string
- [x] #5 input.endpoint.requiredScopes is included as declarative context and is never evaluated by the builder
- [x] #6 Extra-input mappings honour the closed whitelist: token.*, user.*, method, path and route cannot be written from request data, and unknown source prefixes are rejected
- [x] #7 Key order is deterministic so logically identical inputs hash to a single cache key
- [x] #8 Unit tests cover presence rules, whitelist enforcement and key-order stability
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New module lib/opa-input.js: buildOpaInput() produces the canonical input with a fixed top-level key order (method, path, route, params, query, endpoint, token, resource, environment, timestamp, request_id, source_ip, body, extra) and key-sorted nested objects for cache-key determinism. token present only when authenticated and tokenMode!=none (omitted, never null); tokenMode full|claims|none; scope preserved verbatim. endpoint.requiredScopes carried as declarative context only. Closed-whitelist extra-input mapping (parseOpaMappings/validateOpaMappings): sources params./query./headers./body./auth./method/path/route/ip/'literal'; targets resource.*/environment.*/extra.*/request_id/source_ip; token.*/user.*/method/path/route unwritable; unknown sources rejected (CONFIG_INVALID). 34 unit tests in tests/unit/lib/opa-input_spec.js, clean lint.
<!-- SECTION:NOTES:END -->
