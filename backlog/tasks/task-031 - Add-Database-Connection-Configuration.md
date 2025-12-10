---
id: task-031
title: Add Database Connection Configuration
status: To Do
assignee: []
created_date: '2025-12-10 09:32'
labels:
  - api-server
  - config-node
  - database
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add database connection properties to api-server config node. Support SQL Server with secure credential storage using Node-RED credentials system. Properties: server, database, user, password (credential), encrypt, trustServerCertificate, connectionPool settings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Database connection properties in editor UI
- [ ] #2 Password stored using Node-RED credentials system
- [ ] #3 Connection pool settings (min, max, idle timeout)
- [ ] #4 Encryption options for secure connections
- [ ] #5 Unit tests for credential handling
<!-- AC:END -->
