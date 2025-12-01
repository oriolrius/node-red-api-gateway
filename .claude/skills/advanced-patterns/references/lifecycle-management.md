# Lifecycle Management

## Node-RED Node Lifecycle

### Lifecycle Phases

```
┌─────────────────────────────────────────────────────────┐
│                    Node Lifecycle                       │
├─────────────────────────────────────────────────────────┤
│  1. Constructor    → Node created, config available     │
│  2. Initialization → Setup connections, state          │
│  3. Ready          → Process messages                   │
│  4. Close          → Cleanup resources                  │
└─────────────────────────────────────────────────────────┘
```

### Standard Lifecycle Pattern

```javascript
function MyNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    // ============================================
    // PHASE 1: Constructor - Synchronous Setup
    // ============================================

    // Initialize state
    node.connected = false;
    node.client = null;
    node.messageQueue = [];

    // Store configuration
    node.config = {
        host: config.host,
        port: config.port,
        timeout: config.timeout || 30000
    };

    // Get config node
    node.server = RED.nodes.getNode(config.server);

    // ============================================
    // PHASE 2: Async Initialization
    // ============================================

    node.status({ fill: "yellow", shape: "ring", text: "initializing" });

    initialize()
        .then(() => {
            node.connected = true;
            node.status({ fill: "green", shape: "dot", text: "connected" });

            // Process queued messages
            processQueue();
        })
        .catch(err => {
            node.error('Initialization failed: ' + err.message);
            node.status({ fill: "red", shape: "ring", text: "init failed" });
        });

    async function initialize() {
        // Validate configuration
        if (!node.server) {
            throw new Error('Server configuration required');
        }

        // Create client
        node.client = await createClient(node.config);

        // Setup event handlers
        node.client.on('disconnect', handleDisconnect);
        node.client.on('error', handleError);
        node.client.on('reconnect', handleReconnect);
    }

    // ============================================
    // PHASE 3: Message Processing
    // ============================================

    node.on('input', function(msg, send, done) {
        send = send || function() { node.send.apply(node, arguments) };

        if (!node.connected) {
            // Queue message if not connected
            node.messageQueue.push({ msg, send, done });
            return;
        }

        processMessage(msg, send, done);
    });

    async function processMessage(msg, send, done) {
        try {
            const result = await node.client.process(msg.payload);
            msg.payload = result;
            send(msg);
            done();
        } catch (err) {
            done(err);
        }
    }

    function processQueue() {
        while (node.messageQueue.length > 0 && node.connected) {
            const { msg, send, done } = node.messageQueue.shift();
            processMessage(msg, send, done);
        }
    }

    // ============================================
    // PHASE 4: Cleanup
    // ============================================

    node.on('close', function(removed, done) {
        cleanup(removed)
            .then(() => done())
            .catch(err => {
                node.error('Cleanup error: ' + err.message);
                done();
            });
    });

    async function cleanup(removed) {
        node.connected = false;

        // Clear pending messages
        node.messageQueue.forEach(({ done }) => {
            done(new Error('Node closing'));
        });
        node.messageQueue = [];

        // Close client
        if (node.client) {
            await node.client.close();
            node.client = null;
        }

        if (removed) {
            // Node was deleted - additional cleanup if needed
        }
    }

    // ============================================
    // Event Handlers
    // ============================================

    function handleDisconnect() {
        node.connected = false;
        node.status({ fill: "red", shape: "ring", text: "disconnected" });
    }

    function handleError(err) {
        node.error('Client error: ' + err.message);
    }

    function handleReconnect() {
        node.connected = true;
        node.status({ fill: "green", shape: "dot", text: "connected" });
        processQueue();
    }
}
```

## Initialization Patterns

### Eager Initialization

Connect immediately in constructor:

```javascript
function EagerNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    // Start connection immediately
    node.status({ fill: "yellow", shape: "ring", text: "connecting" });

    createConnection(config)
        .then(client => {
            node.client = client;
            node.status({ fill: "green", shape: "dot", text: "connected" });
        })
        .catch(err => {
            node.error('Connection failed: ' + err.message);
            node.status({ fill: "red", shape: "ring", text: "error" });
        });

    // Messages will error until connected
    node.on('input', function(msg, send, done) {
        if (!node.client) {
            done(new Error('Not connected'));
            return;
        }
        // Process message
    });
}
```

### Lazy Initialization

Connect on first message:

```javascript
function LazyNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    node.client = null;
    node.connecting = null;

    async function ensureConnected() {
        if (node.client) return node.client;

        if (node.connecting) return node.connecting;

        node.status({ fill: "yellow", shape: "ring", text: "connecting" });

        node.connecting = createConnection(config)
            .then(client => {
                node.client = client;
                node.connecting = null;
                node.status({ fill: "green", shape: "dot", text: "connected" });
                return client;
            })
            .catch(err => {
                node.connecting = null;
                node.status({ fill: "red", shape: "ring", text: "error" });
                throw err;
            });

        return node.connecting;
    }

    node.on('input', async function(msg, send, done) {
        try {
            const client = await ensureConnected();
            const result = await client.process(msg.payload);
            msg.payload = result;
            send(msg);
            done();
        } catch (err) {
            done(err);
        }
    });

    node.on('close', function(done) {
        if (node.client) {
            node.client.close().then(done).catch(done);
        } else {
            done();
        }
    });
}
```

### Initialization with Retry

```javascript
function RetryInitNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    node.client = null;
    node.retryCount = 0;
    const maxRetries = config.maxRetries || 5;
    const retryDelay = config.retryDelay || 5000;

    async function initialize() {
        while (node.retryCount < maxRetries) {
            try {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: node.retryCount > 0 ?
                        `retry ${node.retryCount}/${maxRetries}` :
                        "connecting"
                });

                node.client = await createConnection(config);
                node.retryCount = 0;
                node.status({ fill: "green", shape: "dot", text: "connected" });

                // Setup reconnection on disconnect
                node.client.on('disconnect', () => {
                    node.client = null;
                    node.status({ fill: "red", shape: "ring", text: "disconnected" });
                    initialize();
                });

                return;
            } catch (err) {
                node.retryCount++;
                node.warn(`Connection attempt ${node.retryCount} failed: ${err.message}`);

                if (node.retryCount >= maxRetries) {
                    node.error('Max retries exceeded');
                    node.status({ fill: "red", shape: "ring", text: "failed" });
                    return;
                }

                await sleep(retryDelay * node.retryCount); // Exponential backoff
            }
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Start initialization
    initialize();
}
```

## Graceful Shutdown

### Basic Cleanup

```javascript
node.on('close', function(removed, done) {
    // removed: true if node was deleted, false if flow redeploying

    // Clear timers
    if (node.timer) {
        clearInterval(node.timer);
        node.timer = null;
    }

    // Close connections
    if (node.client) {
        node.client.close()
            .then(() => done())
            .catch(done);
    } else {
        done();
    }
});
```

### Cleanup with Timeout

Node-RED gives 15 seconds for cleanup. Ensure completion within limit:

```javascript
node.on('close', function(removed, done) {
    const timeout = 10000; // 10 seconds, leave margin

    const cleanup = async () => {
        // Stop accepting new work
        node.closing = true;

        // Wait for in-flight operations
        if (node.pendingOperations > 0) {
            await waitForPending(5000);
        }

        // Close connections
        if (node.client) {
            await node.client.close();
        }

        // Clear state
        node.client = null;
    };

    // Race cleanup against timeout
    Promise.race([
        cleanup(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Cleanup timeout')), timeout)
        )
    ])
    .then(() => done())
    .catch(err => {
        node.warn('Cleanup incomplete: ' + err.message);
        done();
    });
});

async function waitForPending(maxWait) {
    const start = Date.now();
    while (node.pendingOperations > 0 && Date.now() - start < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
```

### Drain Pattern

Complete pending work before shutdown:

```javascript
function DrainableNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    node.processing = new Set();
    node.draining = false;

    node.on('input', async function(msg, send, done) {
        if (node.draining) {
            done(new Error('Node is shutting down'));
            return;
        }

        const id = msg._msgid;
        node.processing.add(id);

        try {
            await processMessage(msg);
            send(msg);
            done();
        } catch (err) {
            done(err);
        } finally {
            node.processing.delete(id);
        }
    });

    node.on('close', function(removed, done) {
        node.draining = true;
        node.status({ fill: "yellow", shape: "ring", text: "draining" });

        drain()
            .then(() => done())
            .catch(err => {
                node.warn('Drain incomplete: ' + err.message);
                done();
            });
    });

    async function drain() {
        const maxWait = 10000;
        const start = Date.now();

        while (node.processing.size > 0) {
            if (Date.now() - start > maxWait) {
                throw new Error(`${node.processing.size} operations still pending`);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Close client after all processing complete
        if (node.client) {
            await node.client.close();
        }
    }
}
```

## Resource Management

### Automatic Resource Cleanup

```javascript
class ResourceManager {
    constructor() {
        this.resources = new Set();
    }

    track(resource) {
        this.resources.add(resource);
        return resource;
    }

    async release(resource) {
        if (this.resources.has(resource)) {
            this.resources.delete(resource);
            if (resource.close) {
                await resource.close();
            }
        }
    }

    async releaseAll() {
        const promises = [];
        for (const resource of this.resources) {
            if (resource.close) {
                promises.push(resource.close().catch(() => {}));
            }
        }
        await Promise.all(promises);
        this.resources.clear();
    }
}

// Usage in node
function MyNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    const resources = new ResourceManager();

    // Track all created resources
    node.client = resources.track(createClient(config));
    node.cache = resources.track(createCache());
    node.pool = resources.track(createPool());

    node.on('close', function(done) {
        resources.releaseAll()
            .then(() => done())
            .catch(done);
    });
}
```

### Timer Management

```javascript
class TimerManager {
    constructor() {
        this.timers = new Set();
    }

    setTimeout(fn, delay) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            fn();
        }, delay);
        this.timers.add(timer);
        return timer;
    }

    setInterval(fn, delay) {
        const timer = setInterval(fn, delay);
        this.timers.add(timer);
        return timer;
    }

    clear(timer) {
        if (this.timers.has(timer)) {
            clearTimeout(timer);
            clearInterval(timer);
            this.timers.delete(timer);
        }
    }

    clearAll() {
        for (const timer of this.timers) {
            clearTimeout(timer);
            clearInterval(timer);
        }
        this.timers.clear();
    }
}

// Usage
const timers = new TimerManager();

// Schedule work
timers.setInterval(() => checkConnection(), 5000);
timers.setTimeout(() => sendHeartbeat(), 1000);

// Cleanup
node.on('close', function(done) {
    timers.clearAll();
    done();
});
```

## State Machines

### Connection State Machine

```javascript
const ConnectionState = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    CLOSING: 'closing',
    CLOSED: 'closed'
};

class ConnectionStateMachine {
    constructor(node) {
        this.node = node;
        this.state = ConnectionState.DISCONNECTED;
        this.client = null;
    }

    async connect() {
        if (this.state !== ConnectionState.DISCONNECTED) {
            throw new Error(`Cannot connect from state: ${this.state}`);
        }

        this.transition(ConnectionState.CONNECTING);

        try {
            this.client = await createConnection();
            this.transition(ConnectionState.CONNECTED);
        } catch (err) {
            this.transition(ConnectionState.DISCONNECTED);
            throw err;
        }
    }

    async disconnect() {
        if (this.state === ConnectionState.CLOSED) return;

        this.transition(ConnectionState.CLOSING);

        if (this.client) {
            await this.client.close();
            this.client = null;
        }

        this.transition(ConnectionState.CLOSED);
    }

    async reconnect() {
        if (this.state !== ConnectionState.DISCONNECTED) return;

        this.transition(ConnectionState.RECONNECTING);

        try {
            this.client = await createConnection();
            this.transition(ConnectionState.CONNECTED);
        } catch (err) {
            this.transition(ConnectionState.DISCONNECTED);
        }
    }

    transition(newState) {
        const oldState = this.state;
        this.state = newState;

        // Update node status
        const statusMap = {
            [ConnectionState.DISCONNECTED]: { fill: "red", shape: "ring", text: "disconnected" },
            [ConnectionState.CONNECTING]: { fill: "yellow", shape: "ring", text: "connecting" },
            [ConnectionState.CONNECTED]: { fill: "green", shape: "dot", text: "connected" },
            [ConnectionState.RECONNECTING]: { fill: "yellow", shape: "ring", text: "reconnecting" },
            [ConnectionState.CLOSING]: { fill: "yellow", shape: "ring", text: "closing" },
            [ConnectionState.CLOSED]: { fill: "grey", shape: "ring", text: "closed" }
        };

        this.node.status(statusMap[newState]);
        this.node.log(`State: ${oldState} -> ${newState}`);
    }

    isReady() {
        return this.state === ConnectionState.CONNECTED;
    }
}
```

## Best Practices

### Do

- Initialize asynchronously, don't block constructor
- Handle the close event in every node
- Clear all timers and intervals
- Wait for in-flight operations when possible
- Use status indicators for lifecycle state

### Don't

- Assume resources exist (check for null)
- Block in close handler beyond timeout
- Leave event listeners attached
- Ignore cleanup errors
- Store state that survives redeploy (use context)

### Cleanup Checklist

```javascript
node.on('close', function(removed, done) {
    // 1. Stop accepting new work
    node.stopping = true;

    // 2. Clear timers
    timers.clearAll();

    // 3. Clear queues
    node.queue = [];

    // 4. Cancel pending operations
    for (const op of node.pending) {
        op.cancel();
    }

    // 5. Close connections
    if (node.client) {
        node.client.close()
            .catch(err => node.warn('Close error: ' + err.message))
            .finally(() => {
                // 6. Clear references
                node.client = null;
                done();
            });
    } else {
        done();
    }
});
```
