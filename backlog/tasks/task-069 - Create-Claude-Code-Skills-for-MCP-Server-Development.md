---
id: task-069
title: Create Claude Code Skills for MCP Server Development
status: To Do
assignee: []
created_date: '2025-12-10 17:58'
labels:
  - skills
  - mcp
  - documentation
  - ai
dependencies:
  - task-067
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive Claude Code skills (.claude/skills/) for MCP server development patterns. These skills will guide Claude when building, configuring, and troubleshooting MCP servers for the project. Includes patterns for TypeScript/Node.js MCP servers, tool definition best practices, resource exposure, error handling, and integration with Claude Agent SDK.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Create skill: mcp-server-development - Core patterns for building MCP servers with @modelcontextprotocol/sdk
- [ ] #2 Include references/mcp-tools.md - Tool definition patterns with Zod schemas, error handling, permission control
- [ ] #3 Include references/mcp-resources.md - Resource exposure patterns for read-only data access
- [ ] #4 Include references/mcp-transports.md - Transport configuration (stdio, HTTP, SSE) and when to use each
- [ ] #5 Include references/mcp-testing.md - Testing MCP servers with MCP Inspector and integration tests
- [ ] #6 Include references/mcp-security.md - Security best practices: credential isolation, read-only modes, input validation
- [ ] #7 Document integration patterns with existing project skills (mssql, opa, claude-agent-sdk)
- [ ] #8 Add skill to .claude/SKILLS.md registry
- [ ] #9 Include real examples from project MCP servers (task-067, task-068)
- [ ] #10 Test skill by using it to guide MCP server implementation
<!-- AC:END -->
