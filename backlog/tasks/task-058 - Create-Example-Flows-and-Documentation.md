---
id: task-058
title: Create Example Flows and Documentation
status: Done
assignee: []
created_date: '2025-12-10 09:35'
updated_date: '2025-12-16 12:32'
labels:
  - infrastructure
  - documentation
  - examples
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive example flows demonstrating all features. Include README with setup instructions and usage documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Basic CRUD API example flow
- [x] #2 OAuth2 authenticated endpoint example
- [x] #3 OPA-protected resource example
- [x] #4 Pagination and filtering example
- [x] #5 README with setup instructions
- [x] #6 Inline flow documentation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started work on 2025-12-16 - Creating example flows and documentation to demonstrate API gateway features

Completed on 2025-12-16 - Successfully created all example flows and documentation:

**Example Flows Created:**
1. examples/basic-crud-api.json - Full CRUD operations for product management with list, get, create, update, delete endpoints
2. examples/oauth2-authenticated-api.json - OAuth2/Keycloak integration with token validation and authenticated endpoints
3. examples/opa-protected-api.json - OPA policy enforcement with role-based and attribute-based access control
4. examples/pagination-filtering-api.json - Query parameter handling with offset and cursor-based pagination

**Documentation:**
- README.md updated with comprehensive setup instructions, usage guide, and example configurations
- All example flows include detailed info properties documenting purpose and implementation
- Comment nodes added explaining key concepts in each flow

**Key Deliverables:**
- 4 fully functional example flows showcasing different API gateway features
- Step-by-step setup documentation
- Clear flow diagrams with inline documentation for maintainability

Bug fixes applied during testing (2025-12-16):
1. Fixed Fastify logger configuration error - Fastify 5.x doesn't accept a Pino instance directly, set logger: false and handle logging in hooks
2. Added missing @fastify/swagger dependency - @fastify/swagger-ui requires @fastify/swagger to be registered first
3. Fixed route registration timing - Routes must be registered before listen() is called in Fastify 5.x
4. Fixed deprecation warning - Moved ignoreTrailingSlash to routerOptions for Fastify 6 compatibility
5. Updated to latest package versions: fastify ^5.6.2, @fastify/swagger ^9.6.1, @fastify/swagger-ui ^5.2.3
<!-- SECTION:NOTES:END -->
