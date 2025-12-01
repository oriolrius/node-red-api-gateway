---
id: task-009
title: Create fastify-server skill
status: Done
assignee: []
created_date: '2025-12-01 16:22'
updated_date: '2025-12-01 16:27'
labels:
  - skill
  - fastify
  - node-red
  - http
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a Claude skill for Fastify web framework to support building a Node-RED node that implements a Fastify server.

Topics to cover:
- Fastify server setup and configuration (plugins, options, logging)
- Route definition patterns (GET, POST, PUT, DELETE, params, query, body)
- Request/response handling (validation, serialization, hooks)
- Plugin architecture (registration, encapsulation, decorators)
- Error handling patterns (custom error handlers, validation errors)
- Lifecycle hooks (onRequest, preHandler, onSend, onResponse, onClose)
- Integration with Node-RED (starting/stopping server, graceful shutdown)
- Schema validation with JSON Schema or TypeBox
- Authentication and middleware patterns
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SKILL.md created with YAML frontmatter
- [x] #2 Covers Fastify server setup and configuration
- [x] #3 Covers route definition and request handling
- [x] #4 Covers plugin architecture and hooks
- [x] #5 Covers error handling patterns
- [x] #6 Covers integration patterns for Node-RED (lifecycle, shutdown)
- [x] #7 References contain schema validation examples
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented fastify-server skill with comprehensive documentation covering:
- Server setup and configuration options
- Route definition (HTTP methods, params, query, body, response handling)
- Plugin architecture (creation, encapsulation, decorators, common plugins)
- Lifecycle hooks (request lifecycle, route-level, application-level)
- Error handling (custom handlers, custom errors, 404 handler)
- Schema validation (JSON Schema and TypeBox)
- Node-RED integration patterns (server node, route node, response node, graceful shutdown, testing)
- TypeBox reference documentation in references/typebox-schemas.md
<!-- SECTION:NOTES:END -->
