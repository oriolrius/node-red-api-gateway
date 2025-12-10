---
id: task-067
title: Integrate MSSQL MCP Server for Claude Agent Database Access
status: To Do
assignee: []
created_date: '2025-12-10 17:57'
labels:
  - infrastructure
  - mcp
  - database
  - mssql
  - ai
dependencies:
  - task-031
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Integrate an MCP (Model Context Protocol) server for SQL Server to provide Claude Agent SDK with standardized database access. Evaluate Microsoft's official MSSQL MCP Server (preview) vs community implementations. The MCP server enables Claude to query databases, introspect schemas, and validate data through a secure, isolated interface. This replaces custom database tools with a reusable, standardized solution that works across Claude Desktop, Claude Code, and custom Agent SDK applications.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Evaluate Microsoft MSSQL MCP Server (Node.js version from Azure-Samples/SQL-AI-samples) vs community alternatives (mssql-mcp-server PyPI package)
- [ ] #2 Document selection criteria and chosen implementation in backlog doc
- [ ] #3 Create MCP server configuration for the project (.mcp.json or equivalent)
- [ ] #4 Configure connection to use existing api-config database credentials
- [ ] #5 Implement read-only mode by default with explicit opt-in for write operations
- [ ] #6 Add MCP server to Docker Compose development stack (task-053)
- [ ] #7 Create wrapper module (lib/mcp-database.js) for programmatic MCP client usage from Node.js
- [ ] #8 Test MCP tools: list_tables, describe_table, read_data, execute_query
- [ ] #9 Document MCP server setup in project README
- [ ] #10 Integration test verifying Claude Agent SDK can use MCP database tools
<!-- AC:END -->
