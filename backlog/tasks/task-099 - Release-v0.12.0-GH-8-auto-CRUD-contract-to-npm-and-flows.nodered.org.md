---
id: TASK-099
title: Release v0.12.0 (GH-8 auto-CRUD contract) to npm and flows.nodered.org
status: Done
assignee: []
created_date: '2026-11-18T12:52:00Z'
updated_date: '2026-11-18T12:56:00Z'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Minor release (breaking auto-CRUD contract changes) for GH-8: commits aa88907 + c09705a, reviewed by GPT-6.2 Astra. Push main, tag v0.12.0, CI publishes npm + GitHub release, refresh flows.nodered.org, comment on and close issue #8.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CHANGELOG entry and version bump
- [x] #2 Tag pushed and CI release green
- [x] #3 Version visible on npmjs.com
- [x] #4 Version visible on flows.nodered.org
- [x] #5 Issue #8 commented and closed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
v0.12.0 tagged (e1f1d20); Release + CI green; npm latest=0.12.0; GitHub release https://github.com/oriolrius/node-red-api-gateway/releases/tag/v0.12.0; flows.nodered.org refreshed via POST /add/node and shows 0.12.0; issue #8 auto-closed by the 'Fixes #8' push, summary comment posted.
<!-- SECTION:NOTES:END -->
