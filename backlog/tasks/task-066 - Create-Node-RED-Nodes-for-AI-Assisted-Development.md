---
id: task-066
title: Create Node-RED Nodes for AI-Assisted Development
status: To Do
assignee: []
created_date: '2025-12-10 17:47'
labels:
  - node-red
  - ai
  - claude-sdk
  - ui
dependencies:
  - task-063
  - task-064
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create Node-RED nodes that expose Claude Agent SDK capabilities in the flow editor. Includes: ai-schema-analyzer node (analyzes connected database and outputs insights), ai-openapi-generator node (generates OpenAPI from schema with AI enhancement), ai-policy-generator node (generates OPA policies from requirements), ai-doc-generator node (generates documentation). All nodes support streaming output and integrate with existing api-config node for shared configuration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Create ai-config configuration node storing Claude API key (credentials), model selection, and common options
- [ ] #2 Create ai-schema-analyzer node: input=database config reference, output=schema analysis with AI insights
- [ ] #3 Create ai-openapi-generator node: input=schema JSON or database reference, output=enhanced OpenAPI spec (YAML/JSON selectable)
- [ ] #4 Create ai-policy-generator node: input=requirements text + policy type, output=generated Rego policy code
- [ ] #5 Create ai-doc-generator node: input=OpenAPI/schema/policy, output=generated documentation (Markdown)
- [ ] #6 All nodes display streaming progress in Node-RED debug panel
- [ ] #7 All nodes show status indicators (querying, streaming, complete, error)
- [ ] #8 HTML editor UI with proper form validation for each node type
- [ ] #9 Support msg.payload input override for dynamic prompts
- [ ] #10 Integrate with existing api-config node for database connection reuse
- [ ] #11 Unit tests using node-red-node-test-helper
- [ ] #12 Example flows demonstrating each node's capabilities
<!-- AC:END -->
