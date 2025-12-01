# Credential Management in Node-RED

## Node-RED Credentials System

Node-RED provides a built-in system for handling sensitive configuration data separately from regular node properties.

### How Credentials Work

1. **Separate Storage**: Credentials are stored in `flows_cred.json`, not `flows.json`
2. **Encryption**: Password-type credentials are encrypted using a secret key
3. **No Export**: Credentials are never included when exporting flows
4. **Runtime Access**: Available via `this.credentials` in node runtime

### Credential Types

| Type | Storage | Display in Editor |
|------|---------|-------------------|
| `text` | Plain text | Visible |
| `password` | Encrypted | Masked (shows `__PWRD__` placeholder) |

### Defining Credentials

#### JavaScript File (.js)

```javascript
module.exports = function(RED) {
    function MyConfigNode(config) {
        RED.nodes.createNode(this, config);

        // Access credentials
        this.username = this.credentials.username;
        this.password = this.credentials.password;
        this.apiKey = this.credentials.apiKey;

        // Use in connection
        this.getConnectionOptions = function() {
            return {
                user: this.username,
                pass: this.password
            };
        };
    }

    RED.nodes.registerType("my-config", MyConfigNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" },
            apiKey: { type: "password" }
        }
    });
};
```

#### HTML File (.html)

```html
<script type="text/javascript">
    RED.nodes.registerType('my-config', {
        category: 'config',
        defaults: {
            name: { value: "" },
            host: { value: "localhost" }
        },
        credentials: {
            username: { type: "text" },
            password: { type: "password" },
            apiKey: { type: "password" }
        },
        label: function() {
            return this.name || this.host;
        }
    });
</script>

<script type="text/html" data-template-name="my-config">
    <div class="form-row">
        <label for="node-config-input-name">
            <i class="fa fa-tag"></i> Name
        </label>
        <input type="text" id="node-config-input-name">
    </div>
    <div class="form-row">
        <label for="node-config-input-host">
            <i class="fa fa-server"></i> Host
        </label>
        <input type="text" id="node-config-input-host">
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
    <div class="form-row">
        <label for="node-config-input-apiKey">
            <i class="fa fa-key"></i> API Key
        </label>
        <input type="password" id="node-config-input-apiKey">
    </div>
</script>
```

### Important Rules

1. **Define in Both Files**: Credentials must be declared in both `.js` and `.html` files
2. **Use `type: "password"`** for sensitive data to enable encryption
3. **Never Log Credentials**: Avoid logging credential values
4. **No `value` Default**: Credentials cannot have default values

## Environment Variables

For deployment flexibility, support environment variable substitution:

```javascript
function resolveValue(configValue) {
    if (typeof configValue === 'string' && configValue.startsWith('${') && configValue.endsWith('}')) {
        const envVar = configValue.slice(2, -1);
        return process.env[envVar] || '';
    }
    return configValue;
}

// Usage in node
this.apiKey = resolveValue(this.credentials.apiKey);
```

### Node-RED Environment Variable Syntax

Node-RED supports `${ENV_VAR}` syntax in properties. To enable in credentials:

```javascript
function MyNode(config) {
    RED.nodes.createNode(this, config);

    // RED.util.evaluateNodeProperty supports env vars
    var apiKey = this.credentials.apiKey;
    if (apiKey && apiKey.indexOf('${') !== -1) {
        apiKey = RED.util.evaluateNodeProperty(apiKey, 'str', this);
    }
}
```

## Credential Passing Patterns

### Pass to Child Nodes via Config Node

```javascript
// Config node provides credentials to client nodes
function BrokerConfigNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    // Store for client access
    this.credentials = {
        username: this.credentials.username,
        password: this.credentials.password
    };

    // Method for clients to get auth
    this.getAuth = function() {
        return {
            username: node.credentials.username,
            password: node.credentials.password
        };
    };
}

// Client node uses config node credentials
function ClientNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    this.broker = RED.nodes.getNode(config.broker);

    if (this.broker) {
        var auth = this.broker.getAuth();
        // Use auth for connection
    }
}
```

### Pass via Message (Not Recommended)

Avoid passing credentials through messages when possible. If necessary:

```javascript
node.on('input', function(msg, send, done) {
    // Create new object, don't modify original
    var outMsg = RED.util.cloneMessage(msg);

    // Remove credentials before forwarding
    delete outMsg.credentials;

    send(outMsg);
    done();
});
```

## Secrets Management Integration

### HashiCorp Vault Pattern

```javascript
const vault = require('node-vault')({
    endpoint: process.env.VAULT_ADDR,
    token: process.env.VAULT_TOKEN
});

async function getSecret(path) {
    try {
        const result = await vault.read(path);
        return result.data;
    } catch (err) {
        throw new Error(`Failed to read secret: ${err.message}`);
    }
}

// In node initialization
async function initializeCredentials(node, config) {
    if (config.vaultPath) {
        const secrets = await getSecret(config.vaultPath);
        node.username = secrets.username;
        node.password = secrets.password;
    } else {
        node.username = node.credentials.username;
        node.password = node.credentials.password;
    }
}
```

### AWS Secrets Manager Pattern

```javascript
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({ region: process.env.AWS_REGION });

async function getAwsSecret(secretId) {
    const command = new GetSecretValueCommand({ SecretId: secretId });
    const response = await client.send(command);

    if (response.SecretString) {
        return JSON.parse(response.SecretString);
    }
    throw new Error('Secret not found');
}
```

## Security Best Practices

### Do

- Use `type: "password"` for all sensitive fields
- Store credentials in configuration nodes for reuse
- Support environment variables for deployment flexibility
- Clear credential references on node close
- Validate credential presence before use

### Don't

- Log credential values (even in debug mode)
- Store credentials in regular `defaults`
- Pass credentials through message payloads
- Expose credentials in error messages
- Cache credentials in global variables

### Credential Cleanup on Close

```javascript
node.on('close', function(removed, done) {
    // Clear sensitive data
    node.username = null;
    node.password = null;
    node.apiKey = null;

    // Close connections that hold credentials
    if (node.connection) {
        node.connection.close(done);
    } else {
        done();
    }
});
```

### Validating Credentials

```javascript
function validateCredentials(credentials) {
    const errors = [];

    if (!credentials.username) {
        errors.push('Username is required');
    }
    if (!credentials.password) {
        errors.push('Password is required');
    }
    if (credentials.password && credentials.password.length < 8) {
        errors.push('Password must be at least 8 characters');
    }

    return errors;
}

// In node constructor
var errors = validateCredentials(this.credentials);
if (errors.length > 0) {
    node.error('Invalid credentials: ' + errors.join(', '));
    node.status({ fill: "red", shape: "ring", text: "invalid credentials" });
    return;
}
```
