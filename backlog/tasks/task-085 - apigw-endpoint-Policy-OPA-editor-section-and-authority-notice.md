---
id: TASK-085
title: 'apigw-endpoint: Policy (OPA) editor section and authority notice'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:40'
labels:
  - api-endpoint
  - editor
  - opa
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-077
  - TASK-084
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - nodes/api-endpoint.html
  - nodes/api-server.html
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a Policy (OPA) section to the apigw-endpoint editor between the end of the Authorization section (nodes/api-endpoint.html:579) and the CRUD Operation header (:581), with a matching h3 Policy (OPA) help block between h3 Authorization (:956) and h3 CRUD Operations (:959) so form order and help order match. Config-node aware: an opa-disabled-notice when the selected server config node has opaEnabled false; a Mode select whose inherit label shows the inherited value via .text(); a Policy Path with a live Effective readout resolving endpoint override to config value; an Extra Input control reusing E.parseFieldMappings, E.validateFieldMappings and E.renderMappingBadges verbatim plus a new E.validateOpaMappings for the source vocabulary; an Include Body checkbox with the cache caveat; and a Preview button. Add the D6 authority notice in the Authorization block whenever the resolved OPA mode is enforce or monitor (requiredScopes stays enabled and editable but flagged as not gateway-checked). Add a bespoke updateOpaVisibility() (E.setupToggle is checkbox-only). Document the msg.opa fields in the Outputs list (:905-921). Add every new endpoint defaults key to the hand-written nodeConfig literal in the OpenAPI importer (nodes/api-server.html:298-355). Phase 2 (D6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Policy (OPA) section sits between Authorization and CRUD, and the help block order matches the form order
- [x] #2 An opa-disabled-notice appears when the selected server config node has opaEnabled false
- [x] #3 The inherit Mode option label shows the inherited value, and a live Effective policy path readout resolves endpoint override to config
- [x] #4 Extra Input reuses the existing mapping-badge UI with no new widgets or CSS, and E.validateOpaMappings validates the source vocabulary
- [x] #5 An amber authority notice appears in the Authorization block when the resolved OPA mode is enforce or monitor, and requiredScopes stays enabled and editable
- [x] #6 Every new apigw-endpoint defaults key is added to the nodeConfig literal at nodes/api-server.html:298-355
- [x] #7 The msg.opa fields are documented in the Outputs message-properties list
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
api-endpoint.html: new Policy (OPA) section between Authorization and CRUD (matching <h3>Policy (OPA)</h3> sidebar help between Authorization and CRUD Operations). Config-node aware: getOpaConfigNode() via RED.nodes.node(server).config; #opa-disabled-notice when config opaEnabled false; Mode select whose inherit option label is set via .text() to 'Inherit from config (<value>)'; Policy Path with live Effective <code> readout (endpoint override -> config); Extra Input reuses E.parseFieldMappings/renderMappingBadges verbatim + new E.validateOpaMappings (closed source/target whitelist) in resources/api-endpoint-editor.js; Include Body checkbox w/ cache caveat; Preview button. D6 authority notice (#opa-authority-notice, amber) shown in the Authorization block when resolved mode is enforce/monitor; requiredScopes stays enabled/editable. Bespoke updateOpaVisibility() (E.setupToggle is checkbox-only). Defaults opaMode/opaPolicyPath/opaInputMappings/opaIncludeBody added. msg.opa documented in Outputs. api-server.html importer nodeConfig literal extended with the four new keys. All editor JS syntax-checked; full suite 1452 green.
<!-- SECTION:NOTES:END -->
