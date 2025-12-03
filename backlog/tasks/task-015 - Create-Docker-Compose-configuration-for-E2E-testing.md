---
id: task-015
title: Create Docker Compose configuration for E2E testing
status: Done
assignee: []
created_date: '2025-12-03 11:05'
updated_date: '2025-12-03 14:40'
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
- [x] #1 File `tests/e2e/docker-compose.yml` created
- [x] #2 Node-RED service configured with proper image
- [x] #3 Health check endpoint returns 200 OK when container is ready
- [x] #4 Health check has appropriate timeout and retry settings
- [x] #5 Volume mounts configured for node package and Node-RED config
- [x] #6 Port 1880 exposed and mapped correctly
- [x] #7 Environment variables set for testing (safe mode disabled)
- [x] #8 Comments included for extending with additional services
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
COMPLETED - Docker Compose E2E Testing Infrastructure

Created the complete Docker Compose setup for E2E testing:

Files Created:
- tests/e2e/docker-compose.yml - Node-RED container orchestration with health checks
- tests/e2e/.nodered/settings.js - Testing-optimized Node-RED configuration
- tests/e2e/.nodered/package.json - Node-RED package dependencies and node configuration

Key Implementation Details:
- Docker container uses official Node-RED image with proper service naming
- Health check configured: 5s interval, 10s timeout, 12 retries, 30s start period
- HTTP health endpoint verified to return 200 OK when container is ready
- Port 1880 exposed for Node-RED UI and API access
- Volume mounts configured for:
  * Node package directory (node-red-api-gateway)
  * Node-RED configuration directory (.nodered)
- Environment variables set for testing mode:
  * CORS enabled
  * Authentication disabled
  * Safe mode disabled
- Node-RED loads api-server and api-endpoint nodes successfully

npm Scripts Added:
- docker:e2e:up - Start Docker Compose services
- docker:e2e:down - Stop and remove Docker Compose services
- docker:e2e:logs - View container logs for debugging

Extensibility:
- Included commented example configurations for Redis, PostgreSQL, and MQTT
- Ready for future integration testing with external services

Verification Complete:
- Container starts successfully
- Health checks pass and container becomes healthy
- HTTP endpoint responds with 200 OK
- API Gateway nodes (api-server, api-endpoint) load correctly
- Volume mounts work as expected

Completed on 2025-12-03. Full Docker Compose infrastructure ready for E2E testing.

Commit d8e7ef9: feat(test): add Docker Compose E2E testing infrastructure - Pushed to origin/main on 2025-12-03
<!-- SECTION:NOTES:END -->
