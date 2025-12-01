---
id: task-011
title: Create mssql skill for Microsoft SQL Server connectivity
status: Done
assignee: []
created_date: '2025-12-01 16:43'
updated_date: '2025-12-01 16:50'
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
- [x] #1 SKILL.md created with YAML frontmatter
- [x] #2 Covers connection configuration and pooling
- [x] #3 Covers query execution patterns (simple, parameterized, stored procedures)
- [x] #4 Covers transaction handling
- [x] #5 Covers bulk operations and streaming
- [x] #6 Covers error handling patterns
- [x] #7 Covers Node-RED integration (connection config node, query node)
- [x] #8 References include data type mappings and examples
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Created comprehensive mssql skill at `.claude/skills/mssql/` with:

### Main SKILL.md
- YAML frontmatter with skill name and description
- Quick reference table for common operations
- Connection configuration (basic, pooling, authentication methods)
- Query execution (simple, parameterized, prepared statements, stored procedures)
- Transaction handling (basic, isolation levels, savepoints)
- Bulk operations and streaming patterns
- Comprehensive error handling
- Data type mappings table
- Node-RED integration patterns (config node, query node, stored procedure node, transaction node)
- Testing patterns with mocking
- Graceful shutdown patterns

### Reference Documents
- `references/data-type-mappings.md` - Complete SQL Server to JavaScript type mappings
- `references/connection-strings.md` - Connection formats, authentication examples, Azure configurations
- `references/error-codes.md` - SQL Server error codes with handling strategies
- `references/performance-tuning.md` - Pool optimization, query optimization, streaming, bulk operations
<!-- SECTION:NOTES:END -->
