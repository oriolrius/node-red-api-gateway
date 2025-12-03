---
name: claude-agent-sdk
description: Comprehensive guide for building AI-powered applications using the Claude Agent SDK. This skill should be used when integrating Claude AI capabilities into Node.js applications, creating AI-powered Node-RED nodes, implementing streaming conversations, using tool calling patterns, or building custom MCP tools for Claude agents.
---

# Claude Agent SDK

## Overview

The Claude Agent SDK is a development framework for building production-ready AI agents. It provides all the building blocks needed to create specialized AI agents with context management, rich tool ecosystem, advanced permissions, and MCP integration.

## Quick Reference

| Task | Pattern |
|------|---------|
| Install | `npm install @anthropic-ai/claude-agent-sdk` |
| Set API key | `export ANTHROPIC_API_KEY=your-key` |
| Basic query | `for await (const msg of query({ prompt })) { }` |
| Stream responses | `options: { includePartialMessages: true }` |
| Custom tools | `tool(name, description, zodSchema, handler)` |
| Control permissions | `canUseTool: async (name, input) => { }` |
| Interrupt | `queryInstance.interrupt()` |

## Installation and Authentication

### Install the SDK

```bash
npm install @anthropic-ai/claude-agent-sdk
```

### Authentication

Set your API key as an environment variable:

```bash
export ANTHROPIC_API_KEY=your-api-key-here
```

Alternative authentication methods:
- **Amazon Bedrock**: Set `CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials
- **Google Vertex AI**: Set `CLAUDE_CODE_USE_VERTEX=1` + GCP credentials

## Core API Patterns

### Basic Query

```javascript
import { query } from "@anthropic-ai/claude-agent-sdk";

// Simple prompt - iterate through streaming responses
for await (const message of query({ prompt: "Your task here" })) {
  if (message.type === 'assistant') {
    console.log('Response:', message.message.content);
  }

  if (message.type === 'result') {
    console.log('Completed:', message.subtype);
  }
}
```

### Query with Options

```javascript
const result = query({
  prompt: "Analyze this code",
  options: {
    model: "claude-sonnet-4-5-20250514",  // or "claude-opus-4-20250514"
    cwd: process.cwd(),
    allowedTools: ['Read', 'Glob', 'Grep'],
    disallowedTools: ['Bash', 'Write'],
    includePartialMessages: true
  }
});

for await (const message of result) {
  // Handle messages
}
```

### Streaming Responses

```javascript
for await (const message of query({
  prompt: "Generate a report",
  options: { includePartialMessages: true }
})) {
  switch (message.type) {
    case 'assistantPartial':
      // Real-time streaming content
      process.stdout.write(message.message.content);
      break;
    case 'assistant':
      // Complete assistant message
      console.log('\nFull response:', message.message.content);
      break;
    case 'result':
      // Task completion
      console.log(`Done in ${message.duration_ms}ms`);
      break;
  }
}
```

### Multi-Turn Conversations

```javascript
import { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

async function* conversationFlow() {
  yield { type: 'user', content: 'What files are in src/?' };
  // Additional messages can be yielded dynamically
}

for await (const msg of query({ prompt: conversationFlow() })) {
  // Handle conversation messages
}
```

## Tool Use / Function Calling

### Creating Custom Tools

```javascript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const fetchDataTool = tool(
  "FetchData",
  "Fetches data from an external API",
  z.object({
    endpoint: z.string().describe("API endpoint to call"),
    method: z.enum(["GET", "POST"]).default("GET"),
    body: z.string().optional().describe("Request body for POST")
  }),
  async (args) => {
    const response = await fetch(args.endpoint, {
      method: args.method,
      body: args.body
    });
    const data = await response.json();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }]
    };
  }
);
```

### Tool Error Handling

```javascript
const safeTool = tool(
  "SafeOperation",
  "Performs an operation with error handling",
  z.object({ input: z.string() }),
  async (args) => {
    try {
      const result = await performOperation(args.input);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }],
        isError: true
      };
    }
  }
);
```

### Permission Control

```javascript
const options = {
  canUseTool: async (toolName, input, opts) => {
    // Block dangerous tools
    if (toolName === 'Bash' && input.command?.includes('rm -rf')) {
      return {
        behavior: 'deny',
        message: 'Dangerous command blocked'
      };
    }

    // Restrict file paths
    if (toolName === 'Write' && !input.path?.startsWith('/allowed/')) {
      return {
        behavior: 'deny',
        message: 'Write restricted to /allowed/ directory'
      };
    }

    return { behavior: 'allow', updatedInput: input };
  }
};
```

### Pre/Post Tool Hooks

```javascript
const options = {
  hooks: {
    'PreToolUse': [{
      hooks: [async (input) => {
        console.log(`Tool requested: ${input.tool_name}`);

        // Optionally deny the tool
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow' // or 'deny'
          }
        };
      }]
    }],
    'PostToolUse': [{
      hooks: [async (output) => {
        console.log(`Tool completed: ${output.tool_name}`);
        return { hookSpecificOutput: { hookEventName: 'PostToolUse' } };
      }]
    }]
  }
};
```

## Error Handling Patterns

### Result Message Inspection

```javascript
async function executeTask(prompt) {
  for await (const msg of query({ prompt })) {
    if (msg.type === 'result') {
      switch (msg.subtype) {
        case 'success':
          console.log(`Completed in ${msg.duration_ms}ms`);
          return { success: true, duration: msg.duration_ms };
        case 'error':
          console.error('Error:', msg.message);
          return { success: false, error: msg.message };
        case 'interrupted':
          console.log('Task interrupted');
          return { success: false, interrupted: true };
      }
    }
  }
}
```

### Timeout and Abort

```javascript
async function queryWithTimeout(prompt, timeoutMs = 30000) {
  const queryInstance = query({ prompt });

  const timeout = setTimeout(() => {
    queryInstance.interrupt();
  }, timeoutMs);

  try {
    for await (const msg of queryInstance) {
      if (msg.type === 'result') {
        clearTimeout(timeout);
        return msg;
      }
    }
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}
```

## Node-RED Integration

### Basic Claude Query Node

```javascript
module.exports = function(RED) {
  const { query } = require("@anthropic-ai/claude-agent-sdk");

  function ClaudeQueryNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.on('input', async (msg, send, done) => {
      const prompt = config.prompt || msg.payload;

      node.status({ fill: 'blue', shape: 'dot', text: 'querying' });

      try {
        let response = '';

        for await (const message of query({
          prompt,
          options: {
            model: config.model || 'claude-sonnet-4-5-20250514',
            cwd: RED.settings.userDir,
            allowedTools: config.allowedTools?.split(',') || []
          }
        })) {
          if (message.type === 'assistant') {
            response = message.message.content;
          }

          if (message.type === 'result' && message.subtype === 'error') {
            throw new Error(message.message);
          }
        }

        msg.payload = response;
        node.status({ fill: 'green', shape: 'dot', text: 'done' });
        send(msg);
        done();
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: error.message });
        done(error);
      }
    });
  }

  RED.nodes.registerType('claude-query', ClaudeQueryNode);
};
```

### Claude Node with Streaming Output

```javascript
module.exports = function(RED) {
  const { query } = require("@anthropic-ai/claude-agent-sdk");

  function ClaudeStreamNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.on('input', async (msg, send, done) => {
      const prompt = config.prompt || msg.payload;

      node.status({ fill: 'blue', shape: 'dot', text: 'streaming' });

      try {
        for await (const message of query({
          prompt,
          options: {
            model: config.model || 'claude-sonnet-4-5-20250514',
            includePartialMessages: true
          }
        })) {
          if (message.type === 'assistantPartial') {
            // Send partial updates as they arrive
            send([{ payload: message.message.content, partial: true }, null]);
          }

          if (message.type === 'assistant') {
            // Send complete response
            send([null, { payload: message.message.content, complete: true }]);
          }

          if (message.type === 'result') {
            node.status({
              fill: message.subtype === 'success' ? 'green' : 'red',
              shape: 'dot',
              text: message.subtype
            });
          }
        }

        done();
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: error.message });
        done(error);
      }
    });
  }

  RED.nodes.registerType('claude-stream', ClaudeStreamNode);
};
```

### Claude Configuration Node

```javascript
module.exports = function(RED) {
  function ClaudeConfigNode(config) {
    RED.nodes.createNode(this, config);

    this.model = config.model || 'claude-sonnet-4-5-20250514';
    this.maxTokens = parseInt(config.maxTokens) || 4096;
    this.temperature = parseFloat(config.temperature) || 1.0;

    // Store API key in credentials
    this.apiKey = this.credentials.apiKey;
  }

  RED.nodes.registerType('claude-config', ClaudeConfigNode, {
    credentials: {
      apiKey: { type: 'password' }
    }
  });
};
```

### Claude Tool Node (Custom Function Calling)

```javascript
module.exports = function(RED) {
  const { query, tool } = require("@anthropic-ai/claude-agent-sdk");
  const { z } = require("zod");

  function ClaudeToolNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Create custom tools from connected function nodes
    const customTools = [];

    // Register a tool that can call Node-RED flows
    const callFlowTool = tool(
      "CallNodeREDFlow",
      "Calls a Node-RED subflow with the given input",
      z.object({
        flowId: z.string().describe("The ID of the subflow to call"),
        payload: z.any().describe("The payload to send to the flow")
      }),
      async (args) => {
        return new Promise((resolve) => {
          // Emit to connected flow and wait for response
          node.send([{
            payload: args.payload,
            flowId: args.flowId,
            _callback: (result) => {
              resolve({
                content: [{ type: 'text', text: JSON.stringify(result) }]
              });
            }
          }, null]);
        });
      }
    );

    customTools.push(callFlowTool);

    node.on('input', async (msg, send, done) => {
      try {
        for await (const message of query({
          prompt: msg.payload,
          options: {
            model: config.model,
            customTools
          }
        })) {
          if (message.type === 'assistant') {
            send([null, { payload: message.message.content }]);
          }
        }
        done();
      } catch (error) {
        done(error);
      }
    });
  }

  RED.nodes.registerType('claude-tool', ClaudeToolNode);
};
```

## Available Models

| Model | ID | Best For |
|-------|-----|----------|
| Claude Opus 4 | `claude-opus-4-20250514` | Complex reasoning, long context |
| Claude Sonnet 4.5 | `claude-sonnet-4-5-20250514` | Balance of speed and capability |
| Claude Haiku | `claude-haiku` | Fast, simple tasks |

## Built-in Tools

The SDK provides 16+ built-in tools:

| Tool | Description |
|------|-------------|
| `Read` | Read files from filesystem |
| `Write` | Write files to filesystem |
| `Edit` | Edit existing files |
| `Bash` | Execute shell commands |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents |
| `WebSearch` | Search the web |
| `WebFetch` | Fetch web content |
| `Task` | Launch subagent tasks |
| `TodoWrite` | Manage task lists |
| `AskUserQuestion` | Interactive prompts |

## Best Practices

1. **Always iterate through the query** - Don't await the query directly
2. **Handle all message types** - Check for errors and interruptions
3. **Use appropriate models** - Haiku for simple tasks, Opus for complex ones
4. **Implement timeouts** - Use `interrupt()` for long-running queries
5. **Control tool access** - Whitelist only needed tools with `allowedTools`
6. **Handle credentials securely** - Use environment variables, not hardcoded keys
7. **Stream for UX** - Enable `includePartialMessages` for responsive interfaces

## References

For detailed information on specific topics:

- `references/sdk-basics.md` - Installation, authentication, and core concepts
- `references/streaming-patterns.md` - Streaming responses and real-time updates
- `references/tool-patterns.md` - Creating and managing custom tools
- `references/node-red-integration.md` - Node-RED specific patterns and examples

## External Documentation

- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript API Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [MCP Integration](https://platform.claude.com/docs/en/agent-sdk/mcp)
- [Hosting Guide](https://platform.claude.com/docs/en/agent-sdk/hosting)
