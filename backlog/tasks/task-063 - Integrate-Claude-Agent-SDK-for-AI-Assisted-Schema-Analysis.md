---
id: task-063
title: Integrate Claude Agent SDK for AI-Assisted Schema Analysis
status: To Do
assignee: []
created_date: '2025-12-10 17:46'
updated_date: '2025-12-10 17:58'
labels:
  - infrastructure
  - ai
  - claude-sdk
  - openapi
dependencies:
  - task-061
  - task-062
  - task-067
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add @anthropic-ai/claude-agent-sdk as a project dependency and create an AI-assisted schema analysis module (`lib/ai-schema-assistant.js`). The module uses Claude to analyze extracted database schemas, suggest improvements, generate enhanced OpenAPI documentation with meaningful descriptions, infer business logic from naming conventions, and propose validation rules. Provides interactive refinement through streaming responses.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add @anthropic-ai/claude-agent-sdk and zod to package.json dependencies
- [ ] #2 Create ClaudeSchemaAssistant class with configurable model selection (opus/sonnet/haiku)
- [ ] #3 Implement analyzeSchema(schemaJson) method that returns AI-generated insights about table relationships, naming issues, missing indexes
- [ ] #4 Implement enhanceOpenApiSpec(openApiSpec, schemaJson) method that adds meaningful descriptions to paths, parameters, and schemas
- [ ] #5 Implement suggestValidations(tableSchema) method that proposes JSON Schema validations (patterns, enums, min/max) based on column names and types
- [ ] #6 Implement inferBusinessRules(schemaJson) method that identifies potential business logic (soft deletes, audit columns, status fields)
- [ ] #7 Support streaming responses for real-time UI feedback during analysis
- [ ] #8 Implement proper error handling with retry logic for API failures
- [ ] #9 Use allowedTools configuration to restrict Claude to safe read-only operations
- [ ] #10 Create secure API key management using Node-RED credentials system
- [ ] #11 Unit tests with mocked Claude responses
- [ ] #12 Example usage documentation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Updated architecture: Use MSSQL MCP Server (task-067) for database introspection instead of custom SDK tools. The ClaudeSchemaAssistant will query the database through MCP tools (list_tables, describe_table, read_data) rather than direct mssql connection.
<!-- SECTION:NOTES:END -->
