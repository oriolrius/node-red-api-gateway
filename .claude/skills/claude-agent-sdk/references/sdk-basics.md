# Claude Agent SDK Basics

## Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

### TypeScript Support

The SDK is written in TypeScript and provides full type definitions:

```typescript
import {
  query,
  tool,
  SDKUserMessage,
  SDKAssistantMessage,
  QueryOptions,
  ToolResult
} from "@anthropic-ai/claude-agent-sdk";
```

### Package.json Configuration

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^1.0.0",
    "zod": "^3.22.0"
  }
}
```

## Authentication

### API Key (Recommended)

Set the `ANTHROPIC_API_KEY` environment variable:

```bash
# Linux/macOS
export ANTHROPIC_API_KEY=sk-ant-api03-xxx

# Windows PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-api03-xxx"

# Windows CMD
set ANTHROPIC_API_KEY=sk-ant-api03-xxx
```

### Programmatic Key Management

For Node-RED nodes, store the API key in credentials:

```javascript
// In Node-RED config node
module.exports = function(RED) {
  function ClaudeConfigNode(config) {
    RED.nodes.createNode(this, config);

    // API key stored securely in credentials
    if (this.credentials.apiKey) {
      process.env.ANTHROPIC_API_KEY = this.credentials.apiKey;
    }
  }

  RED.nodes.registerType('claude-config', ClaudeConfigNode, {
    credentials: {
      apiKey: { type: 'password' }
    }
  });
};
```

### Amazon Bedrock Authentication

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_REGION=us-east-1
```

### Google Vertex AI Authentication

```bash
export CLAUDE_CODE_USE_VERTEX=1
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export GOOGLE_CLOUD_PROJECT=your-project-id
export GOOGLE_CLOUD_REGION=us-central1
```

## Query Function

The `query()` function is the main entry point. It returns an async generator.

### Basic Signature

```typescript
function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: QueryOptions;
}): AsyncGenerator<SDKMessage>;
```

### Query Options

```typescript
interface QueryOptions {
  // Model selection
  model?: string;  // Default: 'claude-sonnet-4-5-20250514'

  // Working directory for file operations
  cwd?: string;

  // Tool control
  allowedTools?: string[];
  disallowedTools?: string[];
  customTools?: Tool[];

  // Streaming
  includePartialMessages?: boolean;

  // Permission callback
  canUseTool?: (
    toolName: string,
    input: any,
    options: any
  ) => Promise<PermissionResult>;

  // Hooks
  hooks?: {
    PreToolUse?: HookConfig[];
    PostToolUse?: HookConfig[];
  };

  // Context sources
  settingSources?: ('project' | 'user')[];
}
```

### Message Types

The query yields different message types:

```typescript
type SDKMessage =
  | { type: 'user'; content: string }
  | { type: 'assistant'; message: { content: string } }
  | { type: 'assistantPartial'; message: { content: string } }
  | { type: 'tool_use'; tool_name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: any }
  | { type: 'result'; subtype: 'success' | 'error' | 'interrupted'; duration_ms?: number; message?: string };
```

### Complete Example

```javascript
import { query } from "@anthropic-ai/claude-agent-sdk";

async function analyzeCode(filePath) {
  const messages = [];

  for await (const msg of query({
    prompt: `Analyze the code in ${filePath} and suggest improvements`,
    options: {
      model: 'claude-sonnet-4-5-20250514',
      cwd: process.cwd(),
      allowedTools: ['Read', 'Glob', 'Grep'],
      includePartialMessages: false
    }
  })) {
    messages.push(msg);

    if (msg.type === 'assistant') {
      console.log('Analysis:', msg.message.content);
    }

    if (msg.type === 'tool_use') {
      console.log(`Using tool: ${msg.tool_name}`);
    }

    if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        console.log(`Completed in ${msg.duration_ms}ms`);
      } else if (msg.subtype === 'error') {
        console.error('Error:', msg.message);
      }
    }
  }

  return messages;
}
```

## Models

### Available Models

| Model | ID | Context | Best For |
|-------|-----|---------|----------|
| Claude Opus 4 | `claude-opus-4-20250514` | 200K | Complex reasoning, long documents |
| Claude Sonnet 4.5 | `claude-sonnet-4-5-20250514` | 200K | General purpose, good balance |
| Claude Haiku | `claude-haiku` | 200K | Fast responses, simple tasks |

### Model Selection Strategy

```javascript
function selectModel(task) {
  // Simple classification, quick responses
  if (task.type === 'classify' || task.maxLatency < 1000) {
    return 'claude-haiku';
  }

  // Complex analysis, code generation
  if (task.type === 'analyze' || task.complexity === 'high') {
    return 'claude-opus-4-20250514';
  }

  // Default for most tasks
  return 'claude-sonnet-4-5-20250514';
}
```

## Error Handling

### Checking Results

Always check the result message:

```javascript
async function safeQuery(prompt) {
  try {
    for await (const msg of query({ prompt })) {
      if (msg.type === 'result') {
        if (msg.subtype === 'error') {
          throw new Error(msg.message || 'Query failed');
        }
        return msg;
      }
    }
  } catch (error) {
    console.error('Query error:', error);
    throw error;
  }
}
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `ANTHROPIC_API_KEY not set` | Missing API key | Set environment variable |
| `Rate limit exceeded` | Too many requests | Implement exponential backoff |
| `Context length exceeded` | Prompt too long | Reduce input size |
| `Tool not allowed` | Tool blocked | Add to `allowedTools` |

### Retry with Backoff

```javascript
async function queryWithRetry(prompt, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await safeQuery(prompt);
      return result;
    } catch (error) {
      lastError = error;

      if (error.message?.includes('Rate limit')) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Rate limited, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}
```

## Environment Configuration

### Recommended .env File

```env
# Required
ANTHROPIC_API_KEY=sk-ant-api03-xxx

# Optional - Model defaults
CLAUDE_DEFAULT_MODEL=claude-sonnet-4-5-20250514

# Optional - For Bedrock
# CLAUDE_CODE_USE_BEDROCK=1
# AWS_ACCESS_KEY_ID=xxx
# AWS_SECRET_ACCESS_KEY=xxx
# AWS_REGION=us-east-1

# Optional - For Vertex
# CLAUDE_CODE_USE_VERTEX=1
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
# GOOGLE_CLOUD_PROJECT=your-project
# GOOGLE_CLOUD_REGION=us-central1
```

### Loading Environment in Node.js

```javascript
import dotenv from 'dotenv';
dotenv.config();

// Validate required variables
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required');
}
```

## TypeScript Configuration

Recommended `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```
