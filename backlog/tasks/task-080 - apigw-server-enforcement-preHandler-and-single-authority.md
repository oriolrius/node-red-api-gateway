---
id: TASK-080
title: 'apigw-server: enforcement preHandler and single authority'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:25'
labels:
  - api-server
  - api-endpoint
  - opa
  - authorization
  - security
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-072
  - TASK-073
  - TASK-074
  - TASK-078
  - TASK-079
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - nodes/api-server.js
  - nodes/api-endpoint.js
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire OPA into the request path as a Fastify route preHandler. Build the preHandler as an array [authMiddleware, opaMiddleware] from one builder at nodes/api-server.js:456-459 (never a second assignment to routeOptions.preHandler). Widen the attach condition at :457 so an OPA-only endpoint still gets the hook, and change the fast-path guard at :198-201 to also test !opaActive so OPA sees a verified (not anonymous) input on an OPA-only gateway. Add createOpaMiddleware() and resolveOpaSettings() (config plus per-endpoint precedence, tighten-only). Enforce with a Promise.race(opaDeadline) wall clock. Status mapping: 403 for a policy denial (401 if unauthenticated and the reason is missing_token or token_expired, decided by request.auth, never by a policy string alone); 503 for any non-decision; fail-open (opaFailOpen) yields 200 plus a warn. POLICY_UNDEFINED (200 empty object, or an object without allow or allowed) yields 503 plus a deduped node.error naming the path plus clearCache(). monitor mode evaluates, logs, meters and attaches msg.opa but never denies. Single authority (D6): when OPA is active for an endpoint, skip the in-flow requiredScopes check at nodes/api-endpoint.js:1189 while still sending requiredScopes as input.endpoint.requiredScopes context. Attach msg.opa. Phase 1 (D2, D4, D5, D6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Default mode is enforce: ticking opaEnabled with a valid path and a denying policy returns 403 with no second setting, and a policy-denied request never reaches endpointNode.receive()
- [x] #2 monitor makes the same request succeed with msg.opa.allowed false and an amber not-authorized warning
- [x] #3 Any non-decision (TIMEOUT, DEADLINE, CIRCUIT_OPEN, OPA 4xx/5xx, POLICY_UNDEFINED, NETWORK) yields 503 fail-closed, or 200 plus warn under opaFailOpen; a policy denial yields 403; the two are distinguishable in logs and metrics
- [x] #4 POLICY_UNDEFINED yields 503 plus a deduped node.error naming the policy path plus clearCache(), never a silent 403
- [x] #5 Single authority: an endpoint with requiredScopes set and OPA active returns 200 when the policy allows even though the token lacks the declared scope, and 403 when the policy denies; requiredScopes still appears as input.endpoint.requiredScopes
- [x] #6 The preHandler is an array with auth first, and the fast-path guard includes !opaActive so an authenticated input reaches OPA on an OPA-only gateway
- [x] #7 msg.opa is attached with allowed, reason, policyPath, mode, cached, durationMs, decisionId, result, failOpen and error
- [x] #8 token is absent (not null) for anonymous requests and a policy dereferencing input.token.scope denies rather than erroring
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
createOpaMiddleware() as a Fastify preHandler; registerFastifyRoute builds preHandler as an array [auth, opa] with a widened attach condition; fast-path guard now includes !opaActive; auth middleware only POPULATES request.auth when OPA active (enforceAuthHere), never rejects. resolveOpaSettings() config+endpoint precedence (tighten-only). Promise.race(opaDeadline). Status mapping: 403 deny (401 when request.auth unauthenticated AND reason missing_token/token_expired), 503 non-decision, 200+warn fail-open. isUndefinedDecision() -> POLICY_UNDEFINED 503 + deduped node.error + clearCache. monitor never denies, attaches msg.opa. Single authority: api-endpoint.js:1189 skipped when msg.opa present; requiredScopes still sent as input.endpoint.requiredScopes. msg.opa carries allowed/reason/policyPath/mode/cached/durationMs/decisionId/result/failOpen/error. 13 HTTP integration tests cover all ACs.
<!-- SECTION:NOTES:END -->
