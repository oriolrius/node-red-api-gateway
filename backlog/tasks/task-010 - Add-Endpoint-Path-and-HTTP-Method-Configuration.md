---
id: task-010
title: Add Endpoint Path and HTTP Method Configuration
status: To Do
assignee: []
created_date: '2025-12-10 09:25'
labels:
  - api-endpoint
  - core-feature
  - configuration
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add properties to the API Endpoint node to configure REST API endpoints with specific path and HTTP method. Support path parameters like :id and integrate with api-server config node for endpoint registration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add 'path' property supporting paths like /users, /users/:id with parameter interpolation
- [ ] #2 Add 'method' property with GET, POST, PUT, DELETE, PATCH dropdown selection
- [ ] #3 Parse and extract path parameters (e.g., :id, :userId) and make available in msg context
- [ ] #4 Reference and register endpoint with api-server config node
- [ ] #5 Validate path format and method selection on deploy
<!-- AC:END -->
