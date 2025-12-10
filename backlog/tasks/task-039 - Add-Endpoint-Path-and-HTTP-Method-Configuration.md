---
id: task-039
title: Add Endpoint Path and HTTP Method Configuration
status: Done
assignee: []
created_date: '2025-12-10 09:34'
updated_date: '2025-12-10 11:22'
labels:
  - api-endpoint
  - routing
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add properties to configure endpoint path (e.g., /users, /users/:id) and HTTP method (GET, POST, PUT, DELETE, PATCH). Support path parameters. Include reference to api-server config node.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Path input with validation for valid URL patterns
- [x] #2 HTTP method dropdown (GET, POST, PUT, DELETE, PATCH)
- [x] #3 Path parameter extraction (e.g., :id becomes req.params.id)
- [x] #4 Reference to api-server config node via dropdown
- [x] #5 Unit tests for path parsing and parameter extraction
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started work on 2025-12-10 - implementing endpoint path and HTTP method configuration

Commit: 66ea88d - feat(node): add endpoint path and HTTP method configuration

Implemented:
- lib/path-utils.js: Path parsing utilities with Express-style parameter support
- nodes/api-endpoint.js: Path, method, and server config reference
- nodes/api-endpoint.html: UI with path validation, method dropdown, server selector
- tests/unit/path-utils_spec.js: Comprehensive unit tests (315 test cases)
- tests/unit/api-endpoint_spec.js: Extended endpoint node tests (433 test cases)

All 252 tests pass. Full path parameter extraction and validation implemented.
<!-- SECTION:NOTES:END -->
