# Node-RED Node JavaScript API Reference

> Source: https://nodered.org/docs/creating-nodes/node-js

## Overview

The `.js` file defines the runtime behavior of a Node-RED node.

## Node Constructor Pattern

```javascript
module.exports = function(RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Node initialization code here
    }
    RED.nodes.registerType("my-node", MyNode);
}
```

### Key Points
- Module exports a function receiving `RED` (runtime API)
- Constructor receives `config` object with node properties
- Must call `RED.nodes.createNode(this, config)` first
- `RED.nodes.registerType()` registers node with runtime

## Receiving Messages

```javascript
node.on('input', function(msg, send, done) {
    // Process message

    // For Node-RED 1.0+ compatibility
    send = send || function() { node.send.apply(node, arguments) };

    // Signal completion
    if (done) {
        done();
    }
});
```

### Parameters (Node-RED 1.0+)
- `msg` - The incoming message object
- `send` - Function to send messages (use instead of `node.send` inside handler)
- `done` - Function to signal message handling complete

### Error Handling

```javascript
node.on('input', function(msg, send, done) {
    try {
        // Process message
        send(msg);
        done();
    } catch (err) {
        if (done) {
            done(err);  // Triggers Catch nodes
        } else {
            node.error(err, msg);  // Node-RED 0.x compatibility
        }
    }
});
```

## Sending Messages

### Single Output
```javascript
node.send(msg);
```

### Multiple Outputs
```javascript
// Send msg1 to first output, msg2 to second output
node.send([msg1, msg2]);
```

### Multiple Messages to One Output
```javascript
// Send three messages to first output, one to second
node.send([[msgA1, msgA2, msgA3], msg2]);
```

### No Message to an Output
```javascript
// Send to second output only
node.send([null, msg2]);
```

## Node Cleanup (close event)

### Synchronous Cleanup
```javascript
node.on('close', function() {
    // Cleanup resources
});
```

### Asynchronous Cleanup (Node-RED 0.17+)
```javascript
node.on('close', function(removed, done) {
    if (removed) {
        // Node has been disabled or deleted
    } else {
        // Node is being restarted (flow redeployed)
    }

    // Perform async cleanup
    connection.disconnect(function() {
        done();
    });
});
```

**Important:** Runtime enforces 15-second timeout on cleanup operations.

## Logging

```javascript
node.log("Something happened");
node.warn("Something you should know about");
node.error("Something bad happened");
node.trace("Internal details");      // Node-RED 0.17+
node.debug("Debugging information"); // Node-RED 0.17+
```

## Setting Status

```javascript
// Set status
node.status({fill: "red", shape: "ring", text: "disconnected"});
node.status({fill: "green", shape: "dot", text: "connected"});

// Clear status
node.status({});
```

### Status Properties
- `fill`: `"red"`, `"green"`, `"yellow"`, `"blue"`, `"grey"`
- `shape`: `"ring"`, `"dot"`
- `text`: Short string (under 20 characters)

## Custom Node Settings

Register custom settings exposed to editor:

```javascript
RED.nodes.registerType("sample", SampleNode, {
    settings: {
        sampleNodeColour: {
            value: "red",        // Default value
            exportable: true     // Expose to editor
        }
    }
});
```

### Naming Convention
- Prefix with node type name (camelCase)
- Example: `sample-node` type + `colour` setting = `sampleNodeColour`

### Access in Editor
```javascript
RED.settings.sampleNodeColour
```

## Credentials

Register credential properties (not exported with flows):

```javascript
RED.nodes.registerType("my-node", MyNode, {
    credentials: {
        username: { type: "text" },
        password: { type: "password" }
    }
});
```

### Access in Node
```javascript
function MyNode(config) {
    RED.nodes.createNode(this, config);

    var username = this.credentials.username;
    var password = this.credentials.password;
}
```

## Context Storage

```javascript
// Node context (private to this node instance)
var nodeContext = this.context();
nodeContext.set('count', 0);
var count = nodeContext.get('count');

// Flow context (shared with nodes on same flow)
var flowContext = this.context().flow;
flowContext.set('sharedData', data);

// Global context (shared across all flows)
var globalContext = this.context().global;
globalContext.set('globalData', data);
```

## Accessing Configuration Nodes

```javascript
function MyNode(config) {
    RED.nodes.createNode(this, config);

    // Get config node by its ID
    this.server = RED.nodes.getNode(config.server);

    if (this.server) {
        // Access config properties
        console.log(this.server.host);
        console.log(this.server.port);
    } else {
        // Config node not found
        this.error("Missing server configuration");
    }
}
```
