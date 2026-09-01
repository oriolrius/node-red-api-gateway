---
id: TASK-077
title: 'apigw-config: OPA editor UI section (house style)'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 11:56'
labels:
  - api-config
  - editor
  - opa
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-076
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - nodes/api-config.html
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the existing apigw-config OPA section (nodes/api-config.html:317-348) in place, following house style (one scrolling form of div.form-row, h4 sub-headers, show/hide via plain jQuery, class form-row opa-config-row so the existing opaEnabled toggle picks the rows up). Sub-sections: Connection (opaUrl with https warning, opaToken password required with hint, opaPolicyPath with a generic-shape placeholder and tip), Enforcement (opaMode select with Enforce default first and a monitor amber hint, opaFailOpen nested), Policy input (opaTokenMode, opaTokenClaims nested chip preview, opaIncludeAuditFields with a disables-caching hint), Performance and resilience (TTL, timeout, retry, deadline, cacheMaxSize, breaker fields plus a live worst-case-latency budget callout). Add var node = this in oneditprepare (currently absent) so the Test button posts the correct config-node id. Phase 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All new rows carry class form-row opa-config-row and are shown or hidden by the existing opaEnabled toggle
- [x] #2 opaUrl shows an amber use-TLS warning when the value does not start with https, and opaToken shows an amber warning when empty
- [x] #3 opaMode select lists Enforce (default, first), Monitor (with an amber requests-are-NOT-authorized hint), and Off; selecting Monitor reveals the hint
- [x] #4 A live budget callout recomputes worst-case added latency (bounded by the deadline) and the breaker-open threshold as fields change
- [x] #5 oneditprepare declares var node = this so admin requests use the real config-node id
- [x] #6 No RED.tabs, typedInput, editableList or details element is introduced (house style preserved)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
nodes/api-config.html: extended the existing OPA section in place, house style (div.form-row + bold full-width sub-headings + plain jQuery toggles). Sub-sections Connection (opaUrl w/ amber https warning, opaToken password required w/ hint + empty warning, opaPolicyPath generic-shape placeholder + tip), Enforcement (opaMode select Enforce-first + monitor amber hint, opaFailOpen nested .opa-enforce-row), Policy input (opaTokenMode + nested opaTokenClaims chip preview + opaIncludeAuditFields disables-caching hint), Performance & resilience (TTL/timeout/retry/deadline/cacheMaxSize/breaker fields + live worst-case-latency budget callout via updateOpaBudget). All new rows carry class 'form-row opa-config-row' picked up by the opaEnabled toggle (which re-triggers children on show). Added 'var node = this;' in oneditprepare. Defaults updated + opaToken credential declared. No RED.tabs/typedInput/editableList/details introduced. Added Test button markup + hidden result divs (handler wired in task-082).
<!-- SECTION:NOTES:END -->
