# Central OPA coordination runbook (production prerequisite)

The gateway talks to a **central, shared OPA service** (decision-001 D1). Before
you point production traffic at it, these items must be obtained from, and
agreed with, whoever administers that OPA. This is an out-of-repo prerequisite —
no gateway code depends on completing it, but **enforcement must not be enabled
in production until it is done**.

Work through the checklist, then fill in the record at the bottom and keep it
with your deployment configuration.

## Checklist

### 1. Policy path and gateway token (D7)

- [ ] The OPA administrator provisions a **dedicated bearer token owned by this
      gateway** (`opaToken`). It is the gateway's own service credential — not a
      user token, and not shared with any other gateway. Store it as the
      `opaToken` credential on the `apigw-config` node (never in the flow JSON).
- [ ] The administrator gives you the **policy path** the gateway should query
      (e.g. `v1/data/<package>/<rule>`). It must resolve to a document that
      returns a decision (`allowed` and, ideally, `reason`). The gateway reserves
      no namespace and prescribes none — the path is the administrator's to
      define.
- [ ] Confirm the token's rotation procedure. Rotation is an operational task
      independent of the identity provider; a rotated/revoked token surfaces as
      `OPA_HTTP_401` → **503** (our misconfiguration), never a user-facing 403.

### 2. Capacity and latency SLO

- [ ] Agree **steady-state QPS** and **peak QPS** *at the expected cache hit
      rate*. Remember the decision cache key rotates with every user-token
      refresh, so a service account fetching a token per call yields ~0% hit
      rate — size `opaCacheMaxSize` and your QPS estimate accordingly.
- [ ] Agree the **latency SLO** for a decision (p99). Keep the gateway's
      `opaDeadline` well under the gateway's own client-facing timeout, and watch
      the `api_gateway_opa_policy_duration_ms` p99 against it (see
      `docs/opa-observability.md`).
- [ ] Confirm the shared OPA has headroom for **our** load on top of every other
      project pointed at it — our load is someone else's load.

### 3. Decision logging and masking (D8)

- [ ] Ensure **decision logging is enabled** on the central OPA. Without it OPA
      emits no `decision_id`, so a gateway 403/503 cannot be correlated to the
      decision that produced it end to end.
- [ ] Agree **decision-log masking** and name the claims to mask. The gateway
      puts the full verified claim set in `input.token` as policy data; the
      central OPA's decision logs must not retain sensitive claims in the clear.
      List the masked claims explicitly before any production traffic.

### 4. Transport and trust (D1/D7)

- [ ] Confirm the gateway-to-OPA transport is **`https://`** with a valid CA
      trust chain — either the system trust store, or `NODE_EXTRA_CA_CERTS`
      pointing at the private CA bundle when OPA presents a private-CA
      certificate. `http://` is for the e2e/local harness only.

## Record (fill in and keep with your deployment config)

| Item | Value / decision | Owner | Date |
|---|---|---|---|
| Policy path | `v1/data/________/________` | | |
| Gateway token provisioned (opaToken) | yes / no (rotation: ______) | | |
| OPA URL (https) | `https://________` | | |
| CA trust | system store / `NODE_EXTRA_CA_CERTS=________` | | |
| Steady-state QPS @ hit rate | ______ QPS @ ____% | | |
| Peak QPS | ______ QPS | | |
| Latency SLO (p99) | ______ ms (opaDeadline: ______ ms) | | |
| Decision logging enabled | yes / no | | |
| Masked claims | ________________________ | | |

> Until every row is filled, run with `opaMode: monitor` (evaluate and log, never
> deny) or keep OPA disabled — do not enable `enforce` against the shared service
> without this coordination complete.
