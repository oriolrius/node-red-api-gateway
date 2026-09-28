---
id: TASK-094
title: 'Release v0.10.0 (GH #4, #5, #6) to npm and flows.nodered.org'
status: Done
assignee: []
created_date: '2026-09-28 16:54'
updated_date: '2026-09-28 17:08'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Release the fixes for GH #4, #5, #6.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CHANGELOG entry and version bump
- [x] #2 Tag pushed and CI release green
- [x] #3 Version visible on npmjs.com
- [x] #4 Version visible on flows.nodered.org
- [x] #5 GitHub issues closed with references
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
v0.10.0 tagged and pushed; Release + CI workflows green; npm latest=0.10.0 (with provenance); GitHub release v0.10.0 created; flows.nodered.org refreshed via POST /add/node and shows 0.10.0 (it had been stuck on 0.8.2 and did not auto-pick 0.9.0). GH #4/#5/#6 auto-closed by Fixes footers.
<!-- SECTION:NOTES:END -->
