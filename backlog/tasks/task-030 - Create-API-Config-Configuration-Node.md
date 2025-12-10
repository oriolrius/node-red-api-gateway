---
id: task-030
title: Create API Config Configuration Node
status: To Do
assignee: []
created_date: '2025-12-10 09:32'
updated_date: '2025-12-10 09:39'
labels:
  - api-config
  - config-node
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a new api-config configuration node that stores shared settings for the API Gateway. This config node holds database connection, OAuth2/Keycloak, OPA, TLS, and other settings. It is referenced by both API Server and API Endpoint nodes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Node registered as config node type in Node-RED
- [ ] #2 Editor shows in config nodes sidebar, not palette
- [ ] #3 Other nodes can reference this config via dropdown
- [ ] #4 Properties include database, OAuth2, OPA, TLS configuration groups
- [ ] #5 Unit tests verify config node behavior
<!-- AC:END -->
