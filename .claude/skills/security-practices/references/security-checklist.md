# Node-RED Node Security Checklist

Use this checklist before publishing or deploying Node-RED nodes.

## Credential Management

- [ ] **Sensitive fields use credentials system**
  - Passwords, API keys, tokens defined with `type: "password"`
  - Credentials declared in both `.js` and `.html` files
  - No sensitive data in `defaults` object

- [ ] **Credentials properly accessed**
  - Access via `this.credentials` not `config`
  - Credentials not stored in global variables
  - Credentials cleared on node close

- [ ] **No credential logging**
  - `node.log()`, `node.warn()`, `node.error()` don't include credentials
  - Debug output sanitized
  - Error messages don't expose credentials

- [ ] **Environment variable support**
  - Credentials can be sourced from environment variables
  - `${ENV_VAR}` syntax supported where appropriate

## UI Security

- [ ] **Password fields masked**
  - All sensitive inputs use `type="password"`
  - API key fields use password type
  - Token fields use password type

- [ ] **Input validation**
  - Client-side validators for critical fields
  - Server-side validation in node runtime
  - Regex validators for URLs, IPs, hostnames

- [ ] **XSS prevention**
  - User input not directly inserted into HTML
  - `oneditprepare` sanitizes dynamic content
  - Help text properly escaped

## TLS/SSL Configuration

- [ ] **Secure defaults**
  - `rejectUnauthorized: true` by default
  - Minimum TLS version 1.2
  - No deprecated ciphers enabled

- [ ] **Certificate handling**
  - Path traversal prevented
  - Certificate format validated before use
  - File size limits enforced
  - Errors don't expose file system paths

- [ ] **Production safety**
  - No `rejectUnauthorized: false` without explicit warning
  - Insecure options clearly documented
  - Development-only options labeled

## File Handling

- [ ] **Path validation**
  - User-provided paths validated
  - Path traversal attacks prevented
  - Symlink handling considered

- [ ] **File access**
  - Minimum required permissions checked
  - File existence verified before operations
  - Read/write errors handled gracefully

- [ ] **File content**
  - Content validated before processing
  - Size limits enforced
  - Encoding handled properly

## Authentication Mechanisms

- [ ] **Correct mechanism for use case**
  - API keys for service auth
  - OAuth for user delegation
  - SASL for message brokers
  - mTLS for service-to-service

- [ ] **Token handling**
  - Tokens stored securely (credentials system)
  - Token refresh implemented where applicable
  - Expired tokens handled gracefully

- [ ] **Session management**
  - Sessions cleaned up on close
  - Reconnection handles re-authentication
  - Failed auth doesn't leak information

## Error Handling

- [ ] **Secure error messages**
  - Internal errors not exposed to users
  - Stack traces not sent to clients
  - Error details logged server-side only

- [ ] **Authentication failures**
  - Generic "authentication failed" messages
  - No indication of which credential was wrong
  - Rate limiting considered for repeated failures

- [ ] **Connection errors**
  - Timeouts handled
  - Retry logic doesn't leak credentials
  - Connection state properly tracked

## Code Quality

- [ ] **Dependencies**
  - No known vulnerable dependencies
  - Dependencies regularly updated
  - Minimal dependency footprint

- [ ] **Input handling**
  - All external input validated
  - Message properties sanitized
  - No command injection possible

- [ ] **Resource management**
  - Connections closed on node close
  - Timers cleared on close
  - Memory leaks prevented

## Documentation

- [ ] **Security notes**
  - Insecure options documented
  - Security best practices included
  - Example configurations are secure

- [ ] **Credential requirements**
  - Required permissions documented
  - Minimum privilege principle explained
  - Credential setup instructions clear

## Quick Security Audit

Run these checks on your node code:

```bash
# Check for hardcoded secrets (false positives common)
grep -r "password\s*=" --include="*.js" .
grep -r "apiKey\s*=" --include="*.js" .
grep -r "secret\s*=" --include="*.js" .

# Check for disabled security
grep -r "rejectUnauthorized.*false" --include="*.js" .
grep -r "NODE_TLS_REJECT_UNAUTHORIZED" --include="*.js" .

# Check for eval/exec (potential injection)
grep -r "eval(" --include="*.js" .
grep -r "Function(" --include="*.js" .
grep -r "exec(" --include="*.js" .
grep -r "execSync(" --include="*.js" .

# Check credential logging
grep -r "\.log.*password" --include="*.js" .
grep -r "\.log.*credentials" --include="*.js" .
grep -r "console\.log.*password" --include="*.js" .
```

## Pre-Deployment Checklist

Before deploying to production:

1. **Credentials Review**
   - [ ] All secrets in credentials system or environment variables
   - [ ] No credentials in source control
   - [ ] Credential files have proper permissions

2. **TLS Verification**
   - [ ] `rejectUnauthorized` is `true`
   - [ ] Valid CA certificates configured
   - [ ] TLS 1.2+ enforced

3. **Access Control**
   - [ ] Minimum required permissions used
   - [ ] Service accounts properly scoped
   - [ ] API keys have appropriate access levels

4. **Monitoring**
   - [ ] Auth failures logged
   - [ ] Certificate expiry monitored
   - [ ] Connection errors tracked

5. **Recovery**
   - [ ] Credential rotation plan exists
   - [ ] Certificate renewal process documented
   - [ ] Fallback authentication considered

## Security Anti-Patterns to Avoid

### Never Do

```javascript
// WRONG: Credentials in defaults
defaults: {
    password: { value: "secret123" }
}

// WRONG: Logging credentials
node.log("Connecting with password: " + this.credentials.password);

// WRONG: Disabling TLS in production
tlsOptions.rejectUnauthorized = false;

// WRONG: Hardcoded secrets
const API_KEY = "sk-12345abcdef";

// WRONG: Credentials in error messages
throw new Error("Auth failed for user: " + username + " with password: " + password);

// WRONG: Path without validation
fs.readFileSync(userProvidedPath);

// WRONG: Command injection
exec("ls " + userInput);
```

### Always Do

```javascript
// CORRECT: Credentials in credentials system
credentials: {
    password: { type: "password" }
}

// CORRECT: No credential logging
node.log("Connecting to server");

// CORRECT: TLS enabled
tlsOptions.rejectUnauthorized = true;

// CORRECT: Environment variables
const apiKey = process.env.API_KEY || this.credentials.apiKey;

// CORRECT: Generic error messages
throw new Error("Authentication failed");

// CORRECT: Path validation
const safePath = validatePath(userProvidedPath, allowedDir);
fs.readFileSync(safePath);

// CORRECT: Parameterized commands
execFile("ls", ["-la", sanitizedPath]);
```
