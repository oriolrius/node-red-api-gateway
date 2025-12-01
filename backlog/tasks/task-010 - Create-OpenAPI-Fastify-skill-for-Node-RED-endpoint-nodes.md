---
id: task-010
title: Create OpenAPI-Fastify skill for Node-RED endpoint nodes
status: In Progress
assignee: []
created_date: '2025-12-01 16:29'
updated_date: '2025-12-01 16:30'
labels:
  - skill
  - openapi
  - fastify
  - swagger
  - node-red
dependencies:
  - task-009
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a Claude skill for building OpenAPI-documented endpoints in Fastify within Node-RED nodes.

The skill should cover the integration of `@fastify/swagger` (the official Fastify OpenAPI plugin) with Node-RED to enable:
- Auto-generating OpenAPI specs from Fastify route schemas
- Exposing OpenAPI JSON endpoints
- Integrating Swagger UI or Scalar API reference for documentation
- Code-first approach leveraging existing JSON Schema route validation

Key libraries to cover:
- `@fastify/swagger` - Official Swagger/OpenAPI spec generator (v2 and v3)
- `@fastify/swagger-ui` - Classic Swagger UI integration
- `@scalar/fastify-api-reference` - Modern API reference UI alternative
- `fastify-openapi-glue` - For design-first workflows (generate routes from OpenAPI spec)

Topics to include:
- Setting up @fastify/swagger with OpenAPI 3.x configuration
- Defining route schemas that generate proper OpenAPI documentation
- Configuring Swagger UI and Scalar API reference
- Exposing /openapi.json and /docs endpoints
- Node-RED integration patterns (config nodes for OpenAPI settings, dynamic route registration)
- Design-first vs code-first workflows
- TypeBox integration for type-safe OpenAPI schemas
- Security definitions (API keys, OAuth, JWT)
- Tags and grouping endpoints
- Request/response examples in documentation
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SKILL.md created with YAML frontmatter
- [ ] #2 Covers @fastify/swagger setup and configuration
- [ ] #3 Covers OpenAPI 3.x spec generation from route schemas
- [ ] #4 Covers Swagger UI and Scalar API reference integration
- [ ] #5 Covers Node-RED integration patterns for OpenAPI endpoints
- [ ] #6 Covers security definitions (API key, OAuth, JWT)
- [ ] #7 Covers design-first workflow with fastify-openapi-glue
- [ ] #8 References include TypeBox OpenAPI patterns
<!-- AC:END -->
