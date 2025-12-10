---
id: task-003
title: Add Keycloak/OAuth2 Configuration
status: To Do
assignee: []
created_date: '2025-12-10 09:24'
labels:
  - api-server
  - config-node
  - oauth2
  - keycloak
  - credentials
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add OAuth2 and Keycloak authentication configuration properties to the API Server config node. This enables centralized authentication provider settings that can be shared across multiple endpoint nodes.

Configuration includes Keycloak server URL, realm, client ID, and client secret. Client secret and other sensitive credentials will be stored securely using Node-RED's credentials system.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Config node accepts keycloakServerUrl and realm properties
- [ ] #2 Client ID and client secret stored with client secret as credential
- [ ] #3 OAuth2 configuration accessible from other endpoint nodes
- [ ] #4 Keycloak settings validated on save
- [ ] #5 Documentation includes OAuth2 flow and configuration examples
<!-- AC:END -->
