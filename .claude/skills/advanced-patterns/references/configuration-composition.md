# Configuration Composition

## Overview

Configuration composition combines multiple configuration sources into a final configuration. Sources typically include:
- Hard-coded defaults
- Configuration nodes (shared settings)
- Node-specific settings
- Runtime overrides (environment variables, message properties)

## Basic Composition

### Simple Merge

```javascript
function buildConfig(nodeConfig, defaults) {
    return {
        ...defaults,
        ...nodeConfig
    };
}

const defaults = {
    timeout: 30000,
    retries: 3,
    debug: false
};

const config = buildConfig({
    timeout: 60000,
    host: 'api.example.com'
}, defaults);

// Result: { timeout: 60000, retries: 3, debug: false, host: 'api.example.com' }
```

### Deep Merge

```javascript
function deepMerge(target, ...sources) {
    for (const source of sources) {
        for (const key of Object.keys(source)) {
            const targetVal = target[key];
            const sourceVal = source[key];

            if (isPlainObject(targetVal) && isPlainObject(sourceVal)) {
                target[key] = deepMerge({ ...targetVal }, sourceVal);
            } else if (sourceVal !== undefined) {
                target[key] = sourceVal;
            }
        }
    }
    return target;
}

function isPlainObject(obj) {
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

// Usage
const defaults = {
    connection: {
        timeout: 30000,
        retries: 3
    },
    logging: {
        level: 'info',
        format: 'json'
    }
};

const nodeConfig = {
    connection: {
        timeout: 60000
    }
};

const config = deepMerge({}, defaults, nodeConfig);
// Result: {
//   connection: { timeout: 60000, retries: 3 },
//   logging: { level: 'info', format: 'json' }
// }
```

## Node-RED Configuration Pattern

### Three-Layer Composition

```javascript
function MyNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    // Layer 1: Hard-coded defaults
    const defaults = {
        timeout: 30000,
        retries: 3,
        encoding: 'utf8'
    };

    // Layer 2: Config node (shared settings)
    const serverConfig = RED.nodes.getNode(config.server);
    const sharedConfig = serverConfig ? {
        host: serverConfig.host,
        port: serverConfig.port,
        tls: serverConfig.tls
    } : {};

    // Layer 3: Node-specific settings
    const nodeConfig = {
        timeout: config.timeout,
        topic: config.topic,
        qos: config.qos
    };

    // Compose (later layers override earlier)
    node.config = buildConfig(defaults, sharedConfig, nodeConfig);
}

function buildConfig(...layers) {
    const result = {};

    for (const layer of layers) {
        for (const [key, value] of Object.entries(layer)) {
            // Skip undefined values (preserve previous layer)
            if (value !== undefined && value !== '') {
                result[key] = value;
            }
        }
    }

    return result;
}
```

### With Credentials

```javascript
function buildSecureConfig(nodeConfig, serverConfig, nodeCredentials, serverCredentials) {
    return {
        // Non-sensitive from config node
        host: serverConfig?.host,
        port: serverConfig?.port,

        // Non-sensitive from node (overrides)
        ...nodeConfig,

        // Credentials (node overrides server)
        username: nodeCredentials?.username || serverCredentials?.username,
        password: nodeCredentials?.password || serverCredentials?.password,
        apiKey: nodeCredentials?.apiKey || serverCredentials?.apiKey
    };
}
```

## Field Mapping

Map node properties to client configuration:

```javascript
const fieldMappings = {
    // nodeProperty: clientProperty
    host: 'hostname',
    port: 'port',
    useTls: 'ssl',
    timeout: 'connectTimeout',
    keepAlive: 'keepalive'
};

function mapConfig(nodeConfig, mappings) {
    const result = {};

    for (const [nodeKey, clientKey] of Object.entries(mappings)) {
        if (nodeConfig[nodeKey] !== undefined) {
            result[clientKey] = nodeConfig[nodeKey];
        }
    }

    return result;
}

// Usage
const clientConfig = mapConfig(config, fieldMappings);
// { host: 'example.com' } becomes { hostname: 'example.com' }
```

### With Transformation

```javascript
const fieldMappings = {
    host: {
        to: 'hostname',
        transform: (v) => v.toLowerCase()
    },
    port: {
        to: 'port',
        transform: (v) => parseInt(v, 10)
    },
    timeout: {
        to: 'connectTimeout',
        transform: (v) => v * 1000  // seconds to ms
    },
    useTls: {
        to: 'ssl',
        transform: (v) => v === true || v === 'true'
    }
};

function mapConfigWithTransform(nodeConfig, mappings) {
    const result = {};

    for (const [nodeKey, mapping] of Object.entries(mappings)) {
        const value = nodeConfig[nodeKey];
        if (value !== undefined && value !== '') {
            const transformed = mapping.transform ? mapping.transform(value) : value;
            result[mapping.to] = transformed;
        }
    }

    return result;
}
```

## Environment Variable Override

```javascript
function resolveEnvVars(config) {
    const result = {};

    for (const [key, value] of Object.entries(config)) {
        if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
            const envVar = value.slice(2, -1);
            result[key] = process.env[envVar] || '';
        } else if (isPlainObject(value)) {
            result[key] = resolveEnvVars(value);
        } else {
            result[key] = value;
        }
    }

    return result;
}

// Usage
const config = {
    host: '${API_HOST}',
    port: 443,
    apiKey: '${API_KEY}'
};

const resolved = resolveEnvVars(config);
// { host: 'api.example.com', port: 443, apiKey: 'secret123' }
```

### Node-RED Environment Variable Integration

```javascript
function resolveNodeRedEnv(value, node) {
    if (typeof value !== 'string') return value;

    // Node-RED uses ${...} syntax
    if (value.indexOf('${') === -1) return value;

    return RED.util.evaluateNodeProperty(value, 'str', node);
}

function resolveAllEnv(config, node) {
    const result = {};

    for (const [key, value] of Object.entries(config)) {
        if (isPlainObject(value)) {
            result[key] = resolveAllEnv(value, node);
        } else {
            result[key] = resolveNodeRedEnv(value, node);
        }
    }

    return result;
}
```

## Configuration Validation

### Schema-Based Validation

```javascript
const configSchema = {
    host: {
        type: 'string',
        required: true,
        validate: (v) => v.length > 0
    },
    port: {
        type: 'number',
        required: true,
        validate: (v) => v > 0 && v < 65536
    },
    timeout: {
        type: 'number',
        required: false,
        default: 30000,
        validate: (v) => v > 0
    },
    protocol: {
        type: 'string',
        required: false,
        default: 'https',
        validate: (v) => ['http', 'https'].includes(v)
    }
};

function validateConfig(config, schema) {
    const errors = [];
    const result = {};

    for (const [key, spec] of Object.entries(schema)) {
        let value = config[key];

        // Apply default if missing
        if (value === undefined || value === '') {
            if (spec.required) {
                errors.push(`${key} is required`);
                continue;
            }
            value = spec.default;
        }

        // Type check
        if (value !== undefined) {
            const actualType = typeof value;
            if (actualType !== spec.type) {
                // Try coercion
                if (spec.type === 'number' && !isNaN(Number(value))) {
                    value = Number(value);
                } else if (spec.type === 'boolean') {
                    value = value === true || value === 'true';
                } else {
                    errors.push(`${key} must be ${spec.type}, got ${actualType}`);
                    continue;
                }
            }

            // Custom validation
            if (spec.validate && !spec.validate(value)) {
                errors.push(`${key} failed validation`);
                continue;
            }
        }

        result[key] = value;
    }

    return { config: result, errors };
}
```

### Usage in Node

```javascript
function MyNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    // Build and validate config
    const rawConfig = buildConfig(defaults, serverConfig, config);
    const { config: validConfig, errors } = validateConfig(rawConfig, configSchema);

    if (errors.length > 0) {
        node.error('Configuration errors: ' + errors.join(', '));
        node.status({ fill: "red", shape: "ring", text: "config error" });
        return;
    }

    node.config = validConfig;
    // Continue with valid configuration
}
```

## Configuration Inheritance

### Config Node Hierarchy

```javascript
// Base config node
function BaseServerNode(config) {
    RED.nodes.createNode(this, config);

    this.host = config.host;
    this.port = config.port;
    this.timeout = config.timeout || 30000;
}

// Extended config node
function SecureServerNode(config) {
    // Call base
    BaseServerNode.call(this, config);

    // Add TLS settings
    this.tls = config.tls;
    this.ca = config.ca;
    this.cert = config.cert;
    this.key = config.key;
}

// Inherit prototype
SecureServerNode.prototype = Object.create(BaseServerNode.prototype);
```

### Mixin Pattern

```javascript
const TlsMixin = {
    getTlsOptions() {
        if (!this.tls) return null;

        return {
            ca: this.ca ? loadCert(this.ca) : undefined,
            cert: this.cert ? loadCert(this.cert) : undefined,
            key: this.key ? loadCert(this.key) : undefined,
            rejectUnauthorized: this.rejectUnauthorized !== false
        };
    }
};

const AuthMixin = {
    getAuthOptions() {
        return {
            username: this.credentials?.username,
            password: this.credentials?.password
        };
    }
};

function SecureServerNode(config) {
    RED.nodes.createNode(this, config);

    // Apply mixins
    Object.assign(this, TlsMixin, AuthMixin);

    // Set properties
    this.host = config.host;
    this.tls = config.tls;
    // ...
}

// Usage
const tlsOpts = serverNode.getTlsOptions();
const authOpts = serverNode.getAuthOptions();
```

## Best Practices

### Do

- Define clear defaults for all optional settings
- Validate configuration early (in constructor)
- Support environment variable overrides
- Document all configuration options
- Use typed configuration when possible

### Don't

- Mutate configuration objects
- Store sensitive data in non-credential fields
- Skip validation for "trusted" sources
- Use deeply nested configuration
- Mix configuration and runtime state
