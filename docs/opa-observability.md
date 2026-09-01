# OPA policy enforcement — observability

This document describes the signals the gateway emits for OPA policy enforcement
and the alerts you should run against them. It accompanies the OPA enforcement
feature (see `backlog/decisions/decision-001`).

## The `opa_policy_check` structured log

Exactly **one** `opa_policy_check` record is emitted per OPA-active request
(and no `authorization_check` record — under single authority the policy is the
only authority). Fields are flat/top-level so they are greppable and indexable:

| Field | Meaning |
|---|---|
| `allowed` | boolean — the authorization outcome |
| `enforced` | boolean — true in `enforce` mode, false in `monitor` |
| `mode` | `enforce` \| `monitor` |
| `policyPath` | the resolved OPA document path |
| `reason` | the policy reason, or the error-taxonomy code for a non-decision |
| `cached` | whether the decision was served from the local cache |
| `durationMs` | wall-clock time for the evaluation |
| `decisionId` | OPA's `decision_id`, present on a fresh decision, **absent on a cache hit** |
| `method`, `path`, `route`, `sub` | request context |

The **input document is never logged** (it carries verified JWT claims).

## The error taxonomy

One stable code identifies every non-decision. The **same code** appears in the
`503` body `details.reason`, the `opa_policy_check` log `reason`, the Prometheus
`reason` label and `msg.opa.error.code`, so a denial and an outage are never
conflated:

| Code | Cause | Retryable |
|---|---|---|
| `TIMEOUT` | a per-attempt request timed out | yes (within the deadline) |
| `DEADLINE` | the overall `opaDeadline` was exceeded | no |
| `CIRCUIT_OPEN` | the breaker is open (OPA repeatedly failing) | no |
| `NETWORK` | transport error (connection refused/reset, DNS, TLS) | yes |
| `OPA_HTTP_401` / `OPA_HTTP_403` | **our gateway service token** was rejected | no |
| `OPA_HTTP_404` | the policy path does not exist | no |
| `OPA_HTTP_429` | OPA throttled us | no |
| `OPA_HTTP_5xx` | OPA server-side failure | yes |
| `POLICY_UNDEFINED` | the path returned an undefined document (HTTP 200 `{}`) | no |
| `CONFIG_INVALID` | invalid config or a rejected input mapping — never reached the wire | no |

A non-decision yields **503** (fail-closed) — or **200** under `opaFailOpen` — and
is metered as `result="error"`, never as `result="deny"`. A policy denial yields
**403** (or **401** when the gateway's own state says unauthenticated and the
policy reason is `missing_token`/`token_expired`).

## Prometheus metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `api_gateway_opa_policy_duration_ms` | histogram | `policy`, `result` | evaluation latency; `result` = `allow`\|`deny`\|`error` |
| `api_gateway_opa_operations_total` | counter | `operation`, `result`, `reason` | decision counter; `reason` carries the policy reason or the taxonomy code |
| `api_gateway_opa_cache_hits_total` / `..._misses_total` | counter | — | cache hit rate |
| `api_gateway_opa_circuit_breaker_state` | gauge | — | `0`=closed, `1`=half-open, `2`=open |

## Required alerts

Run at least the following alerts against the metrics above:

1. **Breaker open** — `api_gateway_opa_circuit_breaker_state == 2` for more than a
   minute. OPA is unreachable/failing and every protected route is failing closed.
2. **Deny-rate step change** — a sudden change in the ratio of
   `result="deny"` to `result="allow"` in `opa_operations_total`. A new policy or a
   bad bundle usually shows here first.
3. **`POLICY_UNDEFINED` > 0 pages** — any `reason="POLICY_UNDEFINED"` is a
   configuration error (wrong/typo'd policy path); it should never occur in a
   healthy deployment.
4. **p99 latency vs budget** — `api_gateway_opa_policy_duration_ms` p99 approaching
   `opaDeadline`. Evaluations are about to start being cut off.
5. **Sustained `NETWORK`/`TIMEOUT`/`DEADLINE` pages** — a run of these codes means
   OPA is degraded even if the breaker has not yet opened.
6. **`OPA_HTTP_401`/`OPA_HTTP_403` pages** — our **gateway service token** is wrong,
   expired or revoked. This is our misconfiguration, not the caller's — it must
   never be read as a user-facing 403.
7. **Cache hit-rate drop** — a fall in the hit rate (from the cache counters)
   raises our load on the shared OPA and our own tail latency; investigate token
   churn or an undersized `opaCacheMaxSize`.
