---
id: task-059
title: Implement API Server Fastify Instance Management
status: To Do
assignee: []
created_date: '2025-12-10 09:40'
updated_date: '2025-12-10 12:40'
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
- [ ] #1 Fastify added as project dependency in package.json
- [ ] #2 Reference to api-config configuration node
- [ ] #3 Host and port configuration with defaults
- [ ] #4 Fastify server lifecycle management (start/stop)
- [ ] #5 Auto-start option on Node-RED deploy
- [ ] #6 Route registration from api-endpoint nodes
- [ ] #7 Server status displayed in Node-RED editor

- [ ] #8 Graceful shutdown on node close/redeploy
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
<!-- SECTION:NOTES:END -->
