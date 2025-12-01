---
name: node-red-node-development
description: Comprehensive guide for developing Node-RED nodes. This skill should be used when creating new Node-RED nodes, implementing node lifecycle handlers, building edit dialogs, managing configuration nodes, or packaging nodes for npm distribution.
---

# Node-RED Node Development

This skill provides patterns, APIs, and tools for developing custom Node-RED nodes.

## When to Use This Skill

- Creating new Node-RED nodes from scratch
- Implementing node message handling and lifecycle
- Building edit dialogs with HTML/jQuery
- Creating configuration nodes for shared state
- Setting up node status indicators
- Packaging nodes for npm distribution

## Quick Start

To scaffold a new node, run the initialization script:

```bash
# Regular node
python scripts/init_node.py my-node --path ./nodes

# Configuration node
python scripts/init_node.py my-config --config --path ./nodes
```

## Node Architecture

Every Node-RED node consists of two files:

### JavaScript File (.js)

Defines runtime behavior:

```javascript
module.exports = function(RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.on('input', function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments) };
            try {
                // Process message
                send(msg);
                done();
            } catch (err) {
                done(err);
            }
        });

        node.on('close', function(removed, done) {
            // Cleanup resources
            done();
        });
    }
    RED.nodes.registerType("my-node", MyNode);
}
```

### HTML File (.html)

Defines editor appearance with three `<script>` sections:

1. **Node registration** - `RED.nodes.registerType()`
2. **Edit template** - `data-template-name`
3. **Help text** - `data-help-name`

## Key Patterns

### Message Handling

```javascript
node.on('input', function(msg, send, done) {
    // Node-RED 1.0+ compatibility
    send = send || function() { node.send.apply(node, arguments) };

    // Process and send
    msg.payload = transform(msg.payload);
    send(msg);

    // Signal completion (triggers done/error)
    done();
});
```

### Error Handling

```javascript
try {
    // risky operation
} catch (err) {
    if (done) {
        done(err);  // Triggers Catch nodes
    } else {
        node.error(err, msg);  // Node-RED 0.x
    }
}
```

### Status Updates

```javascript
node.status({ fill: "green", shape: "dot", text: "connected" });
node.status({ fill: "red", shape: "ring", text: "disconnected" });
node.status({});  // Clear status
```

Status properties:
- `fill`: `"red"`, `"green"`, `"yellow"`, `"blue"`, `"grey"`
- `shape`: `"ring"` (outline), `"dot"` (filled)
- `text`: Short string (under 20 characters)

### Configuration Nodes

For shared connections/state:

```javascript
// In config node
RED.nodes.registerType("my-server", MyServerNode, {
    credentials: {
        username: { type: "text" },
        password: { type: "password" }
    }
});

// In client node - reference config
this.server = RED.nodes.getNode(config.server);
if (this.server) {
    var connection = this.server.getConnection();
}
```

### Cleanup (close event)

```javascript
node.on('close', function(removed, done) {
    if (removed) {
        // Node disabled or deleted
    } else {
        // Flow redeploying
    }
    // Async cleanup with 15-second timeout
    disconnect(done);
});
```

## HTML Edit Dialog

### Input Naming Convention

- Regular nodes: `id="node-input-<property>"`
- Config nodes: `id="node-config-input-<property>"`

### Form Structure

```html
<script type="text/html" data-template-name="my-node">
    <div class="form-row">
        <label for="node-input-name">
            <i class="fa fa-tag"></i> Name
        </label>
        <input type="text" id="node-input-name">
    </div>
</script>
```

### Editor Hooks

```javascript
RED.nodes.registerType('my-node', {
    oneditprepare: function() {
        // Dialog opening - initialize widgets
    },
    oneditsave: function() {
        // User clicked Done - return false to cancel
    },
    oneditcancel: function() {
        // User clicked Cancel
    }
});
```

## Packaging

### package.json Structure

```json
{
    "name": "@scope/node-red-my-nodes",
    "version": "1.0.0",
    "keywords": ["node-red"],
    "node-red": {
        "version": ">=2.0.0",
        "nodes": {
            "my-node": "nodes/my-node.js"
        }
    }
}
```

**Important:** Since January 2022, all new packages must use scoped names.

### Local Testing

```bash
cd ~/.node-red
npm install /path/to/your/node
# Restart Node-RED
```

## Reference Documentation

For detailed API documentation, consult the references directory:

- `references/node-js-api.md` - JavaScript API (send, receive, close, status, logging)
- `references/node-html-api.md` - HTML API (registration, edit dialog, help text)
- `references/config-nodes.md` - Configuration node patterns
- `references/status-and-context.md` - Status indicators and context storage
- `references/packaging.md` - npm packaging and publishing

To search for specific API patterns:
```bash
grep -r "pattern" references/
```

## Common Mistakes to Avoid

1. **Forgetting `RED.nodes.createNode()`** - Must be called first in constructor
2. **Not handling Node-RED 0.x compatibility** - Use `send = send || ...` pattern
3. **Blocking in input handler** - Use async patterns for I/O
4. **Not cleaning up in close** - Always handle the `close` event
5. **Wrong input ID prefix** - `node-input-` vs `node-config-input-`
6. **Mismatched type names** - JS and HTML `registerType` must match
7. **Missing credentials in both files** - Define in both JS and HTML
8. **Exceeding 15-second close timeout** - Runtime will force-kill
