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
## 0.7.2

### Fixed

- `apigw-server` populated `msg.req.path` with Fastify's
  `request.routeOptions?.url` (the route **template**, e.g.
  `/api/v1/maquines/:zIdMaquina`) rather than the actual request URL.
  Combined with `apigw-endpoint` unconditionally re-extracting params
  from `msg.req.path`, this overwrote Fastify's correctly-parsed
  `req.params` with placeholder *literals* (`{ zIdMaquina: ':zIdMaquina' }`).
  Downstream SQL then received `':zIdMaquina'` as the value, producing
  `Conversion failed when converting the nvarchar value ':zIdMaquina' to
  data type smallint` (int/smallint/uniqueidentifier PKs), `404 not found`
  (string PKs returning 0 rows), and `400 idMesura must be an integer`
  (custom handlers using `parseInt(msg.req.params.idMesura, 10)`).
- `msg.req.path` is now the actual request path (no query string). The
  route template remains available under `msg.req.route` for
  observability and OpenAPI tooling.
- `apigw-endpoint` only re-extracts params from `msg.req.path` when
  `msg.req.params` is empty/absent. This preserves the synthetic-message
  contract used by unit tests while never clobbering Fastify-supplied
  values.

### Tests

- `tests/unit/api-endpoint_spec.js` — two regressions: pre-populated
  `req.params` is preserved when `req.path` is the actual URL **and**
  when it is a route template.

### Notes

- Backwards compatible for any flow that already received correct
  `msg.req.params` (it now stays correct). Flows that relied on
  `msg.req.path` being the template should switch to `msg.req.route`.

## 0.7.1

### Fixed

- `apigw-config.executeCrudOperation` previously hard-coded
  `params.id = urlParams.id` for `get`, `update`, and `delete`, so the
  built-in CRUD only worked when the primary-key column was literally
  named `id`. It now binds `params[primaryKey] = urlParams[primaryKey]`
  (falling back to the single path-param value when the path uses a
  differently-named placeholder, e.g. `:idCota` for PK `id_cota`, and
  finally to `urlParams.id` for legacy paths). Auto-CRUD now works for
  tables with arbitrary single-column primary keys.
- `apigw-endpoint` passes `paramNames` through the CRUD execution
  context to enable the path-param fallback above.

### Tests

- `tests/unit/api-config_crud-pk_spec.js` covers PK-name matching,
  paramNames fallback, legacy `id` behavior, and the equivalents for
  `update` and `delete`.

### Notes

- Backwards compatible. Paths/PKs with `id`/`urlParams.id` keep working
  unchanged.

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
