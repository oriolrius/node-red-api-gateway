---
id: task-017
title: Create E2E test runner with Docker verification
status: To Do
assignee: []
created_date: '2025-12-03 11:05'
labels:
  - testing
  - infrastructure
  - e2e
  - docker
dependencies:
  - task-015
  - task-016
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create `tests/e2e/run-e2e-tests.js` - Main E2E test runner script that orchestrates Docker, verifies container health, deploys flows, and runs comprehensive tests.

**Reference**: See doc-002 "Testing Approaches" - Approach 3: run-e2e-tests.js section

**CRITICAL REQUIREMENT**: This script must implement strict Docker verification:
- Verify Docker is installed and running BEFORE any tests
- Fail IMMEDIATELY if Docker is unavailable (no fallbacks)
- Check Docker Compose availability
- Provide clear error messages when Docker fails

**Key Features**:
- `verifyDockerAvailable()` - Strict Docker verification that fails fast
- `startContainers()` - Start Docker Compose with health checks
- `stopContainers()` - Graceful shutdown and cleanup
- `deployFlow()` - Deploy test flows via Node-RED Admin API
- Multiple test functions:
  - testBasicFunctionality() - Test node behavior via HTTP
  - testNodeInPalette() - Verify node appears in palette
  - testMultipleMessages() - Process multiple messages successfully
- Proper timeout handling and container log inspection on failure
- Exit codes: 0 for success, 1 for failure

The script should be executable and handle all edge cases documented in doc-002.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 File `tests/e2e/run-e2e-tests.js` created
- [ ] #2 Docker availability verification runs first and fails if unavailable
- [ ] #3 Containers start and pass health checks before tests
- [ ] #4 Flow deployment via Admin API works correctly
- [ ] #5 At least 3 test functions implemented
- [ ] #6 Container logs printed on failure
- [ ] #7 Proper cleanup happens even on test failure
- [ ] #8 Exit code 0 on success, 1 on failure
- [ ] #9 Clear error messages for Docker unavailability
- [ ] #10 Timeout handling for container startup and test execution
<!-- AC:END -->
