#!/bin/bash
# Certificate Setup Script for TLS E2E Tests
#
# This script generates locally-trusted development certificates using mkcert.
# The certificates are used for testing HTTPS/TLS functionality with the API Gateway.
#
# The mkcert binary is bundled in the contrib/ directory - no installation required.
#
# Usage:
#   ./setup-certs.sh          # Generate certificates in tests/e2e/certs/
#   ./setup-certs.sh clean    # Remove generated certificates
#
# Generated files:
#   - server.crt    - Server certificate
#   - server.key    - Server private key
#   - rootCA.pem    - CA root certificate (for client validation)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CERTS_DIR="${SCRIPT_DIR}/certs"
MKCERT_BIN="${PROJECT_ROOT}/contrib/mkcert"

# Check for clean argument
if [ "$1" = "clean" ]; then
    echo "Removing certificates from ${CERTS_DIR}..."
    rm -rf "${CERTS_DIR}"
    echo "Done."
    exit 0
fi

# Check if bundled mkcert exists
if [ ! -x "${MKCERT_BIN}" ]; then
    echo "Error: mkcert binary not found at ${MKCERT_BIN}"
    echo ""
    echo "The mkcert binary should be bundled in the contrib/ directory."
    echo "Please ensure the project is properly set up."
    exit 1
fi

echo "Using mkcert: ${MKCERT_BIN}"
echo "mkcert version: $("${MKCERT_BIN}" --version)"
echo ""

# Check if local CA is installed, if not install it
CAROOT=$("${MKCERT_BIN}" -CAROOT 2>/dev/null || echo "")
if [ -z "${CAROOT}" ] || [ ! -f "${CAROOT}/rootCA.pem" ]; then
    echo "Installing mkcert local CA (requires sudo for system trust store)..."
    "${MKCERT_BIN}" -install
    CAROOT=$("${MKCERT_BIN}" -CAROOT)
fi

if [ ! -f "${CAROOT}/rootCA.pem" ]; then
    echo "Error: mkcert local CA installation failed."
    echo "CAROOT: ${CAROOT}"
    exit 1
fi

echo "Using CA root from: ${CAROOT}"

# Create certs directory
echo "Creating certificates directory: ${CERTS_DIR}"
mkdir -p "${CERTS_DIR}"

# Generate certificates for localhost
echo "Generating certificates for localhost, 127.0.0.1, and ::1..."
"${MKCERT_BIN}" -cert-file "${CERTS_DIR}/server.crt" \
                -key-file "${CERTS_DIR}/server.key" \
                localhost 127.0.0.1 ::1

# Copy CA root certificate for client validation
echo "Copying CA root certificate..."
cp "${CAROOT}/rootCA.pem" "${CERTS_DIR}/rootCA.pem"

# Set appropriate permissions
chmod 644 "${CERTS_DIR}/server.crt"
chmod 600 "${CERTS_DIR}/server.key"
chmod 644 "${CERTS_DIR}/rootCA.pem"

echo ""
echo "Certificates generated successfully!"
echo ""
echo "Files created:"
echo "  ${CERTS_DIR}/server.crt  - Server certificate"
echo "  ${CERTS_DIR}/server.key  - Server private key"
echo "  ${CERTS_DIR}/rootCA.pem  - CA root certificate"
echo ""
echo "Use these paths in your api-config node:"
echo "  tlsCertPath: ${CERTS_DIR}/server.crt"
echo "  tlsKeyPath:  ${CERTS_DIR}/server.key"
echo "  tlsCaPath:   ${CERTS_DIR}/rootCA.pem (optional, for client cert validation)"
