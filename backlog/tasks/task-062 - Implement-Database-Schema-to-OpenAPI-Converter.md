---
id: task-062
title: Implement Database Schema to OpenAPI Converter
status: To Do
assignee: []
created_date: '2025-12-10 17:46'
labels:
  - infrastructure
  - openapi
  - database
  - schema
dependencies:
  - task-061
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a converter module (`lib/schema-to-openapi.js`) that transforms extracted database schema metadata into OpenAPI 3.0 specification. Generate CRUD endpoint definitions (GET list, GET by ID, POST, PUT, DELETE) for each table, with proper request/response schemas derived from column definitions. Support customizable path templates, pagination parameters, and filtering options.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Accept schema introspector output (tables with columns, constraints, relationships)
- [ ] #2 Generate OpenAPI 3.0 paths for CRUD operations: GET /resources, GET /resources/{id}, POST /resources, PUT /resources/{id}, DELETE /resources/{id}
- [ ] #3 Generate request body schemas from table columns (excluding auto-generated fields like identity PKs)
- [ ] #4 Generate response schemas including all columns with proper JSON Schema types
- [ ] #5 Include path parameters from primary key columns with correct types
- [ ] #6 Generate query parameters for filtering (column-based) and pagination (limit, offset)
- [ ] #7 Include foreign key relationships as $ref references or nested schemas
- [ ] #8 Add descriptions from database extended properties to schema fields
- [ ] #9 Support customizable path naming (pluralization, case conversion)
- [ ] #10 Output valid OpenAPI 3.0 YAML and JSON formats
- [ ] #11 Unit tests for schema transformation logic
- [ ] #12 Integration test generating spec from test database
<!-- AC:END -->
