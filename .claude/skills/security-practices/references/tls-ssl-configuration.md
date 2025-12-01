# TLS/SSL Configuration in Node.js

## TLS Options Reference

Node.js `tls.connect()` and `https.request()` accept a common set of TLS options:

| Option | Type | Description |
|--------|------|-------------|
| `ca` | string/Buffer/Array | CA certificates to trust |
| `cert` | string/Buffer | Client certificate (for mTLS) |
| `key` | string/Buffer | Client private key |
| `passphrase` | string | Passphrase for private key |
| `rejectUnauthorized` | boolean | Verify server certificate (default: true) |
| `servername` | string | SNI hostname |
| `minVersion` | string | Minimum TLS version |
| `maxVersion` | string | Maximum TLS version |
| `ciphers` | string | Cipher suite list |
| `checkServerIdentity` | function | Custom hostname verification |

## Building TLS Options

### Standard Pattern

```javascript
function buildTlsOptions(config, credentials) {
    const options = {};

    // Certificate verification (always true in production)
    options.rejectUnauthorized = config.rejectUnauthorized !== false;

    // CA certificate(s)
    if (config.ca) {
        options.ca = loadCertificate(config.ca);
    }

    // Client certificate for mTLS
    if (config.cert) {
        options.cert = loadCertificate(config.cert);
    }

    // Private key
    if (config.key) {
        options.key = loadCertificate(config.key);

        // Key passphrase from credentials
        if (credentials && credentials.keyPassphrase) {
            options.passphrase = credentials.keyPassphrase;
        }
    }

    // TLS version constraints
    if (config.tlsMinVersion) {
        options.minVersion = config.tlsMinVersion;
    }

    // SNI (Server Name Indication)
    if (config.servername) {
        options.servername = config.servername;
    }

    return options;
}
```

### With Certificate Loading

```javascript
function buildSecureTlsOptions(config, credentials, node) {
    const options = {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
    };

    try {
        // CA certificate (optional but recommended)
        if (config.ca) {
            options.ca = loadCertificateSafe(config.ca, {
                validateExpiry: true
            });
            node.log('CA certificate loaded');
        }

        // Client certificate
        if (config.cert && config.key) {
            options.cert = loadCertificateSafe(config.cert, {
                validateExpiry: true
            });

            const keyContent = loadCertificateSafe(config.key, {
                validateExpiry: false
            });
            options.key = keyContent;

            if (credentials.keyPassphrase) {
                options.passphrase = credentials.keyPassphrase;
            }

            node.log('Client certificate and key loaded (mTLS enabled)');
        }

        return options;

    } catch (err) {
        node.error('TLS configuration error: ' + err.message);
        throw err;
    }
}
```

## TLS Version Configuration

### Recommended Settings

```javascript
// Production: TLS 1.2 minimum
const productionOptions = {
    minVersion: 'TLSv1.2',
    // maxVersion defaults to TLSv1.3
};

// High security: TLS 1.3 only
const highSecurityOptions = {
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3'
};
```

### Version Strings

| String | Protocol |
|--------|----------|
| `'TLSv1'` | TLS 1.0 (deprecated, avoid) |
| `'TLSv1.1'` | TLS 1.1 (deprecated, avoid) |
| `'TLSv1.2'` | TLS 1.2 (minimum recommended) |
| `'TLSv1.3'` | TLS 1.3 (preferred) |

## Cipher Suite Configuration

### Default Behavior

Node.js uses secure defaults. Only customize ciphers if required:

```javascript
// Let Node.js choose (recommended)
const options = {
    minVersion: 'TLSv1.2'
    // ciphers not specified = secure defaults
};
```

### Custom Cipher List (if required)

```javascript
const options = {
    minVersion: 'TLSv1.2',
    ciphers: [
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384'
    ].join(':')
};
```

## Mutual TLS (mTLS)

### Server Configuration (Express/HTTPS)

```javascript
const https = require('https');
const fs = require('fs');

const server = https.createServer({
    key: fs.readFileSync('server-key.pem'),
    cert: fs.readFileSync('server-cert.pem'),
    ca: fs.readFileSync('client-ca.pem'),
    requestCert: true,
    rejectUnauthorized: true
}, app);
```

### Client Configuration

```javascript
const https = require('https');

const options = {
    hostname: 'api.example.com',
    port: 443,
    path: '/data',
    method: 'GET',
    key: fs.readFileSync('client-key.pem'),
    cert: fs.readFileSync('client-cert.pem'),
    ca: fs.readFileSync('server-ca.pem'),
    rejectUnauthorized: true
};

const req = https.request(options, (res) => {
    // Handle response
});
```

### Node-RED mTLS Pattern

```javascript
function MyNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    // Get config node with TLS settings
    this.tlsConfig = RED.nodes.getNode(config.tls);

    var tlsOptions = null;
    if (this.tlsConfig) {
        tlsOptions = {
            rejectUnauthorized: this.tlsConfig.rejectUnauthorized !== false
        };

        // Server CA
        if (this.tlsConfig.ca) {
            tlsOptions.ca = loadCertificate(this.tlsConfig.ca);
        }

        // Client cert/key for mTLS
        if (this.tlsConfig.cert && this.tlsConfig.key) {
            tlsOptions.cert = loadCertificate(this.tlsConfig.cert);
            tlsOptions.key = loadCertificate(this.tlsConfig.key);

            if (this.tlsConfig.credentials.passphrase) {
                tlsOptions.passphrase = this.tlsConfig.credentials.passphrase;
            }
        }
    }

    // Use tlsOptions in connection
}
```

## Server Name Indication (SNI)

SNI allows multiple TLS hosts on one IP:

```javascript
const options = {
    hostname: 'shared-ip.example.com',
    servername: 'my-service.example.com', // SNI hostname
    // ... other options
};
```

For connections where hostname differs from certificate:

```javascript
const tls = require('tls');

const socket = tls.connect({
    host: '10.0.0.1',
    port: 443,
    servername: 'api.example.com',
    rejectUnauthorized: true
});
```

## Custom Certificate Verification

### Skip Hostname Check (Use with Caution)

```javascript
const options = {
    rejectUnauthorized: true, // Still verify certificate chain
    checkServerIdentity: function(host, cert) {
        // Return undefined to accept, Error to reject
        // This example accepts any hostname
        return undefined;
    }
};
```

### Custom Hostname Verification

```javascript
const tls = require('tls');

const options = {
    checkServerIdentity: function(host, cert) {
        // Check against allowed names
        const allowedNames = ['api.example.com', 'api-backup.example.com'];

        const certNames = [cert.subject.CN];
        if (cert.subjectaltname) {
            const altNames = cert.subjectaltname.split(', ')
                .filter(n => n.startsWith('DNS:'))
                .map(n => n.slice(4));
            certNames.push(...altNames);
        }

        const match = certNames.some(name => allowedNames.includes(name));

        if (!match) {
            return new Error(`Certificate name mismatch. Expected: ${allowedNames.join(', ')}, got: ${certNames.join(', ')}`);
        }
        return undefined; // Accept
    }
};
```

## Common Connection Patterns

### HTTPS Client

```javascript
const https = require('https');

function makeSecureRequest(url, tlsOptions) {
    return new Promise((resolve, reject) => {
        const options = {
            ...new URL(url),
            method: 'GET',
            ...tlsOptions
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });

        req.on('error', reject);
        req.end();
    });
}
```

### TCP with TLS

```javascript
const tls = require('tls');

function connectSecure(host, port, tlsOptions) {
    return new Promise((resolve, reject) => {
        const socket = tls.connect(port, host, tlsOptions, () => {
            if (!socket.authorized && tlsOptions.rejectUnauthorized !== false) {
                socket.destroy();
                reject(new Error('Certificate not authorized: ' + socket.authorizationError));
                return;
            }
            resolve(socket);
        });

        socket.on('error', reject);
    });
}
```

### WebSocket with TLS

```javascript
const WebSocket = require('ws');
const https = require('https');

function createSecureWebSocket(url, tlsOptions) {
    const agent = new https.Agent(tlsOptions);

    return new WebSocket(url, {
        agent: agent,
        rejectUnauthorized: tlsOptions.rejectUnauthorized
    });
}
```

## Development vs Production

### Development (Self-Signed Certificates)

```javascript
// ONLY for development/testing
const devOptions = {
    rejectUnauthorized: false,
    // Warning: Disables all certificate verification
};

// Better: Add self-signed CA to trust
const betterDevOptions = {
    ca: fs.readFileSync('dev-ca.pem'),
    rejectUnauthorized: true
};
```

### Production Checklist

```javascript
const productionOptions = {
    // Always verify certificates
    rejectUnauthorized: true,

    // Minimum TLS 1.2
    minVersion: 'TLSv1.2',

    // CA if not in system trust store
    ca: config.ca ? loadCertificate(config.ca) : undefined,

    // Client certs if mTLS required
    cert: config.cert ? loadCertificate(config.cert) : undefined,
    key: config.key ? loadCertificate(config.key) : undefined,
    passphrase: credentials.keyPassphrase || undefined
};

// Verify no insecure options
if (productionOptions.rejectUnauthorized === false) {
    throw new Error('rejectUnauthorized must be true in production');
}
```

## Error Handling

### Common TLS Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | CA not trusted | Add CA to options |
| `CERT_HAS_EXPIRED` | Certificate expired | Renew certificate |
| `SELF_SIGNED_CERT_IN_CHAIN` | Self-signed CA | Add CA or (dev only) disable verify |
| `HOSTNAME_MISMATCH` | Wrong servername | Check SNI setting |
| `ERR_TLS_CERT_ALTNAME_INVALID` | Hostname not in cert | Verify certificate covers hostname |
| `DEPTH_ZERO_SELF_SIGNED_CERT` | Self-signed cert | Add CA certificate |

### Error Handler Pattern

```javascript
function handleTlsError(err, node) {
    const errorMap = {
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE': 'Server certificate not trusted. Add CA certificate.',
        'CERT_HAS_EXPIRED': 'Server certificate has expired.',
        'SELF_SIGNED_CERT_IN_CHAIN': 'Self-signed certificate in chain. Add CA certificate.',
        'HOSTNAME_MISMATCH': 'Certificate hostname does not match.',
        'DEPTH_ZERO_SELF_SIGNED_CERT': 'Self-signed certificate. Add CA or disable verification (dev only).'
    };

    const message = errorMap[err.code] || `TLS error: ${err.message}`;

    node.error(message);
    node.status({ fill: "red", shape: "ring", text: "TLS error" });

    return new Error(message);
}
```
