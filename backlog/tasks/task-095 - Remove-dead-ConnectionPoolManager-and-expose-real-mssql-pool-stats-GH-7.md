---
id: TASK-095
title: Remove dead ConnectionPoolManager and expose real mssql pool stats (GH-7)
status: Done
assignee: []
created_date: '2026-11-09T16:30:00Z'
updated_date: '2026-11-09T16:48:00Z'
labels:
  - bug
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GitHub issue https://github.com/oriolrius/node-red-api-gateway/issues/7. api-config builds a ConnectionPoolManager that no query uses; queries go through the native mssql/tarn pool (node.mssqlPool). The 7 wrapper methods are only used by unit tests, and MetricsCollector.updateConnectionPool() is never called, so connection_pool_size is always empty and the tarn wait queue is invisible. A pool acquire timeout is a capacity problem but returns 500.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ConnectionPoolManager is removed from api-config, plus the unused lib/connection-pool.js and its spec
- [x] #2 api-config getPoolStatistics() reports the real mssql pool (size, available, pending, borrowed, min, max) or null
- [x] #3 connection_pool_size{pool=database,state=active|idle|waiting} is filled from the real pool on each /metrics scrape
- [x] #4 A pool acquire timeout maps to 503 with Retry-After and does not mark the DB connection as errored
- [x] #5 Unit tests updated; full unit suite passes
- [x] #6 README/CHANGELOG updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed ConnectionPoolManager (lib/connection-pool.js + spec) and its 6 unused wrappers from api-config. getPoolStatistics() now reads node.mssqlPool getters (size/available/borrowed/pending) + configured min/max; null until the tarn pool exists. api-server /metrics handler pulls the stats at scrape time into connection_pool_size{pool=database,state=active|idle|waiting} (no timer). lib/db-errors: isPoolAcquireTimeout() matches tarn's unwrapped TimeoutError (no code, no SQL number) -> new 'busy' class 503 service-busy; every 503 now returns headers {Retry-After}; api-endpoint sets problem.headers. mssql emits pool 'error' for failed acquires too: acquire timeouts now only log a throttled (10s) warning and do not mark the DB connection as errored. Tests: api-config_spec pool block rewritten, db-errors_spec, new api-endpoint_pool-busy_spec and api-server_pool-metrics_spec. Full unit suite: 1447 passing; eslint clean. README + CHANGELOG (Unreleased, BREAKING) updated.

Fix committed in 5ed9db5; shipped in v0.11.0.
<!-- SECTION:NOTES:END -->
