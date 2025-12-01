---
id: task-010
title: Create OpenAPI-Fastify skill for Node-RED endpoint nodes
status: Done
assignee: []
created_date: '2025-12-01 16:29'
updated_date: '2025-12-01 16:38'
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
- [x] #1 SKILL.md created with YAML frontmatter
- [x] #2 Covers @fastify/swagger setup and configuration
- [x] #3 Covers OpenAPI 3.x spec generation from route schemas
- [x] #4 Covers Swagger UI and Scalar API reference integration
- [x] #5 Covers Node-RED integration patterns for OpenAPI endpoints
- [x] #6 Covers security definitions (API key, OAuth, JWT)
- [x] #7 Covers design-first workflow with fastify-openapi-glue
- [x] #8 References include TypeBox OpenAPI patterns
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented openapi-fastify skill with comprehensive documentation covering:
- @fastify/swagger setup with full configuration options
- OpenAPI 3.x spec generation from Fastify route schemas
- Swagger UI integration with custom themes and configuration
- Scalar API reference as modern alternative
- Security definitions (API Key, JWT Bearer, OAuth 2.0 with all flows)
- Design-first workflow with fastify-openapi-glue
- Node-RED integration patterns (OpenAPI config node, documented endpoint node)
- Complete flow examples for Node-RED
- TypeBox OpenAPI patterns reference in references/typebox-openapi.md
<!-- SECTION:NOTES:END -->
