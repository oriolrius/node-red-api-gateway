# Streaming Patterns

## Overview

The Claude Agent SDK returns an async generator from `query()`. This enables efficient streaming of responses, real-time progress updates, and proper handling of long-running operations.

## Basic Streaming

### Iterating Through Messages

```javascript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({ prompt: "Hello" })) {
  console.log(message.type, message);
}
```

### Message Types in Order

A typical query produces messages in this order:

1. `user` - The initial prompt
2. `assistant` / `assistantPartial` - Claude's response (may include multiple)
3. `tool_use` - When Claude calls a tool
4. `tool_result` - Result from the tool
5. `assistant` - Claude's response after tool use
6. `result` - Final completion status

## Real-Time Streaming

### Enable Partial Messages

```javascript
for await (const message of query({
  prompt: "Write a long story",
  options: {
    includePartialMessages: true
  }
})) {
  if (message.type === 'assistantPartial') {
    // Incremental content as it's generated
    process.stdout.write(message.message.content);
  }
}
```

### Streaming to UI

```javascript
async function streamToUI(prompt, onChunk, onComplete) {
  let fullResponse = '';

  for await (const message of query({
    prompt,
    options: { includePartialMessages: true }
  })) {
    if (message.type === 'assistantPartial') {
      const chunk = message.message.content;
      fullResponse = chunk; // Partial contains cumulative content
      onChunk(chunk);
    }

    if (message.type === 'result') {
      onComplete(fullResponse, message);
    }
  }

  return fullResponse;
}

// Usage
await streamToUI(
  "Explain quantum computing",
  (chunk) => updateUIText(chunk),
  (full, result) => console.log(`Done in ${result.duration_ms}ms`)
);
```

### Streaming with Progress Events

```javascript
async function queryWithProgress(prompt, callbacks) {
  const {
    onStart,
    onChunk,
    onToolUse,
    onToolResult,
    onComplete,
    onError
  } = callbacks;

  onStart?.();

  try {
    for await (const msg of query({
      prompt,
      options: { includePartialMessages: true }
    })) {
      switch (msg.type) {
        case 'assistantPartial':
          onChunk?.(msg.message.content);
          break;

        case 'tool_use':
          onToolUse?.(msg.tool_name, msg.input);
          break;

        case 'tool_result':
          onToolResult?.(msg.tool_use_id, msg.content);
          break;

        case 'result':
          if (msg.subtype === 'success') {
            onComplete?.(msg);
          } else {
            onError?.(new Error(msg.message || msg.subtype));
          }
          break;
      }
    }
  } catch (error) {
    onError?.(error);
  }
}
```

## Buffered Streaming

### Collecting Complete Responses

```javascript
async function collectResponse(prompt) {
  const responses = [];
  const toolCalls = [];

  for await (const msg of query({ prompt })) {
    if (msg.type === 'assistant') {
      responses.push(msg.message.content);
    }

    if (msg.type === 'tool_use') {
      toolCalls.push({
        tool: msg.tool_name,
        input: msg.input
      });
    }
  }

  return {
    response: responses.join('\n'),
    toolCalls
  };
}
```

### Chunked Processing

Process messages in batches for efficiency:

```javascript
async function processInChunks(prompt, batchSize = 10) {
  const buffer = [];

  for await (const msg of query({
    prompt,
    options: { includePartialMessages: true }
  })) {
    buffer.push(msg);

    if (buffer.length >= batchSize) {
      await processBatch(buffer.splice(0, batchSize));
    }
  }

  // Process remaining
  if (buffer.length > 0) {
    await processBatch(buffer);
  }
}

async function processBatch(messages) {
  // Process batch of messages
  for (const msg of messages) {
    // Handle each message
  }
}
```

## Timeout and Interruption

### Implementing Timeouts

```javascript
async function queryWithTimeout(prompt, timeoutMs = 30000) {
  const queryInstance = query({ prompt });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      queryInstance.interrupt();
      reject(new Error(`Query timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const results = [];

  try {
    for await (const msg of queryInstance) {
      results.push(msg);

      if (msg.type === 'result') {
        return { success: true, messages: results, result: msg };
      }
    }
  } catch (error) {
    if (error.message.includes('timed out')) {
      return { success: false, messages: results, error };
    }
    throw error;
  }
}
```

### Cancellation Support

```javascript
class CancellableQuery {
  constructor(prompt, options = {}) {
    this.prompt = prompt;
    this.options = options;
    this.queryInstance = null;
    this.cancelled = false;
  }

  async *run() {
    this.queryInstance = query({
      prompt: this.prompt,
      options: this.options
    });

    for await (const msg of this.queryInstance) {
      if (this.cancelled) {
        return;
      }
      yield msg;
    }
  }

  cancel() {
    this.cancelled = true;
    if (this.queryInstance) {
      this.queryInstance.interrupt();
    }
  }
}

// Usage
const q = new CancellableQuery("Write a book");

// Start processing
const iterator = q.run();

// Cancel after 5 seconds
setTimeout(() => q.cancel(), 5000);

for await (const msg of iterator) {
  console.log(msg);
}
```

## Node-RED Streaming Patterns

### Streaming Node with Multiple Outputs

```javascript
module.exports = function(RED) {
  const { query } = require("@anthropic-ai/claude-agent-sdk");

  function ClaudeStreamNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.on('input', async (msg, send, done) => {
      node.status({ fill: 'blue', shape: 'dot', text: 'streaming' });

      try {
        for await (const message of query({
          prompt: msg.payload,
          options: { includePartialMessages: true }
        })) {
          switch (message.type) {
            case 'assistantPartial':
              // Output 1: Streaming chunks
              send([{ payload: message.message.content, _msgid: msg._msgid }, null, null]);
              break;

            case 'tool_use':
              // Output 2: Tool events
              send([null, {
                payload: {
                  tool: message.tool_name,
                  input: message.input
                },
                _msgid: msg._msgid
              }, null]);
              break;

            case 'result':
              // Output 3: Completion
              send([null, null, {
                payload: {
                  status: message.subtype,
                  duration: message.duration_ms
                },
                _msgid: msg._msgid
              }]);

              node.status({
                fill: message.subtype === 'success' ? 'green' : 'red',
                shape: 'dot',
                text: `${message.subtype} (${message.duration_ms}ms)`
              });
              break;
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

### Event-Based Streaming

```javascript
const EventEmitter = require('events');

class ClaudeStreamer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
  }

  async stream(prompt) {
    this.emit('start', { prompt });

    try {
      for await (const msg of query({
        prompt,
        options: {
          ...this.options,
          includePartialMessages: true
        }
      })) {
        this.emit('message', msg);

        switch (msg.type) {
          case 'assistantPartial':
            this.emit('chunk', msg.message.content);
            break;
          case 'tool_use':
            this.emit('tool', msg.tool_name, msg.input);
            break;
          case 'result':
            this.emit('complete', msg);
            break;
        }
      }
    } catch (error) {
      this.emit('error', error);
    }
  }
}

// Usage in Node-RED
const streamer = new ClaudeStreamer({ model: 'claude-sonnet-4-5-20250514' });

streamer.on('chunk', (content) => {
  node.send([{ payload: content }, null]);
});

streamer.on('complete', (result) => {
  node.send([null, { payload: result }]);
});

streamer.on('error', (error) => {
  node.error(error);
});

streamer.stream(msg.payload);
```

## Backpressure Handling

### Controlled Consumption

```javascript
async function streamWithBackpressure(prompt, consumer) {
  const queue = [];
  let processing = false;

  async function processQueue() {
    if (processing || queue.length === 0) return;

    processing = true;
    while (queue.length > 0) {
      const msg = queue.shift();
      await consumer(msg);
    }
    processing = false;
  }

  for await (const msg of query({
    prompt,
    options: { includePartialMessages: true }
  })) {
    queue.push(msg);

    // Apply backpressure if queue grows too large
    if (queue.length > 100) {
      await processQueue();
    } else {
      processQueue(); // Don't await, let it run async
    }
  }

  // Process remaining
  await processQueue();
}
```

### Rate-Limited Streaming

```javascript
async function rateLimitedStream(prompt, msPerMessage = 50) {
  let lastEmit = 0;

  for await (const msg of query({
    prompt,
    options: { includePartialMessages: true }
  })) {
    const now = Date.now();
    const elapsed = now - lastEmit;

    if (elapsed < msPerMessage) {
      await new Promise(r => setTimeout(r, msPerMessage - elapsed));
    }

    yield msg;
    lastEmit = Date.now();
  }
}
```

## Memory-Efficient Streaming

### Streaming Large Outputs

```javascript
const fs = require('fs');

async function streamToFile(prompt, outputPath) {
  const writeStream = fs.createWriteStream(outputPath);

  for await (const msg of query({
    prompt,
    options: { includePartialMessages: true }
  })) {
    if (msg.type === 'assistantPartial') {
      // Write directly to file, don't accumulate in memory
      writeStream.write(msg.message.content);
    }

    if (msg.type === 'result') {
      writeStream.end();
      return msg;
    }
  }
}
```

### Streaming Transformation

```javascript
async function* transformStream(prompt, transformer) {
  for await (const msg of query({ prompt })) {
    if (msg.type === 'assistant') {
      yield {
        ...msg,
        message: {
          ...msg.message,
          content: transformer(msg.message.content)
        }
      };
    } else {
      yield msg;
    }
  }
}

// Usage: transform Markdown to HTML
const htmlStream = transformStream(
  "Write documentation in Markdown",
  (content) => markdownToHtml(content)
);

for await (const msg of htmlStream) {
  console.log(msg);
}
```
