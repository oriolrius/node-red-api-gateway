---
id: decision-001
title: Integrate OPA policy enforcement into the API server and endpoint nodes
date: '2026-08-30 10:32'
status: proposed
---
## Context

### What exists today

OPA is *configured* in this package but **never consulted**. Every part of the
integration exists except the one that matters — the request-time call.

| Artefact | State |
|---|---|
| `lib/opa-client.js` (756 lines) | Complete, 57 passing unit tests, **`require`d by zero files under `nodes/`** |
| `policies/templates/*.rego` (5 templates, 2343 lines) | Shipped in the npm tarball (`package.json:24-25`) |
| `apigw-config` OPA UI + runtime props | Present (`nodes/api-config.html:317-348`, `nodes/api-config.js:292-298`) |
| OPA health check | Registered (`nodes/api-config.js:161-166` → `lib/health-check.js:472`) |
| `ConnectionStateManager("opa")` | Created (`nodes/api-config.js:127-134`) and **never used** |
| Request-path policy evaluation | **Does not exist** |

The code says so out loud. `nodes/api-config.js:172`:

> `node.warn("OPA is enabled but policy enforcement is NOT active in this version — requests are NOT evaluated against OPA policies. Use endpoint scope checks (requiredScopes) for authorization.")`

`README.md:10`, `:87` and `:106-109` advertise OPA authorization without that
caveat. Four backlog tasks (`task-033`, `task-042`, `task-050`, `task-055`) are
marked **Done** — their artefacts do exist; their *composition* does not.
`task-042` AC#3 ("Integration with OPA client for policy evaluation") is checked
but false: `nodes/api-endpoint.js` contains zero occurrences of `opa`.

### The gap is not "call the client" — five latent traps sit in the way

Each of these was verified against the code, and each silently produces
**deny-everything or allow-everything** if implemented naively.

1. **Four incompatible `input` shapes are committed in this repo.**
   `policies/templates/*.rego` read `input.token` / `input.method` /
   `input.path` / `input.resource` at top level. `OpaClient.isAllowed()` builds
   `{user, request:{method,path,body}}` (`lib/opa-client.js:625-632`) — a shape
   **no shipped template reads**. `doc-005:368` samples `{user, resource, action}`.
   `examples/opa-protected-api.json:220` builds `path` as an **array of
   segments** while every template treats it as a **string**. `task-064` AC#9
   mandates a fifth, `{user, method, path, body}`.
2. **The default policy path resolves to nothing.**
   `DEFAULT_OPA_CONFIG.policyPath` is `v1/data/api/gateway/allow`
   (`lib/opa-client.js:18-41`); package `api.gateway` is defined by no shipped
   `.rego`. OPA answers **HTTP 200 `{}`**, `_extractAllowed`
   (`lib/opa-client.js:596-614`) collapses that to `false`, and `evaluate()`
   **caches the poison**. A path typo therefore denies 100% of traffic, for the
   whole TTL, with no error anywhere. Worse: the editor default for
   `opaPolicyPath` is `""` (`nodes/api-config.html:35`) and the constructor merge
   is a shallow spread (`lib/opa-client.js:130-138`), so `""` **beats** the
   default and POSTs to the OPA root.
3. **`cacheTtl: 0` means "never expire", not "no cache"** (`lib/opa-client.js:257-262`).
   The editor field is labelled "Cache TTL (s)" and the runtime default is `30`
   while the editor default is `60`; `examples/opa-protected-api.json:37` stores
   `60000` in the seconds-labelled field.
4. **`token: null` is not the same as omitting `token`.**
   `policies/templates/rbac.rego:81-89`: `token_is_valid if { input.token; not token_is_expired }`.
   In Rego only `false` and *undefined* fail a body expression — `null` is
   defined and non-false, so it **satisfies** the token gate, and
   `token_is_expired` needs `input.token.exp`, which is undefined on `null`, so
   the negation also succeeds. Sending `"token": null` for anonymous requests
   makes `token_is_valid` **true for unauthenticated callers**.
5. **The auth fast path never reads the `Authorization` header on an OPA-only
   gateway.** `nodes/api-server.js:198-201`:
   `if (!requiresAuth && !node.configNode?.oauth2Enabled) { request.auth = {authenticated:false}; return; }`.
   On the headline deployment (OPA replaces scope checks, no `requiredScopes`),
   OPA would receive an anonymous input regardless of the token presented.

### Resilience arithmetic — what the client does today

Three of these are **defects v1 fixes** (D8); the rest are constraints the design
has to live with.

- **[fixed in v1]** Retries are **unconditional** — a 400 and a 404 ("policy not
  found") are retried exactly like a 500 (`lib/opa-client.js:493-534`).
- **[fixed in v1]** `_recordFailure()` fires **once per attempt**, not per logical
  call (`lib/opa-client.js:519`), so one `evaluate()` against a dead OPA
  contributes 4 failures against a threshold of 5 — the breaker trips after ~1.25
  requests.
- **[fixed in v1]** `evaluate()` discards everything but `response.result`
  (`:583-587`), so OPA's `decision_id` is thrown away and a gateway 403 cannot be
  tied to the decision that produced it.
- There is **no overall deadline** across retries. Worst case ≈
  `(retryAttempts+1) × timeout + Σbackoff` → **~20 s** with the shipped defaults
  (`timeout 5000`, `retryAttempts 3`). v1 adds the deadline in the node rather
  than the client.
- There is **no request coalescing**: N concurrent distinct inputs = N HTTP calls.
  This one stays out of scope (D8).
- `getStatistics()` is at `lib/opa-client.js:698`; `clearCache()` at `:296`;
  `resetCircuitBreaker()` at `:429`; `shutdown()` at `:735`; `getHealthStatus()`
  at `:648`.
- `lib/metrics-collector.js:409` maps `"half-open"` while
  `CircuitState.HALF_OPEN` is `"half_open"` (`lib/opa-client.js:9-13`) — a
  half-open breaker is reported to Prometheus as **CLOSED**.

### Template reality check

`abac.rego` and `ownership.rego` require a **real resource object** that only a
database read can produce. Against a route-derived stub, `abac.rego:122-125`
defaults resource classification to `public` (hierarchy 0) while a token without
`clearance_level` scores `-1`, and `-1 >= 0` is false — it **denies everything**.
`ownership.rego:122-129` defaults `owner_id` to `""`, which can never match.
Both fail *closed*, but both are non-functional. No template reads any `data.*`
document — every role map and clearance table is a hard-coded literal, so
"customisation" today means forking the `.rego`.

---

## Decision

Wire OPA into the request path as a **Fastify route `preHandler`** on the
`apigw-server` node, configured on **`apigw-config`** (connection + defaults) and
**overridable per `apigw-endpoint`** (mode, policy path, input shaping),
**enforcing from the first release**.

The eight decisions below are load-bearing. Each states the decision, the evidence,
the rejected alternative, and what an operator has to live with.

### D1 — Deployment topology: a central shared OPA service

**Decision.** The gateway talks to a **central, shared OPA service over the
network**, reached at an `https://` URL, authenticated with a bearer token. This
is the deployment that already exists here and that other projects already use;
it is the only topology this design supports. **Per-gateway OPA instances are out
of scope** — not "supported but untuned", simply not part of this architecture.
Embedded WASM (`@open-policy-agent/opa-wasm`) is likewise **out of scope**.
**Rationale.** A single OPA is where policy, bundles and decision logs already
live; duplicating it per gateway would fork the policy source of truth and
multiply the operational surface for no gain. The consequence is that **every
resilience number in this document is a network number**, not a loopback one —
see D4 and the performance budget — and that the gateway inherits a real external
availability dependency, which is stated as such rather than hidden.
**Rejected.** WASM — it moots the entire cache/breaker/deadline apparatus and is
a different product decision, and it would still need a bundle distribution story.
**Consequences that the rest of this document is built on.**

- **OPA is a shared, multi-project availability dependency.** Its outage is a
  simultaneous outage of every protected route on every gateway pointed at it.
  Fail-closed (D4) is preserved — a request with no valid decision gets **503** —
  so this dependency must be alerted on and capacity-planned, not assumed away.
- **The decision cache is now a first-class resilience component**, not a
  micro-optimisation: it is what keeps a network round trip off the hot path and
  keeps our request volume off a service other teams share.
- **Transport is TLS, and the gateway authenticates with its own service
  credential** (D7). The request input carries the full set of verified user
  claims — as policy data, never as a credential — and now crosses a network
  boundary to a service this project does not exclusively own.
- **The policy path is supplied to us, not chosen by us.** Where our decision
  document lives in the shared OPA is the OPA administrator's call; this design
  places no requirement on it beyond the technical one — the configured
  `opaPolicyPath` must resolve to a document that returns a valid decision.
- **Our load is someone else's load.** The stampede characteristic in the
  security section is no longer self-inflicted only.

### D2 — Enforcement point: the Fastify route `preHandler`

**Decision.** Evaluate policy in a `preHandler` attached at
`nodes/api-server.js:456-459`, built as an **array** from one builder
(`[authMiddleware, opaMiddleware]`), never as a second assignment to
`routeOptions.preHandler`. Never enforce inside `nodes/api-endpoint.js`.
**Rationale.** A denied request must never reach `endpointNode.receive()`, and
the endpoint node's in-flow position is structurally unsuitable: its own
authorization block at `nodes/api-endpoint.js:1189` runs *after* the response
cache, so a cache hit at `:1146-1172` returns before it. Enforcing at the hook layer
is cache-proof and flow-author-proof.
**Rejected.** Enforcing in the endpoint node (bypassable, and side effects such as
an auto-CRUD `DELETE` would already have run). Design 1's global `onSend`
failsafe (mechanically feasible, but it adds a hook to every response to catch a
regression the `preHandler` already prevents, and it fires after the flow ran).
**Consequence.** The attach condition at `:457` must widen so an OPA-only
endpoint still gets the hook, **and** the fast-path guard at `:198-201` must
become `if (!requiresAuth && !oauth2Enabled && !opaActive)` — otherwise OPA sees
an anonymous input on exactly the deployment it was bought for.

### D3 — Client ownership: one `OpaClient` per policy path, on the server node

**Decision.** `nodes/api-server.js` owns `node.opaClientsByPath = new Map()`,
constructed in `initializeOpaClient()` immediately after `initializeKeycloakClient()`
(`nodes/api-server.js:96-137`) and torn down in `stopServer()` right after the
Keycloak block (`:871-876`). **One client per distinct resolved policy path is
mandatory, not an optimisation.**
**Rationale.** The decision cache key is `md5(JSON.stringify(input))` and
**contains neither `opaUrl` nor `policyPath`** (`lib/opa-client.js:203-206`) — a
shared client would serve endpoint A's decision to endpoint B. Server-node
ownership follows the codebase's only client-lifecycle template: `KeycloakClient`
is likewise constructed on the server node from `configNode` fields, including
`node.configNode.credentials?.keycloakClientSecret` (`:111-115`).
**Rejected.** Config-node ownership. Note the usual argument for it is **false**:
`restartServer()` calls `node.fastify.close()` directly at `:544` and never
`stopServer()`, so a server-node client and its warm cache already survive
debounced restarts.
**Consequence.** Two `apigw-server` nodes sharing one `apigw-config` get two
clients, two caches and two breakers against the same OPA. Under D1 that is not
just a memory note — it **halves the effective cache hit rate and doubles the
request volume this gateway sends to a service other projects share**. Document it
in the help text so anyone sizing `cacheMaxSize` knows. Warn above 16 distinct
policy paths, since each path is an independent cache and an independent stream of
traffic to the central OPA.

### D4 — Failure posture: fail closed, and closed means **503**

**Decision.** When no decision was reached — transport error, `TIMEOUT`,
`DEADLINE`, `CIRCUIT_OPEN`, OPA 4xx/5xx, or a non-conforming result — respond
**503**, not 403. `403` is reserved for an actual policy denial. `opaFailOpen`
exists on `apigw-config` only; an endpoint may **tighten but never loosen**.
**Rationale.** A 403 asserts that a policy evaluated and refused. This mirrors
the existing unavailable-auth-backend precedent at `nodes/api-server.js:223-227`.
**Rejected.** Design 2's per-endpoint `opaFailMode: "open"` — a route-level
control must not weaken the gateway's failure posture. Design 1's **startup
abort** — refusing to `listen()` over one authorisation typo takes down every
unrelated endpoint and leaves no HTTP surface to debug against.
**Consequence.** An invalid OPA config **refuses to enforce, not to serve**:
force mode to `off`, red `node.status`, `node.error`. Never fall back to
`DEFAULT_OPA_CONFIG.policyPath` (trap #2).

### D5 — `opaMode` defaults to `enforce` from the first release

**Decision.** `opaMode` defaults to **`enforce`** in the first release that
carries this feature. Enabling OPA means OPA decides. `monitor` (evaluate, log,
meter, attach `msg.opa`, **never deny**) remains a first-class, explicitly
selectable mode — for debugging, for validating a new policy against live traffic,
and for authoring — but it is **not the default and not a rollout phase**.
**Rationale.** `opaEnabled: true` is a documented no-op today
(`nodes/api-config.js:172` says so out loud), and a setting whose name promises
authorization must actually authorize. The project is pre-production: there are no
deployments whose runtime behaviour has to be preserved, so there is no
constituency for a transitional default. A default that does not enforce leaves
`README.md:10` overstating what the gateway does — the exact problem this work
exists to fix — and quietly shifts the burden onto every user to discover a second
setting before they are protected.
**Rejected.** A `monitor` default for one minor version followed by a flip to
`enforce`. It buys compatibility nobody needs, costs a second breaking release,
and ships an authorization feature that authorizes nothing. Also rejected:
`monitor` as a permanent default (same false-advertising problem).
**Consequence.** `nodes/api-config.js:172` is **replaced**, not deleted, with
mode-aware truthful messaging: blank path → "policy evaluation is disabled";
`enforce` → "enforcement active (fail open/closed)"; `monitor` → "evaluated but
**NOT** enforced — this is a debugging mode". Because `monitor` is now an
opt-*out* of protection rather than a starting point, that message is a `node.warn`,
not a `node.log`, and the editor labels the option accordingly. Turning on
`opaEnabled` with a policy path that denies will deny — which is the point, and
which is what the Test button (see the editor section) exists to catch **before**
deploy.

### D6 — When OPA is active, OPA is the **only** authorization authority

**Decision.** For an endpoint whose resolved OPA mode is `enforce` or `monitor`,
the OPA decision **is** the authorization decision. The gateway performs **no
separate `requiredScopes` check** for that endpoint — not before the policy call,
not after it. Scope-based authorization is expressed **in Rego**, against the
verified claims the gateway puts in `input.token`. `requiredScopes` continues to
work unchanged on endpoints where OPA is **not** active (`off`, or OPA disabled
on the config node); the two mechanisms never both run for the same request.

**The execution model, in full:**

```
user authentication  →  verified claims  →  build OPA input
                     →  gateway authenticates privately to OPA
                     →  OPA evaluates policy  →  allow / deny
```

The gateway's call to OPA carries the **gateway's own** service credential; the
user's claims ride inside the `input` document, never as the outbound
`Authorization` header. See D7.

Authentication is unchanged: the gateway still validates the token and populates
`request.auth` before anything else. What changes is that the *authorization* step
after it is a single call, not two checks in two places.

**Rationale.** Two authorization systems on one request is the problem, not the
feature. They produce different 403 bodies and different log events for the same
logical failure, they are enforced at different points in the pipeline with
different bypass characteristics, and "which one denied me?" becomes a support
question. Everything `checkScopes()` does — `AND`/`OR` over a scope set — is three
lines of Rego against `input.token.scope`, which the policy can then combine with
role, method, route, ownership and time in a way a static scope list never could.
Expressing it once, in the place that owns the decision, is strictly more
capable and strictly easier to reason about.

**Rejected.** `requiredScopes AND OPA`. It sounds like defence in depth and is
really duplicated logic: the gateway would re-derive from `request.auth` exactly
what the policy already received in `input.token`, and any divergence between the
two implementations is a security bug that only shows up in production.

**Consequences.**

- `lib/authorization.js` (`parseScopes` / `checkScopes`) is **untouched** and
  still used — just not on the OPA path. No behaviour changes for non-OPA
  endpoints.
- The in-flow authorization block at `nodes/api-endpoint.js:1189` must be skipped
  when OPA is active for that endpoint, and the endpoint editor must say so
  (see the UI section) so a flow author who filled in both fields is not misled
  about which one decides.
- `requiredScopes` is still **sent** to OPA as `input.endpoint.requiredScopes` —
  as *declarative context*, so a generic policy can read the endpoint's declared
  intent. The gateway never evaluates it. A policy that ignores it is correct; a
  policy that reads it is also correct. This is documented as data, not as a check.
- OPA must receive **only gateway-produced, verified** identity. `input.token` is
  the validated claim set; a policy must never authorize on a raw caller-supplied
  token or on any caller-controlled field. This is what the closed-whitelist rule
  on extra input (below) enforces — `token.*`, `user.*`, `method`, `path` and
  `route` are unwritable from request data.

### D7 — Two separate identities: the user's, and the gateway's

**Decision.** User authentication and gateway-to-OPA authentication are
**completely separate concerns and share no credential**.

- **User authentication is unchanged**, whether OPA is enabled or disabled. The
  API client authenticates to the gateway exactly as it does today; nothing about
  the caller-facing contract moves.
- The gateway verifies the user's session/JWT and builds the OPA input **from the
  verified claims**.
- The gateway then calls the central OPA with its **own private service
  credential**: HTTPS plus a **dedicated bearer token owned by the gateway**, held
  as the `opaToken` credential on `apigw-config`.
- **The user's bearer token is never reused as the `Authorization` header of the
  gateway-to-OPA request.** It is never forwarded to OPA as a credential at all.
  The verified *claims* travel only inside the `input` document, as policy data.

OPA therefore sees **two distinct things**, at two different layers:

| Layer | Identity | Carried as | Answers |
|---|---|---|---|
| HTTP transport / authentication | **the gateway service** | `Authorization: Bearer <opaToken>` | *"May this service ask me for decisions?"* |
| Policy input | **the authenticated end user** | `input.token` (verified claims) | *"May this user do this thing?"* |

The full flow:

```
user authentication  →  verified claims  →  build OPA input
                     →  gateway authenticates privately to OPA
                     →  OPA evaluates policy
```

`opaUrl` must be `https://` in production and `opaToken` must be set; the token
is injected via a **`fetchFn` wrapper** (an existing constructor option,
`lib/opa-client.js:130-138`). Server-certificate trust comes from the system trust
store, or from **`NODE_EXTRA_CA_CERTS`** when the central OPA presents a
private-CA certificate.

**Rationale.** Conflating the two identities is the classic confused-deputy setup.
Forwarding the caller's token to OPA would mean OPA's admission control is
governed by whoever happens to be calling the API, the gateway could not query OPA
for an anonymous request at all (there would be no credential), token audience and
lifetime would be wrong for a service that was never an intended recipient, and
any caller who obtained a token would gain a direct channel to the shared policy
service. Separating them means the gateway's right to *ask* is stable and
independent of the user's right to *do*, which is what makes the decision path
work identically for authenticated and anonymous requests. On the implementation
side, `_makeRequest` hard-codes `Content-Type` as its only header
(`lib/opa-client.js:456-463`) and `getHealthStatus()` (`:648`) makes an
*independent* `this._fetch` call — a `headers` config key merged only into
`_makeRequest` would leave the health check unauthenticated against an OPA started
with `--authentication=token` (`doc-005:196-213`), reporting unhealthy while
decisions succeed. A `fetchFn` wrapper covers **both** call sites **without touching
`lib/opa-client.js` for authentication at all** — v1 does change that file, but
for the three decision-path defects in D8, not for this — and
`NODE_EXTRA_CA_CERTS` is process-level trust, so it works with `globalThis.fetch`
unchanged.

**Rejected.**

- **Forwarding the user's `Authorization` header to OPA.** See above; it is the
  defect this decision exists to prevent, and the input builder's closed
  whitelist (D6) is what structurally stops a request header from reaching the
  outbound call.
- An `https.Agent` + `rejectUnauthorized` toggle — `https.Agent` is **silently
  ignored** by `globalThis.fetch` (undici) on Node 22, and `undici` is not a
  direct dependency. A UI switch that does nothing is worse than no switch, and a
  per-node "skip certificate validation" escape hatch has no place on the path
  that carries user claims to a shared service.
- **mTLS, client certificates, workload identity and any other service-authentication
  mechanism.** Out of scope — not deferred, not a follow-up alternative. Bearer
  over TLS is the approach.

**Consequences.**

- **OPA is invisible to API consumers.** No new header, no new status code shape,
  no change to how a client authenticates. A caller cannot tell from the outside
  whether OPA is enabled — which is the point, and which is what makes enabling it
  a deployment decision rather than an API change.
- `initializeOpaClient()` validates the gateway credential alongside the D4
  checks: a non-`https` `opaUrl` or a missing `opaToken` emits a `node.warn`
  naming the risk. `http://` is permitted **only** for the e2e harness and local
  development, never presented as a production option.
- The two credentials fail in visibly different ways, and the taxonomy keeps them
  apart: a bad **user** token yields **401** to the caller; a bad **gateway**
  token yields `OPA_HTTP_401` → **503**, because it is our misconfiguration, not
  the caller's.
- `opaToken` is provisioned by whoever administers the central OPA and belongs to
  this gateway. Its rotation is an operational task independent of anything in the
  identity provider.

### D8 — The v1 boundary

v1 delivers a **correct, observable and resilient remote authorization decision
path** — and nothing beyond it. The line is drawn there because a remote
authorization call is the part that must be right before anything richer is worth
building on top of it.

**v1 includes:**

- **OPA enforcement** on API endpoints (D2, D5, D6).
- **Fail-closed behaviour** — no valid decision means 503 (D4).
- **Correct retry classification** — transient failures are retried, deterministic
  ones are not. See *Resilience settings* below for the full table.
- **Per-logical-evaluation circuit-breaker accounting** — one incoming API
  request counts once, however many attempts it made.
- **`decision_id` traceability** — captured from OPA and propagated through
  `msg.opa`, the structured log and the admin test route.

The last three require changes to **`lib/opa-client.js`** itself, not just to the
nodes. That is a deliberate widening of v1's blast radius: all three are defects
in the decision path, and shipping enforcement on top of them would mean shipping
a gateway that retries a 404 four times, trips its breaker after one and a quarter
requests, and cannot tie a 403 to the decision that caused it.

**v1 deliberately excludes:**

- **OPA authorization for gateway-owned and operational routes.** OPA applies to
  **API endpoints only** — the routes in `node.registeredRoutes`. `/openapi.json`,
  the YAML spec, Swagger UI and `/metrics` are attached directly to the Fastify
  instance, keep their **existing access-control behaviour**, and get **no
  OPA-specific hook**. This design introduces no replacement authorization
  mechanism for them; their security model is unchanged and out of scope here.
- **Resource resolution.** `abac.rego` and `ownership.rego` remain
  **reference-only**, documented as such in the help text and the template table,
  until real resource loading exists. A DB read before the policy call does not
  belong in a `preHandler`.
- **Obligations enforcement.** OPA may return extra information — for example
  `time-based.rego:520`'s `rate_limits` — and the gateway surfaces it on
  `msg.opa`, but **v1 enforces the authorization decision only**. Response-header
  obligations are not shipped; if they ever are, header **names must be an
  allow-list**, not a deny-list.
- **Policy push or policy editing from the Node-RED editor.** The editor
  configures a policy path, previews the input document and tests an *existing*
  policy. It does **not** publish policies to the central OPA — that is the OPA
  administrator's system of record, not ours to write into.
- **Request coalescing / in-flight deduplication.**
- **Token-bucket protection ahead of the OPA call.**
- **Embedded WASM.**
- **Any gateway-to-OPA authentication mechanism other than HTTPS + the dedicated
  gateway bearer token** already decided in D7. mTLS, client certificates and
  workload identity are out of scope — not deferred, and deliberately not offered
  as alternatives anywhere in this document.

In short: v1 does not include richer policy orchestration, resource loading,
policy publishing, or advanced shared-service load protection.

---

## Connecting to the OPA server

### Configuration mapping — editor key → `OpaClient` option

The node keys and the client keys **do not line up**. This table is the contract.

| Editor key (`apigw-config`) | Runtime prop | `OpaClient` option | Unit | New default | Note |
|---|---|---|---|---|---|
| `opaEnabled` | `node.opaEnabled` | — | bool | `false` | unchanged |
| `opaUrl` | `node.opaUrl` | `opaUrl` | URL | *(none — must be set)* | **changed**: `https://` required; the `http://localhost:8181` default is removed so an unset URL fails validation instead of silently pointing at nothing |
| `opaToken` *(credential)* | `credentials.opaToken` | via `fetchFn` | secret | — | **new**, `type: "password"`, **required** (D7). The **gateway's own** service credential for calling OPA — **unrelated to any user's session token**, and never derived from one |
| `opaPolicyPath` | `node.opaPolicyPath` | `policyPath` | path | *(none — must be set)* | **fully configurable**; supplied by the OPA administrator. **`""` disables enforcement with a warn — never falls back to any built-in default** |
| `opaMode` | `node.opaMode` | — | enum | `enforce` | **new**: `enforce` \| `monitor` \| `off` |
| `opaFailOpen` | `node.opaFailOpen` | — | bool | `false` | **new** |
| `opaCacheTTL` | `node.opaCacheTTL` | `cacheTtl` | **s → ms** | `60` | `× 1000`; **`0` → `cacheEnabled: false`** |
| `opaTimeout` | `node.opaTimeout` | `timeout` | ms | `2000` *(was 5000)* | per attempt; a network call incl. TLS handshake on a cold connection |
| `opaRetryAttempts` | `node.opaRetryAttempts` | `retryAttempts` | count | `1` *(was 3)* | max attempts = value + 1, **applied only to retryable failures** (see classification) |
| `opaDeadline` | `node.opaDeadline` | — | ms | `3000` | **new**, `Promise.race` wall clock — the number the API client actually feels |
| `opaCacheMaxSize` | `node.opaCacheMaxSize` | `cacheMaxSize` | count | `5000` | **new**; the cache is a resilience component under D1, not a micro-optimisation |
| `opaCircuitBreakerThreshold` | `node.opaCbThreshold` | `circuitBreakerThreshold` | count | `5` | **new**; **5 consecutive failed logical evaluations** — v1 changes accounting from per-attempt to per-call |
| `opaCircuitBreakerTimeout` | `node.opaCbTimeout` | `circuitBreakerTimeout` | ms | `30000` | **new**; probe a recovering shared service sooner than the 60 s library default |
| `opaTokenMode` | `node.opaTokenMode` | — | enum | `full` | **new**: `full` \| `claims` \| `none` |
| `opaTokenClaims` | `node.opaTokenClaims` | — | list | `""` | **new**, used when `claims` |
| `opaIncludeAuditFields` | `node.opaIncludeAuditFields` | — | bool | `false` | **new**; forces `cacheEnabled:false` |

**Unit traps that must be handled at the boundary**, not deep in the code:
`opaCacheTTL` is seconds in the UI and milliseconds in the client; `0` means
*never expire* in the client (`lib/opa-client.js:257-262`) so it must map to
`cacheEnabled: false`; and values that look like milliseconds (e.g. the `60000`
in `examples/opa-protected-api.json:37`) get a defensive `node.warn`.

### Client construction and validation

`initializeOpaClient()` is a line-for-line analogue of `initializeKeycloakClient()`
(`nodes/api-server.js:96-137`):

1. Guard on `node.configNode?.opaEnabled`.
2. Bail with `node.warn` when `(opaPolicyPath || "").trim()` is empty.
3. **Call `validateOpaConfig()`** (`lib/opa-client.js:48`) — this is its **first
   production caller**; the constructor validates nothing (`:130`). It does *not*
   check that `opaUrl` parses or that `policyPath` is non-empty, so the node adds
   both checks itself, **plus the two D1/D7 checks**: `opaUrl` must be `https://`
   (warn otherwise) and `credentials.opaToken` must be present (warn otherwise).
   There is no default `opaUrl` any more, so an unconfigured gateway fails this
   step loudly instead of quietly addressing a local port that does not exist.
4. `new OpaClient({..., logger: node.configNode.getLogger(), fetchFn: bearerWrapper})`.
5. Attach `circuitOpen` / `circuitClosed` listeners exactly as at `:127-133`,
   **plus a defensive `client.on("error", ...)`** — `isAllowed()` does
   `this.emit("error", err)` at `lib/opa-client.js:639`, and an unhandled
   `"error"` on an EventEmitter **throws**.
6. Register the health check against the **live client**
   (`() => client.getHealthStatus()`) rather than the duplicate
   `createOpaHealthCheck`, so `details` include `circuitState`.

**Never call `isAllowed()`.** Its `{user, request:{...}}` shape matches zero
policies here, it discards the reason, and with no `"error"` listener it
**rejects** instead of resolving `false` (`lib/opa-client.js:634-641`). Mark it
`@deprecated` so nobody wires it later.

### Resilience settings and why

These are **network numbers**. Under D1 every cache miss is a TLS-terminated call
to a shared service that may be busy with another project's traffic, so the
budget has to absorb a connection setup and a realistic tail — but it also has to
stay small enough that a slow OPA does not become a slow API.

- **`timeout: 2000` per attempt.** Enough for a cold connection (DNS + TCP + TLS
  handshake) plus evaluation on a loaded server. A tighter value turns a normal
  tail latency into a 503 storm.
- **`retryAttempts: 1`** (two attempts total, **and only for retryable failures**
  — see the classification below). Across a network a retry is worth having: a
  connection reset or a rolling restart of one OPA replica is exactly the
  transient a single retry absorbs. More than one retry only lengthens the tail
  in front of a user.
- **`opaDeadline: 3000`, enforced with `Promise.race`.** This is the number an API
  client actually experiences, and it is the only hard bound: the client has **no
  overall budget across retries** (`lib/opa-client.js:493-534`), so without it the
  worst case is `(retryAttempts+1) × timeout + Σbackoff`. The deadline is
  deliberately less than the naive sum, so a pathological second attempt is cut
  off rather than run to completion.
- **`circuitBreakerThreshold: 5`, `circuitBreakerTimeout: 30000`.** With
  per-logical-evaluation accounting (below), 5 means **5 consecutive failed
  requests** — no division, no attempt arithmetic. The shorter open-state timeout
  lets the gateway probe a recovering OPA sooner, because under fail-closed every
  second the breaker stays open is a second of 503s.

#### Retry classification — v1, not a follow-up

The client retries **every** error today (`lib/opa-client.js:493-534`) with no
notion of retryable-ness, so a 404 "policy not found" costs four round trips and
four breaker failures before surfacing. v1 fixes this. The classification:

| Failure | Retry? | Why |
|---|---|---|
| Connection refused / reset, DNS failure, socket hang-up | **Yes** | Classic transient; a second attempt commonly succeeds |
| TLS handshake failure | **Yes** | Often transient (mid-rotation, replica restart); still bounded by the deadline |
| Per-attempt `TIMEOUT` | **Yes, if another attempt fits inside `opaDeadline`** | Otherwise there is no point starting one — fail now rather than at the deadline |
| **502, 503, 504** | **Yes** | Temporary server-side failure: a replica restarting, a proxy with no healthy upstream |
| Other 5xx (500) | **Yes** | Conservatively transient — but see the note below |
| **400** malformed request | **No** | Deterministic; the same body will fail identically |
| **401 / 403** | **No** | Our service credential is wrong or revoked (D7). Retrying cannot fix it and hammers a shared service |
| **404** policy not found | **No** | A configuration error — the path does not exist |
| **429** | **No** | We are being throttled; retrying immediately is the opposite of the correct response |
| Malformed / non-conforming policy response (`POLICY_UNDEFINED`) | **No** | Deterministic: the same path returns the same non-answer |
| `CONFIG_INVALID` | **No** | Never reaches the wire |

The rule of thumb behind the table: **retry what a different moment might fix;
never retry what a different request body or a different configuration would be
needed to fix.** Every non-retryable class is one where retrying converts our
misconfiguration into load on a service other projects share.

The deadline check on `TIMEOUT` matters more than it looks: with
`timeout: 2000` and `opaDeadline: 3000`, a second attempt after a first timeout
has ~1 s of budget left, so it is started only if that is a plausible window;
otherwise the call fails immediately as `DEADLINE` rather than burning a second
2 s attempt that the deadline would abort anyway.

#### Circuit-breaker accounting — per logical evaluation

`_recordFailure()` currently fires **once per attempt** (`lib/opa-client.js:519`),
so with the shipped defaults a single dead-OPA call contributes 4 failures against
a threshold of 5 and the breaker trips after **~1.25 requests**. v1 changes this
to **one failure per logical policy evaluation**: one incoming API request that
makes two OPA attempts and ultimately fails counts as **one** failed evaluation.
A request that fails an attempt and then succeeds on retry counts as a **success**,
not a failure-then-success.

The threshold therefore reads directly as what an operator expects — 5 means five
consecutive failed requests — and the breaker becomes tunable without knowing the
retry count. This is what makes the two settings composable: changing
`opaRetryAttempts` no longer silently retunes the breaker.

Operators retuning these must keep one invariant: `opaDeadline` below the
gateway's own client-facing timeout.

### Caching

Key = `md5(JSON.stringify(input))`, **no `policyPath`, no `opaUrl`**
(`lib/opa-client.js:203-206`) — hence D3. Because `input.token` carries the full
verified claim set including `iat`/`jti`, the key **rotates with every user-token
refresh**: hit rate ≈ requests-per-token-lifetime-per-route. Fine for a 5-minute browser
token; **exactly 0%** for a service account that fetches a token per call. Size
`cacheMaxSize` as *(distinct concurrent tokens × distinct routes)*; the default is
`5000` and undersizing it is not a memory saving — it is extra load on the shared
OPA and extra latency on our own hot path.

Under D1 the cache is doing two jobs, and both are load-bearing: it keeps a
network round trip off the request path, and it keeps our request volume off a
service other teams depend on. Disabling it (`opaCacheTTL: 0`) is a legitimate
choice for high-assurance or short-TTL-policy deployments, but it must be a
deliberate one, taken with the central OPA's capacity in mind.

**Invalidation is TTL-only.** There is no bundle-change hook, no ETag, no
stale-while-revalidate, no selective invalidation; `clearCache()`
(`lib/opa-client.js:296`) is the only lever. **The cache therefore does not ride
out an OPA outage** — entries simply expire and the next request fails closed;
there is no serve-stale-on-error path. That is a follow-up task, not a v1
mitigation to rely on. Two further consequences belong in the help text, not a
code comment:

- Edit a `.rego`, OPA hot-reloads in ~1 s, and the gateway keeps enforcing the
  **old** decision for up to `opaCacheTTL`. *Set TTL to 0 while authoring.*
- `time-based.rego:152-158` falls back to `time.now_ns()` when `input.timestamp`
  is omitted (which we recommend, for cache hygiene), so a business-hours ALLOW
  is **replayed from cache after the boundary**. Bound the TTL for temporal
  policies.

### Lifecycle

Construct in the node constructor next to `nodes/api-server.js:1026` — **never
inside `startServer()`**, which `restartServer()` re-enters. Tear down in
`stopServer()` after `:871-876`. `shutdown()` (`lib/opa-client.js:735`) clears
the unref'd sweep interval, the cache and the breaker, and removes all listeners.
Two cases that must be handled explicitly rather than degrading silently:

- **`RED.nodes.getNode()` returns `null`** for a deleted or unwired config node.
  A server that *was* OPA-enabled must go red and refuse to enforce — not start
  unprotected with no signal.
- **Partial deploy** of only `apigw-config` leaves the route-registration-time
  `resolveOpaSettings()` snapshot stale. Re-resolve on restart.

Also: **dispose of `ConnectionStateManager("opa")`** (`nodes/api-config.js:127-134`).
Left in place it is a *third* retry mechanism nominally governing the same call.

---

## Defining and using Rego rules from the endpoint node

### The canonical `input` document

This is the union of what the five shipped templates actually read. **Key order
is fixed and load-bearing** — `JSON.stringify` order is what the cache key
hashes.

```jsonc
{
  "method": "GET",                       // rbac, abac, ownership, timebased, audit
  "path":   "/api/v1/documents/doc-123", // STRING (not an array), query stripped
  "route":  "/api/v1/documents/:id",     // route template, for policy readability
  "params": { "id": "doc-123" },
  "query":  { "page": "1" },
  // DECLARATIVE CONTEXT ONLY — the gateway does NOT evaluate this (D6).
  // A policy may read it; a policy may ignore it. It is data, not a check.
  "endpoint": { "requiredScopes": ["read:docs"], "operator": "AND" },

  // token: PRESENT ONLY WHEN AUTHENTICATED. Never `null`. See rbac.rego:81-89.
  // VERIFIED claims produced by the gateway — never a caller-supplied token.
  "token": { "sub": "...", "exp": 1735689600,
             "scope": "openid profile read:documents",
             "realm_access": { "roles": ["user"] } },

  // opt-in blocks, appended in this fixed order
  "resource":    { "id": "doc-123", "type": "document" },   // from opaInputMappings
  "environment": { "ip_address": "10.0.0.1" },              // abac only
  "timestamp":   "2026-08-30T10:32:00Z",                    // timebased only
  "request_id":  "...", "source_ip": "...",                 // audit only, TOP-LEVEL
  "body":        { }                                        // opt-in; wrecks cache hit rate
}
```

**Optional-key presence rules** (this is the same defect class as trap #4, and
must be specified per key): a key whose source is absent is **omitted**, never
`null` and never `{}`. `params` is `{}` for a static route; `body` is `undefined`
for GET and for unparsed content types; a client-credentials token has no
`email`. "Sometimes present, sometimes absent" otherwise produces two cache keys
for logically identical inputs.

**Token claim union actually read by the templates:** `sub`, `exp` (seconds),
`preferred_username`, `email`, `realm_access.roles`, `resource_access.<client>.roles`,
`roles`, `groups`, `custom:roles`, `scope` (**space-delimited string** — preserve
it as a string), `department`, `clearance_level`, `location`, `teams`,
`job_title`, `employee_type`, `org_id`, `permissions`, `access_schedule{start,end}`,
`sid`, `auth_time`, `amr`.

### Scope authorization in Rego

Under D6 this is where scope checks live. OAuth/OIDC scopes from the verified
session token reach policy as **`input.token.scope`**, a **space-delimited
string** — the format the identity provider issues, preserved verbatim:

```
"openid profile read:documents write:documents"
```

Split it before any membership test. **Require all of a set:**

```rego
required_scopes := {"read:documents", "write:documents"}
token_scopes := {s | s := split(input.token.scope, " ")[_]}

allow if {
    required_scopes <= token_scopes
}
```

`<=` is subset in Rego, so this is the `AND` semantics `checkScopes()` used to
implement. **Require any one of a set** (the `OR` semantics):

```rego
allowed_scopes := {"admin", "write:documents"}
token_scopes := {s | s := split(input.token.scope, " ")[_]}

allow if {
    some scope in allowed_scopes
    scope in token_scopes
}
```

**Both fail safely on missing input, and that is not an accident.** If `token` is
absent (anonymous request) or the token carries no `scope` claim, then
`input.token.scope` is **undefined**; `split()` on an undefined value makes
`token_scopes` undefined; every rule body referencing it is undefined; and with
`default allow := false` the request is denied. There is no `null` to be truthy
and no empty set to satisfy a subset test by accident — which is precisely why
the gateway **omits** `token` rather than sending `null` (trap #4).

If a policy needs to branch on presence rather than simply deny, test it
explicitly instead of relying on a default:

```rego
default allow := false

is_authenticated if { input.token }          # true only when the key exists

allow if {
    is_authenticated
    "read:documents" in {s | s := split(input.token.scope, " ")[_]}
}
```

A policy may also drive itself from the endpoint's declared intent rather than
hard-coding a scope set, since the gateway passes `requiredScopes` as context:

```rego
token_scopes := {s | s := split(input.token.scope, " ")[_]}

allow if {
    required := {s | s := input.endpoint.requiredScopes[_]}
    required <= token_scopes
}
```

That single rule reproduces the old gateway-side behaviour for every endpoint at
once — the difference being that it is now visible, versioned and overridable in
the policy rather than hard-coded in `lib/authorization.js`.

### Response contract

Every template declares `default allow := false` and exposes a richer sibling
(`authorization` for rbac/abac/ownership/timebased, `decision` for audit).
`_extractAllowed` accepts **`boolean` | `{allow}` | `{allowed}`**. There is **no
`deny` rule and no `violations` rule** in any template; reasons are plain strings
under `reason` / `decision_reason`.

> **The undefined-document trap — the single highest-value defensive check in
> this feature.** OPA answers **HTTP 200 `{}`** for a path it does not define.
> Classify a result as a **config fault** — not a deny — when it is `undefined`
> **or** a non-array object carrying neither `allow` nor `allowed`. On first
> detection: respond 503, emit a **deduped** `node.error` naming the policy path,
> and call `clearCache()` so the poison is not served for the whole TTL.
>
> Note the limit of this check: it catches an **undefined** path, not a **wrong
> but defined** one. A path that resolves to some other document which happens to
> return a boolean is indistinguishable here from the correct one. That is what
> the editor Test button is for — it shows the actual decision and reason for a
> sample input before anything is deployed.

**Point `opaPolicyPath` at a rule that returns `allowed` *and* `reason` in one
round trip** — a `decision`/`authorization`-style rule rather than a bare
`allow`, since `_extractAllowed` already accepts `boolean | {allow} | {allowed}`
(`lib/opa-client.js:596-614`). Avoid pointing it at a **package root**: that
returns every exported rule in the package, which is both a larger response and a
wider data-egress surface than the decision needs. Beyond that, **the path itself
is entirely the OPA administrator's to define** — this design reserves no
namespace and prescribes no naming scheme. The only requirement the gateway
imposes is the technical one: the configured path must resolve to a document that
returns a valid decision.

Status mapping: **401** when the policy reason is `missing_token` or
`token_expired` *and* `request.auth.authenticated` is false (the gateway's own
state decides 401 vs 403 — **never** a policy-authored string alone, or a policy
could hand an authenticated user a 401). **403** for any other deny. **503** for
any non-decision.

### Per-endpoint settings and precedence

| `apigw-endpoint` key | Values | Default | Precedence |
|---|---|---|---|
| `opaMode` | `inherit` \| `enforce` \| `monitor` \| `off` | `inherit` | endpoint wins unless `inherit`; forced `off` if config disabled or path blank |
| `opaPolicyPath` | path | `""` | endpoint wins when non-empty; **creates its own client** |
| `opaInputMappings` | `resource.id->params.id, resource.type->'document'` | `""` | merged last, **allow-list only** |
| `opaIncludeBody` | bool | `false` | endpoint only |

**Tighten-only rule.** An endpoint may move `monitor → enforce`, or point at a
stricter policy. It may **not** set fail-open, and it may **not** re-configure
the connection. There is no per-endpoint `opaFailMode: "open"`.

**Extra input is a closed whitelist.** Fixed source prefixes
(`params.` `query.` `headers.` `body.` `auth.` `method` `path` `route` `ip`
`'literal'`) and fixed writable targets (`resource.*`, `environment.*`,
`extra.*`, plus the audit top-level keys). **`token.*`, `user.*`, `method`,
`path` and `route` are explicitly unwritable** — otherwise a request header can
forge the identity the policy authorises on. No JSONata, no expression evaluator
in the authorization input builder.

### Authoring, testing and deploying policies

Unchanged from `doc-005`: write `.rego` under a directory, bind-mount it
read-only into the OPA container, pass the directory as a positional arg
(`doc-005:126`, mirrored at `tests/e2e/docker-compose.yml:91-100`). OPA
hot-reloads file mounts. Bundles (`opa build --bundle`) are the production path.
`opa test policies/templates/ -v` (`policies/templates/README.md:169`) becomes an
npm script and a CI step — `.github/workflows/ci.yml` runs only gitleaks + lint +
mocha today, and `policies/templates/tests/` is **absent from the `package.json`
`files` allowlist**, so consumers receive policies CI never tested.

### Template compatibility — state this in the help text

| Template | Path | Verdict |
|---|---|---|
| `gateway.rego` *(new)* | *(its own package — an example, not a convention)* | **Supported** — written against the canonical input; used by the e2e harness and the example flows |
| `rbac.rego` | `v1/data/rbac/authorization` | **Supported** |
| `time-based.rego` | `v1/data/timebased/authorization` | **Supported** (bound the cache TTL) |
| `audit.rego` | `v1/data/audit/decision` | **Supported** (needs `opaIncludeAuditFields`, disables cache) |
| `abac.rego` | `v1/data/abac/authorization` | **Reference-only** — needs a real resource object |
| `ownership.rego` | `v1/data/ownership/authorization` | **Reference-only** — needs a real resource object |

---

## Editor UI integration

House style is non-negotiable: one long scrolling form of `div.form-row`, `<h4>`
section headers with a bottom border, show/hide via plain jQuery
`.on("change", …).trigger("change")`. There is **no `RED.tabs`, no `typedInput`,
no `editableList`, no `<details>`** anywhere in `nodes/*.html` or `resources/` —
this plan introduces none.

### `apigw-config` — extend the existing OPA section in place

The section already exists at `nodes/api-config.html:317-348` with its toggle at
`:125-132` and help at `:577-585`. Every new row carries
`class="form-row opa-config-row"`, so the existing toggle picks them up for free.

Grouped with the full-width bold sub-heading idiom (`nodes/api-config.html:225`):

- **Connection** — `opaUrl` (`fa-link`, **placeholder
  `https://opa.example.internal`**, no pre-filled default, with an amber warning
  shown when the value does not start with `https://`: *"Policy input carries JWT
  claims — use TLS."*), **`opaToken`** (`fa-key`, `type="password"`, labelled
  **required**, hint *"This gateway's own service token for calling OPA. Not a
  user token — API callers keep authenticating exactly as they do now."*, amber
  warning when empty), `opaPolicyPath`
  (`fa-file-code-o`, **no default**, placeholder showing the generic shape
  `v1/data/<your-package>/<rule>`) plus a `form-tips` line: *"The path is
  supplied by whoever administers your OPA. It must resolve to a document that
  returns a decision — use Test to confirm before deploying."*
- **Enforcement** — `opaMode` (`fa-gavel`, select, **default first**: *Enforce —
  deny on policy denial* / *Monitor — evaluate & log, never deny (debugging)* /
  *Off*; selecting Monitor reveals an amber `#f0ad4e` hint: *"Requests are NOT
  authorized in this mode."*), and `opaFailOpen`
  (`fa-chain-broken`, checkbox) in a nested `.opa-enforce-row`, stacked exactly
  like the `jwt-issuer-row` idiom at `:284`.
- **Policy input** — `opaTokenMode` (select), `opaTokenClaims` (nested
  `.opa-token-claims-row`, chip preview), `opaIncludeAuditFields` (checkbox with
  an amber `#f0ad4e` hint: *"disables decision caching"*).
- **Performance & resilience** — `opaCacheTTL` (hint: *"Seconds. 0 disables
  caching — every request then makes a network call to OPA."*), `opaTimeout`
  (placeholder `2000`), `opaRetryAttempts` (placeholder `1`), `opaDeadline`
  (placeholder `3000`), `opaCacheMaxSize` (placeholder `5000`),
  `opaCircuitBreakerThreshold`, `opaCircuitBreakerTimeout`, plus a **live budget
  callout** in the grey info-box idiom (`:513`) recomputed on change:
  *"Worst-case added latency: 3.0 s (bounded by the deadline; only retryable
  failures retry). Breaker opens after 5 consecutive failed requests. Keep the
  deadline well under your client timeout."*
- **Test row** — a `red-ui-button red-ui-button-small` following the OpenAPI
  import precedent, with hidden success/error divs.

`oneditprepare` additions go **after** the existing `opaEnabled` handler at
`:125-132` — handler definition order matters for the initial `.trigger("change")`
cascade — and the parent's `show()` branch re-triggers the children.
**`nodes/api-config.html`'s `oneditprepare` never declares `var node = this;`**
(unlike `nodes/api-endpoint.html:81`); it must be added or the Test button posts
`undefined` as the config-node id.

### `apigw-endpoint` — a new "Policy (OPA)" section

**Position:** between the end of the Authorization section
(`nodes/api-endpoint.html:579`) and the CRUD Operation header (`:581`). The help
block gets a matching `<h3>Policy (OPA)</h3>` between `<h3>Authorization</h3>`
(`:956`) and `<h3>CRUD Operations</h3>` (`:959`) — **form order and help order
must match**.

The section is **config-node aware**, which is what makes a two-node split
legible to a flow author:

- `#opa-disabled-notice` — a grey callout shown when the selected server's config
  node has `opaEnabled === false`: *"These settings have no effect until you
  enable OPA there."* Read via
  `RED.nodes.node(RED.nodes.node($('#node-input-server').val()).config)`, refreshed
  on `#node-input-server` change.
- **Mode** select — the `inherit` option's label is set from JS with `.text()`
  showing the inherited value (*"Inherit from config (enforce)"*). A `<span>`
  nested inside an `<option>` **does not render**.
- **Policy Path** with a live `Effective: <code>…</code>` readout resolving
  endpoint-override → config-node value.
- **Extra Input** reusing `E.parseFieldMappings` / `E.validateFieldMappings` /
  `E.renderMappingBadges` (`resources/api-endpoint-editor.js:262`, `:224`, `:432`)
  **verbatim** — the `old → new` arrow-chip UI is already a learned pattern in
  this dialog (Field Mappings) and `.mapping-badge` CSS already exists. Zero new
  widgets, zero new CSS. A new `E.validateOpaMappings` validates the *source
  vocabulary*, not just the arrow syntax.
- **Include Body** checkbox with an amber *"reduces decision cache hit rate"* hint.
- **Preview input & test policy** button.
- **Help / Examples** button — see below.
- **Authorization-authority notice** (D6) — because the Authorization section
  with its `requiredScopes` field sits directly above this one, an amber
  `#f0ad4e` callout appears in the Authorization block whenever the resolved OPA
  mode is `enforce` or `monitor`: *"OPA is the authorization authority for this
  endpoint. Required Scopes are **not** checked by the gateway — express scope
  rules in your policy using `input.token.scope`. See Policy (OPA) → Help."* The
  `requiredScopes` input is left **enabled and editable** — it is still sent to
  the policy as `input.endpoint.requiredScopes` and it still applies if OPA is
  later set to `off` — but the notice makes it unambiguous which layer decides.
  It is wired to the same `updateOpaVisibility()` that drives the section.

`E.setupToggle` is checkbox-only (`resources/api-endpoint-editor.js:371`), so a
`<select>`-driven section needs a bespoke `updateOpaVisibility()` following the
`updateCrudVisibility` precedent, primed from the "Initial updates" block at
`nodes/api-endpoint.html:385-401`.

### The Help / Examples button

**Purpose.** A flow author writing their first Rego rule needs two things the
editor cannot otherwise give them: the exact shape of `input`, and a handful of
patterns to copy. Without this, the most common outcome is a policy written
against a guessed input shape that denies everything.

**Surface.** A `red-ui-button red-ui-button-small` labelled
`<i class="fa fa-question-circle"></i> Help & examples`, next to the Preview
button. It toggles an **inline collapsible panel** immediately below it —
`#opa-help-panel`, hidden by default, shown with the same plain-jQuery
`.toggle()` idiom the rest of these dialogs use. No modal, no new dependency, no
`RED.tabs`: the project has none of those (`nodes/*.html`, `resources/`), and an
inline panel keeps the examples visible while the author edits the policy path in
the same dialog. Examples sit in `<pre>` blocks styled like the existing
`#opa-preview-result` output, each with a small **Copy** button using the
clipboard API with a `document.execCommand("copy")` fallback.

**Panel content — the contract first.** The panel opens with the canonical input
shape, so everything below it has a referent:

```json
{
  "method": "GET",
  "path": "/api/v1/documents/123",
  "route": "/api/v1/documents/:id",
  "params": { "id": "123" },
  "query": {},
  "token": {
    "sub": "...",
    "scope": "openid profile read:documents",
    "realm_access": { "roles": ["user"] }
  }
}
```

Followed by six statements, stated plainly because each one is a trap if missed:

- `input.token` contains **verified claims** produced by the gateway — not an
  untrusted decoded token, and not anything the caller supplied.
- **`input.token` is data, not a credential.** The gateway authenticates to OPA
  with its **own** service token; the user's token is never sent as the OPA
  request's `Authorization` header. Two identities, two layers: the *gateway*
  identity authorizes the HTTP call, the *user* claims in `input.token` are what
  your policy authorizes on (D7).
- `token` is **absent** for anonymous requests. It is **never `null`**.
- `scope` is a **space-delimited string**. Split it before membership checks.
- Policies must **not** use request headers to forge identity or token fields;
  `token.*`, `user.*`, `method`, `path` and `route` cannot be written from
  request data (closed whitelist, D6).
- **OPA is the authorization authority when enabled.** Implement scope, role,
  ownership, method and route rules **in Rego** — there is no second
  gateway-side authorization layer to fall back on.

**Panel content — the seven examples.** Each is short enough to read at a glance
and correct enough to paste.

1. **Require a scope**

   ```rego
   token_scopes := {s | s := split(input.token.scope, " ")[_]}

   allow if {
       "read:documents" in token_scopes
   }
   ```

2. **Require multiple scopes** (`<=` is subset — all must be present)

   ```rego
   required_scopes := {"read:documents", "write:documents"}
   token_scopes := {s | s := split(input.token.scope, " ")[_]}

   allow if {
       required_scopes <= token_scopes
   }
   ```

3. **Require a role** — from the verified role claim

   ```rego
   allow if {
       "editor" in input.token.realm_access.roles
   }
   ```

   With a note that the claim path is identity-provider specific: Keycloak realm
   roles live at `realm_access.roles`, client roles at
   `resource_access.<client-id>.roles`, and some providers use a flat `roles` or
   `groups`. Check a real token with the Preview button.

4. **Match the HTTP method**

   ```rego
   allow if {
       input.method == "GET"
   }
   ```

5. **Match a route or path** — and the difference between the two

   `input.path` is the **concrete request path** (`/api/v1/documents/123`);
   `input.route` is the **route template** (`/api/v1/documents/:id`). Match on
   `route` for a rule about an endpoint, on `path` only when the literal value
   matters — a `startswith(input.path, ...)` rule silently covers every
   sub-path, which is rarely what is meant.

   ```rego
   allow if {
       input.route == "/api/v1/documents/:id"
       input.method == "GET"
   }
   ```

6. **Use route parameters** — *example semantics only*

   ```rego
   allow if {
       input.params.id == input.token.sub
   }
   ```

   Labelled clearly: this says "a user may read their own record" **only if**
   that API happens to key records by subject. Every API must choose its own
   ownership semantics; do not paste this as-is.

7. **Anonymous vs authenticated**

   ```rego
   default allow := false

   is_authenticated if { input.token }

   allow if {
       is_authenticated
       "read:documents" in {s | s := split(input.token.scope, " ")[_]}
   }
   ```

   With the reminder that `input.token` is **omitted**, never `null`, for an
   anonymous request — so `if { input.token }` is a genuine presence test, and a
   rule that dereferences `input.token.scope` without it simply evaluates to
   undefined and denies. That is the safe direction, and it is why the gateway
   omits the key.

The same content is mirrored into the endpoint node's `<h3>Policy (OPA)</h3>`
help block, so it is reachable from the editor sidebar as well as the dialog.

Expose the decision on `msg.opa` and document it in the Outputs
`<dl class="message-properties">` (`:905-921`): `allowed`, `reason`, `policyPath`,
`mode`, `cached`, `durationMs`, **`decisionId`**, `result`, `failOpen`, `error`.
A flow author branching on `msg.opa.allowed` with a plain switch node is the most
Node-RED-native part of this design. `decisionId` is the join key into the central
OPA's decision log — present when OPA supplied one, absent on a cache hit
(`cached: true`). **In monitor mode only**, also attach `msg.opa.input`.

### The admin test route — and its SSRF constraint

`RED.httpAdmin.post("/api-gateway/test-opa", RED.auth.needsPermission("flows.read"), handler)`
in `nodes/api-server.js` next to the existing `import-openapi` (`:1103`) and
`preview-openapi` (`:1154`) routes, with the same `{success:true,…}` /
`res.status(400).json({success:false,error})` envelope. Called from the editor
with a **relative** URL so `httpAdminRoot` is respected
(`nodes/api-server.html:153-186` precedent).

It reports three things, and the third is the point:

1. **Reachable** — `GET /health`.
2. **Policy defined** — `policyDefined = (result !== undefined)` from a **real
   `evaluate()`**. `createOpaHealthCheck` (`lib/health-check.js:472`) never
   evaluates `opaPolicyPath`, so a configured-but-nonexistent policy reports
   *healthy* today. Surfacing this before deploy is the highest-value single
   feature in the plan.
3. **Sample decision** — `allow`, `reason`, and the exact input document the
   runtime would send, built by the **production** builder.

Constraints: use a **throwaway** client (`cacheEnabled:false`, `retryAttempts:0`,
`circuitBreakerEnabled:false`, then `shutdown()`) so a test cannot pollute the
production cache or trip the live breaker; read the token server-side via
`RED.nodes.getCredentials(configNodeId)` and handle Node-RED's `__PWRD__`
sentinel; and **take `opaUrl` from the stored config node, not the request body**
— a body-supplied URL makes this route an SSRF primitive for any principal with
`flows.read`, including cloud metadata endpoints.

### One easily-missed editor chore

Every new `apigw-endpoint` defaults key must **also** be added to the
hand-written `nodeConfig` literal in the OpenAPI importer at
`nodes/api-server.html:298-355`, which enumerates all 40 keys by hand.
`config.rateLimitTrustProxy` — read at `nodes/api-endpoint.js:177`, absent from
`defaults{}`, therefore permanently `false` — is the live precedent for this bug
class.

---

## Error taxonomy

The contract dashboards and alerts are written against. One stable enum, appearing
identically in the 503/403 body's `details.reason`, the `opa_policy_check` log
field, the Prometheus label and `msg.opa.error.code`.

Each code also carries a **retryable** column, because the classification is part
of the contract rather than an implementation detail — an operator reading a
`NETWORK` spike should know the gateway already tried twice, and one reading
`OPA_HTTP_404` should know it did not.

| Code | Trigger | Retried? | HTTP | Log | Operator action |
|---|---|---|---|---|---|
| `POLICY_DENIED` | Policy returned `allow:false` | n/a | 403 (401 if unauthenticated + `missing_token`/`token_expired`) | info | none — working as designed |
| `POLICY_UNDEFINED` | 200 `{}`, or object without `allow`/`allowed` | **No** — deterministic | 503 | **error** | **PAGE** — policy path is wrong; gateway 503s everything |
| `TIMEOUT` | Per-attempt abort | **Yes, if an attempt still fits in `opaDeadline`** | 503 (200 if fail-open) | warn | check OPA latency |
| `DEADLINE` | `opaDeadline` exceeded | **No** — budget is gone | 503 (200 if fail-open) | warn | raise deadline or fix OPA |
| `CIRCUIT_OPEN` | Breaker open | **No** — never reaches the wire | 503 (200 if fail-open) | warn | OPA is down |
| `OPA_HTTP_502/503/504` | Temporary server-side failure | **Yes** | 503 | error | check OPA/proxy health |
| `OPA_HTTP_500` | OPA internal error | **Yes** (conservatively) | 503 | error | check OPA logs |
| `OPA_HTTP_400/404/429` | Malformed query, policy path absent, throttled | **No** — deterministic or counter-productive | 503 | error | fix the policy path or the input builder; for 429, reduce load |
| `OPA_HTTP_401/403` | **Our** service credential rejected | **No** | 503 | error | **PAGE** — the gateway's `opaToken` is wrong or revoked (D7). Not a caller denial |
| `NETWORK` | Transport failure, DNS, TLS handshake or certificate validation failure | **Yes** | 503 (200 if fail-open) | warn | check connectivity to the central OPA and the CA trust chain |
| `CONFIG_INVALID` | `validateOpaConfig` failed, URL unparseable or not `https`, token missing, path blank | **No** — never reaches the wire | — (mode forced `off`) | **error** + red status | fix config |

Every failure code above counts as **exactly one** failed logical evaluation
against the circuit breaker, regardless of how many attempts it made.

## Observability

Log event `opa_policy_check`, mirroring the `authorization_check` convention at
`nodes/api-endpoint.js:1235-1244`: `allowed`, `enforced`, `mode`, `policyPath`,
`reason`, `cached`, `durationMs`, `decisionId`, `method`, `path`, `route`, `sub`.
**The input document is never logged** — it carries the full verified user claim
set, and correlation is achieved through `decisionId`, *not* by logging more of
the input.

### `decision_id` traceability (v1)

`evaluate()` currently discards everything but `response.result`
(`lib/opa-client.js:583-587`). v1 changes it to also return OPA's `decision_id`
when present, and the gateway propagates it:

- **Captured on every evaluation that reaches OPA — ALLOW and DENY alike**, and
  independently of whether the gateway ultimately answers 200, 403 or 503. The
  identifier describes *the decision*, not the outcome we derived from it.
- **Surfaced in three places**: `msg.opa.decisionId`, the `opa_policy_check` log
  record as a flat top-level `decisionId` field (flat so it is greppable and
  indexable in a structured log backend without a JSON path), and the admin test
  route's response.
- **Never used for authorization logic.** It is traceability metadata; no rule,
  branch or cache key may depend on it. A missing `decisionId` changes nothing
  about allow/deny.
- **Omitted, not null**, when OPA does not supply one — consistent with the
  presence rules for every other optional field.

Two honest limits that belong in the help text, not a code comment:

- **Correlation depends on the OPA administrator.** OPA only emits `decision_id`
  when decision logging is configured on their side (D1). With it off, the field
  is simply absent and the gateway behaves identically — but end-to-end
  correlation is not available, and that is not something this gateway can fix.
- **A cache hit has no `decision_id`**, because no decision was made — the entry
  is replayed locally. `msg.opa.cached` is `true` in exactly those cases, so the
  two fields read together tell the whole story: `cached: false` with a
  `decisionId` is individually traceable; `cached: true` is not.

Metrics: `api_gateway_opa_policy_duration_ms` (already advertised at
`nodes/api-server.html:698` and permanently empty today), decision counters by
`allowed`/`reason`, cache hit rate, and `opa_circuit_breaker_state` — which
requires the **`lib/metrics-collector.js:409` fix** (normalise
`state.toLowerCase().replace(/_/g,"-")` **in the collector**, not at each call
site) or the gauge reports half-open as CLOSED.

Alerts. The first four are the baseline: breaker open; deny-rate step change;
**`POLICY_UNDEFINED` count > 0 → page**; p99 duration against the stated budget.
Because D1 makes the central OPA an external dependency shared with other
projects, three more are required rather than optional:

- **`NETWORK` / `TIMEOUT` / `DEADLINE` rate > 0 sustained → page.** Under
  fail-closed these are user-visible 503s, and they are the signal that the
  dependency — not our code — is failing.
- **`OPA_HTTP_401` / `OPA_HTTP_403` > 0 → page.** Our bearer token has expired,
  been rotated or been revoked centrally. This fails *every* protected request and
  is invisible in the caller-facing deny metrics.
- **Cache hit rate dropping.** It is the leading indicator both of extra load
  landing on the shared OPA and of latency about to appear on our own hot path.

Dashboards must distinguish **"the policy denied"** from **"we could not get a
decision"** — they are the same 4xx/5xx family to a naive panel but completely
different incidents, and only the second one is an OPA availability problem.
Because the OPA is shared, correlate our metrics with the central service's own
availability signal before escalating: a spike here may be another project's
incident.

**The residual limitation, stated plainly:** with `decision_id` captured in v1,
every decision that actually reaches OPA is traceable. What remains untraceable is
a **cache hit** — no decision was made, so there is nothing to correlate with.
**Cached allows are therefore not individually auditable**, which is a
compliance-relevant statement rather than a footnote: high-assurance deployments
should set `opaCacheTTL: 0` and accept the latency and the additional load on the
shared OPA (see the performance budget).

## Security considerations

- **Bypassability, within the scope of this design.** The `preHandler` seam
  covers **every route in `node.registeredRoutes`** — that is, every API endpoint,
  which is exactly what OPA authorizes here. A startup self-check should assert
  that every registered route carries the OPA hook when OPA is active. Gateway-owned
  and operational routes (`/openapi.json`, the YAML spec, Swagger UI, `/metrics`)
  are attached directly to the Fastify instance, never enter `registeredRoutes`,
  and **keep their existing access-control behaviour unchanged** — they are out of
  scope for OPA authorization.
- **Credential separation (D7) — the invariant to protect in review.** The
  outbound `Authorization` header on every OPA request carries the **gateway's**
  `opaToken` and nothing else. The user's bearer token is **never** forwarded as
  a credential to OPA, never copied into the outbound headers, and never derived
  from. The user's *claims* travel only as `input.token`, as data. Two structural
  guards keep this true: the `fetchFn` wrapper is the single place outbound
  headers are set, and the input builder's closed whitelist (D6) makes
  `token.*`/`user.*` unwritable from request data. A code review that sees
  `request.headers.authorization` anywhere near the OPA call path should stop.
- **Data egress across an organisational boundary.** The verified claim set —
  `email`, `preferred_username`, `groups`, `org_id` and every custom claim —
  leaves this gateway on every cache miss and travels to a service **this project
  does not exclusively own**. Note what does *not* leave: the raw JWT string
  itself is never sent. TLS and the gateway's service credential (D7) are
  therefore mandatory rather than hardening; `opaTokenMode: "claims"` with an
  explicit allow-list is the right default for any deployment where the OPA
  administrator is not also the API operator. **Amplification, and it is worse
  under D1:** enabling OPA decision logs (`decision_logs: {console: true}` in
  `doc-005`) **persists the entire input, claim set included, to OPA's stdout** —
  which on a shared service means *another team's* log aggregator, under *their*
  retention policy. If we recommend decision logs for auditability — and we
  should — we must agree `decision_logs` masking with the OPA administrator and
  name the claims to mask, before pointing production traffic at it.
- **Input forgery.** See the closed-whitelist rule above.
- **Anonymous-input trap.** See D2. Corollary that must appear in the help text:
  with OAuth2 genuinely off there is **no verified identity at all**, so
  *"OPA without Keycloak"* is viable **only** for path/method/IP policies.
- **Cold-cache stampede — and it is no longer self-inflicted only.** There is no
  coalescing in the client, and the `preHandler` runs **ahead of** the endpoint's
  rate limiter (`nodes/api-endpoint.js:1065-1116`). An attacker cycling tokens
  against one endpoint drives unbounded request volume at the **shared** OPA:
  under fail-closed that becomes a 503 outage here once our breaker trips, and a
  noisy-neighbour incident for every other project on that OPA. The client-side
  breaker limits the blast radius but only *after* the damage. A token bucket
  ahead of the OPA call is a follow-up task; until it lands, this characteristic
  must be stated to whoever operates the central OPA, not just documented here.
- **Admin route SSRF.** See above. Under D1 the constraint is sharper: the Test
  button must use the **stored** `opaUrl`, never a body-supplied one, or it
  becomes a probe for arbitrary internal endpoints from the Node-RED host.

## Performance budget

Under D1 every cache miss is a network round trip, so the budget has two very
different numbers and the gap between them is the whole argument for the cache.

- **Cache hit: p50 < 2 ms, p99 < 5 ms.** In-process; unchanged by topology.
- **Cache miss: p50 < 25 ms, p99 < 75 ms** to a central OPA on the same network.
  Cross-region or internet-path deployments are **not supported** — the
  fail-closed posture makes that latency an availability problem, not just a
  slowness problem.
- **Worst case** ≈ `min(opaDeadline, (retryAttempts+1) × timeout + Σbackoff)` =
  **3 s**, bounded by the deadline rather than by the retry arithmetic — and
  reached only on a *retryable* failure. Retry classification means the common
  misconfiguration cases (`OPA_HTTP_404` from a wrong policy path,
  `OPA_HTTP_401` from a stale service token, `POLICY_UNDEFINED`) fail after **one**
  attempt, so their added latency is one `timeout` at most, not the full budget.

Expected hit rate follows the token-lifetime model in the caching section —
**0% for per-call service-account tokens**, which under D1 means such a workload
sends one network call per request and should be treated as a capacity item to
raise with the OPA operator, not a default to assume. `cacheMaxSize` must be sized
as *(distinct concurrent tokens × distinct routes)*.

Two figures need agreeing with whoever operates the central OPA before this
ships: our **steady-state and peak QPS** at the expected hit rate, and the
**latency SLO** we are budgeting against. Neither can be asserted unilaterally
from this side.

## Compatibility and migration

The project is pre-production. There are no deployments whose runtime behaviour
has to be preserved, so this section is about **not shipping a lie**, not about
protecting installed bases.

- **`opaEnabled: true` starts denying.** That is the intended change: the setting
  finally does what its name says. Anyone who wants the old evaluate-but-allow
  behaviour selects `monitor` explicitly.
- **`opaEnabled: false` — the default — is unaffected.** No OPA client is
  constructed, no hook is attached, and no request behaviour changes.
- A misconfigured OPA still **refuses to enforce, not to serve** (D4): invalid
  config or a blank policy path forces mode to `off` with a red `node.status` and
  a `node.error`. Enforce-by-default therefore cannot turn a config typo into a
  dead gateway.
- **Both shipped example flows are broken today and must be rewritten in the same
  PR** — they are the de facto documentation and both ship in the npm tarball.
  `examples/opa-protected-api.json`: `opaPolicyPath` `/v1/data/api/authz` (package
  `api.authz` — defined by nothing), `opaCacheTTL: 60000` in a seconds field
  (`:37`), `path` as an array (`:220`), and an in-JavaScript `evaluatePolicy()`
  simulation that must be replaced by real enforcement plus `msg.opa` branching.
  `examples/full-stack-api.json` has the same undefined package and the same
  `60000`.
- `README.md:10`, `:87`, `:106-109` must be corrected. `CHANGELOG.md:29-31`
  ("OPA fail-open made explicit") and the known-limitations entry at `:84-85`
  both become **false** and must be **superseded with a dated entry**, not
  silently deleted.
- Release classification: **`feat(node)!` with a `BREAKING CHANGE:` footer**, in
  one release. `opaEnabled: true` changes from a no-op to an enforcing
  authorization gate — that is a behaviour change and is labelled as one, even
  though no deployment depends on the old behaviour.

## Test strategy

**Prerequisite — the injection seam.** All three candidate designs assumed "unit
tests with an injected `fetchFn`", but the node constructs `OpaClient` itself
inside `initializeOpaClient()` and `tests/unit/api-server_spec.js` goes through
`helper.load`, which offers no hook. **Without an explicit seam the entire test
plan is aspirational.** Add a `node._opaFetchFn` test property (or a
`RED.settings`-driven override) as step one.

- **Unit** (`tests/unit/api-server_spec.js`, `tests/unit/api-config_spec.js`):
  **the default mode is `enforce`**; enforce + deny → 403; monitor + deny → 200 +
  `msg.opa.allowed === false`; enforce + `TIMEOUT` + fail-closed →
  503; fail-open → 200 + warn; `result === undefined` → fault, not deny; `token`
  key **absent** for anonymous; `path` is a string with the query stripped; cache
  TTL normalisation for 0 / 60 / 60000; blank path disables with a warn;
  `preHandler` is an array with auth first; client survives `restartServer()` and
  is shut down by `stopServer()`. Plus the `half_open` gauge assertion in
  `tests/unit/lib/metrics-collector_spec.js`.
- **Single-authority (D6)** — the tests that pin the model, and they matter more
  than any other unit test here:
  - An endpoint with `requiredScopes: ["read:docs"]` and OPA **active**, given a
    token **without** that scope and a policy that **allows**, returns **200**.
    This is the assertion that proves the gateway no longer runs its own scope
    check — it fails loudly if `checkScopes()` is ever reintroduced on this path.
  - The same endpoint with a policy that **denies** returns **403**, and the log
    carries exactly one `opa_policy_check` and **no** `authorization_check`
    record.
  - `requiredScopes` still appears in the input as
    `input.endpoint.requiredScopes` — present as context, never consulted by the
    gateway.
  - With OPA `off` on the endpoint, `requiredScopes` enforcement is **unchanged**
    (the existing `tests/unit/authorization_spec.js` behaviour still holds).
- **Credential separation (D7)** — assert on the *outbound* request captured by
  the injected `fetchFn`: its `Authorization` header equals
  `Bearer <opaToken>` and **never** the caller's token, for an authenticated
  request, an anonymous request, and a request carrying a deliberately
  distinctive bogus `Authorization` value. Also: the OPA call still carries the
  gateway credential when the caller sent **no** `Authorization` header at all —
  proof the two identities are independent. And user-facing behaviour is
  unchanged with OPA enabled: same 401 for a bad user token, same response shape,
  no new headers.
- **Retry classification (D8)** — table-driven against
  `tests/unit/opa-client_spec.js`, one case per row of the classification table,
  counting the attempts the injected `fetchFn` actually received:
  - **Retried once** (2 attempts): connection reset, DNS failure, TLS handshake
    failure, `502`, `503`, `504`, `500`.
  - **Not retried** (exactly 1 attempt): `400`, `401`, `403`, `404`, `429`, and a
    malformed/non-conforming policy response.
  - A first attempt that fails transiently and a second that succeeds returns the
    decision and records **no** breaker failure.
  - `TIMEOUT` with insufficient remaining budget does **not** start a second
    attempt and surfaces as `DEADLINE`.
- **Breaker accounting (D8)** — one logical evaluation that makes two attempts and
  fails increments the failure count by **exactly 1**. Five consecutive failed
  requests open the breaker; four do not. A retry-then-success counts as a
  success. This is the test that fails if `_recordFailure()` is ever moved back
  into the attempt loop.
- **`decision_id` traceability (D8)** — captured and propagated on **ALLOW and
  DENY alike**: present in `msg.opa.decisionId`, present as a flat `decisionId`
  field in the `opa_policy_check` record, and present in the admin test route's
  response. Absent (not `null`) when OPA supplies none, and absent on a cache hit
  where `cached === true`. A test asserting that authorization behaviour is
  **identical** with and without `decision_id` present, so nothing can come to
  depend on it.
- **Policy-level scope tests** (`opa test`, against `gateway.rego`): a request
  whose `input.token.scope` lacks a required scope is **denied**; the same
  request with the scope present is **allowed**; a request with `token` **omitted
  entirely** is denied; and a token whose `scope` claim is **missing** is denied
  rather than accidentally satisfying a subset test.
- **Policy** — `opa test policies/templates/ -v` as an npm script and a CI step;
  add `policies/templates/tests/` to the `package.json` `files` allowlist.
- **E2E** — **fix the harness first**: `tests/e2e/opa-integration.test.js` runs
  `docker compose --profile nodered`, which **no service declares**
  (`tests/e2e/docker-compose.yml:85,178`), so it starts zero containers; and
  `tests/e2e/policies/authz.rego:16` is `package authz` while the flow targets
  `/v1/data/api/authz`. Today the test contacts OPA exactly once, for `GET /health`
  (`:363`), and asserts against JS function nodes that simulate policy in-process.
  It must become a real enforcement test. The compose file keeps running a
  **containerised OPA as a test fixture** — that is a harness convenience, not the
  deployment topology, and the e2e README must say so explicitly so nobody reads
  `tests/e2e/docker-compose.yml` as a reference architecture. The suite should
  additionally cover the D1/D7 paths that only exist against a remote service:
  bearer token rejected (`OPA_HTTP_401` → 503), TLS/certificate failure
  (`NETWORK` → 503), and OPA unreachable (breaker opens, then recovers).

## Implementation phases

**Phase 0 — `lib/opa-client.js` corrections (D8).** These land first, with their
own tests, because everything above them assumes the decision path behaves:

1. **Retry classification** in `_evaluateWithRetry` (`lib/opa-client.js:493-534`):
   an `isRetryable(err)` predicate implementing the classification table, plus a
   remaining-budget check before starting an attempt.
2. **Per-logical-evaluation failure accounting**: move `_recordFailure()` out of
   the attempt loop (`:519`) so one `evaluate()` records at most one failure, and
   a retry-then-success records a success.
3. **`decision_id` capture** in `evaluate()` (`:583-587`), which currently
   discards everything but `response.result` — the body is already available from
   `_makeRequest` (`:473`) via `_evaluateWithRetry` (`:509`).

Items 1 and 2 change behaviour, so `tests/unit/opa-client_spec.js` gains cases and
some existing ones will need their expectations updated; item 3 is additive and
the existing 57 tests assert with `should.have.property` rather than `deepEqual`,
so it breaks none of them.

**Phase 1 — enforcement is live and on by default.** `lib/metrics-collector.js:409`
fix → `opaMode`/`opaFailOpen`/`opaDeadline`/breaker settings on `apigw-config`
runtime + editor → **`opaToken` credential + `fetchFn` bearer wrapper + the
`https`/token validation checks** (mandatory under D7, so it cannot be deferred) →
replace the `nodes/api-config.js:172` warn → `initializeOpaClient()` +
`buildOpaInput()` + `createOpaMiddleware()` + `resolveOpaSettings()` +
`preHandler` array + fast-path guard fix → **skip the in-flow scope check at
`nodes/api-endpoint.js:1189` whenever OPA is active for that endpoint (D6)** →
teardown → `msg.opa` **including `decisionId`** → `opa_policy_check` log with a
flat `decisionId` field → admin test route
+ Test button → unit tests, including the single-authority assertions → ship
`policies/templates/gateway.rego` as a **reference policy** — its rule implements
scope authorization from `input.endpoint.requiredScopes` against
`input.token.scope`, so a deployment that adopts it reproduces the old behaviour
out of the box, and it gives the e2e harness and the example flows something
concrete to evaluate against — fix both example flows, `README`, `CHANGELOG`,
`policies/templates/README.md:219-222`.

**Phase 1 also has an out-of-repo prerequisite** (D1): obtain the policy path and
a bearer token for this gateway, and settle the QPS/latency expectations,
**decision logging** (without it `decision_id` is never emitted and end-to-end
correlation is unavailable) and `decision_logs` masking, with whoever administers
the central OPA. None of that is code, and all of it blocks pointing production
traffic at the service.

**Phase 2 — per-endpoint control.** `apigw-endpoint` runtime reads + editor
section + `nodes/api-server.html:298-355` importer literal → **the Help &
examples panel and the authorization-authority notice in the Authorization
block (D6)** → activate `resolveOpaSettings()` overrides and the multi-client map
→ `x-opa-policy` OpenAPI extension alongside the existing `x-rate-limit` /
`x-cache` precedent → e2e enforcement test.

All three phases may ship in the same release. The split is about reviewable units
of work, not about staging the enforcement default — Phase 1 already enforces, and
Phase 0 is a prerequisite for it rather than a separate deliverable.

## Open items and follow-up tasks

1. Resource resolution, so `abac.rego` / `ownership.rego` become usable.
2. Obligations enforcement (`time-based.rego:520` `rate_limits`).
3. In-flight request coalescing + a token bucket ahead of the OPA call — both are
   protections for the **shared** service, so they matter more under D1 than they
   would against a dedicated instance.
4. **Serve-stale-on-error**: allow an expired cache entry to satisfy a request
   when OPA is unreachable, bounded by a separate max-stale window. This is the
   only mechanism that would let a warm gateway ride out a short central-OPA
   outage; the client has no such path today (`lib/opa-client.js:296-298`).
5. Long-term disposition of `requiredScopes` on OPA-active endpoints: keep it
   permanently as declarative policy context, or remove it from those dialogs
   entirely (D6). Not urgent — it is inert on the OPA path either way.
6. **Rotation of the gateway's `opaToken`** (D7): how the service credential is
   refreshed without a Node-RED redeploy, and what the gateway does on
   `OPA_HTTP_401`. Note this is entirely independent of user-token lifecycle,
   which is the identity provider's concern and unchanged by this work.
   *Alternative service-authentication mechanisms are **not** follow-up items —
   see D7 and D8.*
7. A `clearCache` admin route wired to a bundle-status poll.
8. Retroactively correct **`task-042` AC#3**, and amend **`task-064` AC#9** so
   its mandated input shape matches the canonical document above — the input
   contract is a technical requirement; the policy path it is queried at is not
   this document's to specify.

## Definition of done

1. Ticking `opaEnabled` on a fresh config node, with a valid policy path and no
   other change, **denies a request the policy denies** — no second setting
   required.
2. A policy-denied request **never reaches `endpointNode.receive()`**.
3. Selecting `monitor` makes the same request succeed, with
   `msg.opa.allowed === false` and a warning that requests are not authorized.
4. An undefined policy path yields **503 + `node.error`**, never a silent 403,
   and the poisoned cache entry is cleared.
5. Exactly **one** `opa_policy_check` record per request, and **no**
   `authorization_check` record for an OPA-active endpoint — one authority, one
   decision, one log line.
6. An OPA policy **denies** a request whose `input.token.scope` is missing a
   required scope, and **allows** the same request once the scope is present —
   with no change to the endpoint's `requiredScopes` field in either case.
7. An endpoint with `requiredScopes` set and OPA active returns **200** when the
   policy allows, even though the token lacks the declared scope: the gateway
   does not repeat the scope check.
8. `token` is **absent** — not `null` — from the input of an anonymous request,
   and a policy that dereferences `input.token.scope` denies that request rather
   than erroring.
9. The **Help & examples** panel opens from the Policy (OPA) section and shows
   the canonical input shape plus all seven documented Rego patterns, each
   copyable.
10. Every request to the central OPA — **decisions and the health check alike** —
   carries the **gateway's** `opaToken` over TLS; a non-`https` URL or a missing
   token is warned about at startup.
11. **The user's token is never the OPA request's credential.** The outbound
   `Authorization` header equals `Bearer <opaToken>` for authenticated, anonymous
   and bogus-token requests alike, and the OPA call is made with the gateway
   credential even when the caller sent no `Authorization` header at all.
12. **OPA is invisible to API consumers.** Enabling OPA changes no part of how a
   client authenticates: same request contract, same 401 for a bad user token, no
   new headers.
13. An OPA that rejects our token (`OPA_HTTP_401`) and an OPA that is unreachable
   (`NETWORK`/`CIRCUIT_OPEN`) both yield **503**, are distinguishable in logs and
   metrics, and neither is reported as a policy denial.
14. **Retry classification holds**: a `404`, `401` or malformed policy response
   produces **exactly one** OPA attempt; a connection reset or a `503` from OPA
   produces two; and a `TIMEOUT` with no remaining budget does not start a second.
15. **Breaker accounting is per logical evaluation**: one failed request that made
   two attempts increments the failure count by one, and five consecutive failed
   requests — not fewer — open the breaker.
16. **`decision_id` is captured and observable**: present on both ALLOW and DENY
   in `msg.opa.decisionId`, as a flat `decisionId` field in the `opa_policy_check`
   log record, and in the admin test route response; absent on a cache hit; and
   authorization behaviour is provably identical whether or not OPA supplies one.
17. The `nodes/api-config.js:172` warn is gone, and `CHANGELOG.md:84-85` no longer
   claims enforcement is absent.
18. Both shipped OPA example flows produce real 200/403 against
   `policies/templates/gateway.rego` using the documented test harness.
19. `opa_circuit_breaker_state` reports `1` for a half-open breaker.
20. `npm test` and `opa test policies/templates/` both pass in CI.

---

## Consequences

**Positive.** The gateway stops advertising authorization it does not perform.
`lib/opa-client.js` (756 lines, 57 tests) becomes load-bearing instead of dead
code. Four "Done" tasks become actually done. Policy decisions become visible to
flow authors as `msg.opa`, and the editor gains the one affordance that prevents
the dominant failure mode — a Test button that reports whether the policy path is
**defined**. And it costs API consumers nothing: **OPA is transparent from the
outside** (D7), so this is a deployment decision, not an API change.

**Negative / accepted.**

- **`opaEnabled: true` now denies.** A gateway whose policy path is wrong, whose
  policy is stricter than intended, or whose OPA is unreachable will reject
  traffic from the first deploy. That is the intended semantics (D5), and the
  editor Test button plus the `POLICY_UNDEFINED` → 503 + page path (D4, error
  taxonomy) exist precisely to catch those cases — the first before deploy, the
  second immediately after.
- **`monitor` is an opt-out of protection.** Anyone who selects it has an
  unauthorized gateway; the UI and the runtime log say so in amber, and it is not
  a mode to leave on.
- **Two of five advertised templates are demoted to reference-only** until
  resource resolution lands (D8).
- **Cached allows are not individually auditable.** `decision_id` traceability is
  in v1 (D8), so every decision that reaches OPA can be correlated with the
  central decision log — but a cache hit made no decision and so has no
  identifier. High-assurance deployments must run with `opaCacheTTL: 0` and accept
  both the latency and the extra load that places on the shared OPA. Correlation
  additionally depends on the OPA administrator having decision logging enabled;
  we cannot guarantee it from this side.
- **The gateway takes on a hard external availability dependency it does not
  own** (D1). Under fail-closed, a central-OPA outage is a simultaneous outage of
  every protected route, and the cache does not ride it out — entries expire and
  the next request 503s. This is the central trade of this decision: correct
  authorization semantics bought with an availability coupling. It must be
  alerted on (observability), capacity-planned with the OPA operator
  (performance budget), and `opaFailOpen` exists as the deliberate,
  documented-as-unsafe escape hatch for anyone who chooses availability over
  enforcement.
- **We are now a tenant on someone else's service.** Our traffic and our
  stampedes are shared, our policy path is assigned to us rather than chosen by
  us, incidents may originate elsewhere, and our JWT claims land in a decision log
  we do not administer.
- **Every request adds a network round trip** on a cache miss, and the cache is
  per-token — so service accounts fetching a token per call get a 0% hit rate and
  one OPA call per request.
- **Two servers sharing one config node get two clients and two caches** (D3),
  halving the hit rate and doubling our load on the shared OPA.
- **The gateway now holds a second, long-lived service credential** (D7). TLS and
  `opaToken` are required configuration, so enabling OPA is no longer a one-field
  change: a credential must be provisioned centrally first, it is a secret to
  store and rotate, and its rotation is an open item. This is the cost of keeping
  the gateway's identity separate from the user's — and it is the right cost.
- Config surface grows by ~15 keys on `apigw-config` and 4 on `apigw-endpoint`,
  in a dialog with no tabs or collapsing affordance. Phase 1 deliberately adds
  only the keys that change behaviour.
- **Authorization moves out of the codebase and into policy** (D6). That is the
  point, but it is a real shift: an endpoint's access rules are no longer
  readable in the Node-RED dialog, and reviewing them means reading Rego in
  another repository. The Help & examples panel and the Preview button exist to
  soften that, not to eliminate it.
- **A `requiredScopes` value on an OPA-active endpoint no longer enforces
  anything.** It is passed to the policy as context and is otherwise inert. The
  amber notice in the Authorization section is what stops that from being a
  silent surprise; without it this would be the single most likely
  misunderstanding of the whole feature.

**Neutral.** This decision does not change **user authentication in any way** —
whether OPA is enabled or disabled, the API client authenticates to the gateway
exactly as it does today, and the gateway verifies the session/JWT exactly as it
does today. Nor does it change the Keycloak integration, `lib/authorization.js`
itself, `requiredScopes` behaviour on endpoints where OPA is not active, or any
route behaviour when `opaEnabled` is false — which is the default.

## Related files

- `lib/opa-client.js` — the OPA client; unwired today, and **modified in v1**
  (D8): retry classification, per-logical-evaluation failure accounting,
  `decision_id` capture
- `lib/opa-input.js` *(new)* — canonical input builder, shared by runtime and the test route
- `lib/metrics-collector.js` — `:409` half-open mapping fix
- `lib/health-check.js` — `:472` `createOpaHealthCheck`, to be re-pointed at the live client
- `lib/authorization.js` — `requiredScopes` checks; **unchanged, and not used on
  the OPA path** (D6)
- `nodes/api-config.js` / `.html` — OPA connection settings, credential, defaults
- `nodes/api-server.js` / `.html` — client lifecycle, `preHandler` seam, admin test route
- `nodes/api-endpoint.js` / `.html` — per-endpoint overrides, `msg.opa`, help
- `resources/api-endpoint-editor.js` — `parseFieldMappings` / `validateFieldMappings` / `renderMappingBadges` reuse
- `policies/templates/` — five templates + `gateway.rego` *(new)* + `README.md`
- `examples/opa-protected-api.json`, `examples/full-stack-api.json` — both broken, both rewritten
- `tests/e2e/docker-compose.yml`, `tests/e2e/opa-integration.test.js` — profile + package fixes
- `backlog/docs/doc-005 - HOWTO-Run-OPA-(Open-Policy-Agent)-in-Docker-with-Policy-Provisioning.md`
