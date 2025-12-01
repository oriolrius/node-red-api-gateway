---
id: task-011
title: Create mssql skill for Microsoft SQL Server connectivity
status: In Progress
assignee: []
created_date: '2025-12-01 16:43'
updated_date: '2025-12-01 16:44'
labels:
  - skill
  - mssql
  - database
  - node-red
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a Claude skill for connecting to Microsoft SQL Server databases using the `mssql` Node.js library.

The skill should cover:
- Connection configuration (server, database, authentication methods)
- Connection pooling setup and management
- Query execution (simple queries, parameterized queries, stored procedures)
- Transaction handling (begin, commit, rollback, savepoints)
- Streaming large result sets
- Bulk operations (bulk insert)
- Error handling patterns
- Node-RED integration patterns (config node for connections, query nodes)
- Security best practices (parameterized queries to prevent SQL injection)
- TypeScript type definitions and usage

Key topics:
- ConnectionPool vs individual connections
- SQL authentication vs Windows authentication vs Azure AD
- Prepared statements and input/output parameters
- Working with different data types (datetime, decimal, geography, etc.)
- Handling multiple result sets
- Connection events and error handling
- Graceful shutdown and connection cleanup
- Testing patterns with mocked connections
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SKILL.md created with YAML frontmatter
- [ ] #2 Covers connection configuration and pooling
- [ ] #3 Covers query execution patterns (simple, parameterized, stored procedures)
- [ ] #4 Covers transaction handling
- [ ] #5 Covers bulk operations and streaming
- [ ] #6 Covers error handling patterns
- [ ] #7 Covers Node-RED integration (connection config node, query node)
- [ ] #8 References include data type mappings and examples
<!-- AC:END -->
