---
id: TASK-086
title: OPA Help and examples panel (canonical input + 7 Rego patterns)
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:40'
labels:
  - api-endpoint
  - editor
  - documentation
  - opa
milestone: OPA Policy Enforcement v1
dependencies:
  - TASK-085
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
  - nodes/api-endpoint.html
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add an inline collapsible opa-help-panel (plain jQuery .toggle(), no modal and no RED.tabs) below a Help and examples red-ui-button-small next to the Preview button. Content: the canonical input shape; six plain contract statements (verified claims; data not a credential and two identities; token absent not null; scope space-delimited; closed whitelist; OPA is the authority); and the seven copyable Rego examples (require a scope; require multiple scopes; require a role with the claim-path note; match method; match route vs path; use route params with the ownership-semantics caveat; anonymous vs authenticated). Each example sits in a pre block with a Copy button (clipboard API with a document.execCommand copy fallback). Mirror the same content into the endpoint node h3 Policy (OPA) help block. Phase 2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Help and examples panel opens from the Policy (OPA) section and shows the canonical input shape plus all seven Rego patterns, each copyable
- [x] #2 Copy uses the clipboard API with a document.execCommand copy fallback
- [x] #3 The six contract statements, including token omitted-not-null and OPA-is-the-authority, are present
- [x] #4 The same content is mirrored into the endpoint h3 Policy (OPA) sidebar help block
- [x] #5 No modal, RED.tabs or new dependency is introduced
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Inline #opa-help-panel (plain jQuery .toggle(), no modal/RED.tabs) below a 'Help & examples' red-ui-button-small next to Preview. Content: canonical input shape; six contract statements (verified claims; data-not-credential + two identities; token absent-not-null; scope space-delimited; closed whitelist; OPA is the authority); seven copyable Rego patterns (require a scope; require multiple scopes via object.subset; require a role w/ realm_access/resource_access claim-path note; match method; route-template vs concrete-path; route params w/ NOT-true-ownership caveat; anonymous vs authenticated). Each example in a <pre class='opa-code'> with a Copy button using navigator.clipboard.writeText + document.execCommand('copy') fallback. Same canonical input + key facts + patterns mirrored into the <h3>Policy (OPA)</h3> sidebar help. .opa-code/.opa-example CSS added; no new dependency.
<!-- SECTION:NOTES:END -->
