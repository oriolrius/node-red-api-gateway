---
id: task-016
title: Create Node-RED configuration for E2E tests
status: To Do
assignee: []
created_date: '2025-12-03 11:05'
labels:
  - testing
  - infrastructure
  - e2e
  - configuration
dependencies:
  - task-015
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create Node-RED settings and package configuration files for E2E testing:
- `tests/e2e/.nodered/settings.js` - Node-RED settings optimized for testing
- `tests/e2e/.nodered/package.json` - Empty npm package manifest for Node-RED user directory

**Reference**: See doc-002 "Testing Approaches" - Approach 3 configuration files section

**Key Requirements**:
- Minimal settings.js with authentication disabled
- Projects disabled for testing
- Basic logging configuration (info level, no metrics/audit)
- Proper flow file path configuration
- Function global context and external modules settings
- Proper directory structure with .nodered directory

These files configure how Node-RED behaves inside the Docker container during E2E tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Directory `tests/e2e/.nodered/` created
- [ ] #2 File `tests/e2e/.nodered/settings.js` created with proper configuration
- [ ] #3 File `tests/e2e/.nodered/package.json` created
- [ ] #4 Authentication disabled in settings
- [ ] #5 Projects disabled for testing
- [ ] #6 Logging configured at info level
- [ ] #7 Flow file path correctly configured
- [ ] #8 Directory is properly mounted in Docker Compose
<!-- AC:END -->
