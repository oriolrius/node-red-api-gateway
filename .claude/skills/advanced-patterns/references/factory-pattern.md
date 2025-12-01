# Factory Pattern

## Overview

The Factory Pattern creates objects without exposing instantiation logic. It's useful when:
- Multiple implementations share a common interface
- Object creation requires complex setup
- The concrete type is determined at runtime

## Basic Factory

### Simple Factory Function

```javascript
function createClient(type, config) {
    switch (type) {
        case 'http':
            return new HttpClient(config);
        case 'mqtt':
            return new MqttClient(config);
        case 'kafka':
            return new KafkaClient(config);
        default:
            throw new Error(`Unknown client type: ${type}`);
    }
}

// Usage
const client = createClient(config.protocol, config);
```

### Factory Class with Registry

```javascript
class ClientFactory {
    static registry = new Map();

    static register(type, ClientClass) {
        this.registry.set(type, ClientClass);
    }

    static create(type, config) {
        const ClientClass = this.registry.get(type);
        if (!ClientClass) {
            const available = Array.from(this.registry.keys()).join(', ');
            throw new Error(`Unknown client type: ${type}. Available: ${available}`);
        }
        return new ClientClass(config);
    }

    static has(type) {
        return this.registry.has(type);
    }

    static types() {
        return Array.from(this.registry.keys());
    }
}

// Register implementations
ClientFactory.register('http', HttpClient);
ClientFactory.register('mqtt', MqttClient);
ClientFactory.register('kafka', KafkaClient);

// Usage
if (ClientFactory.has(config.type)) {
    const client = ClientFactory.create(config.type, config);
}
```

## Factory with Async Initialization

```javascript
class AsyncClientFactory {
    static registry = new Map();

    static register(type, factory) {
        // Factory is an async function that creates and initializes
        this.registry.set(type, factory);
    }

    static async create(type, config) {
        const factory = this.registry.get(type);
        if (!factory) {
            throw new Error(`Unknown client type: ${type}`);
        }

        // Factory handles both creation and initialization
        return await factory(config);
    }
}

// Register with async factories
AsyncClientFactory.register('mqtt', async (config) => {
    const client = new MqttClient(config);
    await client.connect();
    return client;
});

AsyncClientFactory.register('kafka', async (config) => {
    const client = new KafkaClient(config);
    await client.connect();
    await client.ensureTopics(config.topics);
    return client;
});

// Usage
const client = await AsyncClientFactory.create(config.type, config);
```

## Factory with Validation

```javascript
class ValidatedClientFactory {
    static registry = new Map();

    static register(type, spec) {
        // spec: { class, validator, defaults }
        this.registry.set(type, spec);
    }

    static create(type, config) {
        const spec = this.registry.get(type);
        if (!spec) {
            throw new Error(`Unknown client type: ${type}`);
        }

        // Merge with defaults
        const finalConfig = { ...spec.defaults, ...config };

        // Validate
        if (spec.validator) {
            const errors = spec.validator(finalConfig);
            if (errors.length > 0) {
                throw new Error(`Invalid config for ${type}: ${errors.join(', ')}`);
            }
        }

        return new spec.class(finalConfig);
    }
}

// Register with validation
ValidatedClientFactory.register('http', {
    class: HttpClient,
    defaults: {
        timeout: 30000,
        retries: 3
    },
    validator: (config) => {
        const errors = [];
        if (!config.baseUrl) errors.push('baseUrl required');
        if (config.timeout < 0) errors.push('timeout must be positive');
        return errors;
    }
});
```

## Node-RED Factory Pattern

### Dynamic Node Type Factory

```javascript
module.exports = function(RED) {
    // Registry for protocol handlers
    const protocolHandlers = new Map();

    function registerProtocol(name, handler) {
        protocolHandlers.set(name, handler);
    }

    // Built-in protocols
    registerProtocol('http', require('./protocols/http'));
    registerProtocol('mqtt', require('./protocols/mqtt'));
    registerProtocol('kafka', require('./protocols/kafka'));

    function ApiGatewayNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Get protocol handler
        const handler = protocolHandlers.get(config.protocol);
        if (!handler) {
            node.error(`Unknown protocol: ${config.protocol}`);
            node.status({ fill: "red", shape: "ring", text: "unknown protocol" });
            return;
        }

        // Create protocol-specific client
        node.client = handler.createClient(config, node);

        node.on('input', function(msg, send, done) {
            handler.handleMessage(node.client, msg, send, done);
        });

        node.on('close', function(removed, done) {
            handler.cleanup(node.client, done);
        });
    }

    RED.nodes.registerType("api-gateway", ApiGatewayNode);

    // Expose registration for extensions
    RED.apiGateway = { registerProtocol };
};
```

### Protocol Handler Interface

```javascript
// protocols/http.js
module.exports = {
    createClient(config, node) {
        const axios = require('axios');
        return axios.create({
            baseURL: config.baseUrl,
            timeout: config.timeout || 30000,
            headers: config.headers || {}
        });
    },

    async handleMessage(client, msg, send, done) {
        try {
            const response = await client.request({
                method: msg.method || 'GET',
                url: msg.url || '/',
                data: msg.payload
            });
            msg.payload = response.data;
            msg.statusCode = response.status;
            send(msg);
            done();
        } catch (err) {
            done(err);
        }
    },

    cleanup(client, done) {
        // HTTP client doesn't need cleanup
        done();
    }
};

// protocols/mqtt.js
module.exports = {
    createClient(config, node) {
        const mqtt = require('mqtt');
        const client = mqtt.connect(config.broker, {
            username: config.username,
            password: config.password
        });

        client.on('connect', () => {
            node.status({ fill: "green", shape: "dot", text: "connected" });
        });

        client.on('error', (err) => {
            node.error(err);
            node.status({ fill: "red", shape: "ring", text: "error" });
        });

        return client;
    },

    handleMessage(client, msg, send, done) {
        client.publish(msg.topic, JSON.stringify(msg.payload), (err) => {
            if (err) {
                done(err);
            } else {
                done();
            }
        });
    },

    cleanup(client, done) {
        client.end(false, {}, done);
    }
};
```

## Abstract Factory

For creating families of related objects:

```javascript
class ConnectionFactory {
    createConnection(config) {
        throw new Error('Abstract method');
    }

    createPool(config) {
        throw new Error('Abstract method');
    }

    createTransaction(connection) {
        throw new Error('Abstract method');
    }
}

class PostgresFactory extends ConnectionFactory {
    createConnection(config) {
        const { Client } = require('pg');
        return new Client(config);
    }

    createPool(config) {
        const { Pool } = require('pg');
        return new Pool(config);
    }

    createTransaction(connection) {
        return new PostgresTransaction(connection);
    }
}

class MySqlFactory extends ConnectionFactory {
    createConnection(config) {
        const mysql = require('mysql2/promise');
        return mysql.createConnection(config);
    }

    createPool(config) {
        const mysql = require('mysql2/promise');
        return mysql.createPool(config);
    }

    createTransaction(connection) {
        return new MySqlTransaction(connection);
    }
}

// Factory of factories
class DatabaseFactoryProvider {
    static factories = {
        postgres: new PostgresFactory(),
        mysql: new MySqlFactory()
    };

    static getFactory(type) {
        const factory = this.factories[type];
        if (!factory) {
            throw new Error(`Unknown database type: ${type}`);
        }
        return factory;
    }
}

// Usage
const factory = DatabaseFactoryProvider.getFactory(config.dbType);
const pool = factory.createPool(config);
```

## Singleton Factory

Ensure only one instance per configuration:

```javascript
class SingletonClientFactory {
    static instances = new Map();

    static getOrCreate(key, factory) {
        if (!this.instances.has(key)) {
            this.instances.set(key, factory());
        }
        return this.instances.get(key);
    }

    static remove(key) {
        const instance = this.instances.get(key);
        this.instances.delete(key);
        return instance;
    }

    static clear() {
        this.instances.clear();
    }
}

// Usage with Node-RED config node
function BrokerConfigNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    const key = `${config.host}:${config.port}`;

    // Get or create shared client
    node.client = SingletonClientFactory.getOrCreate(key, () => {
        return createBrokerClient({
            host: config.host,
            port: config.port,
            credentials: node.credentials
        });
    });

    node.on('close', function(removed, done) {
        if (removed) {
            // Only cleanup when config node is deleted
            const client = SingletonClientFactory.remove(key);
            if (client) {
                client.close(done);
            } else {
                done();
            }
        } else {
            done();
        }
    });
}
```

## Best Practices

### Do

- Use factories when type is determined at runtime
- Register all implementations at startup
- Provide meaningful error messages for unknown types
- Support async initialization when needed
- Include validation in the factory

### Don't

- Create new factory instances per request
- Hardcode types in switch statements (use registry)
- Ignore cleanup requirements
- Mix creation and business logic
- Expose internal registry directly

### Testing Factories

```javascript
// Allow test doubles
class TestableClientFactory {
    static registry = new Map();
    static overrides = new Map();

    static register(type, ClientClass) {
        this.registry.set(type, ClientClass);
    }

    static override(type, MockClass) {
        this.overrides.set(type, MockClass);
    }

    static clearOverrides() {
        this.overrides.clear();
    }

    static create(type, config) {
        // Check overrides first (for testing)
        if (this.overrides.has(type)) {
            return new (this.overrides.get(type))(config);
        }

        const ClientClass = this.registry.get(type);
        if (!ClientClass) {
            throw new Error(`Unknown client type: ${type}`);
        }
        return new ClientClass(config);
    }
}

// In tests
TestableClientFactory.override('http', MockHttpClient);
const client = TestableClientFactory.create('http', config);
// client is MockHttpClient
TestableClientFactory.clearOverrides();
```
