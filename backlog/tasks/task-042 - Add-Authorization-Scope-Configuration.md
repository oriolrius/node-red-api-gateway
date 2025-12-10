---
id: task-042
title: Add Authorization Scope Configuration
status: Done
assignee: []
created_date: '2025-12-10 09:34'
updated_date: '2025-12-10 14:46'
labels:
  - api-endpoint
  - authorization
  - oauth2
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Configure required OAuth2 scopes for endpoint access. Support AND/OR operators for multiple scopes. Integrate with OPA policy evaluation from api-server config.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Required scopes array configuration
- [x] #2 Scope operator selection (AND requires all, OR requires any)
- [x] #3 Integration with OPA client for policy evaluation
- [x] #4 401/403 responses for unauthorized access
- [x] #5 Scopes exported for OpenAPI security definitions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2025-12-10: Started work on implementing authorization scope configuration

Commit 7aeb437: feat(node): add authorization scope configuration with OAuth2 support - Implemented OAuth2 scope-based authorization with AND/OR operators, 401/403 response handling, and OpenAPI security definitions export

Completed 2025-12-10 - Implementation summary: Added parseScopes() and checkScopes() helper functions for scope validation. Added requiredScopes and scopeOperator configuration properties to support comma-separated scope lists and AND/OR selection. Implemented checkAuthorization() method for scope verification with OPA client integration. Added getOpenApiSecurity() method to export scopes for OpenAPI security definitions. Integrated authorization checks in message input handler with proper 401 (unauthenticated) and 403 (insufficient scopes) error responses. UI enhancements include scope input field and operator dropdown with visual badge display. Comprehensive documentation added to help section. Commit: 7aeb437
<!-- SECTION:NOTES:END -->
