---
id: task-014
title: Implement CRUD Operation Mapping
status: To Do
assignee: []
created_date: '2025-12-10 09:25'
labels:
  - api-endpoint
  - core-feature
  - crud
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Map HTTP methods to database CRUD operations. Support configurable operation type, table name, and primary key. Enable endpoints to delegate to database operations or custom flow logic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add 'operation' property with list, get, create, update, delete dropdown
- [ ] #2 Add 'tableName' property for database table reference
- [ ] #3 Add 'primaryKey' property to identify record for get/update/delete operations
- [ ] #4 Support delegation to flow via msg.payload for custom logic
- [ ] #5 Generate appropriate SQL or flow message based on operation type
<!-- AC:END -->
