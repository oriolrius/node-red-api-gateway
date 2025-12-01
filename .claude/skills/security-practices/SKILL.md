---
name: security-practices
description: Comprehensive security practices for Node.js and Node-RED applications. This skill should be used when implementing credential storage, certificate handling, TLS/SSL configuration, authentication mechanisms (SASL, OAuth, API keys), password field masking in UI, or file path validation.
---

# Security Practices

This skill provides patterns and best practices for implementing secure Node.js and Node-RED applications.

## When to Use This Skill

- Implementing credential storage and management
- Handling certificate files (PEM, CA, client certificates)
- Configuring TLS/SSL connections
- Selecting authentication mechanisms (SASL, OAuth, API keys, mTLS)
- Masking password fields in Node-RED edit dialogs
- Validating file paths and handling file security

## Quick Reference

### Credential Management

Node-RED provides a built-in credentials system that stores sensitive data separately from flow configurations:

```javascript
// JavaScript file - register credentials
RED.nodes.registerType("my-node", MyNode, {
    credentials: {
        username: { type: "text" },
        password: { type: "password" },
        apiKey: { type: "password" }
    }
});

// Access credentials in node
function MyNode(config) {
    RED.nodes.createNode(this, config);
    var username = this.credentials.username;
    var password = this.credentials.password;
}
```

```html
<!-- HTML file - credentials must be declared in both files -->
<script type="text/javascript">
    RED.nodes.registerType('my-node', {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });
</script>
```

Key points:
- Credentials are stored in a separate file (`flows_cred.json`)
- Password-type credentials are encrypted at rest
- Credentials are never exported with flows
- Define credentials in both `.js` and `.html` files

### Password Field Masking

Always use `type="password"` for sensitive fields in edit dialogs:

```html
<div class="form-row">
    <label for="node-config-input-password">
        <i class="fa fa-lock"></i> Password
    </label>
    <input type="password" id="node-config-input-password">
</div>
```

For API keys and tokens:

```html
<div class="form-row">
    <label for="node-config-input-apiKey">
        <i class="fa fa-key"></i> API Key
    </label>
    <input type="password" id="node-config-input-apiKey"
           placeholder="Enter API key">
</div>
```

### Certificate File Handling

When working with certificates (PEM, CA bundles, client certs):

```javascript
const fs = require('fs');
const path = require('path');
const tls = require('tls');

// Validate and load certificate file
function loadCertificate(certPath) {
    // Validate path
    const resolvedPath = path.resolve(certPath);

    // Check file exists
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Certificate file not found: ${resolvedPath}`);
    }

    // Read certificate
    const cert = fs.readFileSync(resolvedPath, 'utf8');

    // Basic validation - check PEM format
    if (!cert.includes('-----BEGIN')) {
        throw new Error('Invalid certificate format: expected PEM');
    }

    return cert;
}
```

### TLS/SSL Configuration

Standard TLS options pattern:

```javascript
function buildTlsOptions(config) {
    const options = {
        rejectUnauthorized: config.rejectUnauthorized !== false
    };

    // CA certificate(s)
    if (config.ca) {
        options.ca = loadCertificate(config.ca);
    }

    // Client certificate (mTLS)
    if (config.cert) {
        options.cert = loadCertificate(config.cert);
    }

    // Client private key
    if (config.key) {
        options.key = loadCertificate(config.key);
        if (config.keyPassphrase) {
            options.passphrase = config.keyPassphrase;
        }
    }

    // TLS version constraints
    if (config.minVersion) {
        options.minVersion = config.minVersion; // 'TLSv1.2', 'TLSv1.3'
    }

    return options;
}
```

### Authentication Mechanism Selection

| Mechanism | Use Case | Implementation |
|-----------|----------|----------------|
| API Key | Simple service auth | Header or query param |
| OAuth 2.0 | User delegation | Access/refresh tokens |
| SASL/PLAIN | Message brokers | Username/password |
| SASL/SCRAM | Secure broker auth | Challenge-response |
| mTLS | Service-to-service | Client certificates |
| JWT | Stateless auth | Signed tokens |

### File Path Security

Always validate file paths to prevent directory traversal:

```javascript
const path = require('path');

function validateFilePath(userPath, allowedBase) {
    const resolved = path.resolve(allowedBase, userPath);

    // Ensure path stays within allowed directory
    if (!resolved.startsWith(path.resolve(allowedBase))) {
        throw new Error('Path traversal detected');
    }

    return resolved;
}
```

## Reference Documentation

For detailed patterns and implementation examples:

- `references/credential-management.md` - Node-RED credentials system, environment variables, secrets management
- `references/certificate-handling.md` - PEM files, CA bundles, certificate validation, error handling
- `references/tls-ssl-configuration.md` - TLS options, protocol versions, cipher suites, mTLS
- `references/security-checklist.md` - Pre-deployment security checklist

To search for specific patterns:
```bash
grep -r "pattern" references/
```

## Common Security Mistakes

1. **Storing credentials in flow configuration** - Use Node-RED credentials system
2. **Hardcoding secrets** - Use environment variables or credential nodes
3. **Disabling TLS verification in production** - Only disable for development
4. **Not validating certificate paths** - Validate before reading
5. **Logging sensitive data** - Never log passwords, tokens, or keys
6. **Using outdated TLS versions** - Minimum TLSv1.2 recommended
7. **Missing error handling for auth failures** - Handle gracefully, don't expose details
