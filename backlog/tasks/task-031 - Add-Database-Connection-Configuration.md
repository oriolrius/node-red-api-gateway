---
id: task-031
title: Add Database Connection Configuration
status: Done
assignee: []
created_date: '2025-12-10 09:32'
updated_date: '2025-12-10 09:56'
labels:
  - api-config
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
- [x] #1 Database connection properties in editor UI
- [x] #2 Password stored using Node-RED credentials system
- [x] #3 Connection pool settings (min, max, idle timeout)
- [x] #4 Encryption options for secure connections
- [x] #5 Unit tests for credential handling
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started work on 2025-12-10: Beginning implementation of SQL Server encryption options and connection pool settings for api-config node

Completed on 2025-12-10: Added SQL Server specific options (dbEncrypt, dbTrustServerCertificate) and connection pool settings (dbPoolMin, dbPoolMax, dbPoolIdleTimeout). Updated api-config.js runtime to store new properties. Updated api-config.html editor with UI fields for SQL Server options (shown only when mssql selected) and connection pool settings. Added unit tests for SQL Server config and connection pool settings. All 16 tests passing, lint clean. Note: Basic database connection properties (host, port, dbName, user, password) were already implemented in task-030.

Commit 1e929ac: feat(node): add SQL Server encryption and connection pool settings - Added dbEncrypt, dbTrustServerCertificate, and connection pool configuration (dbPoolMin, dbPoolMax, dbPoolIdleTimeout) with unit tests
<!-- SECTION:NOTES:END -->
