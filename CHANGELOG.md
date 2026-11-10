# Changelog

All notable changes to this project will be documented in this file.

## 0.11.1

### Regression tests for the mssql pool and full lint coverage (2026-11-10)

No change to runtime behavior. This release adds tests and tooling only.

**Tests:**

- **E2E regression tests for GH-7 against a real SQL Server 2022 container**
  (`npm run test:e2e-hardening`):
  - `getPoolStatistics()` returns the live `mssql` pool (`size`, `available`,
    `borrowed`, `pending`, `min`, `max`), and `/metrics` shows the same values
    in `api_gateway_connection_pool_size{pool="database",state=...}`.
  - With `dbPoolMax=1` held by an open transaction, `/metrics` shows
    `active=1` and `waiting=1`. The queued request gets `503 service-busy` with
    `Retry-After` after `dbPoolAcquireTimeout`, with no schema details.
  - After the connection is released, the pool recovers: the DB connection is
    not marked as errored and the next request gets `200`.

**Tooling:**

- `npm run lint` and `lint:fix` now also check `resources/` (browser code for
  the editor) and `scripts/`. 184 lint errors there are fixed (quotes, indent,
  browser globals). No logic change.

## 0.11.0

### Real database pool metrics and 503 on pool saturation (GH-7) (2026-11-09)

**BREAKING CHANGES:**

- **`ConnectionPoolManager` is removed.** `apigw-config` built it, but no query
  used it: all queries go through the native `mssql` pool. The unused wrappers
  `getConnectionPool()`, `getPoolStatus()`, `setPoolFactory()`,
  `initializePool()`, `acquireConnection()` and `releaseConnection()` and the
  file `lib/connection-pool.js` are deleted.
- **`getPoolStatistics()` has a new shape.** It now reads the live `mssql`
  pool and returns `{ size, available, borrowed, pending, min, max }`, or
  `null` when no SQL Server pool is connected.

**Fixes:**

- `api_gateway_connection_pool_size{pool="database",state="active|idle|waiting"}`
  now shows the real pool. Each `/metrics` scrape reads it. Before, the gauge
  was always empty, so the request queue in front of the pool was invisible.
- A pool acquire timeout (all `dbPoolMax` connections busy for
  `dbPoolAcquireTimeout`) now gives `503` `service-busy` with `Retry-After`,
  not `500`. Every auto-CRUD `503` now sends `Retry-After`.
- A pool acquire timeout no longer puts the database connection state into
  error (the database is up, only busy). The gateway logs a throttled warning.

## 0.10.0

### Gateway hardening: metrics access, DB error hygiene, request bodies (2026-09-28)

**BREAKING CHANGES:**

- **`/metrics` is opt-in.** A new `apigw-server` has metrics off, and the runtime
  only enables them when `metricsEnabled` is `true`. Flows saved from the
  editor keep their stored value, so existing servers are unaffected. Flows
  built without the property (e.g. generated JSON) lose `/metrics` until
  `metricsEnabled: true` is set.
- **Auto-CRUD database errors no longer return the raw driver message**, and are
  no longer always `500`. See below. Clients that parsed `detail` for SQL text
  must use the status code, or enable `exposeDbErrors` in development.

#### Security

- **Metrics access control** ([#5]): new `metricsAuth` on `apigw-server`:
  - `none`: public. Still supported, now an explicit choice with an editor
    warning.
  - `bearer`: static token credential.
  - `basic`: username/password credentials.
  - `oauth2`: token validated by the config node's Keycloak settings, with
    optional `metricsRequiredScopes` (all/any).

  An optional `metricsAllowedIps` IP/CIDR allowlist (IPv4/IPv6) answers `403`
  to other sources. Failures return `401` with a `WWW-Authenticate` challenge,
  or `403`. A mode that is missing its credentials fails closed with `503`
  instead of serving public metrics.
- **Auto-CRUD SQL errors don't leak schema details** ([#4]): responses carry a
  generic `detail` and a `requestId`, and the raw message is only logged
  server-side. SQL Server errors are mapped to proper statuses:
  - PK/unique violation → `409`
  - NOT NULL, type conversion, truncation and FK/CHECK violations on write →
    `400`
  - deleting a row that is still referenced → `409`
  - lost connection → `503`
  - anything else → `500`

  `exposeDbErrors` (or `includeStackTrace`) on the endpoint returns the raw
  message for development.

#### Added

- **`problemTypeBaseUri`** on `apigw-config` sets the RFC 7807 `type` base of
  the auto-CRUD problem responses (default unchanged:
  `https://api.example.com/errors/`) ([#4]).
- **Configurable request bodies** ([#6]) on `apigw-server`:
  - `bodyLimit`: bytes, default 1 MiB.
  - `binaryBodyEnabled`: opt-in.
  - `binaryContentTypes`: default `image/*,application/octet-stream`.

  Matching uploads reach the flow as a `Buffer` in `msg.req.body`, so
  file/image upload endpoints work without base64-in-JSON.
- `npm run test:e2e-hardening`: a self-contained e2e covering all of the above,
  with real HTTP, real RS256 JWTs against a JWKS server and a real SQL Server
  2022 container.

[#4]: https://github.com/oriolrius/node-red-api-gateway/issues/4
[#5]: https://github.com/oriolrius/node-red-api-gateway/issues/5
[#6]: https://github.com/oriolrius/node-red-api-gateway/issues/6

## 0.9.0

### OPA Policy Enforcement v1 (2026-09-01)

**BREAKING CHANGE:** enabling OPA now enforces policy at request time. `opaMode`
defaults to `enforce`, so an endpoint on an OPA-enabled config node whose policy
denies now returns **403** (previously OPA was configured but never consulted and
every request was allowed). Set `opaMode` to `monitor` to evaluate and log
without denying, or `off` to disable.

- OPA is evaluated in a Fastify `preHandler` and is the **single authorization
  authority** for an active endpoint: the gateway no longer also runs its own
  Required Scopes check (scopes are sent to the policy as
  `input.endpoint.requiredScopes` context instead).
- The gateway calls OPA over TLS with its **own service token** (the `opaToken`
  credential on `apigw-config`), never the user's token; verified claims travel
  in `input.token`.
- **Fail-closed** by default — no valid decision yields **503**; `opaFailOpen`
  allows the request instead.
- OPA client hardening: correct retry classification, per-logical-evaluation
  circuit-breaker accounting, and `decision_id` traceability.
- New `gateway.rego` reference policy (`v1/data/gateway/decision`) with CI `opa
  test`; an SSRF-safe editor **Test** button; the `opa_policy_check` structured
  log, a stable error taxonomy, Prometheus metrics and an alert set
  (`docs/opa-observability.md`).
- Editor: a config-node OPA section and a per-endpoint **Policy (OPA)** section
  with a Help &amp; examples panel.
- The `http://localhost:8181` `opaUrl` default is **removed** — an unset URL
  disables enforcement instead of pointing at nothing. `opaCacheTTL` is now
  **seconds** (0 disables caching). `OpaClient.isAllowed()` is deprecated.

This supersedes the 0.8.2 note that request-time policy evaluation "is not
implemented" and the known-limitation that OPA "is not enforced at request time".

## 0.8.2

Hardening release: fixes the binary/LOB auto-CRUD failure ([#3]) plus a batch
of correctness and security issues found by an internal multi-agent code review,
and adds secret-scanning to CI/CD.

### Security

- **JWT expiry could be silently disabled.** A non-zero "Clock Tolerance"
  configured in the editor was persisted as a string, so `exp + tolerance`
  string-concatenated and made the expiry check always pass — expired tokens
  were accepted. Clock tolerance is now coerced to a number at both config
  ingestion and in the Keycloak client.
- **Rate-limit bypass via spoofed `X-Forwarded-For`.** The `ip` key type trusted
  the client-supplied header by default, allowing unlimited requests (and
  unbounded memory growth) from rotating fake IPs. `X-Forwarded-For` is now
  honoured only when a new **`trustProxy`** option is enabled; the token-bucket
  map is also size-capped.
- **Configured JWT signing algorithm was ignored.** Selecting ES*/PS* in the
  editor had no effect (the client kept its RS-only default and rejected all
  tokens); the selection is now wired through.
- **Issuer override was dead.** The editor's "Issuer" field is now honoured, so
  tokens whose `iss` differs from the gateway's Keycloak URL (reverse-proxy
  setups) can validate.
- **OPA fail-open made explicit.** Enabling OPA now logs a prominent warning that
  request-time policy evaluation is not implemented, instead of silently
  authorizing every request (full enforcement remains a follow-up).
- Added **gitleaks** secret scanning to the CI and release workflows (release
  publish now requires a clean scan), a `.gitleaks.toml` allowlist, a local
  pre-commit hook installer, a fail-closed `files` allow-list for the npm
  tarball, and enabled GitHub push-protection.

### Fixed

- **Binary/LOB auto-CRUD writes** ([#3]): create/update now introspects column
  types (`INFORMATION_SCHEMA`, cached) and binds `image`/`varbinary`/`binary`
  columns as `VarBinary` (decoding base64/hex/Buffer), and `text`/`ntext`
  appropriately, instead of always `NVarChar` — resolving
  `Operand type clash: nvarchar is incompatible with image`.
- **Route conflict false positives**: the conflict check split route keys on
  every `:`, truncating parameterized paths (`/users/:id`) and wrongly blocking
  valid sibling routes.
- **New/edited endpoints returned 404 after deploy**: the "server already
  listening" restart was gated on an error-message substring that never matches
  Fastify 5; it now detects the error by code.
- **Request validation could be silently disabled**: a schema carrying an `$id`
  threw "already exists" on redeploy/reuse (shared Ajv), leaving the endpoint
  unvalidated. Ajv no longer registers schema `$id`s.
- **Response-cache key collisions**: unescaped separators let distinct requests
  (and, with vary-headers, distinct tenants) collide and serve each other's
  cached responses. Key components are now delimiter-escaped.
- **Auto-CRUD SQL correctness**: custom sort was dropped when the primary key
  contained the letter `o`; body keys containing `$`-replacement patterns
  corrupted generated SQL; positional params could collide with a PK literally
  named `col0`; unqualified table introspection merged columns across schemas.
- **Editor pool settings** saved as strings broke the SQL Server connection
  (tarn rejects non-numbers); numeric config is now parsed.
- **SQL Server never reconnected** after a failed initial connect; it now retries
  with capped backoff.
- **`applyFieldMapping`** lost data on field swaps/rename-chains; values are now
  resolved from the original object first.
- **OpenAPI import** no longer infinitely recurses on circular `$ref`s, skips
  unsupported OPTIONS/HEAD operations (with a warning) instead of mis-importing
  them as GET, emits unique `operationId`s, advertises the server URL with its
  port, and no longer aborts node creation on a missing `_def`.
- **Redeploy hygiene**: the Pino logger transport and its file handle are closed;
  an in-flight debounced server restart no longer races node close into a zombie
  listener / `EADDRINUSE`; a timed-out pool acquire is dequeued so freed
  connections are not leaked.
- **`msg.req.originalBody`** now holds the pre-transformation body.
- **Editor table-name validation** accepts the same 3-part / bracket-quoted names
  the runtime does.
- **Required body validation** is now enforced when the request body is absent.

### Known limitations

- Duplicating (copy/paste) an endpoint together with its server node leaves the
  pasted endpoint bound to the original server (Node-RED remaps only typed
  config-node references); rebind the server manually after pasting.
- OPA policy evaluation, in this 0.8.2 build, is configured and health-checked
  only. (Superseded in **Unreleased**: OPA is now enforced at request time.)

[#3]: https://github.com/oriolrius/node-red-api-gateway/issues/3

## 0.8.1

### Fixed

- **Auto-CRUD now bracket-quotes every SQL identifier** (table, primary key,
  and body columns) in generated queries ([#2]). Columns whose names contain
  characters that are special in T-SQL (e.g. `%Descuento`) previously produced
  `INSERT`/`UPDATE` statements like `..., %Descuento, ...` and failed with
  `500 Incorrect syntax near '%'`. Generated SQL is now
  `INSERT INTO [DEV].[dbo].[Clientes] ([%Descuento], ...) OUTPUT INSERTED.* VALUES (@col0, ...)`.
  Body-field parameters are bound to positional names (`@col0`, `@col1`, …)
  decoupled from the column names, so a column name that is not a valid SQL
  parameter token no longer breaks the query.
- **`validateTableName` accepts fully-qualified `database.schema.table` names**
  ([#1]). Three-part identifiers (and bracket-quoted variants such as
  `[db].[schema].[table]`) are now valid and no longer emit spurious
  `Invalid table name format` warnings on every deploy/flow reload.

### Known limitations

- Binary/`IMAGE` columns are still bound as `nvarchar` and can raise
  `Operand type clash: nvarchar is incompatible with image` on write. This
  requires column-type introspection and is tracked separately (secondary note
  in [#2]).

[#1]: https://github.com/oriolrius/node-red-api-gateway/issues/1
[#2]: https://github.com/oriolrius/node-red-api-gateway/issues/2

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
