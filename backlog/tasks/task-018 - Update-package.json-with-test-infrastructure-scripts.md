---
id: task-018
title: Update package.json with test infrastructure scripts
status: To Do
assignee: []
created_date: '2025-12-03 11:05'
labels:
  - testing
  - infrastructure
  - build
dependencies:
  - task-014
  - task-017
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update `package.json` to add new npm scripts for the test infrastructure:

**Scripts to add**:
- `test:e2e` - Run E2E tests with Docker
- `dev:nodered` - Start standalone Node-RED launcher for manual testing
- `docker:test:up` - Start Docker containers (for debugging)
- `docker:test:down` - Stop and clean up Docker containers
- (Optional) `test:integration` - Run integration tests with mock RED

**Reference**: See doc-002 "Testing Approaches" - Suggested package.json Scripts section

These scripts should be properly documented and follow npm script conventions. The E2E script should reference the run-e2e-tests.js file, dev script should reference launcher/launch.js, and docker scripts should use proper docker-compose commands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 test:e2e script added and references run-e2e-tests.js
- [ ] #2 dev:nodered script added and references launcher/launch.js
- [ ] #3 docker:test:up script added with proper docker-compose command
- [ ] #4 docker:test:down script added with proper docker-compose command
- [ ] #5 All scripts are executable from npm
- [ ] #6 Scripts follow npm conventions with proper file paths
- [ ] #7 Scripts are documented in package.json
<!-- AC:END -->
