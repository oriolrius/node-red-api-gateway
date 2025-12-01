# Node-RED Status and Context Reference

> Sources:
> - https://nodered.org/docs/creating-nodes/status
> - https://nodered.org/docs/creating-nodes/context

## Node Status

Nodes can display status indicators in the editor UI to show current state.

### Setting Status

```javascript
// Show connected status
node.status({ fill: "green", shape: "dot", text: "connected" });

// Show disconnected status
node.status({ fill: "red", shape: "ring", text: "disconnected" });

// Show warning status
node.status({ fill: "yellow", shape: "ring", text: "reconnecting..." });

// Show info status
node.status({ fill: "blue", shape: "dot", text: "processing" });

// Show neutral status
node.status({ fill: "grey", shape: "ring", text: "idle" });
```

### Status Object Properties

| Property | Values | Description |
|----------|--------|-------------|
| `fill` | `"red"`, `"green"`, `"yellow"`, `"blue"`, `"grey"` | Status indicator color |
| `shape` | `"ring"`, `"dot"` | Indicator shape (ring=outline, dot=filled) |
| `text` | string | Short status text (keep under 20 characters) |

### Clearing Status

```javascript
node.status({});
```

### Status Patterns

```javascript
module.exports = function(RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Initial status
        node.status({ fill: "grey", shape: "ring", text: "initializing" });

        // Connection status pattern
        function setConnected() {
            node.status({ fill: "green", shape: "dot", text: "connected" });
        }

        function setDisconnected() {
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        }

        function setConnecting() {
            node.status({ fill: "yellow", shape: "ring", text: "connecting..." });
        }

        function setError(message) {
            node.status({ fill: "red", shape: "dot", text: message });
        }

        // Message count pattern
        var messageCount = 0;
        node.on('input', function(msg, send, done) {
            messageCount++;
            node.status({ fill: "blue", shape: "dot", text: messageCount + " messages" });
            send(msg);
            done();
        });

        // Rate/throughput pattern
        var lastTime = Date.now();
        var count = 0;
        node.on('input', function(msg, send, done) {
            count++;
            var now = Date.now();
            if (now - lastTime > 1000) {
                var rate = Math.round(count / ((now - lastTime) / 1000));
                node.status({ fill: "green", shape: "dot", text: rate + " msg/s" });
                count = 0;
                lastTime = now;
            }
            send(msg);
            done();
        });
    }
    RED.nodes.registerType("my-node", MyNode);
}
```

### Status Node

The Status node can catch status updates from other nodes:

```javascript
// This status update can trigger Status nodes on same tab
node.status({ fill: "green", shape: "dot", text: "ready" });
```

Users can connect Status nodes to react to status changes.

### Display Control

Users can toggle status display via the editor's dropdown menu: "Display Node Status"

---

## Node Context

Nodes can store data in context objects at three scope levels.

### Context Scopes

| Scope | Access | Persistence |
|-------|--------|-------------|
| Node | Private to node instance | Lost on redeploy |
| Flow | Shared with nodes on same flow/tab | Lost on redeploy |
| Global | Shared across all flows | Lost on restart* |

*Unless persistent context store configured

### Accessing Context

```javascript
module.exports = function(RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Node context - private to this node instance
        var nodeContext = this.context();

        // Flow context - shared with nodes on same flow
        var flowContext = this.context().flow;

        // Global context - shared across all flows
        var globalContext = this.context().global;

        node.on('input', function(msg, send, done) {
            // Node context operations
            var count = nodeContext.get('count') || 0;
            count++;
            nodeContext.set('count', count);

            // Flow context operations
            var sharedData = flowContext.get('sharedData');
            flowContext.set('lastMessage', msg.payload);

            // Global context operations
            var globalConfig = globalContext.get('config');
            globalContext.set('lastActive', Date.now());

            send(msg);
            done();
        });
    }
    RED.nodes.registerType("my-node", MyNode);
}
```

### Context API

```javascript
// Get a value
var value = context.get('key');

// Set a value
context.set('key', value);

// Get multiple values
var values = context.get(['key1', 'key2']);
// Returns: [value1, value2]

// Set multiple values
context.set(['key1', 'key2'], [value1, value2]);

// Get all keys
var keys = context.keys();
```

### Asynchronous Context Access

For persistent context stores:

```javascript
// Async get
context.get('key', function(err, value) {
    if (err) {
        node.error(err);
    } else {
        // Use value
    }
});

// Async set
context.set('key', value, function(err) {
    if (err) {
        node.error(err);
    }
});

// Using specific store
context.get('key', 'file', function(err, value) {
    // Retrieved from 'file' context store
});

context.set('key', value, 'file', function(err) {
    // Saved to 'file' context store
});
```

### Context Patterns

#### Counter Pattern

```javascript
node.on('input', function(msg, send, done) {
    var context = this.context();
    var count = context.get('count') || 0;
    count++;
    context.set('count', count);
    msg.count = count;
    send(msg);
    done();
});
```

#### Caching Pattern

```javascript
node.on('input', function(msg, send, done) {
    var flowContext = this.context().flow;
    var cacheKey = 'cache_' + msg.topic;
    var cached = flowContext.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < 60000)) {
        // Use cached value (less than 1 minute old)
        msg.payload = cached.value;
        msg.cached = true;
        send(msg);
        done();
    } else {
        // Fetch fresh data
        fetchData(msg.topic, function(err, result) {
            if (err) {
                done(err);
            } else {
                flowContext.set(cacheKey, {
                    value: result,
                    timestamp: Date.now()
                });
                msg.payload = result;
                msg.cached = false;
                send(msg);
                done();
            }
        });
    }
});
```

#### State Machine Pattern

```javascript
node.on('input', function(msg, send, done) {
    var context = this.context();
    var state = context.get('state') || 'idle';

    switch (state) {
        case 'idle':
            if (msg.topic === 'start') {
                context.set('state', 'running');
                node.status({ fill: "green", shape: "dot", text: "running" });
            }
            break;
        case 'running':
            if (msg.topic === 'stop') {
                context.set('state', 'idle');
                node.status({ fill: "grey", shape: "ring", text: "idle" });
            } else if (msg.topic === 'data') {
                // Process data
                send(msg);
            }
            break;
    }
    done();
});
```

#### Aggregation Pattern

```javascript
node.on('input', function(msg, send, done) {
    var context = this.context();
    var buffer = context.get('buffer') || [];
    var batchSize = 10;

    buffer.push(msg.payload);

    if (buffer.length >= batchSize) {
        // Send aggregated data
        send({ payload: buffer });
        context.set('buffer', []);
    } else {
        context.set('buffer', buffer);
    }
    done();
});
```

### Important Notes

1. **Configuration nodes** are globally scoped - they cannot reliably access flow context
2. **Context is not persistent** by default - data is lost on restart
3. **Use sparingly** - excessive context usage can impact performance
4. **Clean up** - consider clearing context in the `close` event if needed

```javascript
node.on('close', function(done) {
    // Clear node context on removal
    var context = this.context();
    context.set('data', null);
    done();
});
```
