---
id: task-013
title: Add Authorization Scope Configuration
status: To Do
assignee: []
created_date: '2025-12-10 09:25'
labels:
  - api-endpoint
  - core-feature
  - authorization
  - oauth2
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Configure OAuth2 required scopes for endpoint authorization. Integrate with OPA policy evaluation from api-server config node for scope validation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add 'requiredScopes' property as array of OAuth2 scope strings
- [ ] #2 Add 'scopeOperator' property with AND/OR selection for scope matching logic
- [ ] #3 Integrate with OPA policy evaluation from api-server config node
- [ ] #4 Return 403 Forbidden when scopes don't match
- [ ] #5 Include scope validation details in debug output
<!-- AC:END -->
