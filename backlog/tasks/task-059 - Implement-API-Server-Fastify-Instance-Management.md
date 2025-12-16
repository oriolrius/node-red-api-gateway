---
id: task-059
title: Implement API Server Fastify Instance Management
status: Done
assignee: []
created_date: '2025-12-10 09:40'
updated_date: '2025-12-16 11:37'
labels:
  - api-server
  - fastify
  - http
  - blocker
  - critical
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CRITICAL BLOCKER: Implement the api-server node to manage Fastify HTTP server instances. The node references an api-config for settings and manages server lifecycle (start, stop, restart). Properties: name, apiConfig (reference), host, port, autoStart. The server registers routes from connected api-endpoint nodes.

This task is CRITICAL because:
- api-endpoint.js already calls node.serverNode.registerEndpoint(node) expecting this function to exist
- Without Fastify instance management, the entire API gateway cannot start or handle any HTTP requests
- All configuration work done in api-config (health checks, connection pools, TLS, OAuth2, OPA) is completely UNUSED until this task creates the server that references api-config
- This is a BLOCKING dependency for task-060 (route registration) and all downstream functionality
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Fastify added as project dependency in package.json
- [x] #2 Reference to api-config configuration node
- [x] #3 Host and port configuration with defaults
- [x] #4 Fastify server lifecycle management (start/stop)
- [x] #5 Auto-start option on Node-RED deploy
- [x] #6 Route registration from api-endpoint nodes
- [x] #7 Server status displayed in Node-RED editor

- [x] #8 Graceful shutdown on node close/redeploy
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PREREQUISITE: Fastify must be added as a dependency before starting this task. Run: npm install fastify @fastify/swagger @fastify/swagger-ui

CRITICAL IMPLEMENTATION NOTES:
- The api-endpoint node is currently trying to call registerEndpoint() on a server node that doesn't exist
- Must implement proper Fastify initialization with all config references
- Must provide registerEndpoint() and unregisterEndpoint() methods for api-endpoint nodes to call
- The entire system is non-functional without this core server implementation
- Priority: Complete this before any endpoint configuration testing

Verification completed 2025-12-16: Implementation was found to already be complete. All 8 acceptance criteria verified as implemented and working. All 299 unit tests pass including specific api-server tests for registerEndpoint, unregisterEndpoint, OpenAPI generation, config node integration, and cleanup. Core functionality verified in api-server.js with proper Fastify lifecycle management, route registration, and graceful shutdown.

Implementation verified complete on 2025-12-16 during verification phase. All functionality confirmed present and working including: Fastify instance creation, server lifecycle management (start/stop/restart), registerEndpoint/unregisterEndpoint methods, OpenAPI spec endpoints, Swagger UI support, Prometheus metrics collection, request/response logging, and server status display in Node-RED editor. All 299 unit tests passed including specific tests for api-server node integration, lifecycle management, and endpoint registration.
<!-- SECTION:NOTES:END -->
