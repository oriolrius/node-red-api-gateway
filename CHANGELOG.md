# Changelog

All notable changes to this project will be documented in this file.

## 0.8.0

### Changed (breaking)

- **OpenAPI version flipped from 3.0.3 to 3.1.0.** Generated specs now
  report `openapi: "3.1.0"` and include a top-level
  `jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema"`.
  Downstream consumers that pin a 3.0 parser must upgrade.
- **Parser rejects OpenAPI 3.0 input.** `OpenApiParser.parse()` now
  accepts only `3.1.x` specs. 3.0 specs must be migrated upstream
  before import (no bi-version path).
- **Schema validator switched to Ajv 2020-12.** `lib/schema-validator.js`
  now uses `require('ajv/dist/2020')`. Saved request/response schemas
  carrying 3.0-only constructs (`nullable: true`, boolean
  `exclusiveMinimum`/`exclusiveMaximum`, array-form `items`) will fail
  to compile and validation will be disabled for that endpoint —
  audit deployed flows with `scripts/audit-saved-schemas.js` before
  upgrading.
- **Generator emits 2020-12-native schemas.** `nullable` is no longer
  emitted (replaced by `type: [..., "null"]` where needed); boolean
  exclusives are rewritten to numeric form; `$id`, `examples`,
  `const`, `prefixItems`, `$defs`, etc. now pass through.

### Added

- `scripts/audit-saved-schemas.js` — walks Node-RED flow JSON files
  and tries to compile every `apigw-endpoint`'s `bodySchema`,
  `querySchema`, `paramsSchema`, and per-status `responseSchemas`
  under Ajv 2020-12. Use this before upgrading production iot02
  flows.
- Parser accepts optional `webhooks` and `jsonSchemaDialect` top-level
  fields and tolerates 3.1 specs with no `paths`.
- Schema normalizer recursion now reaches every 2020-12 container
  (`$defs`, `prefixItems`, `propertyNames`, `dependentSchemas`,
  `if`/`then`/`else`, `unevaluatedItems`, `unevaluatedProperties`).

### Notes

- Editor copy (`nodes/api-config.html`, `nodes/api-server.html`)
  updated to mention OpenAPI 3.1.
- Parser keeps `deprecated` and `externalDocs` as valid Schema-Object
  annotations in 3.1; only `discriminator` and `xml` are stripped.
- See `backlog/drafts/oas31-migration.md` for full plan and risks.

## 0.7.0

### Added

- `apigw-endpoint` now exposes the configured SQL Server pool to
  downstream nodes as `msg.db = { executeQuery, isReady }`. Function
  handlers can run parameterized queries through the gateway's
  connection pool without importing `mssql` or instantiating their own
  `ConnectionPool`. Attached only when the associated `apigw-config`
  has `dbType === "mssql"` and exposes `executeQuery`.
- E2E test `tests/e2e/msgdb-integration.test.js` (npm script
  `test:msgdb-e2e`) bootstraps SQL Server + Node-RED, deploys a handler
  using `msg.db.executeQuery()`, and verifies the parameterized result
  reaches the HTTP response.
- Unit tests `tests/unit/api-endpoint_msgdb_spec.js` cover presence /
  absence of `msg.db`, proxy semantics, and `isReady` evaluation.

### Notes

- Purely additive change. Endpoints that do not read `msg.db` are
  unaffected.
