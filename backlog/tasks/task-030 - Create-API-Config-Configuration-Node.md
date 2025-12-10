---
id: task-030
title: Create API Config Configuration Node
status: Done
assignee: []
created_date: '2025-12-10 09:32'
updated_date: '2025-12-10 09:50'
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
- [x] #1 Node registered as config node type in Node-RED
- [x] #2 Editor shows in config nodes sidebar, not palette
- [x] #3 Other nodes can reference this config via dropdown
- [x] #4 Properties include database, OAuth2, OPA, TLS configuration groups
- [x] #5 Unit tests verify config node behavior
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2025-12-10: Started work on creating the api-config configuration node

2025-12-10: Completed api-config configuration node implementation. Created nodes/api-config.js with config node runtime providing secure credential handling (dbUser, dbPassword, keycloakClientSecret). Created nodes/api-config.html with editor UI featuring collapsible sections for: database (type, host, port, name, user, password), OAuth2/Keycloak (URL, realm, client ID, client secret), OPA (URL, policy path), and TLS (enabled toggle, verify certs, cert/key/CA paths). Registered node in package.json under node-red.nodes with category 'config'. Implemented tests/unit/api-config_spec.js with 8 passing tests covering node registration, credential handling, and editor rendering. Verified node loads correctly in Node-RED environment and appears in config nodes sidebar.

Commit b9cbedc: feat(node): add api-config configuration node for shared API Gateway settings - pushed to remote
<!-- SECTION:NOTES:END -->
