---
id: task-002
title: Add Database Connection Configuration
status: To Do
assignee: []
created_date: '2025-12-10 09:24'
labels:
  - api-server
  - config-node
  - database
  - credentials
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the API Server configuration node with comprehensive database connection settings. This includes connection parameters (server, database, user, password), encryption settings, and connection pooling configuration.

The task requires integrating Node-RED's credentials system for sensitive data (password) to ensure secure storage and transmission. Connection pooling settings will optimize database resource utilization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Config node accepts database server and database name properties
- [ ] #2 User/password stored securely using Node-RED credentials system
- [ ] #3 Encrypt and trustServerCertificate options configurable
- [ ] #4 Connection pooling properties: min/max connections, idle timeout
- [ ] #5 Configuration validated on save with informative error messages
<!-- AC:END -->
