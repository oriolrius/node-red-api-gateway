---
id: TASK-097
title: >-
  Release v0.11.1 (GH-7 e2e regression tests, lint coverage) to npm and
  flows.nodered.org
status: Done
assignee: []
created_date: '2026-11-10T15:05:00Z'
updated_date: '2026-11-10T15:08:00Z'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Patch release: e2e regression tests for GH-7 against real SQL Server, lint now covers resources/ and scripts/. No runtime change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GH-7 e2e regression tests added and passing
- [x] #2 CHANGELOG entry and version bump
- [x] #3 Tag pushed and CI release green
- [x] #4 Version visible on npmjs.com
- [x] #5 Version visible on flows.nodered.org
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GH-7 e2e regression tests in tests/e2e/gateway-hardening.test.js (4ba9de9): live pool stats + /metrics gauge, saturation 503 + Retry-After + recovery; 22/22 hardening e2e and 1447 unit passing. v0.11.1 tagged (e5ff197); Release + CI green; npm latest=0.11.1; GitHub release v0.11.1 with CHANGELOG notes; flows.nodered.org refreshed via POST /add/node and shows 0.11.1.
<!-- SECTION:NOTES:END -->
