---
id: task-001
title: Convert API Server to Configuration Node
status: To Do
assignee: []
created_date: '2025-12-10 09:24'
labels:
  - api-server
  - config-node
  - architecture
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Transform the API Server node from a regular node to a Node-RED configuration node pattern. Configuration nodes don't appear in flows but are referenced by other nodes (like regular nodes reference config nodes). This allows for centralized server-wide settings management.

Configuration nodes in Node-RED provide a pattern for storing shared configuration that multiple runtime nodes can reference. This task involves restructuring the API Server node to follow this pattern, making it available as a config node type in the Node-RED editor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 API Server node implements Node-RED config node pattern
- [ ] #2 Config node properties include: name, server URL/base path
- [ ] #3 Config node appears in Node-RED palette as config node type
- [ ] #4 Other nodes can reference and retrieve the API Server config
- [ ] #5 Config node settings persist across Node-RED restarts
<!-- AC:END -->
