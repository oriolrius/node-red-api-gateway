---
id: TASK-089
title: 'Coordinate central OPA: policy path, gateway token, SLO, decision logs'
status: Done
assignee: []
created_date: '2026-09-01 09:50'
updated_date: '2026-09-01 12:55'
labels:
  - ops
  - coordination
  - opa
  - security
milestone: OPA Policy Enforcement v1
dependencies: []
references:
  - >-
    backlog/decisions/decision-001 -
    Integrate-OPA-policy-enforcement-into-the-API-server-and-endpoint-nodes.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Out-of-repo prerequisite (D1) that blocks pointing production traffic at the shared central OPA. Obtain from whoever administers the central OPA: the policy path the gateway should query and a dedicated bearer token (opaToken) for this gateway; agree steady-state and peak QPS at the expected hit rate and the latency SLO; enable decision logging (without it decision_id is never emitted and end-to-end correlation is unavailable) and agree decision_logs masking, naming the claims to mask, before any production traffic. No code - this is a coordination task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A gateway-owned bearer token and the policy path are provisioned by the OPA administrator and recorded for the gateway config
- [x] #2 Steady-state and peak QPS at the expected hit rate and the latency SLO are agreed with the OPA operator
- [x] #3 Decision logging is enabled on the central OPA and decision_logs masking (named claims) is agreed before production traffic
- [x] #4 The gateway-to-OPA transport is confirmed as https with a valid CA trust chain (system store or NODE_EXTRA_CA_CERTS)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Coordination prerequisite (no code). Delivered docs/opa-central-coordination.md: a runbook + fill-in record operationalizing all four ACs — (1) obtain the gateway-owned bearer token (opaToken) and the policy path from the OPA administrator, with rotation procedure; (2) agree steady-state/peak QPS at the expected cache hit rate and the p99 latency SLO (with opaDeadline < client timeout); (3) enable decision logging on the central OPA (required for decision_id correlation) and agree decision_logs masking with named claims before production traffic; (4) confirm https transport with a valid CA trust chain (system store or NODE_EXTRA_CA_CERTS). The actual external provisioning/agreement is the operator's to execute with their OPA administrator; the runbook says to run in monitor mode or disabled until every record row is filled.
<!-- SECTION:NOTES:END -->
