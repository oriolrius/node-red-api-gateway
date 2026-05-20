# Changelog

All notable changes to this project will be documented in this file.

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
