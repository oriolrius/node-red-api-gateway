---
id: TASK-096
title: 'Release v0.11.0 (GH #7) to npm and flows.nodered.org'
status: Done
assignee: []
created_date: '2026-11-09T16:48:00Z'
updated_date: '2026-11-09T16:54:00Z'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Release the fix for GH #7 (breaking: ConnectionPoolManager removed, getPoolStatistics() new shape).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CHANGELOG entry and version bump
- [x] #2 Tag pushed and CI release green
- [x] #3 Version visible on npmjs.com
- [x] #4 Version visible on flows.nodered.org
- [x] #5 GitHub issue #7 closed with reference
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
v0.11.0 tagged and pushed (1435eb1); Release + CI workflows green; npm latest=0.11.0; GitHub release v0.11.0 created; flows.nodered.org refreshed via POST /add/node and shows 0.11.0. GH #7 auto-closed by the Fixes footer of 5ed9db5.
<!-- SECTION:NOTES:END -->
