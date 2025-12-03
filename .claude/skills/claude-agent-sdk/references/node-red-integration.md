# Node-RED Integration Patterns

## Overview

This guide covers patterns for integrating the Claude Agent SDK with Node-RED, including node development, async handling, configuration management, and lifecycle considerations.

## Node Architecture

### Standard Node Structure

```javascript
module.exports = function(RED) {
  const { query } = require("@anthropic-ai/claude-agent-sdk");

  function ClaudeNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get configuration node reference
    this.claudeConfig = RED.nodes.getNode(config.claudeConfig);

    // Validate configuration
    if (!this.claudeConfig) {
      node.error("Missing Claude configuration");
      node.status({ fill: 'red', shape: 'ring', text: 'no config' });
      return;
    }

    // Handle incoming messages
    node.on('input', async (msg, send, done) => {
      // Process message
    });

    // Cleanup on node removal/redeploy
    node.on('close', (done) => {
      // Cleanup resources
      done();
    });
  }

  RED.nodes.registerType('claude-node', ClaudeNode);
};
```

### Configuration Node

```javascript
module.exports = function(RED) {
  function ClaudeConfigNode(config) {
    RED.nodes.createNode(this, config);

    // Configuration from editor
    this.name = config.name;
    this.model = config.model || 'claude-sonnet-4-5-20250514';
    this.maxTokens = parseInt(config.maxTokens) || 4096;
    this.timeout = parseInt(config.timeout) || 60000;

    // Credentials (stored securely)
    this.apiKey = this.credentials.apiKey;

    // Shared state for all nodes using this config
    this.activeQueries = new Map();

    // Set API key in environment
    if (this.apiKey) {
      process.env.ANTHROPIC_API_KEY = this.apiKey;
    }

    // Cleanup method
    this.cancelAll = () => {
      for (const [id, queryInstance] of this.activeQueries) {
        queryInstance.interrupt();
      }
      this.activeQueries.clear();
    };

    this.on('close', (done) => {
      this.cancelAll();
      done();
    });
  }

  RED.nodes.registerType('claude-config', ClaudeConfigNode, {
    credentials: {
      apiKey: { type: 'password' }
    }
  });
};
```

## Input Handling Patterns

### Basic Query Node

```javascript
node.on('input', async (msg, send, done) => {
  const prompt = config.prompt || msg.payload;

  if (!prompt) {
    node.status({ fill: 'red', shape: 'ring', text: 'no prompt' });
    done(new Error('No prompt provided'));
    return;
  }

  node.status({ fill: 'blue', shape: 'dot', text: 'processing' });

  try {
    let response = '';

    for await (const message of query({
      prompt,
      options: {
        model: node.claudeConfig.model,
        cwd: RED.settings.userDir
      }
    })) {
      if (message.type === 'assistant') {
        response = message.message.content;
      }

      if (message.type === 'result') {
        if (message.subtype === 'error') {
          throw new Error(message.message);
        }
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
```

### Template-Based Prompts

```javascript
const Mustache = require('mustache');

node.on('input', async (msg, send, done) => {
  // Use Mustache templates for dynamic prompts
  const template = config.promptTemplate || '{{payload}}';
  const prompt = Mustache.render(template, {
    payload: msg.payload,
    topic: msg.topic,
    ...msg  // All message properties available
  });

  try {
    for await (const message of query({ prompt })) {
      // Handle response
    }
    done();
  } catch (error) {
    done(error);
  }
});
```

### Context-Aware Prompts

```javascript
node.on('input', async (msg, send, done) => {
  // Get context from flow/global
  const flowContext = node.context().flow;
  const globalContext = node.context().global;

  const conversationHistory = flowContext.get('claudeHistory') || [];

  // Build prompt with history
  const fullPrompt = [
    ...conversationHistory.map(h => `${h.role}: ${h.content}`),
    `user: ${msg.payload}`
  ].join('\n');

  try {
    let response = '';

    for await (const message of query({ prompt: fullPrompt })) {
      if (message.type === 'assistant') {
        response = message.message.content;
      }
    }

    // Update conversation history
    conversationHistory.push(
      { role: 'user', content: msg.payload },
      { role: 'assistant', content: response }
    );

    // Keep last N exchanges
    if (conversationHistory.length > 20) {
      conversationHistory.splice(0, 2);
    }

    flowContext.set('claudeHistory', conversationHistory);

    msg.payload = response;
    send(msg);
    done();
  } catch (error) {
    done(error);
  }
});
```

## Output Patterns

### Single Output

```javascript
// Standard single output
msg.payload = response;
send(msg);
```

### Multiple Outputs

```javascript
// Define outputs in node registration
RED.nodes.registerType('claude-multi', ClaudeMultiNode, {
  outputs: 3  // response, tools, status
});

// In input handler
node.on('input', async (msg, send, done) => {
  try {
    let response = '';
    const toolCalls = [];

    for await (const message of query({ prompt: msg.payload })) {
      if (message.type === 'assistant') {
        response = message.message.content;
      }

      if (message.type === 'tool_use') {
        toolCalls.push({
          tool: message.tool_name,
          input: message.input
        });
      }

      if (message.type === 'result') {
        // Output 1: Response
        // Output 2: Tool calls (if any)
        // Output 3: Status
        send([
          { payload: response },
          toolCalls.length > 0 ? { payload: toolCalls } : null,
          {
            payload: {
              status: message.subtype,
              duration: message.duration_ms
            }
          }
        ]);
      }
    }

    done();
  } catch (error) {
    // Send error on output 3
    send([null, null, { payload: { status: 'error', message: error.message } }]);
    done(error);
  }
});
```

### Streaming Output

```javascript
node.on('input', async (msg, send, done) => {
  const originalMsgId = msg._msgid;

  try {
    for await (const message of query({
      prompt: msg.payload,
      options: { includePartialMessages: true }
    })) {
      if (message.type === 'assistantPartial') {
        // Send streaming chunks
        send({
          _msgid: originalMsgId,
          payload: message.message.content,
          streaming: true,
          complete: false
        });
      }

      if (message.type === 'assistant') {
        // Send final complete message
        send({
          _msgid: originalMsgId,
          payload: message.message.content,
          streaming: false,
          complete: true
        });
      }
    }

    done();
  } catch (error) {
    done(error);
  }
});
```

## Async Handling

### Proper Async/Await Pattern

```javascript
node.on('input', async (msg, send, done) => {
  // Always use try/catch with async
  try {
    const result = await processWithClaude(msg.payload);
    msg.payload = result;
    send(msg);
    done();
  } catch (error) {
    // Proper error handling
    node.error(error.message, msg);
    done(error);
  }
});
```

### Timeout Handling

```javascript
node.on('input', async (msg, send, done) => {
  const timeout = node.claudeConfig.timeout || 60000;
  const queryInstance = query({ prompt: msg.payload });

  // Set timeout
  const timeoutId = setTimeout(() => {
    queryInstance.interrupt();
  }, timeout);

  try {
    let response = '';

    for await (const message of queryInstance) {
      if (message.type === 'assistant') {
        response = message.message.content;
      }

      if (message.type === 'result') {
        clearTimeout(timeoutId);

        if (message.subtype === 'interrupted') {
          throw new Error('Query timed out');
        }
      }
    }

    msg.payload = response;
    send(msg);
    done();
  } catch (error) {
    clearTimeout(timeoutId);
    done(error);
  }
});
```

### Cancellation Support

```javascript
function ClaudeNode(config) {
  RED.nodes.createNode(this, config);
  const node = this;

  // Track active query for cancellation
  let activeQuery = null;

  node.on('input', async (msg, send, done) => {
    // Cancel previous query if still running
    if (activeQuery) {
      activeQuery.interrupt();
    }

    activeQuery = query({ prompt: msg.payload });

    try {
      for await (const message of activeQuery) {
        // Process messages
      }
      done();
    } catch (error) {
      done(error);
    } finally {
      activeQuery = null;
    }
  });

  node.on('close', (done) => {
    if (activeQuery) {
      activeQuery.interrupt();
    }
    done();
  });
}
```

### Queue-Based Processing

```javascript
function ClaudeQueueNode(config) {
  RED.nodes.createNode(this, config);
  const node = this;

  const queue = [];
  let processing = false;

  async function processQueue() {
    if (processing || queue.length === 0) return;

    processing = true;
    node.status({ fill: 'blue', shape: 'dot', text: `queue: ${queue.length}` });

    while (queue.length > 0) {
      const { msg, send, done } = queue.shift();

      try {
        let response = '';
        for await (const message of query({ prompt: msg.payload })) {
          if (message.type === 'assistant') {
            response = message.message.content;
          }
        }
        msg.payload = response;
        send(msg);
        done();
      } catch (error) {
        done(error);
      }

      node.status({ fill: 'blue', shape: 'dot', text: `queue: ${queue.length}` });
    }

    processing = false;
    node.status({ fill: 'green', shape: 'dot', text: 'idle' });
  }

  node.on('input', (msg, send, done) => {
    queue.push({ msg, send, done });
    processQueue();
  });
}
```

## Status Patterns

### Standard Status Updates

```javascript
// Idle
node.status({ fill: 'grey', shape: 'ring', text: 'ready' });

// Processing
node.status({ fill: 'blue', shape: 'dot', text: 'processing' });

// Streaming
node.status({ fill: 'blue', shape: 'dot', text: 'streaming...' });

// Success
node.status({ fill: 'green', shape: 'dot', text: 'done' });

// Success with info
node.status({ fill: 'green', shape: 'dot', text: `done (${duration}ms)` });

// Warning
node.status({ fill: 'yellow', shape: 'ring', text: 'timeout' });

// Error
node.status({ fill: 'red', shape: 'ring', text: 'error' });

// Error with message
node.status({ fill: 'red', shape: 'ring', text: error.message.slice(0, 30) });

// Clear status
node.status({});
```

### Progress Status

```javascript
node.on('input', async (msg, send, done) => {
  let tokenCount = 0;

  try {
    for await (const message of query({
      prompt: msg.payload,
      options: { includePartialMessages: true }
    })) {
      if (message.type === 'assistantPartial') {
        tokenCount = message.message.content.split(/\s+/).length;
        node.status({
          fill: 'blue',
          shape: 'dot',
          text: `~${tokenCount} words`
        });
      }

      if (message.type === 'tool_use') {
        node.status({
          fill: 'yellow',
          shape: 'dot',
          text: `tool: ${message.tool_name}`
        });
      }

      if (message.type === 'result') {
        node.status({
          fill: 'green',
          shape: 'dot',
          text: `done (${message.duration_ms}ms)`
        });
      }
    }
    done();
  } catch (error) {
    node.status({ fill: 'red', shape: 'ring', text: error.message });
    done(error);
  }
});
```

## Editor HTML

### Node Editor Template

```html
<script type="text/javascript">
  RED.nodes.registerType('claude-query', {
    category: 'AI',
    color: '#D4A574',
    defaults: {
      name: { value: '' },
      claudeConfig: { value: '', type: 'claude-config', required: true },
      prompt: { value: '' },
      promptTemplate: { value: '{{payload}}' },
      model: { value: 'claude-sonnet-4-5-20250514' },
      streaming: { value: false }
    },
    inputs: 1,
    outputs: 1,
    icon: 'font-awesome/fa-brain',
    label: function() {
      return this.name || 'claude query';
    },
    paletteLabel: 'claude',
    oneditprepare: function() {
      // Editor initialization
      $('#node-input-promptTemplate').typedInput({
        types: ['str', 'msg', 'flow', 'global']
      });
    }
  });
</script>

<script type="text/html" data-template-name="claude-query">
  <div class="form-row">
    <label for="node-input-name"><i class="fa fa-tag"></i> Name</label>
    <input type="text" id="node-input-name" placeholder="Name">
  </div>

  <div class="form-row">
    <label for="node-input-claudeConfig"><i class="fa fa-cog"></i> Config</label>
    <input type="text" id="node-input-claudeConfig">
  </div>

  <div class="form-row">
    <label for="node-input-model"><i class="fa fa-cube"></i> Model</label>
    <select id="node-input-model">
      <option value="claude-sonnet-4-5-20250514">Claude Sonnet 4.5</option>
      <option value="claude-opus-4-20250514">Claude Opus 4</option>
      <option value="claude-haiku">Claude Haiku</option>
    </select>
  </div>

  <div class="form-row">
    <label for="node-input-promptTemplate"><i class="fa fa-file-text-o"></i> Prompt</label>
    <input type="text" id="node-input-promptTemplate" placeholder="{{payload}}">
  </div>

  <div class="form-row">
    <label for="node-input-streaming"><i class="fa fa-stream"></i> Streaming</label>
    <input type="checkbox" id="node-input-streaming" style="width: auto;">
  </div>
</script>

<script type="text/html" data-help-name="claude-query">
  <p>Send a prompt to Claude and receive a response.</p>

  <h3>Inputs</h3>
  <dl class="message-properties">
    <dt>payload <span class="property-type">string</span></dt>
    <dd>The prompt to send to Claude</dd>
  </dl>

  <h3>Outputs</h3>
  <dl class="message-properties">
    <dt>payload <span class="property-type">string</span></dt>
    <dd>Claude's response</dd>
  </dl>

  <h3>Details</h3>
  <p>Use the prompt template to customize how the input is formatted.</p>
  <p>Enable streaming to receive partial responses as they're generated.</p>
</script>
```

### Configuration Node Editor

```html
<script type="text/javascript">
  RED.nodes.registerType('claude-config', {
    category: 'config',
    defaults: {
      name: { value: '' },
      model: { value: 'claude-sonnet-4-5-20250514' },
      maxTokens: { value: 4096 },
      timeout: { value: 60000 }
    },
    credentials: {
      apiKey: { type: 'password' }
    },
    label: function() {
      return this.name || 'claude config';
    }
  });
</script>

<script type="text/html" data-template-name="claude-config">
  <div class="form-row">
    <label for="node-config-input-name"><i class="fa fa-tag"></i> Name</label>
    <input type="text" id="node-config-input-name" placeholder="Name">
  </div>

  <div class="form-row">
    <label for="node-config-input-apiKey"><i class="fa fa-key"></i> API Key</label>
    <input type="password" id="node-config-input-apiKey" placeholder="sk-ant-api03-...">
  </div>

  <div class="form-row">
    <label for="node-config-input-model"><i class="fa fa-cube"></i> Default Model</label>
    <select id="node-config-input-model">
      <option value="claude-sonnet-4-5-20250514">Claude Sonnet 4.5</option>
      <option value="claude-opus-4-20250514">Claude Opus 4</option>
      <option value="claude-haiku">Claude Haiku</option>
    </select>
  </div>

  <div class="form-row">
    <label for="node-config-input-timeout"><i class="fa fa-clock-o"></i> Timeout (ms)</label>
    <input type="number" id="node-config-input-timeout" value="60000">
  </div>
</script>
```

## Lifecycle Management

### Graceful Shutdown

```javascript
function ClaudeNode(config) {
  RED.nodes.createNode(this, config);
  const node = this;

  const activeQueries = new Set();

  node.on('input', async (msg, send, done) => {
    const queryInstance = query({ prompt: msg.payload });
    activeQueries.add(queryInstance);

    try {
      for await (const message of queryInstance) {
        // Process
      }
      done();
    } catch (error) {
      done(error);
    } finally {
      activeQueries.delete(queryInstance);
    }
  });

  node.on('close', async (removed, done) => {
    // Cancel all active queries
    for (const q of activeQueries) {
      q.interrupt();
    }
    activeQueries.clear();

    // If node is being removed (not just redeployed)
    if (removed) {
      // Cleanup any persistent resources
    }

    done();
  });
}
```

### Resource Cleanup

```javascript
function ClaudeNode(config) {
  RED.nodes.createNode(this, config);
  const node = this;

  // Resources to cleanup
  const intervals = [];
  const timeouts = [];

  // Example: periodic status update
  const statusInterval = setInterval(() => {
    // Update status
  }, 5000);
  intervals.push(statusInterval);

  node.on('close', (done) => {
    // Clear all intervals
    intervals.forEach(clearInterval);

    // Clear all timeouts
    timeouts.forEach(clearTimeout);

    done();
  });
}
```

## Integration with javascript-async-patterns Skill

The Claude Agent SDK integrates naturally with async patterns covered in the `javascript-async-patterns` skill:

### Event Emitter Integration

```javascript
const EventEmitter = require('events');

class ClaudeEventNode extends EventEmitter {
  constructor(RED, config) {
    super();
    RED.nodes.createNode(this, config);
    this.setupHandlers();
  }

  setupHandlers() {
    this.on('input', async (msg, send, done) => {
      this.emit('queryStart', msg);

      try {
        for await (const message of query({ prompt: msg.payload })) {
          this.emit('message', message);

          if (message.type === 'assistant') {
            this.emit('response', message.message.content);
          }
        }
        this.emit('queryComplete', msg);
        done();
      } catch (error) {
        this.emit('error', error);
        done(error);
      }
    });
  }
}
```

### State Machine Pattern

```javascript
const states = {
  IDLE: 'idle',
  QUERYING: 'querying',
  STREAMING: 'streaming',
  TOOL_CALLING: 'tool_calling',
  COMPLETE: 'complete',
  ERROR: 'error'
};

function ClaudeStateMachine(node) {
  let state = states.IDLE;

  return {
    getState: () => state,

    transition: (newState) => {
      const statusMap = {
        [states.IDLE]: { fill: 'grey', shape: 'ring', text: 'ready' },
        [states.QUERYING]: { fill: 'blue', shape: 'dot', text: 'querying' },
        [states.STREAMING]: { fill: 'blue', shape: 'dot', text: 'streaming' },
        [states.TOOL_CALLING]: { fill: 'yellow', shape: 'dot', text: 'tool' },
        [states.COMPLETE]: { fill: 'green', shape: 'dot', text: 'done' },
        [states.ERROR]: { fill: 'red', shape: 'ring', text: 'error' }
      };

      state = newState;
      node.status(statusMap[state]);
    }
  };
}
```

### Promise Patterns

See `javascript-async-patterns` skill for:
- Promise.all for parallel queries
- Promise.race for competitive queries
- Retry patterns with exponential backoff
- Timeout wrappers
