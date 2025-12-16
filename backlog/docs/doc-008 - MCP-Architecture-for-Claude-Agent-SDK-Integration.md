---
id: doc-008
title: MCP Architecture for Claude Agent SDK Integration
type: other
created_date: '2025-12-10 17:59'
updated_date: '2025-12-10 18:02'
---
# MCP Architecture for Claude Agent SDK Integration

## Overview

This document describes the architectural decision to use **Model Context Protocol (MCP) servers** as the integration layer between Claude Agent SDK and external systems (SQL Server, OPA) rather than custom in-process tools.

---

## What is MCP?

**Model Context Protocol (MCP)** is an open standard created by Anthropic that enables seamless interaction between AI agents and external resources. Think of it as a **"USB-C for AI"** — a standardized way to connect AI applications to databases, APIs, and services.

### Key Components

| Component | Description |
|-----------|-------------|
| **MCP Server** | Exposes tools and resources to AI clients |
| **MCP Client** | Connects to servers (Claude Desktop, Code, Agent SDK) |
| **Tools** | Functions callable by Claude (query, validate, deploy) |
| **Resources** | Read-only data exposed to Claude (schemas, configs) |
| **Transport** | Communication layer (stdio, HTTP, SSE) |

---

## Architecture Decision

### Before: Custom SDK Tools (Rejected)

```
┌────────────────────────────────────────────────┐
│           Claude Agent SDK Application          │
├────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐            │
│  │ Custom DB    │  │ Custom OPA   │            │
│  │ Tool (mssql) │  │ Tool (fetch) │            │
│  └──────┬───────┘  └──────┬───────┘            │
│         │                 │                     │
│         ▼                 ▼                     │
│    SQL Server          OPA Server              │
└────────────────────────────────────────────────┘

Problems:
- Tools tightly coupled to application
- Not reusable across Claude Desktop/Code/Web
- Credentials in same process
- No standardization
```

### After: MCP Server Architecture (Selected)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Developer Machine                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Claude Code / Desktop / Agent SDK            │   │
│  │                                                           │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │              MCP Client (built into SDK)             │ │   │
│  │  └─────────────────┬───────────────────┬───────────────┘ │   │
│  └────────────────────┼───────────────────┼─────────────────┘   │
│                       │ stdio             │ stdio                │
│           ┌───────────┴───────┐   ┌───────┴───────────┐         │
│           ▼                   │   │                   ▼         │
│  ┌─────────────────┐          │   │          ┌─────────────────┐│
│  │ MSSQL MCP Server│          │   │          │  OPA MCP Server ││
│  │ (node process)  │          │   │          │  (node process) ││
│  │ task-067        │          │   │          │  task-068       ││
│  └────────┬────────┘          │   │          └────────┬────────┘│
│           │                   │   │                   │         │
│           │ localhost:1433    │   │   localhost:8181  │         │
│           │                   │   │                   │         │
│  ┌────────┴───────────────────┴───┴───────────────────┴────────┐│
│  │           Docker Stack (task-053 - Shared Namespace)         ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │                 network-base (alpine)                    │││
│  │  │                 Ports: 8080, 8181, 1433                  │││
│  │  └─────────────────────────────────────────────────────────┘││
│  │         │                │                │                  ││
│  │  ┌──────┴─────┐   ┌──────┴─────┐   ┌──────┴─────┐           ││
│  │  │ SQL Server │   │    OPA     │   │  Keycloak  │           ││
│  │  │   :1433    │   │   :8181    │   │   :8080    │           ││
│  │  │ (profile)  │   │            │   │            │           ││
│  │  └────────────┘   └────────────┘   └────────────┘           ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Key Points:**
- MCP servers run as **local Node.js processes** on the developer machine
- They communicate with Claude via **stdio** (not network)
- They connect to services running in Docker via **localhost:PORT**
- Docker stack uses **shared network namespace** per task-053 architecture

---

## Benefits of MCP Architecture

### 1. Reusability Across Platforms

The same MCP servers work with:
- **Claude Desktop** - Local AI assistant
- **Claude Code** - CLI development tool
- **Claude Web** - Browser-based Claude
- **Custom Agent SDK apps** - Your Node-RED integration
- **Third-party clients** - Any MCP-compatible client

### 2. Security Isolation

| Aspect | Custom Tools | MCP Servers |
|--------|--------------|-------------|
| Credentials | In application process | Isolated subprocess |
| Crash impact | Crashes entire app | Only server restarts |
| Permission model | Code-level | Environment-level |
| Audit | Difficult | Separate process logs |

### 3. Standardized Interface

MCP provides consistent patterns for:
- Tool definition with JSON Schema
- Error responses
- Resource URIs
- Permission handling

### 4. Ecosystem Leverage

Available MCP servers we can use or reference:
- **Microsoft MSSQL MCP Server** (official preview)
- **PostgreSQL MCP Server** (Azure)
- **GitHub MCP Server**
- **Slack MCP Server**
- **Filesystem MCP Server**

### 5. Team Collaboration

```json
// .mcp.json - Shared across team via git
{
  "mcpServers": {
    "sql-server": {
      "command": "node",
      "args": ["./mcp-servers/mssql/dist/index.js"],
      "env": {
        "SQL_SERVER": "localhost",
        "SQL_PORT": "1433",
        "SQL_DATABASE": "${DB_NAME}"
      }
    },
    "opa": {
      "command": "node", 
      "args": ["./mcp-servers/opa/dist/index.js"],
      "env": {
        "OPA_URL": "http://localhost:8181"
      }
    }
  }
}
```

---

## Implementation Strategy

### Phase 1: MSSQL MCP Server (task-067)

**Option A: Use Microsoft's Official Server (Recommended)**
- Repository: `Azure-Samples/SQL-AI-samples/MssqlMcp/Node`
- Already has 8 tools implemented
- Active development by Microsoft
- Supports Azure SQL, on-prem, Fabric

**Option B: Use Community Python Package**
- `pip install microsoft_sql_server_mcp`
- Simpler setup
- Good for evaluation

**Option C: Build Custom**
- Full control over tools
- Can integrate project-specific features
- More maintenance burden

### Phase 2: OPA MCP Server (task-068)

**Build Custom** (no existing implementations)
- Use `@modelcontextprotocol/sdk` for Node.js
- Wrap existing `lib/opa-client.js` functionality
- Add Rego validation via OPA compile endpoint

### Phase 3: Integration with AI Modules

Update existing tasks to use MCP:

| Task | Change |
|------|--------|
| task-063 (AI Schema) | Use MCP `list_tables`, `describe_table` instead of custom tools |
| task-064 (AI Policy) | Use MCP `validate_rego`, `deploy_policy` instead of direct OPA calls |

---

## MCP Server Structure

MCP servers are **local Node.js applications** that run on the developer's machine:

```
mcp-servers/
├── mssql/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts          # Entry point
│   │   ├── server.ts         # MCP server setup
│   │   ├── tools/
│   │   │   ├── query.ts      # execute_query tool
│   │   │   ├── schema.ts     # list_tables, describe_table
│   │   │   └── data.ts       # read_data, insert_data
│   │   ├── resources/
│   │   │   └── schema.ts     # db://schema resource
│   │   └── utils/
│   │       └── connection.ts # Connection pool
│   └── dist/
│
├── opa/
│   ├── package.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── tools/
│   │   │   ├── evaluate.ts   # evaluate_policy
│   │   │   ├── validate.ts   # validate_rego
│   │   │   ├── deploy.ts     # deploy_policy
│   │   │   └── test.ts       # run_policy_tests
│   │   └── resources/
│   │       └── policies.ts   # opa://policies
│   └── dist/
│
└── shared/
    ├── logger.ts             # Structured logging (never use console.log!)
    └── errors.ts             # Standard error handling
```

---

## Integration with Existing Docker Stack (task-053)

The project already has a Docker Compose development stack with shared network namespace architecture. MCP servers connect to these services via localhost.

### Existing Docker Stack (tests/e2e/docker-compose.yml)

```yaml
# Shared Container Network Namespace Architecture
# All services communicate via localhost:PORT

services:
  network-base:
    image: alpine:latest
    container_name: api-gateway-network
    command: sleep infinity
    ports:
      - "8080:8080"   # Keycloak
      - "8181:8181"   # OPA
      - "1433:1433"   # SQL Server (optional profile)
      - "1880:1880"   # Node-RED (optional profile)

  keycloak:
    image: quay.io/keycloak/keycloak:26-latest
    network_mode: "container:api-gateway-network"
    # ... (see task-053 for full config)

  opa:
    image: openpolicyagent/opa:latest
    network_mode: "container:api-gateway-network"
    # ... (see task-053 for full config)

  db:
    image: mcr.microsoft.com/mssql/server:2022-latest
    network_mode: "container:api-gateway-network"
    profiles: [sqlserver]
    # ... (see task-053 for full config)
```

### MCP Server Configuration

MCP servers run **outside Docker** and connect to services via the exposed ports:

```bash
# Start Docker stack first
cd tests/e2e
docker compose --profile sqlserver up -d

# MCP servers connect to localhost:PORT
# (ports exposed by network-base container)
```

### Claude Code Configuration

```bash
# Add MSSQL MCP server (connects to Docker SQL Server)
claude mcp add sql-server \
  --transport stdio \
  --env SQL_SERVER=localhost \
  --env SQL_PORT=1433 \
  --env SQL_DATABASE=testdb \
  -- node ./mcp-servers/mssql/dist/index.js

# Add OPA MCP server (connects to Docker OPA)
claude mcp add opa \
  --transport stdio \
  --env OPA_URL=http://localhost:8181 \
  -- node ./mcp-servers/opa/dist/index.js
```

---

## Usage in Claude Agent SDK

```javascript
const { query } = require('@anthropic-ai/claude-agent-sdk');

// Claude automatically has access to MCP tools when configured
for await (const message of query({
  prompt: `
    Analyze the database schema and suggest improvements.
    Use the sql-server MCP tools to introspect the database.
  `,
  options: {
    // MCP servers configured in .mcp.json are automatically available
    model: 'claude-sonnet-4-5-20250514'
  }
})) {
  // Claude will use MCP tools: list_tables, describe_table, etc.
  console.log(message);
}
```

---

## Security Considerations

### Read-Only by Default

```javascript
// MCP server configuration
const READONLY_MODE = process.env.READONLY !== 'false';

if (READONLY_MODE) {
  // Only expose safe tools
  server.tool('list_tables', ...);
  server.tool('describe_table', ...);
  server.tool('read_data', ...);
} else {
  // Include write tools (requires explicit opt-in)
  server.tool('execute_query', ...);
  server.tool('insert_data', ...);
}
```

### Credential Isolation

```bash
# Credentials only in MCP server environment
# Never passed to Claude or logged
SQL_PASSWORD=secret  # Only MCP server sees this
```

### Input Validation

```javascript
// Always validate and sanitize inputs
server.tool('read_data', schema, async (input) => {
  // Validate table name against whitelist
  if (!ALLOWED_TABLES.includes(input.table)) {
    return { isError: true, content: [{ type: 'text', text: 'Table not allowed' }] };
  }
  // Use parameterized queries
  return await db.query('SELECT * FROM ?? WHERE ??', [input.table, input.conditions]);
});
```

---

## Why MCP Servers Are NOT Docker Services

MCP servers should run as **local processes**, not Docker containers, because:

1. **stdio transport**: MCP uses stdin/stdout for communication with Claude. Dockerizing would complicate this.

2. **On-demand startup**: Claude starts MCP servers when needed. Docker adds unnecessary overhead.

3. **Developer experience**: MCP servers are development tools, not services. They should be as lightweight as `npx`.

4. **Already have services**: SQL Server and OPA are already in Docker (task-053). MCP servers just need to connect to them.

---

## Related Tasks

| Task | Description | Priority |
|------|-------------|----------|
| task-053 | Docker Compose Development Stack | HIGH (Done) |
| task-067 | Integrate MSSQL MCP Server | HIGH |
| task-068 | Create OPA MCP Server | MEDIUM |
| task-069 | Create MCP Development Skills | MEDIUM |
| task-063 | AI Schema Assistant (uses task-067) | HIGH |
| task-064 | AI Policy Generator (uses task-068) | HIGH |

---

## References

- [Microsoft MSSQL MCP Server (Preview)](https://devblogs.microsoft.com/azure-sql/introducing-mssql-mcp-server/)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Building MCP Servers Guide](https://modelcontextprotocol.io/quickstart/server)
- [Claude Code MCP Documentation](https://docs.anthropic.com/en/docs/claude-code/mcp)
