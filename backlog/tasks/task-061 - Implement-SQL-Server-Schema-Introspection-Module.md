---
id: task-061
title: Implement SQL Server Schema Introspection Module
status: To Do
assignee: []
created_date: '2025-12-10 17:46'
labels:
  - infrastructure
  - database
  - mssql
  - schema
dependencies:
  - task-031
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a schema introspection module (`lib/schema-introspector.js`) that extracts metadata from SQL Server databases using INFORMATION_SCHEMA and sys.* views. The module should query table structures, columns, data types, constraints (PK, FK, unique, check), indexes, and extended properties (descriptions). Output structured JSON suitable for OpenAPI generation and documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Query INFORMATION_SCHEMA.TABLES to list all tables with descriptions from sys.extended_properties
- [ ] #2 Query INFORMATION_SCHEMA.COLUMNS to extract column metadata (name, type, nullability, default, length, precision, scale, description)
- [ ] #3 Query TABLE_CONSTRAINTS and KEY_COLUMN_USAGE to extract primary keys, foreign keys, and unique constraints
- [ ] #4 Query sys.indexes and sys.index_columns to extract index definitions
- [ ] #5 Query CHECK_CONSTRAINTS for validation rules
- [ ] #6 Implement SQL Server type to JSON Schema type mapping (int→integer, varchar→string, datetime→string/date-time, etc.)
- [ ] #7 Support filtering by schema name (e.g., dbo only)
- [ ] #8 Return structured JSON with tables[], each containing columns[], primaryKey, foreignKeys[], uniqueConstraints[], indexes[], checkConstraints[]
- [ ] #9 Unit tests with mocked mssql connection
- [ ] #10 Integration test using Docker SQL Server container
<!-- AC:END -->
