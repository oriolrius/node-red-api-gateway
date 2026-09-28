---
id: TASK-093
title: 'Configurable bodyLimit and raw/binary request bodies on apigw-server (GH #6)'
status: Done
assignee: []
created_date: '2026-09-28 16:54'
updated_date: '2026-09-28 17:03'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fixes GitHub issue #6 (applies the patch proposed in the issue).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bodyLimit, binaryBodyEnabled, binaryContentTypes on apigw-server; defaults equal current behaviour
- [x] #2 lib/body-parsing.js with unit tests
- [x] #3 Raw body reaches the flow as a Buffer in msg.req.body
- [x] #4 Editor section and help text
- [x] #5 E2E: real upload through the gateway to the flow
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Applied the patch proposed in GH #6 (lib/body-parsing.js, api-server wiring, editor section, unit spec). E2E: 5 MiB image arrives as Buffer (sha256 verified), octet-stream round-trip, non-listed types 415, raw over limit 413, JSON >1 MiB with larger limit.
<!-- SECTION:NOTES:END -->
