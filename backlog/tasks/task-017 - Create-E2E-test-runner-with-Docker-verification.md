---
id: task-017
title: Create E2E test runner with Docker verification
status: Done
assignee: []
created_date: '2025-12-03 11:05'
updated_date: '2025-12-03 15:04'
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
- [x] #1 File `tests/e2e/run-e2e-tests.js` created
- [x] #2 Docker availability verification runs first and fails if unavailable
- [x] #3 Containers start and pass health checks before tests
- [x] #4 Flow deployment via Admin API works correctly
- [x] #5 At least 3 test functions implemented
- [x] #6 Container logs printed on failure
- [x] #7 Proper cleanup happens even on test failure
- [x] #8 Exit code 0 on success, 1 on failure
- [x] #9 Clear error messages for Docker unavailability
- [x] #10 Timeout handling for container startup and test execution
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started work on 2025-12-03: Beginning implementation of E2E test runner script (tests/e2e/run-e2e-tests.js) with strict Docker verification

Completed on 2025-12-03: All acceptance criteria met - E2E test runner fully implemented with 4 test functions (testNodeInPalette, testBasicFunctionality, testMultipleMessages, testFlowDeployment), comprehensive Docker verification, proper cleanup, and npm script integration. All tests passing.

Commit 5cf4745: feat(test): add E2E test runner with Docker verification - Implements comprehensive test runner with strict Docker verification, automated container management, flow deployment, and 4 test functions (palette registration, basic functionality, multiple messages, flow persistence)

Test Output (npm run test:e2e) - 2025-12-03:

🚀 Starting E2E Tests for Node-RED API Gateway
════════════════════════════════════════════════════════════

🔍 Verifying Docker availability...
  ✓ Docker installed: Docker version 28.5.1, build e180ab8
  ✓ Docker Compose: Docker Compose version v2.40.0
  ✓ Docker daemon is running
✅ Docker is available and running

📦 Starting Docker containers...
  $ docker compose -f ".../tests/e2e/docker-compose.yml" up -d

⏳ Waiting for containers to be healthy...
✅ Node-RED container is healthy (attempt 4)

🔌 Verifying Node-RED API is accessible...
✅ Node-RED API is responding

📝 Test 1: Node Registration in Palette
──────────────────────────────────────────────────
  ✅ api-server node is registered in palette
  ✅ api-endpoint node is registered in palette

📝 Test 2: Basic Node Functionality
──────────────────────────────────────────────────
  📤 Deploying test flow...
  ✅ Flow deployed successfully
  📤 Testing via HTTP endpoint...
  ✅ HTTP endpoint responded successfully

📝 Test 3: Multiple Message Processing
──────────────────────────────────────────────────
  📤 Sending 5 messages...
  📨 Received responses: 5/5
  ✅ All messages processed successfully

📝 Test 4: Flow Deployment
──────────────────────────────────────────────────
  ✅ Retrieved flows: 4 nodes

🛑 Stopping Docker containers...
✅ Containers stopped and cleaned up

════════════════════════════════════════════════════════════
📊 Test Summary
════════════════════════════════════════════════════════════
  ✅ Node Registration
  ✅ Basic Functionality
  ✅ Multiple Messages
  ✅ Flow Deployment
────────────────────────────────────────────────────────────
  Total: 4 tests
  Passed: 4
  Failed: 0
════════════════════════════════════════════════════════════

🎉 All E2E tests passed!
<!-- SECTION:NOTES:END -->
