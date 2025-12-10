---
id: task-068
title: Create OPA MCP Server for Policy Evaluation and Management
status: To Do
assignee: []
created_date: '2025-12-10 17:57'
labels:
  - infrastructure
  - mcp
  - opa
  - rego
  - ai
dependencies:
  - task-050
  - task-067
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a custom MCP server for Open Policy Agent (OPA) that exposes policy evaluation, policy management, and Rego syntax validation as MCP tools. This enables Claude Agent SDK to evaluate authorization decisions, deploy policies, run policy tests, and validate Rego syntax through a standardized MCP interface. Builds on the existing OPA client module (task-050).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Create MCP server package (mcp-servers/opa-mcp-server/) using @modelcontextprotocol/sdk
- [ ] #2 Implement tool: evaluate_policy(input) - evaluate authorization decision against current policy
- [ ] #3 Implement tool: list_policies() - list deployed policies
- [ ] #4 Implement tool: get_policy(id) - retrieve policy source code
- [ ] #5 Implement tool: deploy_policy(id, rego_code) - deploy/update a policy (requires explicit permission)
- [ ] #6 Implement tool: validate_rego(code) - validate Rego syntax without deployment
- [ ] #7 Implement tool: run_policy_tests(policy_id) - execute OPA test cases
- [ ] #8 Implement tool: explain_decision(input, policy_id) - get decision trace/explanation
- [ ] #9 Implement resource: opa://policies - list all policies as MCP resource
- [ ] #10 Add to Docker Compose development stack
- [ ] #11 Unit tests with mocked OPA server
- [ ] #12 Integration test with real OPA container
<!-- AC:END -->
