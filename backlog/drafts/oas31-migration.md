---
title: Migrate OpenAPI generator/parser from 3.0 to 3.1
status: Draft
created_date: '2026-05-29'
labels:
  - openapi
  - breaking-change
  - schema
related:
  - lib/openapi-generator.js
  - lib/openapi-parser.js
  - lib/schema-validator.js
  - examples/
  - tests/unit/openapi-generator_spec.js
  - tests/unit/openapi-parser_spec.js
---

## Goal

Flip the gateway's emitted spec from `openapi: 3.0.3` to `openapi: 3.1.0`,
align internal schema handling with JSON Schema **2020-12** (the dialect
OpenAPI 3.1 references), and keep accepting 3.0 specs on the parser side
so existing SAM-IA flow imports keep working.

## Why 3.1

- **Full JSON Schema alignment**: 3.1 references JSON Schema 2020-12
  verbatim — the gateway no longer needs a "downgrade to OAS 3.0 subset"
  conversion pass. (OAS 3.0 itself is based on an extended subset of
  JSON Schema Wright Draft 00, not draft-05/07.)
- **`nullable` removed**: 3.1 uses `type: ["string", "null"]` natively;
  matches Ajv's preferred representation.
- **`exclusiveMinimum` / `exclusiveMaximum` become numeric** (not
  boolean-paired-with-`minimum`).
- **`examples` (array on schemas), `const`, `$ref` siblings,
  `unevaluatedProperties`, `prefixItems`, `contentMediaType`,
  `webhooks`** all become first-class.
- `@fastify/swagger@^9.7.0` (already a dep) speaks 3.1; Swagger UI 5
  renders it.

## Current state (oas31 branch, HEAD)

| Area | File / line | Today |
|---|---|---|
| Generator version literal | `lib/openapi-generator.js:617` | `openapi: '3.0.3'` |
| Generator schema converter | `lib/openapi-generator.js:21-69` `jsonSchemaToOpenApi()` | Lighter than first thought: only deletes `$id` (line 35) and recurses through `properties`, `items`, `allOf/anyOf/oneOf`, `additionalProperties`. Most "draft-07 only" cleanup is implicit (uncopied) rather than explicit. |
| Parser version gate | `lib/openapi-parser.js:570` | `startsWith('3.')` (already permissive) |
| Parser nullable rewrite | `lib/openapi-parser.js:87-102` | strips `nullable`, rewrites to `type:[T,"null"]` |
| Parser `$ref` handling | `lib/openapi-parser.js:45-52` (via `openApiSchemaToJsonSchema`) | resolves `$ref` and drops any sibling keywords |
| Validator dialect | `lib/schema-validator.js:6` | `require('ajv')` (draft-07 default) |
| Test fixtures hardcoded `"3.0.3"` | `tests/unit/openapi-generator_spec.js:425,708`; `tests/unit/openapi-parser_spec.js:540,635,754,771,788,875`; `tests/unit/api-server_spec.js:88` | one missed in earlier survey |
| Fastify Swagger registration | `nodes/api-server.js:720-729` | passes `openapi: { info: {...} }` only — **no** `openapi.openapi: '3.x.x'`. Version comes from `transformSpecification` (our generator). Worth re-checking after T1. |
| Config-node editor wording | `nodes/api-config.html:611` | "Configure OpenAPI 3.0 specification metadata" |
| Example specs | `examples/*.json` (5 files) | **Not OpenAPI specs** — these are Node-RED flow exports (top-level JSON array). No `openapi`/`nullable`/`exclusiveMinimum` to bump. Embedded schemas in `apigw-endpoint` nodes may still need Ajv 2020-12 sanity. |
| `package.json` / `package-lock.json` drift | `package.json` 0.7.0 vs `package-lock.json` root 0.6.4 | pre-existing inconsistency — fix during release (T8). |
| Swagger UI plugin | `package.json` `@fastify/swagger@^9.7.0`, `@fastify/swagger-ui@^5.2.5` | 3.1-capable but documentation is thin; smoke-test mandatory. |

## Tasks

> **Scope**: 3.1-only. No bi-version path. The parser **rejects** anything
> that isn't `openapi: 3.1.x`. Imported 3.0 specs are out of scope — owners
> migrate them upstream (or via a one-shot script) before feeding them in.
>
> **Execution order**: **T2 → T4 → T1 → T3 → T5 → T6 → T7 → T8.** Land the
> schema normalizer (T2) and Ajv 2020 swap (T4) before the version literal
> flips (T1), so emitted specs never claim 3.1 while still carrying
> 3.0-only constructs.

### T1 — Generator emits 3.1

- `lib/openapi-generator.js:617`: `openapi: '3.1.0'`.
- Update doc-comments at lines 4, 6, 21–22, 24, 37–38, 613 to drop
  "OpenAPI 3.0" wording.
- Re-check `nodes/api-server.js:720-729`: the Fastify Swagger plugin is
  registered without `openapi.openapi`, so the version printed comes
  from our generator via `transformSpecification`. Confirm in T8 smoke
  that the served `/docs` reports `3.1.0`; if not, pass
  `openapi: { openapi: '3.1.0', info: {...} }` to the plugin.
- Emit `jsonSchemaDialect:
  'https://json-schema.org/draft/2020-12/schema'` at the spec root
  (decision: explicit, not relying on the OAS 3.1 default — helps
  tooling that hasn't fully caught up to 3.1).
- Editor wording: `nodes/api-config.html:611` references "OpenAPI 3.0
  specification metadata" — bump to 3.1.

### T2 — Schema normalizer becomes near-identity

The current `jsonSchemaToOpenApi()` is lighter than the "downgrade
pass" framing implied: it only deletes `$id` and recurses through
known schema containers (`properties`, `items`, `allOf/anyOf/oneOf`,
`additionalProperties`). The 3.0 "subsetting" is mostly *implicit*
(uncopied) — there is no explicit blocklist of draft-07 keywords.

For 3.1:

- Remove the `delete result.$id` line — `$id` is valid in 2020-12.
- Keep stripping schema-decoration that isn't validated by Ajv 2020-12
  (`discriminator`, `xml`, `externalDocs`).
- **Defensive `nullable` rewrite at runtime**: if a stray `nullable:
  true` ever reaches the normalizer, silently rewrite to
  `type:[…,"null"]`. Tests must still assert the normalizer **never
  produces** `nullable` on its own — runtime resilience, build-time
  strictness.
- Renaming the function is optional churn; defer.

### T3 — Parser becomes 3.1-only

`lib/openapi-parser.js`:

- Tighten the version gate at line 570 from `startsWith('3.')` to an
  exact `3.1.x` check. Anything else throws with a clear "OpenAPI 3.1
  required — migrate your spec" error.
- **Delete** the `nullable → type[]` rewrite (lines 87–102): 3.1 input
  uses `type: [..., "null"]` natively, pass through.
- **Delete** boolean `exclusiveMinimum`/`exclusiveMaximum` handling if
  present — invalid in 3.1.
- Handle 3.1 top-level additions:
  - `webhooks` — preserve metadata / accept-and-ignore. Do **not**
    register webhooks as endpoints (separate product decision).
  - `jsonSchemaDialect` (string) — read and store; don't enforce.
  - `paths` becomes optional when `webhooks` or `components` carries
    the surface — guard the existing `paths` iteration.
- `$ref` with siblings: in OAS 3.1, **Schema Object** `$ref` may have
  sibling keywords (per JSON Schema 2020-12). **Reference Objects**
  (used for parameters, requestBodies, etc.) still treat siblings as
  ignored. `lib/openapi-parser.js:45-52` currently drops siblings for
  both — fix only for Schema Objects.

### T4 — Bump Ajv to draft 2020-12

`lib/schema-validator.js`:

- Switch `const Ajv = require('ajv')` →
  `const Ajv = require('ajv/dist/2020')`.
- Re-verify `coerceTypes`, `useDefaults`, `removeAdditional` options
  still behave identically. (They do in Ajv 8; this is a dialect swap,
  not an API swap.)
- Verify `ajv-formats@^3` is still compatible with the 2020 build (it
  is — `addFormats(ajv)` is dialect-agnostic).
- Keep `strict: false` — defensive; Ajv-strict can reject unknown
  keywords that legitimately appear in pass-through OAS schemas.

**Risk**: highest of the migration. Every request validator gets
recompiled under a stricter dialect. Mitigation: T6 round-trip tests
exercise the validator path end-to-end.

### T5 — Validate `examples/` against Ajv 2020-12

**Correction**: `examples/*.json` are Node-RED **flow exports** (JSON
arrays of node configs), not OpenAPI specs. No top-level `openapi`
field to bump; no `nullable` / boolean `exclusiveMinimum` found in a
spot-check.

What to actually do:

- Walk each flow's `apigw-endpoint` nodes, extract `bodySchema`,
  `querySchema`, `paramsSchema`, `responseSchemas`, and feed them
  through `require('ajv/dist/2020').compile` to confirm none rely on
  3.0-only constructs that would explode after T4 (boolean exclusives,
  array-form `items`).
- If any do, mark them for migration in a follow-up — don't block this
  branch on fixing flow exports.
- Add a one-shot `scripts/check-example-flows.js` so this stays
  reproducible.

### T6 — Tests

- `tests/unit/openapi-generator_spec.js:425,708` → assert `"3.1.0"`.
- `tests/unit/api-server_spec.js:88` → assert `"3.1.0"` (missed in
  earlier survey; codex caught it).
- `tests/unit/openapi-parser_spec.js`: bump all six `"3.0.3"` fixtures
  (540, 635, 754, 771, 788, 875) to `"3.1.0"`. Drop any test that
  asserts `nullable`/boolean-exclusive rewrites (those code paths are
  gone). Add a new test asserting that feeding a `"3.0.3"` spec throws
  the "OpenAPI 3.1 required" error.
- Add new tests:
  - Parser accepts a minimal 3.1 spec with `webhooks` and no `paths`.
  - Parser accepts `type: ["string", "null"]` and produces a working
    Ajv 2020 validator.
  - Parser accepts numeric `exclusiveMinimum: 0` and rejects the
    boundary correctly.
  - Parser preserves Schema-Object `$ref` siblings (but still drops
    siblings on Reference Objects).
  - Generator → parser round-trip: feed generator output back to
    parser, assert equality of endpoint set.
  - Generator output **must not contain `nullable` anywhere** — assert
    on a generated spec dump (catches regressions of the defensive
    rewrite in T2).
  - Generator output includes `jsonSchemaDialect` at the root.
- New / adjusted `tests/unit/schema-validator_spec.js` cases for
  2020-12-specific behavior: `prefixItems`, numeric `exclusiveMinimum`,
  `type: [..., "null"]`, `$schema` preserved.

### T7 — Docs, CHANGELOG, README

- Rewrite "OpenAPI 3.0" wording in: `lib/openapi-*.js` headers,
  `README.md`, `nodes/api-config.html:611`, and any backlog
  task/decision/doc that references "OpenAPI 3.0" (grep before
  editing).
- New `CHANGELOG.md` entry under `0.8.0`:
  - **Breaking**: emitted spec is now `3.1.0`. Downstream consumers
    that pin a 3.0 parser need an upgrade.
  - **Breaking**: parser **rejects** OpenAPI 3.0 input. Pre-existing
    3.0 specs must be migrated upstream before import.
  - **Breaking**: emitted schemas now use `type: [...,"null"]`,
    numeric `exclusiveMinimum`/`exclusiveMaximum`, and may include
    `examples`, `const`, `prefixItems`, etc.
  - **Additive**: optional `webhooks` field passes through parser.
- Update `task-052` / `task-057` notes if they still reference 3.0.

### T8 — Release & live smoke test on iot02 / SAM-IA

- Bump `package.json` to `0.8.0`, run `npm install` to refresh
  `package-lock.json` — note pre-existing drift: lockfile root version
  is `0.6.4` while `package.json` is `0.7.0`. Fix the lockfile in the
  same release commit.
- `npm pack`.
- Copy tarball into `iot02:/opt/stacks/node-red/data/`, bump the
  reference in `data/package.json`, soft-reload Node-RED (CLAUDE.md
  has the one-shot reload pipeline).
- Run the v1 QA notebook against the live gateway (the legacy
  `/api/rest` Hasura-style surface is being removed — see
  [[oas31-out-of-scope]] — so `qa-api-check-hasura.ipynb` is skipped):
  ```
  ./bin/nb output clear  qa-api-check-v1.ipynb
  ./bin/nb execute --uv --timeout 60 --allow-errors qa-api-check-v1.ipynb
  ./bin/nb search        qa-api-check-v1.ipynb "-> 5" --scope output
  ./bin/nb search        qa-api-check-v1.ipynb "-> 4" --scope output
  ```
  `--allow-errors` is required (notebooks deliberately hit 4xx/5xx
  endpoints); regressions show up as new `-> 4xx` / `-> 5xx` rows.
- Hit `https://api.sabatmorrions.com/.../docs` in a browser to confirm
  Swagger UI renders the 3.1 doc without console errors.

## Out of scope

- Migrating SAM-IA's downstream flow JSON or any pre-existing 3.0 specs
  to 3.1. The parser rejects 3.0; the owning team migrates upstream
  (manual edit or a one-shot converter script — outside this branch).
- The legacy `/api/rest` Hasura-style surface: **slated for removal**.
  No effort spent on its 3.1 compatibility; smoke testing focuses on
  `/api/v1` only.
- Rewriting the existing operationId generator.
- `discriminator` semantics in 3.1 (uses `oneOf` + JSON Schema
  composition more cleanly) — current code already treats it as
  schema-decoration and strips it; revisit in a follow-up if needed.

## Decisions

- **`jsonSchemaDialect`**: emit explicitly at the spec root pointing to
  `https://json-schema.org/draft/2020-12/schema` — aids tooling that
  hasn't caught up to OAS 3.1's defaulting rule. Re-evaluate later
  whether to drop it once the ecosystem settles.
- **`nullable` on generator output**: tests assert the normalizer
  **never** emits `nullable`. At runtime the normalizer still silently
  rewrites a stray `nullable: true` to `type:[…,"null"]` as a safety
  net (build-time strict, runtime resilient).
- **Smoke scope**: T8 runs `qa-api-check-v1.ipynb` only — `/api/rest`
  is being removed.

## Risks

- **Highest risk — saved schemas under Ajv 2020 (T4 hazard, not T3).**
  Endpoint nodes store `bodySchema` / `querySchema` / `paramsSchema` /
  `responseSchemas` as JSON strings in flow config; parsed/compiled in
  `nodes/api-endpoint.js:336-372` via `lib/schema-validator.js:305-312`
  (request) and `:291-297` (response, used by the dev-mode response
  check at `nodes/api-endpoint.js:451-457`). After T4 these recompile
  under Ajv 2020-12. The realistic culprit is `nullable: true` (boolean
  `exclusiveMinimum` / array-form `items` are theoretically possible
  but unusual in OAS-imported schemas). Worse: today the endpoint
  silently *warns and leaves the schema empty* on parse failure, so a
  regression **disables validation invisibly** rather than failing
  deploy. Both request and response paths share this hazard.
  - **Mitigation**: pre-T8, write a one-shot script
    (`scripts/audit-saved-schemas.js`) that loads each iot02 SAM-IA
    flow JSON, extracts `bodySchema` / `querySchema` / `paramsSchema` /
    `responseSchemas` (JSON-escaped strings → parsed objects), and
    tries `require('ajv/dist/2020').compile()` on each. Grep is too
    brittle because flow schemas are escaped strings; only an Ajv
    compile is authoritative. Migrate failing schemas by hand.
  - **Editor-side hardening**: changing `node.warn()` →
    `node.error()` on compile failure is necessary but not sufficient
    (fields still end up unset). For this release, either **fail
    deploy** when a saved schema can't compile, **or** preserve the
    previously-loaded compiled validator and surface a persistent
    status badge on the node. Decide which before T4 lands.
- **Parser 3.0 rejection scope (T3).** Rejection applies to
  `OpenApiParser.parse()` at both import (`nodes/api-server.js:1076`)
  and the preview route (`:1126`), not to already-saved endpoint
  schemas. Reword: the SAM-IA team must migrate *future* spec imports,
  not retroactively fix existing flows.
- **Generator literal still 3.0 until T1 lands.** Until
  `lib/openapi-generator.js:617` flips, the served `/openapi.json`
  reports `3.0.3` and downstream consumers see a 3.0 doc. Ordering
  T2 → T4 → T1 already covers this; risk note exists so a half-merged
  branch doesn't ship.
- **api-endpoint editor UI — no schema-level validation today, only
  shape checks.** `resources/api-endpoint-editor.js:59-99` validates
  JSON shape, object-ness, and status-code map structure; it does
  **not** compile schemas against any JSON Schema dialect. So opening
  a 3.0-flavor saved endpoint won't surface editor errors after T4;
  failures show up only at deploy/runtime. That makes the
  audit-script mitigation above even more important (the editor
  won't catch them). Stale "OpenAPI 3.0" copy lives in at least
  `nodes/api-server.html:487`, `:696`, `:698` — bundle with T7.
- **Dual Swagger registration.** `@fastify/swagger` is registered in
  *dynamic* mode with its own minimal OpenAPI object
  (`nodes/api-server.js:720-733`), while `@fastify/swagger-ui` uses
  `transformSpecification: () => node.getOpenApiSpec()`. Swagger UI is
  showing the **transformed** spec, but `/documentation/json` (the
  plugin's auto-generated endpoint) returns the plugin's *own* doc.
  Either align both to the generator, or document which endpoint is
  canonical. Smoke must verify `/openapi.json` (our endpoint) *and*
  whatever `@fastify/swagger` exposes both report `3.1.0`.
- **Fastify request/response schema compilation.** Route registration
  at `nodes/api-server.js:432` currently does **not** pass schemas in
  `routeOptions`, so Fastify's own Ajv isn't compiling them — no
  risk *today*. **If** anyone later moves validation into Fastify's
  `schema` option, Fastify's default Ajv stays draft-07 unless
  explicitly overridden; that becomes a new hazard. Note for the
  future, no action now.
- **OAuth2 / OPA security schemes.** Generator
  (`lib/openapi-generator.js:313`) and parser
  (`lib/openapi-parser.js:352`) both touch `securitySchemes`. OAS 3.1
  changed nothing structural here, but Swagger UI 5's "Authorize"
  dialog has had 3.1-specific bugs in the wild — verify the OAuth2
  client-credentials flow renders and works against Keycloak during
  T8 (the `oauth2-authenticated-api.json` example flow is the obvious
  fixture).
- **Optional deps install on iot02.** `fastify`, `@fastify/swagger`,
  `@fastify/swagger-ui`, and `js-yaml` are declared **optional**
  (`package.json:62`). If `fastify` itself is missing,
  `nodes/api-server.js:562-565` warns and **returns early** — the
  whole API surface fails to start, not just docs. Missing
  `@fastify/swagger*` breaks `/docs`; missing `js-yaml` breaks YAML
  serialization. Confirm all four are present after T8 install
  (`docker compose exec node-red ls /data/node_modules/@fastify/swagger
  /data/node_modules/fastify`).
- **Swagger UI 5 / OAS 3.1 rendering.** Verifying only the served
  version string is insufficient. Confirm rendering of:
  `type: ["string","null"]` properties, schemas with `examples`
  (plural array), schemas carrying `$schema` / `jsonSchemaDialect`,
  and `oneOf`+`discriminator` blocks. Visual check in browser, not
  just curl.
- **Parser still strips 3.1-valid Schema annotations.**
  `lib/openapi-parser.js:87-102` deletes `deprecated`, `externalDocs`,
  `discriminator` even on 3.1 input. These are still legal on Schema
  Objects in 3.1 — stripping them loses information at import. T3
  scope should narrow the delete list to keep `deprecated` and
  `externalDocs` (still both valid metadata in 3.1); `discriminator`
  may stay stripped if Ajv 2020 doesn't validate it.
- **Parameter / requestBody / response `$ref` not resolved.** The
  parser's `$ref` handling only deep-resolves Schema Object refs
  (`lib/openapi-parser.js:45-52`). Query/path parameter objects
  accessed via `p.in` / `p.schema` are read **before** any Reference
  Object resolution, so a `parameters` array containing `{ $ref:
  '#/components/parameters/Foo' }` silently does nothing. Same for
  `requestBody`/`response` refs. Pre-exists this branch but is worth
  flagging while we're touching the parser.
- **Generator normalizer recursion is shallow.** `jsonSchemaToOpenApi`
  only descends `properties`, `items`, `allOf/anyOf/oneOf`,
  `additionalProperties` (`lib/openapi-generator.js:40-67`). The
  defensive `nullable` rewrite added in T2 will **bypass** schemas
  nested under 2020-12 containers like `$defs`, `prefixItems`,
  `contains`, `propertyNames`, `dependentSchemas`, `if/then/else`,
  `unevaluatedProperties`, `unevaluatedItems`. Expand the recursion
  list in T2 — or accept that the safety net has holes and ship a
  generator test that asserts on every container shape.
- **Downstream consumers of `api.sabatmorrions.com/openapi.json`.**
  Anything that auto-generates clients, monitors API drift, or
  validates against the spec may not yet handle 3.1 or JSON Schema
  2020-12. Inventory consumers before shipping. If none are known,
  state that explicitly so future incidents can be traced.
- **`package-lock.json` drift (root version `0.6.4` vs `package.json`
  `0.7.0`).** Pre-existing; fix in T8. Risk is stale root metadata in
  the lockfile (and a dependency graph snapshotted at 0.6.4-era), not
  that `npm ci` resolves to 0.6.4 from the registry.

**Cross-cutting mitigation — strengthen the T8 smoke checklist** (not
just "/docs reports 3.1.0"):

1. `GET /openapi.json` → `.openapi === "3.1.0"`, `.jsonSchemaDialect`
   present.
2. `GET /openapi.yaml` (if exposed) parses and matches JSON.
3. `GET /documentation/json` (the default `@fastify/swagger` JSON
   route — confirm by inspecting the registered Fastify routes if the
   plugin's `routePrefix` is changed) also reports `3.1.0`, *or*
   confirm it's shadowed/overridden by our `getOpenApiSpec()`.
4. Swagger UI loads at `/docs`; OAuth2 "Authorize" dialog works
   against Keycloak; one schema with `type:[…,"null"]` renders.
5. Try importing a known-3.0 spec via the editor → assert rejection
   with the new error message.
6. Try importing a known-3.1 spec → assert success.
7. Run `qa-api-check-v1.ipynb`, grep outputs for `-> 4xx` / `-> 5xx`
   diffs vs the baseline.
8. **Rollback path**: keep the previous tarball
   (`oriolrius-node-red-api-gateway-0.7.x.tgz`) on iot02; if a smoke
   check fails, swap `data/package.json` back and soft-reload. Don't
   `docker compose down` — that interrupts the gateway.

## References

- [Migrating from OpenAPI 3.0 to 3.1.0 — OpenAPI Initiative](https://www.openapis.org/blog/2021/02/16/migrating-from-openapi-3-0-to-3-1-0)
- [Upgrading from OpenAPI 3.0 to 3.1 — learn.openapis.org](https://learn.openapis.org/upgrading/v3.0-to-v3.1.html)
- [@fastify/swagger README — OAS 3.1 `const` support note](https://github.com/fastify/fastify-swagger)
- Ajv 2020 entrypoint: `require('ajv/dist/2020')` (Ajv 8 ships both).
