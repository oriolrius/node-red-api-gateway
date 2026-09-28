---
id: TASK-092
title: 'Metrics endpoint security: auth modes, IP allowlist, opt-in (GH #5)'
status: Done
assignee: []
created_date: '2026-09-28 16:54'
updated_date: '2026-09-28 17:03'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fixes GitHub issue #5: /metrics enabled by default and always unauthenticated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 metricsAuth modes: none (explicitly supported, public), bearer (static token), basic (user/password), oauth2 (Keycloak token + optional required scopes)
- [x] #2 Optional metricsAllowedIps IP/CIDR allowlist (403 otherwise)
- [x] #3 Metrics opt-in for new nodes (editor default off; runtime on only when metricsEnabled === true)
- [x] #4 Help text and README document behaviour
- [x] #5 Unit tests plus e2e covering every mode
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New lib/metrics-access.js (parseMetricsAccess/createMetricsGuard, net.BlockList allowlist, constant-time compares). apigw-server: metricsAuth none|bearer|basic|oauth2, credentials metricsToken/metricsUsername/metricsPassword, metricsRequiredScopes/metricsScopeOperator, metricsAllowedIps; misconfig fails closed (503). metricsEnabled now === true (editor default false). Token scope extraction factored into collectTokenScopes() shared with endpoint auth. E2E uses real RS256 JWTs against a local JWKS server.
<!-- SECTION:NOTES:END -->
