---
id: task-039
title: Add Endpoint Path and HTTP Method Configuration
status: To Do
assignee: []
created_date: '2025-12-10 09:34'
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
- [ ] #1 Path input with validation for valid URL patterns
- [ ] #2 HTTP method dropdown (GET, POST, PUT, DELETE, PATCH)
- [ ] #3 Path parameter extraction (e.g., :id becomes req.params.id)
- [ ] #4 Reference to api-server config node via dropdown
- [ ] #5 Unit tests for path parsing and parameter extraction
<!-- AC:END -->
