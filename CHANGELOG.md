# Changelog

All notable changes to this project will be documented in this file.

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
