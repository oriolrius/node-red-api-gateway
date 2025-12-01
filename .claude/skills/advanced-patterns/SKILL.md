---
name: advanced-patterns
description: Advanced software patterns for Node.js and Node-RED applications. This skill should be used when implementing factory patterns, configuration inheritance/composition, performance optimization (caching, pooling, batching), lifecycle management, or structured logging strategies.
---

# Advanced Patterns

This skill provides patterns for building maintainable, performant Node.js and Node-RED applications.

## When to Use This Skill

- Implementing factory patterns for dynamic object creation
- Designing configuration inheritance and composition
- Optimizing performance with caching, pooling, or batching
- Managing node lifecycle (initialization, shutdown, cleanup)
- Implementing structured logging and debugging

## Quick Reference

### Factory Pattern

Create objects dynamically based on configuration:

```javascript
class ClientFactory {
    static clients = new Map();

    static register(type, ClientClass) {
        this.clients.set(type, ClientClass);
    }

    static create(type, config) {
        const ClientClass = this.clients.get(type);
        if (!ClientClass) {
            throw new Error(`Unknown client type: ${type}`);
        }
        return new ClientClass(config);
    }
}

// Register implementations
ClientFactory.register('http', HttpClient);
ClientFactory.register('mqtt', MqttClient);
ClientFactory.register('kafka', KafkaClient);

// Usage
const client = ClientFactory.create(config.type, config);
```

### Configuration Composition

Merge configurations with defaults and overrides:

```javascript
function buildConfig(nodeConfig, configNode, defaults) {
    return {
        ...defaults,
        ...(configNode || {}),
        ...nodeConfig,
        // Nested merge for complex objects
        options: {
            ...defaults.options,
            ...(configNode?.options || {}),
            ...nodeConfig.options
        }
    };
}

// Usage with Node-RED
const defaults = { timeout: 30000, retries: 3 };
const serverConfig = RED.nodes.getNode(config.server);
const finalConfig = buildConfig(config, serverConfig, defaults);
```

### Connection Pooling

Reuse connections across nodes:

```javascript
class ConnectionPool {
    constructor(factory, options = {}) {
        this.factory = factory;
        this.maxSize = options.maxSize || 10;
        this.pool = [];
        this.inUse = new Set();
    }

    async acquire() {
        // Return available connection
        const available = this.pool.find(c => !this.inUse.has(c));
        if (available) {
            this.inUse.add(available);
            return available;
        }

        // Create new if under limit
        if (this.pool.length < this.maxSize) {
            const conn = await this.factory();
            this.pool.push(conn);
            this.inUse.add(conn);
            return conn;
        }

        // Wait for available
        return new Promise(resolve => {
            const check = setInterval(() => {
                const conn = this.pool.find(c => !this.inUse.has(c));
                if (conn) {
                    clearInterval(check);
                    this.inUse.add(conn);
                    resolve(conn);
                }
            }, 100);
        });
    }

    release(conn) {
        this.inUse.delete(conn);
    }
}
```

### Lifecycle Management

Standard Node-RED lifecycle pattern:

```javascript
function MyNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    // 1. Initialize state
    node.connected = false;
    node.client = null;

    // 2. Setup (async initialization)
    initializeAsync().catch(err => {
        node.error('Initialization failed: ' + err.message);
        node.status({ fill: "red", shape: "ring", text: "init failed" });
    });

    async function initializeAsync() {
        node.status({ fill: "yellow", shape: "ring", text: "connecting" });
        node.client = await createConnection(config);
        node.connected = true;
        node.status({ fill: "green", shape: "dot", text: "connected" });
    }

    // 3. Message handling
    node.on('input', function(msg, send, done) {
        if (!node.connected) {
            done(new Error('Not connected'));
            return;
        }
        // Process message
        done();
    });

    // 4. Cleanup
    node.on('close', function(removed, done) {
        node.connected = false;
        if (node.client) {
            node.client.close()
                .then(() => done())
                .catch(done);
        } else {
            done();
        }
    });
}
```

### Structured Logging

```javascript
function createLogger(node, options = {}) {
    const prefix = options.prefix || node.type;

    return {
        debug: (msg, data) => {
            if (options.debug) {
                node.log(`[${prefix}] DEBUG: ${msg}` + (data ? ` ${JSON.stringify(data)}` : ''));
            }
        },
        info: (msg, data) => {
            node.log(`[${prefix}] ${msg}` + (data ? ` ${JSON.stringify(data)}` : ''));
        },
        warn: (msg, data) => {
            node.warn(`[${prefix}] ${msg}` + (data ? ` ${JSON.stringify(data)}` : ''));
        },
        error: (msg, err) => {
            const errInfo = err ? `: ${err.message}` : '';
            node.error(`[${prefix}] ${msg}${errInfo}`);
        }
    };
}
```

## Reference Documentation

For detailed patterns and examples:

- `references/factory-pattern.md` - Factory methods, registry pattern, dynamic instantiation
- `references/configuration-composition.md` - Config inheritance, merging, validation
- `references/performance-optimization.md` - Caching, pooling, batching, lazy loading
- `references/lifecycle-management.md` - Initialization, shutdown, resource cleanup
- `references/pattern-decision-guide.md` - When to use which pattern

To search for specific patterns:
```bash
grep -r "pattern" references/
```

## Pattern Selection Guide

| Need | Pattern | Reference |
|------|---------|-----------|
| Multiple client types | Factory | `factory-pattern.md` |
| Shared configuration | Config Node + Composition | `configuration-composition.md` |
| Expensive object reuse | Connection Pool | `performance-optimization.md` |
| Reduce API calls | Caching | `performance-optimization.md` |
| Process in bulk | Batching | `performance-optimization.md` |
| Async startup | Lifecycle | `lifecycle-management.md` |
| Clean shutdown | Close handler | `lifecycle-management.md` |

## Common Mistakes

1. **Creating connections per message** - Use pooling or config nodes
2. **Blocking in message handler** - Use async patterns
3. **Ignoring close event** - Always clean up resources
4. **Hardcoding configuration** - Use composition with defaults
5. **Unbounded caches** - Implement TTL and size limits
6. **Silent failures** - Log errors with context
