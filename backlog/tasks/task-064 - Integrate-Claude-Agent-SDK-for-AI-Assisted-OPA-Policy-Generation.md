---
id: task-064
title: Integrate Claude Agent SDK for AI-Assisted OPA Policy Generation
status: To Do
assignee: []
created_date: '2025-12-10 17:46'
updated_date: '2025-12-10 17:58'
labels:
  - infrastructure
  - ai
  - claude-sdk
  - opa
  - rego
dependencies:
  - task-050
  - task-055
  - task-068
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create an AI-assisted OPA policy generator module (`lib/ai-policy-generator.js`) using Claude Agent SDK. The module generates Rego policies from natural language requirements, analyzes existing policies for improvements, validates policy syntax, suggests test cases, and explains policy decisions. Integrates with the existing OPA client module for policy deployment and testing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Create AIPolicyGenerator class that uses Claude Agent SDK
- [ ] #2 Implement generatePolicy(requirements, policyType) method where policyType is one of: rbac, abac, resource-ownership, time-based, audit
- [ ] #3 Implement analyzePolicy(regoCode) method that reviews existing policies for security issues, optimization opportunities, and best practices
- [ ] #4 Implement explainPolicy(regoCode, inputExample) method that explains what a policy does in plain language with example evaluations
- [ ] #5 Implement suggestTestCases(regoCode) method that generates OPA test cases (test_* rules) for the policy
- [ ] #6 Implement validateSyntax(regoCode) method that checks Rego syntax using OPA's /v1/compile endpoint before deployment
- [ ] #7 Support policy templates as context (from task-055) to guide generation style
- [ ] #8 Implement interactive refinement: user describes requirement → Claude generates → user reviews → Claude refines
- [ ] #9 Generate policies that follow project conventions: package naming (api.gateway.*), standard input structure ({user, method, path, body})
- [ ] #10 Support streaming responses for real-time policy generation feedback
- [ ] #11 Unit tests with mocked Claude and OPA responses
- [ ] #12 Integration test deploying generated policy to OPA and validating evaluation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Updated architecture: Use OPA MCP Server (task-068) for policy evaluation, validation, and deployment instead of direct OPA API calls. The AIPolicyGenerator will use MCP tools (validate_rego, deploy_policy, run_policy_tests, explain_decision) for all OPA interactions.
<!-- SECTION:NOTES:END -->
