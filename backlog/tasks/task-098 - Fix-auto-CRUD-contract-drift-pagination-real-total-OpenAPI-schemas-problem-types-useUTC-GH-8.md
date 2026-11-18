---
id: TASK-098
title: >-
  Fix auto-CRUD contract drift: pagination, real total, OpenAPI schemas, problem
  types, useUTC (GH-8)
status: Done
assignee: []
created_date: '2026-11-18T11:57:00Z'
updated_date: '2026-11-18T12:33:00Z'
labels:
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GitHub issue https://github.com/oriolrius/node-red-api-gateway/issues/8. For autoGenerateSql endpoints the HTTP contract differs from the node config, README and OpenAPI: page size settings ignored, total = page length, no row/body schemas in OpenAPI, example.com problem types and table name in 404 detail, useUTC/lowerCaseGuids not configurable, non-unique primaryKey acts on arbitrary/all rows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Auto-CRUD list uses defaultPageSize/maxPageSize for the SQL and the response; limit always capped
- [x] #2 total in the list response is the real COUNT(*) with the same WHERE
- [x] #3 /openapi.json describes auto-CRUD row, list envelope, request body, 201/204/404 responses and typed filter params from introspected columns (fallback to generic object); no Fastify route schemas
- [x] #4 Default problem type is about:blank when problemTypeBaseUri is empty; 404 detail is generic, table name only in server log
- [x] #5 apigw-config exposes useUTC and lowerCaseGuids, passed to mssql; README documents datetime semantics
- [x] #6 update/delete refuse with 409 and roll back when primaryKey matches more than one row; docs warn primaryKey must be unique
- [x] #7 Unit tests cover every point; full unit suite and lint pass
- [x] #8 README/CHANGELOG updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
§1 api-endpoint getAutoCrudPage(): msg.pagination (offset) or default 10, always capped at maxPageSize via parsePaginationParams; passed as context.pagination to executeCrudOperation; response echoes it. §2 list runs COUNT_BIG(*) with the same FROM/WHERE in parallel; result.total. §3 new lib/crud-schema.js (SQL type -> JSON per tedious, row/body/filter schemas, list envelope, 201/204/404/409/503); api-config getTableColumns() (INFORMATION_SCHEMA + sys.columns identity/computed, cached; getTableColumnTypes derived); endpoint loadAutoCrudColumns/getAutoCrudOpenApi; OpenApiGenerator.prepare()/generateAsync() used by /openapi.json(.yaml); buildOperation merges, hand-written schemas win; not attached to Fastify routes. §4 problemTypeUri() -> about:blank when base empty, title = status phrase; 404 detail 'Resource not found', table name only logged. §5 dbUseUTC (default on) / dbLowerCaseGuids (default off) -> mssql options; README table. §6 get: >1 rows -> 409; update/delete: DML gets AND (SELECT COUNT_BIG(*) ... WHERE pk) = 1, then IF @@ROWCOUNT = 0 AND EXISTS -> THROW 50409 -> 409 non-unique-key (no explicit transaction, no XACT_ABORT leak on pooled connections). Tests: tests/unit/gh8-auto-crud-contract_spec.js (26); unit suite 1475 passing; lint clean; e2e gateway-hardening against real SQL Server 2022: 26 passing incl. 4 new GH-8 tests (Ajv validates every row vs /openapi.json).

Review by gpt-6.2-astra (4 rounds) -> fixes: update/delete guard now withTransaction() + SELECT TOP (2) WITH (UPDLOCK, HOLDLOCK) then DML (begin failure releases the connection via rollback); list SQL rebuilt from parts (keyword-safe table names), custom templates keep COUNT; OFFSET bound as BigInt, offset clamped to MAX_SAFE_INTEGER; body binding bigint->BigInt (range-checked, EPARAM->400), decimal numbers as exact NVarChar text (Float for exponent), float/real typed (real overflow -> 400); unqualified introspection resolves default schema then dbo; OpenAPI uses configured success code, 204 without body. Unit 1492 passing, lint clean, e2e (real SQL Server 2022) 31 passing incl. a two-connection concurrent-duplicate test.
<!-- SECTION:NOTES:END -->
