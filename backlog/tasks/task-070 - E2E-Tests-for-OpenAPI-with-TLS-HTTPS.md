---
id: task-070
title: E2E Tests for OpenAPI with TLS/HTTPS
status: Done
assignee: []
created_date: '2026-02-06 11:15'
updated_date: '2026-02-06 11:16'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add TLS/HTTPS support to the api-server node and create fully self-contained e2e tests for OpenAPI functionality using mkcert-generated certificates with proper CA validation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TLS/HTTPS support added to api-server.js Fastify initialization
- [x] #2 Server reads certificate files from api-config paths (tlsCertPath, tlsKeyPath, tlsCaPath)
- [x] #3 Server status shows protocol (http/https) in Node-RED UI
- [x] #4 mkcert binary bundled in contrib/mkcert (no external install required)
- [x] #5 Certificate setup script (tests/e2e/setup-certs.sh) uses bundled mkcert
- [x] #6 Certificates auto-generated when running tests if they don't exist
- [x] #7 TLS test flow created (tests/e2e/openapi-tls-test-flow.json)
- [x] #8 Minimal Docker Compose for TLS tests (docker-compose-tls.yml) - no Keycloak/OPA dependency
- [x] #9 E2E test is fully self-contained (auto setup/teardown Docker, certs, flows)
- [x] #10 Test validates HTTPS connection with correct CA certificate
- [x] #11 Test validates connection fails with wrong CA (proves validation enforced)
- [x] #12 Test validates OpenAPI spec served over HTTPS
- [x] #13 Test validates OpenAPI spec contains HTTPS server URL
- [x] #14 Test validates Swagger UI accessible over HTTPS
- [x] #15 Test validates functional endpoints work over HTTPS (echo, metrics)
- [x] #16 npm scripts added: setup:certs, test:openapi-tls
- [x] #17 tests/e2e/certs/ added to .gitignore
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added fs require to api-server.js for reading certificate files. TLS enabled when configNode.tlsEnabled && tlsCertPath && tlsKeyPath are set. Fastify receives https options: { key, cert, ca (optional), minVersion (optional) }. Created docker-compose-tls.yml as minimal stack (only network-base + node-red). Test uses wrong CA certificate to prove validation is enforced (not just missing CA). mkcert v1.4.4 Linux x86_64 binary bundled in contrib/. Test supports SKIP_DOCKER_SETUP=1 and SKIP_DOCKER_TEARDOWN=1 env vars.

Files Created:
- contrib/mkcert - Bundled mkcert binary
- tests/e2e/setup-certs.sh - Certificate generation script
- tests/e2e/openapi-tls-test-flow.json - TLS test Node-RED flow
- tests/e2e/docker-compose-tls.yml - Minimal Docker stack for TLS tests
- tests/e2e/openapi-tls.test.js - Self-contained e2e test suite

Files Modified:
- nodes/api-server.js - Added TLS/HTTPS support
- package.json - Added npm scripts
- .gitignore - Added tests/e2e/certs/
- tests/e2e/docker-compose.yml - Added port 3443 and certs volume mount"

Commit: b5abdde - feat(test): add TLS/HTTPS e2e tests for OpenAPI
<!-- SECTION:NOTES:END -->
