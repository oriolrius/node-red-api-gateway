---
id: task-014
title: Create standalone Node-RED launcher for manual testing
status: In Progress
assignee: []
created_date: '2025-12-03 11:05'
updated_date: '2025-12-03 11:07'
labels:
  - testing
  - infrastructure
  - development
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create `tests/launcher/launch.js` - A standalone Node-RED launcher for development-time manual testing.

This allows developers to quickly spin up a real Node-RED instance with their nodes installed without needing Docker or full E2E setup.

**Reference**: See doc-002 "Testing Approaches" - Approach 1: Standalone Node-RED Launcher section

**Key Requirements**:
- Creates a real Node-RED runtime (not the test helper)
- Supports graceful shutdown with temporary directory cleanup
- Minimal logging to keep output clean
- Accessible in browser at configured port
- Express app setup with Node-RED admin and node routes
- Settings optimized for testing (CORS enabled, no auth, minimal logging)

**Implementation should follow the pattern in doc-002** with HTTP server, temporary directory management, and proper process signal handling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 File `tests/launcher/launch.js` created
- [ ] #2 Server starts and listens on configurable port (default 1880)
- [ ] #3 Node-RED instance is fully initialized and responding to HTTP requests
- [ ] #4 Temporary directory is created for Node-RED user data
- [ ] #5 Graceful shutdown via SIGINT signal handler
- [ ] #6 Temporary directory is cleaned up on shutdown
- [ ] #7 CORS headers configured for testing
- [ ] #8 Minimal logging output
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started work on 2025-12-03. Implementing standalone Node-RED launcher for manual testing.
<!-- SECTION:NOTES:END -->
