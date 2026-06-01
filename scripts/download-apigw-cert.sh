#!/bin/bash
# Download apigw.joor.net certificate from Nginx Proxy Manager using npm-cli
# Only overwrites if certificates are different
#
# Requires: uv (https://docs.astral.sh/uv/)
# Uses: npm-cli (https://github.com/oriolrius/npm-cli) via uvx

set -e

# Configuration (override any of these via the environment)
NPM_URL="${NPM_URL:-http://rproxy.joor.net:81}"
CERT_ID="${CERT_ID:-23}"          # apigw.joor.net
DOMAIN="${DOMAIN:-apigw.joor.net}"

# Nginx Proxy Manager credentials.
# NEVER hardcode these — provide them via the environment. For example, pull them
# from Bitwarden (item "NPM (10.2.0.2)") just before running:
#   export NPM_USER=$(bash "$HOME/.claude/skills/bitwarden/scripts/bw_exec.sh" get username "NPM (10.2.0.2)")
#   export NPM_PASS=$(bash "$HOME/.claude/skills/bitwarden/scripts/bw_exec.sh" get password "NPM (10.2.0.2)")
: "${NPM_USER:?Set NPM_USER (Nginx Proxy Manager login) in the environment — see comments above}"
: "${NPM_PASS:?Set NPM_PASS (Nginx Proxy Manager password) in the environment — see comments above}"

# Target directory (relative to script location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="${SCRIPT_DIR}/../tests/e2e/certs"

# Temp directory for download
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# npm-cli command using uvx (no installation required)
NPM_CLI="uvx --from git+https://github.com/oriolrius/npm-cli.git npm-cli"

# Check if uvx is available
if ! command -v uvx &> /dev/null; then
    echo "ERROR: uvx not found. Install uv from https://docs.astral.sh/uv/"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

echo "=== NPM Certificate Downloader for ${DOMAIN} ==="
echo "Using: uvx npm-cli"
echo ""

# Login to NPM (caches token for subsequent commands)
echo "Authenticating with NPM..."
$NPM_CLI auth login --url "$NPM_URL" --user "$NPM_USER" --password "$NPM_PASS" 2>/dev/null || \
$NPM_CLI auth login --url "$NPM_URL" --user "$NPM_USER" --password "$NPM_PASS"

# Download certificate using npm-cli
echo "Downloading certificate ID ${CERT_ID} (${DOMAIN})..."
$NPM_CLI certs download "$CERT_ID" -o "$TMP_DIR"

# npm-cli creates a subdirectory with the domain name
DOWNLOADED_DIR="${TMP_DIR}/${DOMAIN}"

if [ ! -d "$DOWNLOADED_DIR" ]; then
    echo "ERROR: Certificate download failed - directory not found"
    exit 1
fi

# Check if target directory exists
mkdir -p "${CERTS_DIR}"

# Compare and update if different
UPDATED=0

compare_and_copy() {
    local src="$1"
    local dst="$2"
    local name="$3"

    if [ ! -f "$src" ]; then
        echo "WARNING: Source file $src not found"
        return
    fi

    if [ -f "$dst" ]; then
        if diff -q "$src" "$dst" > /dev/null 2>&1; then
            echo "  [SKIP] $name - identical"
        else
            cp "$src" "$dst"
            echo "  [UPDATE] $name - updated with new version"
            UPDATED=1
        fi
    else
        cp "$src" "$dst"
        echo "  [NEW] $name - created"
        UPDATED=1
    fi
}

echo ""
echo "Comparing certificates..."
compare_and_copy "${DOWNLOADED_DIR}/cert1.pem" "${CERTS_DIR}/cert1.pem" "cert1.pem"
compare_and_copy "${DOWNLOADED_DIR}/chain1.pem" "${CERTS_DIR}/chain1.pem" "chain1.pem"
compare_and_copy "${DOWNLOADED_DIR}/fullchain1.pem" "${CERTS_DIR}/server.crt" "server.crt (fullchain)"
compare_and_copy "${DOWNLOADED_DIR}/privkey1.pem" "${CERTS_DIR}/server.key" "server.key (privkey)"

echo ""
if [ $UPDATED -eq 1 ]; then
    echo "Certificate files have been updated!"
    echo ""
    echo "New certificate details:"
    openssl x509 -in "${CERTS_DIR}/cert1.pem" -noout -subject -dates 2>/dev/null
else
    echo "All certificates are already up to date - no changes made"
fi

echo ""
echo "Done."
