#!/usr/bin/env bash
# Preset wrapper: refresh the apigw.joor.net certificate into the e2e test certs.
#
# Thin shim over the generic scripts/refresh-cert.sh. It only sets defaults for the
# JOOR e2e use case (no service reload — it just stages cert files for the tests).
#
# Credentials come from the environment (never hardcoded). For example, from Bitwarden:
#   export NPM_USER=$(bash "$HOME/.claude/skills/bitwarden/scripts/bw_exec.sh" get username "NPM (10.2.0.2)")
#   export NPM_PASS=$(bash "$HOME/.claude/skills/bitwarden/scripts/bw_exec.sh" get password "NPM (10.2.0.2)")
#   ./scripts/download-apigw-cert.sh
#
# Any of these may be overridden via the environment.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export NPM_URL="${NPM_URL:-http://rproxy.joor.net:81}"
export CERT_ID="${CERT_ID:-23}"
export DOMAIN="${DOMAIN:-apigw.joor.net}"
export OUT_DIR="${OUT_DIR:-$DIR/../tests/e2e/certs}"
# Map NPM's fullchain/privkey to the server.crt/server.key the e2e stack expects.
export OUT_FULLCHAIN="${OUT_FULLCHAIN:-server.crt}"
export OUT_PRIVKEY="${OUT_PRIVKEY:-server.key}"
export OUT_CERT="${OUT_CERT:-cert1.pem}"
export OUT_CHAIN="${OUT_CHAIN:-chain1.pem}"
# No reload / no verify for e2e cert prep.

exec "$DIR/refresh-cert.sh" "$@"
