---
id: TASK-091
title: 'Auto-CRUD SQL errors: hide raw driver messages and map status codes (GH #4)'
status: Done
assignee: []
created_date: '2026-09-28 16:54'
updated_date: '2026-09-28 17:03'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fixes GitHub issue #4: auto-CRUD 500 responses leak sqlErr.message (schema info).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Default response detail is generic and includes requestId; raw message only with includeStackTrace or new exposeDbErrors flag
- [x] #2 SQL Server error numbers mapped: PK/unique (2627/2601) -> 409; NOT NULL/conversion/truncation/constraint -> 400; FK on delete -> 409
- [x] #3 Problem type base URI configurable on apigw-config (problemTypeBaseUri), default unchanged
- [x] #4 Raw error still logged server-side
- [x] #5 Unit tests plus e2e against a real SQL Server
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New lib/db-errors.js (classifyDbError/buildDbErrorResponse/problemTypeUri). Auto-CRUD catch returns generic detail + requestId; raw message only with exposeDbErrors/includeStackTrace; logged server-side (requestLogger, or node.warn fallback). Mapping: 2627/2601->409; 515/245/241/242/8114/8115/220/8152/2628/8169/206->400; 547->400 on write, 409 on delete; ESOCKET/ECONNCLOSED/ELOGIN/ETIMEOUT->503. problemTypeBaseUri on apigw-config (default https://api.example.com/errors/). Unit: tests/unit/db-errors_spec.js. E2E: tests/e2e/gateway-hardening.test.js against a real SQL Server 2022 container.
<!-- SECTION:NOTES:END -->
