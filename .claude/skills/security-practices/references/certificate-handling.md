# Certificate Handling in Node.js

## Certificate File Formats

### PEM Format

The most common format for Node.js applications. PEM files are Base64-encoded with header/footer markers.

```
-----BEGIN CERTIFICATE-----
MIIDrzCCApegAwIBAgIQCDvgVpBCRrGhdWrJWZHHSjANBgkqhkiG9w0BAQsFADBh
...base64 encoded data...
-----END CERTIFICATE-----
```

Common PEM file types:

| Extension | Contains | Header |
|-----------|----------|--------|
| `.pem`, `.crt`, `.cer` | Certificate | `-----BEGIN CERTIFICATE-----` |
| `.key` | Private key | `-----BEGIN PRIVATE KEY-----` or `-----BEGIN RSA PRIVATE KEY-----` |
| `.ca`, `.ca-bundle` | CA certificates | Multiple certificate blocks |

### DER Format

Binary format. Convert to PEM before use in Node.js:

```bash
openssl x509 -inform der -in cert.der -out cert.pem
```

### PKCS#12 / PFX Format

Combined certificate and private key. Extract components:

```bash
# Extract certificate
openssl pkcs12 -in bundle.pfx -clcerts -nokeys -out cert.pem

# Extract private key
openssl pkcs12 -in bundle.pfx -nocerts -out key.pem
```

## Loading Certificates

### Basic Certificate Loading

```javascript
const fs = require('fs');
const path = require('path');

function loadCertificate(certPath) {
    // Resolve to absolute path
    const resolvedPath = path.resolve(certPath);

    // Check existence
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Certificate file not found: ${resolvedPath}`);
    }

    // Read file
    const content = fs.readFileSync(resolvedPath, 'utf8');

    // Validate PEM format
    if (!content.includes('-----BEGIN')) {
        throw new Error(`Invalid certificate format in ${resolvedPath}: expected PEM format`);
    }

    return content;
}
```

### Certificate with Validation

```javascript
const crypto = require('crypto');

function loadAndValidateCertificate(certPath) {
    const content = loadCertificate(certPath);

    try {
        // Parse certificate to verify it's valid
        const cert = new crypto.X509Certificate(content);

        // Check expiration
        const now = new Date();
        if (now > new Date(cert.validTo)) {
            throw new Error(`Certificate expired on ${cert.validTo}`);
        }
        if (now < new Date(cert.validFrom)) {
            throw new Error(`Certificate not yet valid until ${cert.validFrom}`);
        }

        return {
            content: content,
            subject: cert.subject,
            issuer: cert.issuer,
            validFrom: cert.validFrom,
            validTo: cert.validTo,
            fingerprint: cert.fingerprint256
        };
    } catch (err) {
        if (err.code === 'ERR_OSSL_X509_UNABLE_TO_GET_ISSUER_CERT') {
            // Self-signed or missing CA - certificate is still usable
            return { content: content, selfSigned: true };
        }
        throw err;
    }
}
```

### Loading CA Certificate Bundle

```javascript
function loadCaBundle(caPath) {
    const content = loadCertificate(caPath);

    // Split multiple certificates
    const certs = [];
    const certRegex = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
    let match;

    while ((match = certRegex.exec(content)) !== null) {
        certs.push(match[0]);
    }

    if (certs.length === 0) {
        throw new Error(`No valid certificates found in ${caPath}`);
    }

    return certs;
}
```

### Loading Private Key with Passphrase

```javascript
function loadPrivateKey(keyPath, passphrase) {
    const content = loadCertificate(keyPath);

    // Validate key format
    if (!content.includes('-----BEGIN') || !content.includes('KEY-----')) {
        throw new Error(`Invalid private key format in ${keyPath}`);
    }

    // Check if encrypted
    const isEncrypted = content.includes('ENCRYPTED');

    if (isEncrypted && !passphrase) {
        throw new Error('Private key is encrypted but no passphrase provided');
    }

    return {
        key: content,
        passphrase: passphrase || undefined
    };
}
```

## Path Validation and Security

### Preventing Path Traversal

```javascript
const path = require('path');

function validateCertPath(userPath, allowedDirs) {
    // Resolve to absolute path
    const resolved = path.resolve(userPath);

    // Check against allowed directories
    const isAllowed = allowedDirs.some(dir => {
        const allowedPath = path.resolve(dir);
        return resolved.startsWith(allowedPath + path.sep) || resolved === allowedPath;
    });

    if (!isAllowed) {
        throw new Error(`Certificate path not in allowed directory: ${userPath}`);
    }

    return resolved;
}

// Usage
const allowedDirs = [
    '/etc/ssl/certs',
    '/etc/pki/tls/certs',
    process.env.NODE_RED_USER_DIR + '/certs'
];

const safePath = validateCertPath(config.certPath, allowedDirs);
```

### Safe Certificate Loading with Full Validation

```javascript
function loadCertificateSafe(certPath, options = {}) {
    const {
        allowedDirs = [],
        validateExpiry = true,
        allowSelfSigned = false
    } = options;

    // Validate path if restrictions specified
    let safePath = certPath;
    if (allowedDirs.length > 0) {
        safePath = validateCertPath(certPath, allowedDirs);
    } else {
        safePath = path.resolve(certPath);
    }

    // Check file exists and is readable
    try {
        fs.accessSync(safePath, fs.constants.R_OK);
    } catch (err) {
        throw new Error(`Cannot read certificate file: ${safePath}`);
    }

    // Check file size (prevent reading huge files)
    const stats = fs.statSync(safePath);
    const maxSize = 1024 * 1024; // 1MB max
    if (stats.size > maxSize) {
        throw new Error(`Certificate file too large: ${stats.size} bytes`);
    }

    // Load and validate
    const content = fs.readFileSync(safePath, 'utf8');

    if (!content.includes('-----BEGIN')) {
        throw new Error('Invalid certificate format: expected PEM');
    }

    // Optional expiry validation
    if (validateExpiry && content.includes('-----BEGIN CERTIFICATE-----')) {
        try {
            const cert = new crypto.X509Certificate(content);
            const now = new Date();

            if (now > new Date(cert.validTo)) {
                throw new Error(`Certificate expired: ${cert.validTo}`);
            }
        } catch (err) {
            if (!allowSelfSigned && err.message.includes('unable to get')) {
                throw err;
            }
            // Continue if self-signed is allowed
        }
    }

    return content;
}
```

## Error Handling Patterns

### Comprehensive Error Handling

```javascript
function loadCertificateWithErrorHandling(certPath, node) {
    try {
        return loadCertificateSafe(certPath, {
            validateExpiry: true,
            allowSelfSigned: true
        });
    } catch (err) {
        // Map technical errors to user-friendly messages
        let userMessage;
        let logMessage = err.message;

        if (err.code === 'ENOENT') {
            userMessage = 'Certificate file not found';
        } else if (err.code === 'EACCES') {
            userMessage = 'Permission denied reading certificate';
        } else if (err.message.includes('expired')) {
            userMessage = 'Certificate has expired';
        } else if (err.message.includes('not yet valid')) {
            userMessage = 'Certificate not yet valid';
        } else if (err.message.includes('Invalid certificate format')) {
            userMessage = 'Invalid certificate format';
        } else if (err.message.includes('Path traversal')) {
            userMessage = 'Invalid certificate path';
            logMessage = `Path traversal attempt: ${certPath}`;
        } else {
            userMessage = 'Failed to load certificate';
        }

        // Log detailed error (not exposed to user)
        node.error(`Certificate error: ${logMessage}`);

        // Return user-friendly error
        throw new Error(userMessage);
    }
}
```

### Node-RED Integration Pattern

```javascript
function MyConfigNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    // Load certificates during initialization
    node.tlsOptions = null;

    try {
        if (config.useTls) {
            node.tlsOptions = {};

            // CA certificate (optional)
            if (config.ca) {
                try {
                    node.tlsOptions.ca = loadCertificateWithErrorHandling(config.ca, node);
                    node.log('Loaded CA certificate');
                } catch (err) {
                    node.warn('CA certificate: ' + err.message);
                    // Continue without CA if optional
                }
            }

            // Client certificate (mTLS)
            if (config.cert) {
                node.tlsOptions.cert = loadCertificateWithErrorHandling(config.cert, node);
                node.log('Loaded client certificate');
            }

            // Private key
            if (config.key) {
                const keyData = loadPrivateKey(config.key, node.credentials.keyPassphrase);
                node.tlsOptions.key = keyData.key;
                if (keyData.passphrase) {
                    node.tlsOptions.passphrase = keyData.passphrase;
                }
                node.log('Loaded private key');
            }
        }

        node.status({ fill: "green", shape: "dot", text: "ready" });

    } catch (err) {
        node.status({ fill: "red", shape: "ring", text: err.message });
        node.error('TLS configuration failed: ' + err.message);
    }
}
```

## Certificate Expiry Monitoring

```javascript
function checkCertificateExpiry(certPath, warningDays = 30) {
    const content = loadCertificate(certPath);

    try {
        const cert = new crypto.X509Certificate(content);
        const expiryDate = new Date(cert.validTo);
        const now = new Date();
        const daysUntilExpiry = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));

        return {
            path: certPath,
            subject: cert.subject,
            expiryDate: cert.validTo,
            daysUntilExpiry: daysUntilExpiry,
            isExpired: daysUntilExpiry < 0,
            isWarning: daysUntilExpiry >= 0 && daysUntilExpiry <= warningDays
        };
    } catch (err) {
        return {
            path: certPath,
            error: err.message
        };
    }
}

// Periodic check in Node-RED
function setupExpiryCheck(node, certPath) {
    const checkInterval = 24 * 60 * 60 * 1000; // Daily

    const check = function() {
        const result = checkCertificateExpiry(certPath);

        if (result.isExpired) {
            node.error(`Certificate expired: ${certPath}`);
            node.status({ fill: "red", shape: "ring", text: "cert expired" });
        } else if (result.isWarning) {
            node.warn(`Certificate expires in ${result.daysUntilExpiry} days: ${certPath}`);
            node.status({ fill: "yellow", shape: "dot", text: `cert expires ${result.daysUntilExpiry}d` });
        }
    };

    // Initial check
    check();

    // Schedule periodic checks
    const timer = setInterval(check, checkInterval);

    // Cleanup on close
    node.on('close', function() {
        clearInterval(timer);
    });
}
```

## Common Certificate Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `ENOENT` | File not found | Check path exists |
| `EACCES` | Permission denied | Check file permissions |
| `unable to get local issuer` | CA not in trust store | Add CA to options or system |
| `certificate has expired` | Certificate past valid date | Renew certificate |
| `self signed certificate` | No chain to trusted CA | Add CA or set `rejectUnauthorized: false` (dev only) |
| `wrong tag` | DER format, not PEM | Convert to PEM |
| `bad decrypt` | Wrong passphrase | Verify passphrase |
