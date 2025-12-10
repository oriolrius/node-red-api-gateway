---
id: task-045
title: Add Filtering and Sorting Support
status: Done
assignee: []
created_date: '2025-12-10 09:34'
updated_date: '2025-12-10 15:17'
labels:
  - api-endpoint
  - filtering
  - sorting
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Support query-based filtering and sorting for list endpoints. Configure which fields are filterable and sortable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Filterable fields configuration
- [x] #2 Sortable fields configuration
- [x] #3 Default sort field and direction
- [x] #4 Query parameter parsing (filter[field], sort)
- [x] #5 SQL WHERE/ORDER BY clause generation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started work on 2025-12-10 - implementing filtering and sorting support for list endpoints

Completed on 2025-12-10. Full implementation delivered:

FILTERING IMPLEMENTATION:
- Added filteringEnabled toggle and filterableFields (comma-separated valid field names)
- Implemented parseFilterParams() supporting filter[field]=value and filter[field][op]=value formats
- Supported operators: eq, ne, gt, gte, lt, lte, like, in
- Generated parameterized SQL with @param placeholders via generateWhereClause()
- Added msg.filtering object containing filters array, errors, and whereClause

SORTING IMPLEMENTATION:
- Added sortingEnabled toggle and sortableFields (comma-separated valid field names)
- Added defaultSortField and defaultSortDirection (asc/desc) config properties
- Implemented parseSortParams() supporting sort=field or sort=-field (desc) format
- Supports comma-separated multiple fields for multi-column sorting
- Generated ORDER BY clause via generateOrderByClause()
- Added msg.sorting object containing sorts array, errors, and orderByClause

HELPER FUNCTIONS:
- parseFieldList() for parsing comma-separated field names
- validateFieldName() for field validation against allowed list
- SORT_DIRECTIONS constant and FILTER_SORT_DEFAULTS

NODE METHODS:
- getFilteringConfig(), getSortingConfig()
- parseFilters(), parseSorts()
- generateWhereClause(), generateOrderByClause()

UI/DOCUMENTATION:
- HTML editor enhancements with filtering and sorting sections
- Comprehensive help documentation with syntax examples
- Operator reference documentation

TESTING:
- Added 36 new unit tests covering all filtering and sorting functionality
- All 469 tests pass

RELATED CODE FILES:
- /home/oriol/nodered/node-red-api-gateway/src/nodes/api-endpoint-node.js (main implementation)
- /home/oriol/nodered/node-red-api-gateway/tests/unit/api-endpoint-node.test.js (test suite)

Commit d464d2a: feat(node): add filtering and sorting support for list endpoints - Full implementation with 36 unit tests, all 469 tests passing
<!-- SECTION:NOTES:END -->
