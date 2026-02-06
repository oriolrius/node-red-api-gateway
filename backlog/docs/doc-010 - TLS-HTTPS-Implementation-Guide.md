---
id: doc-010
title: TLS/HTTPS Implementation Guide
type: other
created_date: '2026-02-06 11:19'
---
# TLS/HTTPS Implementation Guide

## Overview

The Node-RED API Gateway supports TLS/HTTPS for secure API endpoints. This document describes the implementation details and how to test it.

## Architecture

### TLS Request Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HTTPS CLIENT                                    │
│                                                                             │
│  ┌─────────────┐    TLS Handshake    ┌─────────────────────────────────┐   │
│  │ CA rootCA   │◄───────────────────►│  Validates server certificate   │   │
│  │ (rootCA.pem)│                     │  against trusted CA             │   │
│  └─────────────┘                     └─────────────────────────────────┘   │
└─────────────────────────────────────────┬───────────────────────────────────┘
                                          │
                                          │ HTTPS Request (encrypted)
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NODE-RED API GATEWAY                                 │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                           api-server.js                               │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │                    Fastify HTTPS Server                         │  │  │
│  │  │                                                                 │  │  │
│  │  │  https: {                                                       │  │  │
│  │  │    key:  fs.readFileSync(tlsKeyPath),   ◄── server.key         │  │  │
│  │  │    cert: fs.readFileSync(tlsCertPath),  ◄── server.crt         │  │  │
│  │  │    ca:   fs.readFileSync(tlsCaPath),    ◄── rootCA.pem (opt)   │  │  │
│  │  │    minVersion: tlsMinVersion            ◄── TLSv1.2 default    │  │  │
│  │  │  }                                                              │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│  ┌─────────────────────────────────┼────────────────────────────────────┐  │
│  │              api-config.js      │                                     │  │
│  │  ┌──────────────────────────────┴─────────────────────────────────┐  │  │
│  │  │  TLS Configuration Storage                                      │  │  │
│  │  │  • tlsEnabled: true/false                                       │  │  │
│  │  │  • tlsCertPath: "/path/to/server.crt"                          │  │  │
│  │  │  • tlsKeyPath: "/path/to/server.key"                           │  │  │
│  │  │  • tlsCaPath: "/path/to/rootCA.pem" (optional)                 │  │  │
│  │  │  • tlsMinVersion: "TLSv1.2"                                    │  │  │
│  │  │  • tlsRejectUnauthorized: true                                 │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Certificate Chain

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CERTIFICATE TRUST CHAIN                            │
│                                                                             │
│    ┌─────────────────┐                                                      │
│    │   mkcert CA     │  Root Certificate Authority (locally trusted)        │
│    │   (rootCA.pem)  │  Located at: ~/.local/share/mkcert/rootCA.pem       │
│    └────────┬────────┘                                                      │
│             │ signs                                                         │
│             ▼                                                               │
│    ┌─────────────────┐                                                      │
│    │ Server Cert     │  Server Certificate (identifies the server)          │
│    │ (server.crt)    │  Contains: CN=localhost, SAN=127.0.0.1, ::1         │
│    └────────┬────────┘                                                      │
│             │ paired with                                                   │
│             ▼                                                               │
│    ┌─────────────────┐                                                      │
│    │ Private Key     │  Server Private Key (must be kept secret)            │
│    │ (server.key)    │  Used to prove server identity during TLS handshake │
│    └─────────────────┘                                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### E2E Test Architecture

All e2e tests use a unified Docker infrastructure (`docker-compose.yml`).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        openapi-tls.test.js (Self-Contained)                  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 1. SETUP PHASE                                                        │  │
│  │    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │  │
│  │    │ Generate    │  │ Copy TLS    │  │ Start       │                 │  │
│  │    │ Certs       │─►│ Test Flow   │─►│ Docker      │                 │  │
│  │    │ (mkcert)    │  │ to flows.json│  │ Stack       │                 │  │
│  │    └─────────────┘  └─────────────┘  └─────────────┘                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 2. DOCKER STACK (docker-compose.yml --profile nodered)                │  │
│  │                                                                        │  │
│  │    ┌──────────────────┐      ┌──────────────────────────────────┐    │  │
│  │    │  network-base    │      │  node-red                         │    │  │
│  │    │  (alpine)        │◄────►│  Port 1880: Node-RED Editor       │    │  │
│  │    │                  │      │  Port 3443: API Gateway (HTTPS)   │    │  │
│  │    │  Ports:          │      │                                    │    │  │
│  │    │  - 1880:1880     │      │  Volumes:                          │    │  │
│  │    │  - 3443:3443     │      │  - ./certs:/data/certs:ro          │    │  │
│  │    └──────────────────┘      │  - ./flows.json:/data/flows.json   │    │  │
│  │                              └──────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 3. TEST PHASE                                                         │  │
│  │                                                                        │  │
│  │    Test Client ──── HTTPS + CA Cert ────► API Gateway :3443           │  │
│  │         │                                       │                      │  │
│  │         │  Validates:                           │  Serves:             │  │
│  │         │  • Correct CA works                   │  • /api/v1/health    │  │
│  │         │  • Wrong CA fails                     │  • /api/v1/echo      │  │
│  │         │  • OpenAPI spec (HTTPS URL)           │  • /openapi.json     │  │
│  │         │  • Swagger UI accessible              │  • /docs             │  │
│  │         │  • Metrics endpoint                   │  • /metrics          │  │
│  │         ▼                                       ▼                      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 4. TEARDOWN PHASE                                                     │  │
│  │    Stop Docker Stack ──► Remove Containers ──► Report Results         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Configuration

### api-config Node Settings

The following TLS settings are available in the api-config node:

| Setting | Description | Default |
|---------|-------------|---------|
| `tlsEnabled` | Enable TLS/HTTPS | `false` |
| `tlsCertPath` | Path to server certificate file (.crt/.pem) | - |
| `tlsKeyPath` | Path to server private key file (.key/.pem) | - |
| `tlsCaPath` | Path to CA certificate (optional, for client cert validation) | - |
| `tlsMinVersion` | Minimum TLS version (TLSv1, TLSv1.1, TLSv1.2, TLSv1.3) | `TLSv1.2` |
| `tlsRejectUnauthorized` | Verify client certificates | `true` |

### How It Works

1. When `tlsEnabled` is true and cert/key paths are provided, api-server.js reads the certificate files
2. Fastify is initialized with `https` options containing `key`, `cert`, and optionally `ca` and `minVersion`
3. The server listens on the configured port using HTTPS instead of HTTP
4. Node status displays the protocol (e.g., `https://0.0.0.0:3443`)

### Code Location

The TLS implementation is in `nodes/api-server.js` in the `startServer()` function (around line 584-615).

## Certificate Generation

### Using Bundled mkcert

The project includes a bundled mkcert binary at `contrib/mkcert` for generating locally-trusted development certificates.

```bash
# Generate certificates
npm run setup:certs

# Or directly
./tests/e2e/setup-certs.sh

# Clean up certificates
./tests/e2e/setup-certs.sh clean
```

### Generated Files

| File | Purpose |
|------|---------|
| `tests/e2e/certs/server.crt` | Server certificate |
| `tests/e2e/certs/server.key` | Server private key |
| `tests/e2e/certs/rootCA.pem` | CA root certificate for client validation |

### Manual Certificate Generation

For production, use certificates from a trusted CA. For development:

```bash
# Using mkcert
mkcert -cert-file server.crt -key-file server.key localhost 127.0.0.1

# Using OpenSSL (self-signed)
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt -days 365 -nodes
```

## E2E Testing

### Running TLS Tests

```bash
npm run test:openapi-tls
```

This command is fully self-contained and will:
1. Generate certificates using bundled mkcert (if not present)
2. Copy the TLS test flow to `.nodered/flows.json`
3. Start the unified Docker stack with `--profile nodered`
4. Wait for Node-RED to be ready (doesn't wait for Keycloak/OPA)
5. Run all 9 TLS/OpenAPI tests
6. Tear down the Docker stack

### Test Coverage

| Test | Description |
|------|-------------|
| HTTPS connection with valid cert | Verifies server accepts connections with correct CA |
| Connection fails with wrong CA | Proves certificate validation is enforced |
| OpenAPI spec endpoint | Validates /openapi.json returns valid OpenAPI 3.x |
| OpenAPI HTTPS server URL | Confirms spec contains https:// server URL |
| OpenAPI includes endpoints | Checks all registered endpoints in spec |
| OpenAPI includes schemas | Validates request/response schemas present |
| Swagger UI endpoint | Confirms /docs serves Swagger UI over HTTPS |
| Echo endpoint over HTTPS | Tests POST request with body validation |
| Metrics endpoint over HTTPS | Verifies /metrics accessible via HTTPS |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SKIP_DOCKER_SETUP=1` | Skip Docker setup (use existing stack) |
| `SKIP_DOCKER_TEARDOWN=1` | Keep Docker running after tests |

### Test Files

| File | Purpose |
|------|---------|
| `tests/e2e/openapi-tls.test.js` | Main test suite (self-contained) |
| `tests/e2e/openapi-tls-test-flow.json` | Node-RED flow with TLS enabled |
| `tests/e2e/docker-compose.yml` | Unified Docker stack for all e2e tests |
| `tests/e2e/setup-certs.sh` | Certificate generation script |

## Troubleshooting

### Certificate Errors

**UNABLE_TO_VERIFY_LEAF_SIGNATURE**: The CA certificate is not trusted. Ensure you're using the correct rootCA.pem.

**CERT_HAS_EXPIRED**: Regenerate certificates with `npm run setup:certs`.

**ENOENT on cert path**: Check that tlsCertPath and tlsKeyPath point to valid files.

### Server Won't Start with TLS

1. Verify certificate files exist and are readable
2. Check Node-RED logs for "Failed to load TLS certificates" error
3. Ensure private key matches the certificate
4. Verify file permissions (key should be readable by Node-RED process)

### Tests Fail to Connect

1. Ensure ports are not in use: `lsof -i :3443` and `lsof -i :1880`
2. Check Docker containers are running: `docker ps | grep api-gateway`
3. Verify certificates are mounted in container: check docker-compose.yml volumes

## Related Files

- `nodes/api-server.js` - TLS implementation
- `nodes/api-config.js` - TLS configuration storage
- `nodes/api-config.html` - TLS UI form fields
- `contrib/mkcert` - Bundled certificate generator
- `backlog/tasks/task-070.md` - Implementation task
