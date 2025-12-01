---
id: task-003
title: Create node-red-testing skill
status: Done
assignee:
  - Claude
created_date: '2025-12-01 14:59'
updated_date: '2025-12-01 15:31'
labels:
  - skill
  - testing
  - node-red
dependencies:
  - task-008
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a Claude skill for Node-RED testing strategies covering:
- Unit Testing with Mocks (mock RED framework, mock client responses, test initialization)
- Integration Testing (testcontainers, Docker Compose, health checks, message flow testing)
- End-to-End Testing (Node-RED runtime integration, HTTP server testing, UI testing)
- Test Organization & Patterns (test runners, isolation, setup/teardown, example validation)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SKILL.md created with YAML frontmatter
- [x] #2 Covers unit testing with mocks
- [x] #3 Covers integration testing with Docker
- [x] #4 Covers E2E testing patterns
- [x] #5 Scripts contain test scaffolding generator
- [x] #6 References contain testcontainers setup guide
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Directory Structure
```
.claude/skills/node-red-testing/
├── SKILL.md                     # Main skill documentation
├── scripts/
│   └── init_test.py             # Test scaffolding generator
└── references/
    └── testcontainers-setup.md  # Docker/testcontainers guide
```

### SKILL.md Content
1. **YAML Frontmatter** - name: node-red-testing, description for skill trigger
2. **Unit Testing Section** - Mock RED framework, test node initialization, mock messages
3. **Integration Testing Section** - Testcontainers, Docker Compose patterns, health checks
4. **E2E Testing Section** - Node-RED runtime integration, HTTP testing, UI testing
5. **Test Organization** - Jest/Mocha setup, test isolation, fixtures

### Scripts
- `init_test.py` - Generate test file scaffolding for a given node (unit, integration, or E2E tests)

### References
- `testcontainers-setup.md` - Detailed testcontainers/Docker Compose configuration for Node-RED testing

### Implementation Steps
1. Create skill directory structure
2. Write SKILL.md with comprehensive testing coverage
3. Create init_test.py scaffolding generator script
4. Create testcontainers-setup.md reference guide
5. Validate skill and update backlog task
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete

Created the node-red-testing skill with:

### Files Created
- `SKILL.md` - Comprehensive testing guide covering unit, integration, and E2E testing
- `scripts/init_test.py` - Test scaffolding generator that creates unit/integration/E2E test files
- `references/testcontainers-setup.md` - Detailed Docker and testcontainers configuration guide

### SKILL.md Coverage
1. **Unit Testing** - Mock RED framework, test node registration, input handling, status updates, cleanup
2. **Integration Testing** - Docker Compose setup, health checks, message flow testing
3. **E2E Testing** - node-red-node-test-helper usage, configuration nodes, credentials, HTTP endpoints, UI testing with Playwright
4. **Test Organization** - Directory structure, Jest configuration, test isolation patterns, fixture management
<!-- SECTION:NOTES:END -->
