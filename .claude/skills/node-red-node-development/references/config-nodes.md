# Node-RED Configuration Nodes Reference

> Source: https://nodered.org/docs/creating-nodes/config-nodes

## Overview

Configuration nodes share state and connections across multiple nodes. Examples:
- MQTT broker connection shared by MQTT In/Out nodes
- Database connection shared by query nodes
- API credentials shared by API nodes

## Defining a Configuration Node

### Two Key Requirements

1. Set `category` to `"config"`
2. Use `node-config-input-<propertyname>` for input IDs

## Complete Example

### HTML File (remote-server.html)

```html
<script type="text/javascript">
    RED.nodes.registerType('remote-server', {
        category: 'config',
        defaults: {
            name: { value: "" },
            host: { value: "localhost", required: true },
            port: { value: 1234, required: true, validate: RED.validators.number() }
        },
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        },
        label: function() {
            if (this.name) {
                return this.name;
            }
            return this.host + ":" + this.port;
        }
    });
</script>

<script type="text/html" data-template-name="remote-server">
    <div class="form-row">
        <label for="node-config-input-name">
            <i class="fa fa-tag"></i> Name
        </label>
        <input type="text" id="node-config-input-name" placeholder="Optional name">
    </div>
    <div class="form-row">
        <label for="node-config-input-host">
            <i class="fa fa-server"></i> Host
        </label>
        <input type="text" id="node-config-input-host">
    </div>
    <div class="form-row">
        <label for="node-config-input-port">
            <i class="fa fa-hashtag"></i> Port
        </label>
        <input type="text" id="node-config-input-port">
    </div>
    <div class="form-row">
        <label for="node-config-input-username">
            <i class="fa fa-user"></i> Username
        </label>
        <input type="text" id="node-config-input-username">
    </div>
    <div class="form-row">
        <label for="node-config-input-password">
            <i class="fa fa-lock"></i> Password
        </label>
        <input type="password" id="node-config-input-password">
    </div>
</script>

<script type="text/html" data-help-name="remote-server">
    <p>Configuration for connecting to a remote server.</p>
    <h3>Settings</h3>
    <dl class="message-properties">
        <dt>Host <span class="property-type">string</span></dt>
        <dd>The hostname or IP address of the server.</dd>
        <dt>Port <span class="property-type">number</span></dt>
        <dd>The port number to connect to.</dd>
    </dl>
</script>
```

### JavaScript File (remote-server.js)

```javascript
module.exports = function(RED) {
    function RemoteServerNode(config) {
        RED.nodes.createNode(this, config);

        // Store configuration
        this.name = config.name;
        this.host = config.host;
        this.port = config.port;

        // Store credentials (from this.credentials)
        this.username = this.credentials.username;
        this.password = this.credentials.password;

        var node = this;

        // Create shared connection
        this.client = null;

        this.connect = function() {
            if (!node.client) {
                node.client = createConnection({
                    host: node.host,
                    port: node.port,
                    username: node.username,
                    password: node.password
                });
            }
            return node.client;
        };

        this.disconnect = function(callback) {
            if (node.client) {
                node.client.close(callback);
                node.client = null;
            } else if (callback) {
                callback();
            }
        };

        // Cleanup on node close
        this.on('close', function(done) {
            node.disconnect(done);
        });
    }

    RED.nodes.registerType("remote-server", RemoteServerNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });
}
```

## Using Configuration Nodes

### Reference in Defaults

Add a property with `type` matching the config node type:

```javascript
RED.nodes.registerType('my-node', {
    category: 'function',
    defaults: {
        name: { value: "" },
        server: { value: "", type: "remote-server" }  // Reference to config node
    },
    // ...
});
```

The editor automatically shows a dropdown with available config instances.

### Access at Runtime

```javascript
module.exports = function(RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Get the config node instance
        this.server = RED.nodes.getNode(config.server);

        if (this.server) {
            // Access config node properties
            node.log("Connecting to " + this.server.host + ":" + this.server.port);

            // Use shared connection
            var client = this.server.connect();

            node.on('input', function(msg, send, done) {
                client.send(msg.payload, function(err) {
                    if (err) {
                        done(err);
                    } else {
                        done();
                    }
                });
            });
        } else {
            node.error("No server configuration");
        }
    }

    RED.nodes.registerType("my-node", MyNode);
}
```

## Connection Management Pattern

### Config Node with Connection Pooling

```javascript
module.exports = function(RED) {
    function BrokerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        this.host = config.host;
        this.port = config.port;

        // Track connected nodes
        this.users = {};
        this.client = null;
        this.connecting = false;

        this.register = function(clientNode) {
            node.users[clientNode.id] = clientNode;
            if (Object.keys(node.users).length === 1) {
                node.connect();
            }
        };

        this.deregister = function(clientNode, done) {
            delete node.users[clientNode.id];
            if (Object.keys(node.users).length === 0) {
                node.disconnect(done);
            } else {
                done();
            }
        };

        this.connect = function() {
            if (node.client || node.connecting) return;
            node.connecting = true;

            node.client = createConnection({
                host: node.host,
                port: node.port
            });

            node.client.on('connect', function() {
                node.connecting = false;
                for (var id in node.users) {
                    node.users[id].status({fill:"green", shape:"dot", text:"connected"});
                }
            });

            node.client.on('disconnect', function() {
                for (var id in node.users) {
                    node.users[id].status({fill:"red", shape:"ring", text:"disconnected"});
                }
            });

            node.client.on('error', function(err) {
                node.error(err);
            });
        };

        this.disconnect = function(done) {
            if (node.client) {
                node.client.close(function() {
                    node.client = null;
                    done();
                });
            } else {
                done();
            }
        };

        this.on('close', function(done) {
            node.disconnect(done);
        });
    }

    RED.nodes.registerType("broker", BrokerNode);
}
```

### Client Node Using Connection Pool

```javascript
module.exports = function(RED) {
    function ClientNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        this.broker = RED.nodes.getNode(config.broker);

        if (this.broker) {
            // Register with broker
            this.broker.register(this);

            node.on('input', function(msg, send, done) {
                if (node.broker.client) {
                    node.broker.client.publish(msg.topic, msg.payload, done);
                } else {
                    done(new Error("Not connected"));
                }
            });

            node.on('close', function(done) {
                node.broker.deregister(node, done);
            });
        } else {
            node.error("No broker configured");
        }
    }

    RED.nodes.registerType("client", ClientNode);
}
```

## Scope

Configuration nodes are **globally scoped** by default:
- Shared across all flows
- Cannot reliably access flow context
- State persists across flow deployments

## Best Practices

1. **Implement cleanup** - Always handle the `close` event
2. **Track users** - Keep track of nodes using the config for proper connection management
3. **Provide status** - Update dependent nodes' status when connection state changes
4. **Handle errors** - Propagate errors to dependent nodes
5. **Lazy connection** - Only connect when first user registers
6. **Connection pooling** - Reuse connections across multiple nodes
