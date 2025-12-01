---
id: task-009
title: Create fastify-server skill
status: In Progress
assignee: []
created_date: '2025-12-01 16:22'
updated_date: '2025-12-01 16:23'
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
- [ ] #1 SKILL.md created with YAML frontmatter
- [ ] #2 Covers Fastify server setup and configuration
- [ ] #3 Covers route definition and request handling
- [ ] #4 Covers plugin architecture and hooks
- [ ] #5 Covers error handling patterns
- [ ] #6 Covers integration patterns for Node-RED (lifecycle, shutdown)
- [ ] #7 References contain schema validation examples
<!-- AC:END -->
