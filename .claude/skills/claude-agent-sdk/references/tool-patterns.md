# Tool Patterns

## Overview

The Claude Agent SDK provides powerful tool/function calling capabilities. Claude can use built-in tools (Read, Write, Bash, etc.) or custom tools you define.

## Built-in Tools

### Available Tools

| Tool | Description | Use Case |
|------|-------------|----------|
| `Read` | Read files | Code analysis, config reading |
| `Write` | Write files | Code generation, file creation |
| `Edit` | Edit existing files | Code modifications |
| `Bash` | Execute shell commands | Build, test, git operations |
| `Glob` | Find files by pattern | File discovery |
| `Grep` | Search file contents | Code search |
| `WebSearch` | Search the web | Research, documentation |
| `WebFetch` | Fetch web content | API calls, web scraping |
| `Task` | Launch subagent | Parallel processing |
| `TodoWrite` | Manage task lists | Progress tracking |
| `AskUserQuestion` | Interactive prompts | User input |

### Controlling Tool Access

```javascript
// Whitelist specific tools
const options = {
  allowedTools: ['Read', 'Glob', 'Grep']
};

// Blacklist specific tools
const options = {
  disallowedTools: ['Bash', 'Write', 'Edit']
};

// Combine for fine-grained control
const options = {
  allowedTools: ['Read', 'Write', 'Glob'],
  disallowedTools: ['Bash']  // Even if in allowed, this overrides
};
```

## Creating Custom Tools

### Basic Tool Definition

```javascript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const myTool = tool(
  "ToolName",           // Name (used by Claude to call it)
  "Tool description",   // Description (helps Claude understand when to use it)
  z.object({           // Input schema using Zod
    param1: z.string().describe("Description of param1"),
    param2: z.number().optional().describe("Optional parameter")
  }),
  async (args) => {    // Handler function
    // Implementation
    return {
      content: [{ type: 'text', text: 'Result' }]
    };
  }
);
```

### Tool Input Schemas

Use Zod for type-safe input validation:

```javascript
import { z } from "zod";

// String parameters
const stringParam = z.string().describe("A text value");
const enumParam = z.enum(["option1", "option2"]).describe("Select an option");
const regexParam = z.string().regex(/^[A-Z]{3}$/).describe("3-letter code");

// Number parameters
const intParam = z.number().int().describe("Integer value");
const rangeParam = z.number().min(0).max(100).describe("Percentage (0-100)");

// Boolean parameters
const flagParam = z.boolean().describe("Enable feature");

// Optional parameters
const optionalParam = z.string().optional().describe("Optional value");
const defaultParam = z.string().default("default").describe("Has default");

// Array parameters
const arrayParam = z.array(z.string()).describe("List of items");
const tupleParam = z.tuple([z.string(), z.number()]).describe("Name and age");

// Object parameters
const objectParam = z.object({
  name: z.string(),
  value: z.any()
}).describe("Key-value pair");

// Union types
const unionParam = z.union([z.string(), z.number()]).describe("String or number");
```

### Tool Return Values

```javascript
// Text result
return {
  content: [{ type: 'text', text: 'Plain text result' }]
};

// JSON result
return {
  content: [{
    type: 'text',
    text: JSON.stringify({ key: 'value' }, null, 2)
  }]
};

// Multiple content blocks
return {
  content: [
    { type: 'text', text: 'Summary: ...' },
    { type: 'text', text: 'Details: ...' }
  ]
};

// Error result
return {
  content: [{ type: 'text', text: 'Error: Something went wrong' }],
  isError: true
};
```

## Practical Tool Examples

### Database Query Tool

```javascript
const queryDatabaseTool = tool(
  "QueryDatabase",
  "Execute a SQL query against the database and return results",
  z.object({
    query: z.string().describe("SQL SELECT query to execute"),
    params: z.array(z.any()).optional().describe("Query parameters for prepared statements")
  }),
  async (args) => {
    try {
      // Validate it's a SELECT query (security)
      if (!args.query.trim().toUpperCase().startsWith('SELECT')) {
        return {
          content: [{ type: 'text', text: 'Error: Only SELECT queries are allowed' }],
          isError: true
        };
      }

      const result = await db.query(args.query, args.params || []);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            rowCount: result.rows.length,
            rows: result.rows.slice(0, 100) // Limit results
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Database error: ${error.message}` }],
        isError: true
      };
    }
  }
);
```

### HTTP Request Tool

```javascript
const httpRequestTool = tool(
  "HTTPRequest",
  "Make an HTTP request to an external API",
  z.object({
    url: z.string().url().describe("URL to request"),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET"),
    headers: z.record(z.string()).optional().describe("HTTP headers"),
    body: z.string().optional().describe("Request body (for POST/PUT)")
  }),
  async (args) => {
    try {
      const response = await fetch(args.url, {
        method: args.method,
        headers: args.headers,
        body: args.body
      });

      const contentType = response.headers.get('content-type');
      let data;

      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers),
            data
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `HTTP error: ${error.message}` }],
        isError: true
      };
    }
  }
);
```

### File Processing Tool

```javascript
const processFileTool = tool(
  "ProcessFile",
  "Process a file and extract structured data",
  z.object({
    filePath: z.string().describe("Path to the file"),
    format: z.enum(["json", "csv", "xml"]).describe("Expected file format"),
    extractFields: z.array(z.string()).optional().describe("Specific fields to extract")
  }),
  async (args) => {
    const fs = require('fs').promises;
    const path = require('path');

    try {
      // Security: validate path
      const resolvedPath = path.resolve(args.filePath);
      if (!resolvedPath.startsWith(process.cwd())) {
        return {
          content: [{ type: 'text', text: 'Error: Path outside working directory' }],
          isError: true
        };
      }

      const content = await fs.readFile(resolvedPath, 'utf-8');
      let data;

      switch (args.format) {
        case 'json':
          data = JSON.parse(content);
          break;
        case 'csv':
          data = parseCSV(content);
          break;
        case 'xml':
          data = parseXML(content);
          break;
      }

      // Extract specific fields if requested
      if (args.extractFields && Array.isArray(data)) {
        data = data.map(item =>
          args.extractFields.reduce((acc, field) => {
            acc[field] = item[field];
            return acc;
          }, {})
        );
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `File error: ${error.message}` }],
        isError: true
      };
    }
  }
);
```

### Node-RED Flow Caller Tool

```javascript
const callFlowTool = tool(
  "CallNodeREDFlow",
  "Trigger a Node-RED flow and get its response",
  z.object({
    flowName: z.string().describe("Name of the flow to trigger"),
    payload: z.any().describe("Payload to send to the flow"),
    timeout: z.number().default(30000).describe("Timeout in milliseconds")
  }),
  async (args, context) => {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Flow ${args.flowName} timed out`));
      }, args.timeout);

      // Emit event to Node-RED
      context.node.emit('callFlow', {
        flowName: args.flowName,
        payload: args.payload,
        callback: (error, result) => {
          clearTimeout(timeoutId);
          if (error) {
            resolve({
              content: [{ type: 'text', text: `Flow error: ${error.message}` }],
              isError: true
            });
          } else {
            resolve({
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            });
          }
        }
      });
    });
  }
);
```

## Permission Control

### Basic Permission Callback

```javascript
const options = {
  canUseTool: async (toolName, input, opts) => {
    // Allow all reads
    if (toolName === 'Read') {
      return { behavior: 'allow', updatedInput: input };
    }

    // Block all writes
    if (toolName === 'Write') {
      return {
        behavior: 'deny',
        message: 'Write operations are not allowed'
      };
    }

    // Default: allow
    return { behavior: 'allow', updatedInput: input };
  }
};
```

### Path-Based Restrictions

```javascript
const options = {
  canUseTool: async (toolName, input, opts) => {
    if (['Read', 'Write', 'Edit'].includes(toolName)) {
      const path = input.path || input.file_path;

      // Block access to sensitive directories
      const blockedPaths = ['/etc/', '/var/', '/.env', '/secrets/'];
      for (const blocked of blockedPaths) {
        if (path?.includes(blocked)) {
          return {
            behavior: 'deny',
            message: `Access to ${blocked} is restricted`
          };
        }
      }

      // Only allow access within project directory
      const resolved = require('path').resolve(path);
      if (!resolved.startsWith(process.cwd())) {
        return {
          behavior: 'deny',
          message: 'Access outside project directory is not allowed'
        };
      }
    }

    return { behavior: 'allow', updatedInput: input };
  }
};
```

### Command Filtering

```javascript
const options = {
  canUseTool: async (toolName, input, opts) => {
    if (toolName === 'Bash') {
      const command = input.command || '';

      // Block dangerous commands
      const dangerousPatterns = [
        /rm\s+-rf/,
        /sudo/,
        /chmod\s+777/,
        /curl.*\|.*sh/,
        /wget.*\|.*sh/,
        />.*\/etc\//,
        /mkfs/,
        /dd\s+if=/
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(command)) {
          return {
            behavior: 'deny',
            message: `Dangerous command pattern detected: ${pattern}`
          };
        }
      }

      // Only allow specific commands
      const allowedCommands = ['npm', 'node', 'git', 'ls', 'cat', 'echo'];
      const firstWord = command.split(/\s+/)[0];

      if (!allowedCommands.includes(firstWord)) {
        return {
          behavior: 'deny',
          message: `Command '${firstWord}' is not in the allowed list`
        };
      }
    }

    return { behavior: 'allow', updatedInput: input };
  }
};
```

### Input Modification

```javascript
const options = {
  canUseTool: async (toolName, input, opts) => {
    if (toolName === 'Bash') {
      // Add safety flags to commands
      let command = input.command;

      // Make rm interactive
      if (command.startsWith('rm ')) {
        command = command.replace('rm ', 'rm -i ');
      }

      // Add timeout to long-running commands
      if (!command.includes('timeout')) {
        command = `timeout 60 ${command}`;
      }

      return {
        behavior: 'allow',
        updatedInput: { ...input, command }
      };
    }

    return { behavior: 'allow', updatedInput: input };
  }
};
```

## Hooks

### Pre-Tool Hook

```javascript
const options = {
  hooks: {
    'PreToolUse': [{
      hooks: [async (input) => {
        console.log(`[PRE] Tool: ${input.tool_name}`);
        console.log(`[PRE] Input:`, JSON.stringify(input.tool_input, null, 2));

        // Log to audit trail
        await auditLog.record({
          event: 'tool_request',
          tool: input.tool_name,
          input: input.tool_input,
          timestamp: new Date()
        });

        // Decide whether to allow
        const allowed = await checkPermissions(input.tool_name, input.tool_input);

        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: allowed ? 'allow' : 'deny'
          }
        };
      }]
    }]
  }
};
```

### Post-Tool Hook

```javascript
const options = {
  hooks: {
    'PostToolUse': [{
      hooks: [async (output) => {
        console.log(`[POST] Tool: ${output.tool_name}`);
        console.log(`[POST] Result:`, output.tool_result);

        // Log completion
        await auditLog.record({
          event: 'tool_complete',
          tool: output.tool_name,
          result: output.tool_result,
          timestamp: new Date()
        });

        // Optionally modify the result
        return {
          hookSpecificOutput: {
            hookEventName: 'PostToolUse'
          }
        };
      }]
    }]
  }
};
```

### Combined Hooks for Monitoring

```javascript
class ToolMonitor {
  constructor() {
    this.calls = [];
  }

  getHooks() {
    return {
      'PreToolUse': [{
        hooks: [async (input) => {
          const call = {
            id: Date.now(),
            tool: input.tool_name,
            input: input.tool_input,
            startTime: Date.now(),
            status: 'pending'
          };
          this.calls.push(call);

          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              callId: call.id
            }
          };
        }]
      }],
      'PostToolUse': [{
        hooks: [async (output) => {
          const call = this.calls.find(c =>
            c.tool === output.tool_name && c.status === 'pending'
          );

          if (call) {
            call.endTime = Date.now();
            call.duration = call.endTime - call.startTime;
            call.status = output.tool_result?.isError ? 'error' : 'success';
            call.result = output.tool_result;
          }

          return {
            hookSpecificOutput: {
              hookEventName: 'PostToolUse'
            }
          };
        }]
      }]
    };
  }

  getStats() {
    return {
      totalCalls: this.calls.length,
      byTool: this.calls.reduce((acc, call) => {
        acc[call.tool] = (acc[call.tool] || 0) + 1;
        return acc;
      }, {}),
      avgDuration: this.calls.reduce((sum, c) => sum + (c.duration || 0), 0) / this.calls.length,
      errorRate: this.calls.filter(c => c.status === 'error').length / this.calls.length
    };
  }
}
```

## Using Custom Tools with Query

```javascript
import { query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Define custom tools
const customTools = [
  tool(
    "GetWeather",
    "Get current weather for a location",
    z.object({ city: z.string() }),
    async (args) => {
      const weather = await fetchWeather(args.city);
      return { content: [{ type: 'text', text: JSON.stringify(weather) }] };
    }
  ),
  tool(
    "SendEmail",
    "Send an email notification",
    z.object({
      to: z.string().email(),
      subject: z.string(),
      body: z.string()
    }),
    async (args) => {
      await sendEmail(args.to, args.subject, args.body);
      return { content: [{ type: 'text', text: 'Email sent successfully' }] };
    }
  )
];

// Use with query
for await (const msg of query({
  prompt: "Check the weather in London and email me the forecast",
  options: {
    customTools,
    allowedTools: ['GetWeather', 'SendEmail']
  }
})) {
  console.log(msg);
}
```
