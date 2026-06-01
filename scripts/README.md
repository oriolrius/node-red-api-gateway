# Scripts

Utility scripts for the node-red-api-gateway project.

## refresh-cert.sh

Generic certificate refresher for [Nginx Proxy Manager](https://nginxproxymanager.com/)
(NPM). Fetches a certificate via [npm-cli](https://github.com/oriolrius/npm-cli)
(run with `uvx`, no install), writes it to disk under configurable filenames, and
**optionally reloads the service that serves it — only when the certificate changed.**

Fully environment-driven: **no hardcoded paths, domains, or credentials.** Credentials
are read from the environment (or a sourced `ENV_FILE`) and never live in the script.

### Practices it implements

- **Fresh auth every run** — npm-cli login tokens expire after ~1 day, so a cached
  token silently breaks unattended jobs. This re-authenticates each run.
- **certbot archive-index aware** — on renewal NPM/certbot bumps the file index
  (`cert1.pem → cert2.pem`). Files are matched by *role*, not a fixed index.
- **Reload only on change** — diffs before doing anything; idempotent otherwise.
- **Self-healing detection** — when a verify host is set, it compares against the
  **live served** cert, so a failed reload retries on the next run.
- **Large-flow safe** — Node-RED redeploys POST the flows via a file, not a CLI arg.

### Environment contract

| Variable | Req | Default | Notes |
|----------|-----|---------|-------|
| `NPM_URL` | ✓ | — | NPM base URL, e.g. `http://rproxy.example.com:81` |
| `NPM_USER` + `NPM_PASS` | ✓\* | — | NPM login (\*or `NPM_TOKEN`) |
| `NPM_TOKEN` | ✓\* | — | Alternative to user/pass |
| `CERT_ID` | ✓ | — | NPM cert id (`npm-cli certs list`) |
| `DOMAIN` | ✓ | — | Cert domain (download subdir) |
| `OUT_DIR` | ✓ | — | Where to write the cert files |
| `OUT_FULLCHAIN` | | `fullchain1.pem` | Empty = skip |
| `OUT_PRIVKEY` | | `privkey1.pem` | Empty = skip |
| `OUT_CERT` | | `cert1.pem` | Empty = skip |
| `OUT_CHAIN` | | `chain1.pem` | Empty = skip |
| `RELOAD_CMD` | | — | Reload command on change (wins over node-red mode) |
| `NR_URL`+`NR_USER`+`NR_PASS` | | — | Node-RED admin API: full flow redeploy |
| `VERIFY_HOST` [`VERIFY_PORT`=443] | | — | Probe live cert → compare-to-live + post-reload verify |
| `NPM_CLI` | | `uvx --from git+https://github.com/oriolrius/npm-cli npm-cli` | npm-cli invocation |
| `ENV_FILE` | | — | File to source for all of the above |

Reload precedence on change: `RELOAD_CMD` → else node-red (`NR_*`) → else none.

### Examples

**e2e cert prep** (no reload — what `download-apigw-cert.sh` does):
```bash
NPM_URL=http://rproxy.joor.net:81 NPM_USER=… NPM_PASS=… \
CERT_ID=23 DOMAIN=apigw.joor.net OUT_DIR=./tests/e2e/certs \
OUT_FULLCHAIN=server.crt OUT_PRIVKEY=server.key \
./scripts/refresh-cert.sh
```

**Node-RED gateway** (redeploy + verify on change):
```bash
NPM_URL=… NPM_USER=… NPM_PASS=… CERT_ID=26 DOMAIN=api.example.com \
OUT_DIR=/opt/stacks/node-red/certs/api.example.com \
NR_URL=http://localhost:1880 NR_USER=admin NR_PASS=… \
VERIFY_HOST=127.0.0.1 VERIFY_PORT=443 \
./scripts/refresh-cert.sh
```

**nginx** (reload on change):
```bash
NPM_URL=… NPM_USER=… NPM_PASS=… CERT_ID=7 DOMAIN=www.example.com \
OUT_DIR=/etc/ssl/www.example.com \
RELOAD_CMD='systemctl reload nginx' \
VERIFY_HOST=127.0.0.1 \
./scripts/refresh-cert.sh
```

### Cron

Keep secrets out of the crontab — put config in a root-only env file and source it:

```bash
# /root/.config/example-cert.env  (chmod 600)
NPM_URL=http://rproxy.example.com:81
NPM_USER=...
NPM_PASS=...
CERT_ID=7
DOMAIN=www.example.com
OUT_DIR=/etc/ssl/www.example.com
RELOAD_CMD=systemctl reload nginx
VERIFY_HOST=127.0.0.1
```

```cron
0 1 * * * ENV_FILE=/root/.config/example-cert.env /path/to/refresh-cert.sh >> /var/log/example-cert.log 2>&1
```

`uvx` must be on `PATH` (e.g. `~/.local/bin`); set it in the env file or the cron line
if needed. Pin a different npm-cli via `NPM_CLI`.

---

## download-apigw-cert.sh

Thin **preset** over `refresh-cert.sh` for the JOOR e2e use case: fetches the
`apigw.joor.net` cert (NPM id 23) into `tests/e2e/certs/`, mapping `fullchain → server.crt`
and `privkey → server.key` (plus `cert1.pem`/`chain1.pem`). No service reload — it just
stages cert files for the tests.

```bash
# credentials from the environment (e.g. Bitwarden)
export NPM_USER=$(bash "$HOME/.claude/skills/bitwarden/scripts/bw_exec.sh" get username "NPM (10.2.0.2)")
export NPM_PASS=$(bash "$HOME/.claude/skills/bitwarden/scripts/bw_exec.sh" get password "NPM (10.2.0.2)")
./scripts/download-apigw-cert.sh
```

Any default (`CERT_ID`, `DOMAIN`, `OUT_DIR`, `OUT_*`) can be overridden via the environment.

---

## audit-saved-schemas.js

See the script header. Audits saved request/response schemas for OpenAPI 3.0-only
constructs that won't compile under the Ajv 2020-12 validator (used during the
OAS 3.1 migration).
