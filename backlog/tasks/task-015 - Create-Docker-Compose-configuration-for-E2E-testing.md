---
id: task-015
title: Create Docker Compose configuration for E2E testing
status: To Do
assignee: []
created_date: '2025-12-03 11:05'
labels:
  - testing
  - infrastructure
  - e2e
  - docker
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create `tests/e2e/docker-compose.yml` - Docker Compose configuration for running Node-RED in a container for end-to-end testing.

This is the container orchestration layer for full E2E testing where Node-RED runs in Docker with proper health checks and volume mounts for the test node package.

**Reference**: See doc-002 "Testing Approaches" - Approach 3: Docker Compose E2E Testing section

**Key Requirements**:
- Node-RED container configuration (latest image)
- Health check that verifies HTTP endpoint is responding
- Port mapping for Node-RED UI and API (1880)
- Volume mounts for node package and Node-RED configuration
- Environment variables for disabling safe mode
- Proper restart policy for testing
- Support for optional external dependencies (commented examples for Redis, etc.)
- Container naming for test identification

**Must include proper health check with retries and timeouts** to ensure container is truly ready before tests run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 File `tests/e2e/docker-compose.yml` created
- [ ] #2 Node-RED service configured with proper image
- [ ] #3 Health check endpoint returns 200 OK when container is ready
- [ ] #4 Health check has appropriate timeout and retry settings
- [ ] #5 Volume mounts configured for node package and Node-RED config
- [ ] #6 Port 1880 exposed and mapped correctly
- [ ] #7 Environment variables set for testing (safe mode disabled)
- [ ] #8 Comments included for extending with additional services
<!-- AC:END -->
