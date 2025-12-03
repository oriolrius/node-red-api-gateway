---
id: task-014
title: Create standalone Node-RED launcher for manual testing
status: Done
assignee: []
created_date: '2025-12-03 11:05'
updated_date: '2025-12-03 11:41'
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
- [x] #1 File `tests/launcher/launch.js` created
- [x] #2 Server starts and listens on configurable port (default 1880)
- [x] #3 Node-RED instance is fully initialized and responding to HTTP requests
- [x] #4 Temporary directory is created for Node-RED user data
- [x] #5 Graceful shutdown via SIGINT signal handler
- [x] #6 Temporary directory is cleaned up on shutdown
- [x] #7 CORS headers configured for testing
- [x] #8 Minimal logging output
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started work on 2025-12-03. Implementing standalone Node-RED launcher for manual testing.

Completed on 2025-12-03. All acceptance criteria verified and implementation complete.

Implementation Summary:

- Created tests/launcher/launch.js with full Node-RED launcher functionality

- Added npm script 'dev:nodered' to package.json for easy startup

- Uses symlink approach to load local package into Node-RED runtime

- Handles both scoped (@user/package-name) and unscoped package names

- Server configurable via PORT env var (defaults to 1880)

- Temporary directory managed with fs.mkdtempSync and cleanup on SIGINT

- CORS enabled via httpAdminCors and httpNodeCors settings

- Logging minimized (level: 'info', metrics: false, audit: false)

- Graceful shutdown implemented with proper signal handling

- Tested: port configuration, HTTP responses, node registration, shutdown cleanup

Commit: 3d8346b - feat(test): add standalone Node-RED launcher for manual testing

Commit: 9cab460 - fix(test): bind launcher to 0.0.0.0 for container/network access

KEY IMPLEMENTATION DETAIL - Node Isolation Solution (2025-12-03):

Solved the node isolation problem by creating symlinks in the temporary directory:

1. Created symlinks in temp directory for both:
   - The project's own nodes
   - @node-red/nodes (core Node-RED nodes)

2. Set coreNodesDir to point to the temp directory location

3. This approach prevents Node-RED from:
   - Walking up the directory tree and finding unwanted packages (like Kafka nodes) in parent directories
   - Loading incorrect or conflicting node versions
   - Polluting the test environment

4. While still enabling:
   - All core Node-RED nodes to load correctly
   - Project-specific nodes to be available
   - Complete node isolation for testing

This solution ensures that manual testing with 'npm run dev:nodered' provides a clean, isolated Node-RED instance suitable for testing the API gateway node and other project nodes without interference from the parent monorepo structure.
<!-- SECTION:NOTES:END -->
