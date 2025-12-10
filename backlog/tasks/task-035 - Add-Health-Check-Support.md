---
id: task-035
title: Add Health Check Support
status: To Do
assignee: []
created_date: '2025-12-10 09:32'
labels:
  - api-server
  - config-node
  - health-check
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement health check functionality to verify connectivity to all configured backends. Expose aggregated health status to endpoint nodes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Health check for database connection
- [ ] #2 Health check for Keycloak server
- [ ] #3 Health check for OPA server
- [ ] #4 Aggregated health status (healthy, degraded, unhealthy)
- [ ] #5 Health status accessible from endpoint nodes
<!-- AC:END -->
