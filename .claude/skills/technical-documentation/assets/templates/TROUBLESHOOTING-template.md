# Troubleshooting Guide

Solutions to common issues with [Project Name].

## Quick Diagnostics

Run these commands to gather diagnostic information:

```bash
# Check installed version
npm list @scope/package-name

# Check Node.js version
node -v

# Check npm version
npm -v

# For Node-RED: check logs
tail -f ~/.node-red/node-red.log
```

## Common Issues

### Installation Issues

#### Issue: Package fails to install

**Error message:**
```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
```

**Cause:** Conflicting peer dependencies

**Solution:**
```bash
# Option 1: Use legacy peer deps
npm install @scope/package-name --legacy-peer-deps

# Option 2: Force install
npm install @scope/package-name --force
```

#### Issue: Permission denied during install

**Error message:**
```
npm ERR! Error: EACCES: permission denied
```

**Cause:** npm doesn't have write permissions

**Solution:**
```bash
# Option 1: Fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH

# Option 2: Use sudo (not recommended)
sudo npm install -g @scope/package-name
```

### Configuration Issues

#### Issue: Configuration not being applied

**Symptoms:**
- Default values used instead of configured values
- Settings appear to be ignored

**Cause:** Configuration file not found or invalid format

**Solution:**
1. Verify configuration file location
2. Check file permissions: `ls -la config.json`
3. Validate JSON syntax: `cat config.json | python -m json.tool`
4. Check for typos in property names

#### Issue: Environment variables not recognized

**Symptoms:**
- `undefined` values in configuration
- Environment-specific settings not applied

**Solution:**
```bash
# Verify environment variable is set
echo $MY_ENV_VAR

# Set environment variable
export MY_ENV_VAR="value"

# Or use .env file with dotenv package
```

### Runtime Issues

#### Issue: Connection timeout

**Error message:**
```
Error: ETIMEDOUT
```

**Cause:** Network issues or server not responding

**Solution:**
1. Verify network connectivity: `ping api.example.com`
2. Check firewall rules
3. Increase timeout value:
   ```javascript
   { timeout: 60000 } // 60 seconds
   ```
4. Check if server is running and accessible

#### Issue: Memory leak / High memory usage

**Symptoms:**
- Memory usage grows over time
- Application slows down or crashes
- "JavaScript heap out of memory" error

**Solution:**
1. Check for unclosed connections
2. Verify event listeners are removed
3. Increase memory limit (temporary fix):
   ```bash
   node --max-old-space-size=4096 app.js
   ```
4. Profile memory usage:
   ```bash
   node --inspect app.js
   # Open chrome://inspect in Chrome
   ```

#### Issue: "Cannot find module" error

**Error message:**
```
Error: Cannot find module '@scope/package-name'
```

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules
npm install

# Clear npm cache
npm cache clean --force

# Verify package is installed
npm list @scope/package-name
```

### Node-RED Specific Issues

#### Issue: Node doesn't appear in palette

**Symptoms:**
- Node not visible after installation
- Palette shows old version

**Solution:**
1. Restart Node-RED
2. Check Node-RED logs for loading errors:
   ```bash
   tail -f ~/.node-red/node-red.log
   ```
3. Verify installation location:
   ```bash
   ls ~/.node-red/node_modules/@scope/package-name
   ```
4. Check for conflicting packages

#### Issue: Node shows red triangle (error state)

**Symptoms:**
- Node displays error indicator
- Status shows "error" or "disconnected"

**Solution:**
1. Double-click node to check configuration
2. Verify server/endpoint is accessible
3. Check credentials are correct
4. Review Node-RED debug panel for error messages

#### Issue: Flow deployment fails

**Error message:**
```
Error: Failed to deploy flow
```

**Solution:**
1. Check Node-RED logs for specific error
2. Validate node configuration
3. Verify all required nodes are installed
4. Try deploying nodes one at a time to isolate issue

## Error Messages Reference

| Error Code | Meaning | Solution |
|------------|---------|----------|
| `ECONNREFUSED` | Server not accepting connections | Check server is running |
| `ETIMEDOUT` | Connection timed out | Increase timeout, check network |
| `ENOTFOUND` | DNS lookup failed | Check hostname, network |
| `EACCES` | Permission denied | Check file/network permissions |
| `ENOMEM` | Out of memory | Increase memory limit |

## Debug Mode

Enable debug logging for more information:

```bash
# Set debug environment variable
DEBUG=package-name:* node app.js

# For Node-RED
DEBUG=package-name:* node-red
```

## Getting Help

If your issue isn't covered here:

1. **Search existing issues:** [GitHub Issues](https://github.com/user/repo/issues)
2. **Check discussions:** [GitHub Discussions](https://github.com/user/repo/discussions)
3. **Open new issue:** Include:
   - Package version
   - Node.js version
   - Operating system
   - Complete error message
   - Steps to reproduce
   - Relevant configuration (sanitized)

## Diagnostic Information Template

When reporting issues, include this information:

```
Package version: X.X.X
Node.js version: X.X.X
npm version: X.X.X
Operating system:
Node-RED version (if applicable): X.X.X

Error message:
[paste complete error]

Steps to reproduce:
1.
2.
3.

Configuration (remove sensitive data):
[paste relevant config]
```
