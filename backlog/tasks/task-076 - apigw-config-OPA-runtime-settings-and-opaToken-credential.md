---
id: TASK-076
title: 'apigw-config: OPA runtime settings and opaToken credential'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 11:56'
labels:
  - api-config
  - opa
  - security
milestone: OPA Policy Enforcement v1
dependencies: []
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - nodes/api-config.js
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the new OPA runtime properties to the apigw-config node and the opaToken credential (type password, required) - the gateway own service token for calling OPA, not a user token. Replace the false nodes/api-config.js:172 warn with mode-aware truthful messaging. Dispose the unused ConnectionStateManager(opa) (:127-134). Remove the http://localhost:8181 opaUrl default so an unset URL fails validation instead of silently pointing at nothing. Phase 1 (D5, D7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 opaToken is stored as a Node-RED credential (type password) and never serialised into the flow JSON
- [x] #2 All new OPA runtime props are read from config with the documented defaults; opaMode defaults to enforce (enforce | monitor | off)
- [x] #3 The api-config.js:172 warn is replaced (not deleted): blank path says policy evaluation is disabled, enforce says enforcement active, monitor emits a node.warn that requests are evaluated but NOT enforced (debugging mode)
- [x] #4 ConnectionStateManager(opa) is no longer created, so it cannot act as a third retry mechanism over the same call
- [x] #5 opaUrl has no built-in default; an unset opaUrl leaves the client unconfigured rather than pointing at localhost:8181
- [x] #6 New keys added: opaMode, opaFailOpen, opaDeadline, opaCacheMaxSize, opaCircuitBreakerThreshold, opaCircuitBreakerTimeout, opaTokenMode, opaTokenClaims, opaIncludeAuditFields, with the defaults from the config mapping table
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
nodes/api-config.js: added opaToken credential (type password) to registerType; added runtime props opaMode(enforce default), opaFailOpen, opaDeadline(3000), opaCacheMaxSize(5000), opaCbThreshold(5), opaCbTimeout(30000), opaTokenMode(full), opaTokenClaims, opaIncludeAuditFields, and updated defaults opaCacheTTL 60 / opaTimeout 2000 / opaRetryAttempts 1. Replaced the false :172 warn with mode-aware messaging (blank path -> disabled log; off -> disabled log; monitor -> node.warn NOT enforced; enforce -> enforcement-active log). Removed ConnectionStateManager('opa') so it can't be a third retry mechanism. opaUrl keeps no built-in default. Tests updated in api-config_spec.js (conn-manager-absent + new-defaults).
<!-- SECTION:NOTES:END -->
