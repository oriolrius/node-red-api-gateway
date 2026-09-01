---
id: TASK-083
title: Ship gateway.rego reference policy and add opa test to CI
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:29'
labels:
  - opa
  - policy
  - ci
  - testing
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-078
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - policies/templates/
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ship policies/templates/gateway.rego (its own package) written against the canonical input: its rule implements scope authorization from input.endpoint.requiredScopes against input.token.scope (reproducing the old gateway-side behaviour out of the box) and returns allowed AND reason in one round trip. Add opa test policies/templates/ -v as an npm script and a CI step (.github/workflows/ci.yml runs only gitleaks, lint and mocha today). Add policies/templates/tests/ to the package.json files allowlist (consumers currently receive policies CI never tested). Update policies/templates/README.md and the template compatibility table. Phase 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 gateway.rego declares default allow := false and returns allowed plus reason; a token whose scope holds the required scope is allowed and one missing it is denied
- [x] #2 A request with token omitted entirely is denied, and a token whose scope claim is missing is denied rather than accidentally satisfying a subset test
- [x] #3 opa test policies/templates/ passes and runs both as an npm script and as a CI step
- [x] #4 policies/templates/tests/ is added to the package.json files allowlist
- [x] #5 The template compatibility table (rbac, time-based and audit Supported; abac and ownership Reference-only) is documented in the README and help text
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
policies/templates/gateway.rego (package gateway, its own package): decision := {allowed, reason}; default allow := false; is_authenticated iff input.token; scope authz from input.endpoint.requiredScopes vs input.token.scope (space-delimited), AND via object.subset / OR via membership, and count(required)==0 admits any authenticated caller; reason allow|missing_token|insufficient_scope. tests/gateway_test.rego (9 tests) covers scope present/missing, token omitted->missing_token, missing scope claim->insufficient_scope (no accidental subset satisfaction), OR operator, no-required-scopes, default-deny. Added npm script test:opa-policies (opa test policies/templates/ -v), a CI job opa-policies (installs OPA static binary, runs the script), added policies/templates/tests/ to package.json files allowlist, and documented gateway.rego + the Supported/Reference-only compatibility table in policies/templates/README.md (also corrected the deprecated isAllowed integration example). opa test: 145/145 pass.
<!-- SECTION:NOTES:END -->
