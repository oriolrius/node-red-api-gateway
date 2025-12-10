---
id: task-030
title: Convert API Server to Configuration Node
status: To Do
assignee: []
created_date: '2025-12-10 09:32'
labels:
  - api-server
  - config-node
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Transform the api-server node from a regular flow node to a Node-RED configuration node. Config nodes don't appear in flows but are referenced by other nodes (like api-endpoint). Properties: name, serverUrl, basePath.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Node registered as config node type in Node-RED
- [ ] #2 Editor shows in config nodes sidebar, not palette
- [ ] #3 Other nodes can reference this config via dropdown
- [ ] #4 Properties include name, serverUrl, basePath
- [ ] #5 Unit tests verify config node behavior
<!-- AC:END -->
