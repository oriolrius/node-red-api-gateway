# Scripts

Utility scripts for the node-red-api-gateway project.

## download-apigw-cert.sh

Downloads SSL certificates for `apigw.joor.net` from Nginx Proxy Manager (NPM) and updates the e2e test certificates.

### Features

- Uses [npm-cli](https://github.com/oriolrius/npm-cli) via `uvx` (no installation required)
- **Safe updates**: Only overwrites files if they differ from the downloaded version
- Compares using `diff -q` before copying
- Maps NPM certificate files to project structure:
  - `cert1.pem` → `tests/e2e/certs/cert1.pem`
  - `chain1.pem` → `tests/e2e/certs/chain1.pem`
  - `fullchain1.pem` → `tests/e2e/certs/server.crt`
  - `privkey1.pem` → `tests/e2e/certs/server.key`

### Prerequisites

- **uv** - Python package manager with `uvx` command
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

### Usage

```bash
./scripts/download-apigw-cert.sh
```

### Output Example

```
=== NPM Certificate Downloader for apigw.joor.net ===
Using: uvx npm-cli

Authenticating with NPM...
✓ Logged in successfully. Token cached for server 'default'
Downloading certificate ID 23 (apigw.joor.net)...
✓ Certificate downloaded to /tmp/tmp.xxx/apigw.joor.net

Comparing certificates...
  [SKIP] cert1.pem - identical
  [SKIP] chain1.pem - identical
  [SKIP] server.crt (fullchain) - identical
  [SKIP] server.key (privkey) - identical

All certificates are already up to date - no changes made

Done.
```

### Crontab Setup

To automatically sync certificates (e.g., weekly), add a cron job:

#### 1. Edit crontab

```bash
crontab -e
```

#### 2. Add cron entry

Run weekly on Sunday at 3:00 AM:

```cron
# Sync apigw.joor.net certificates from NPM
0 3 * * 0 PATH=/home/oriol/.local/bin:/usr/local/bin:/usr/bin:/bin /home/oriol/nodered/node-red-api-gateway/scripts/download-apigw-cert.sh >> /home/oriol/logs/apigw-cert-sync.log 2>&1
```

**Important notes:**
- The `PATH` must include the directory containing `uvx` (`/home/oriol/.local/bin`)
- Adjust paths according to your system
- Create the log directory: `mkdir -p ~/logs`

#### 3. Alternative: Wrapper script for cron

Create a wrapper script that sets up the environment:

```bash
#!/bin/bash
# /home/oriol/bin/sync-apigw-cert.sh

# Set PATH for uvx
export PATH="/home/oriol/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Run the certificate sync
/home/oriol/nodered/node-red-api-gateway/scripts/download-apigw-cert.sh
```

Then use in crontab:
```cron
0 3 * * 0 /home/oriol/bin/sync-apigw-cert.sh >> /home/oriol/logs/apigw-cert-sync.log 2>&1
```

#### 4. Verify cron is working

```bash
# List current crontab
crontab -l

# Check cron logs (Ubuntu/Debian)
grep CRON /var/log/syslog | tail -20

# Test the script manually first
./scripts/download-apigw-cert.sh
```

### Configuration

The script has hardcoded configuration for the JOOR infrastructure:

| Variable | Value | Description |
|----------|-------|-------------|
| `NPM_URL` | `http://rproxy.joor.net:81` | NPM server URL |
| `NPM_USER` | `oriol@joor.net` | NPM username |
| `CERT_ID` | `23` | Certificate ID for apigw.joor.net |
| `DOMAIN` | `apigw.joor.net` | Domain name |

### Why uvx instead of uv pip install?

Using `uvx` (run without install) is preferred for cron jobs because:

1. **No installation required** - Works immediately without setup
2. **Always latest version** - Fetches the latest npm-cli from GitHub
3. **Isolated execution** - No conflicts with system packages
4. **Simpler cron setup** - Just needs uvx in PATH, no virtual environment activation

The only requirement is having `uv` installed, which provides the `uvx` command.
