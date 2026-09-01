---
id: TASK-090
title: 'Backlog hygiene: correct stale OPA task acceptance criteria'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:55'
labels:
  - backlog
  - documentation
  - opa
milestone: OPA Policy Enforcement v1
dependencies: []
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per decision open-item 8, correct the stale OPA task acceptance criteria. task-042 AC#3 (Integration with OPA client for policy evaluation) is checked but false - nodes/api-endpoint.js contained zero occurrences of opa at the time. task-064 AC#9 mandates an OPA input shape that must be amended to match the canonical input document in decision-001. Backlog hygiene, not code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 task-042 AC#3 is corrected to reflect that request-time OPA integration did not exist at the time, or is re-pointed to this milestone
- [x] #2 task-064 AC#9 mandated OPA input shape is amended to the canonical document defined in decision-001 (method, path string, route, params, query, endpoint, token when authenticated)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Backlog hygiene (no code). task-042 AC#3 corrected: it was checked but false (nodes/api-endpoint.js had zero 'opa' occurrences when closed); reworded to note request-time OPA integration did not exist at the time and is delivered by milestone 'OPA Policy Enforcement v1' (task-080, single authority). task-064 AC#9 amended: the mandated input shape {user, method, path, body} replaced with the canonical decision-001 input (method, path STRING, route, params, query, endpoint, token only when authenticated), and the 'api.gateway.*' package convention corrected to note the gateway reserves no namespace (gateway.rego's package is an example).
<!-- SECTION:NOTES:END -->
