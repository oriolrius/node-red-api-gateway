---
id: task-001
title: Create node-red-node-development skill
status: Done
assignee: []
created_date: '2025-12-01 14:59'
updated_date: '2025-12-01 15:07'
labels:
  - skill
  - node-red
  - core
dependencies:
  - task-008
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a comprehensive Claude skill for Node-RED node development covering:
- Node-RED Node Architecture Pattern (RED.nodes.createNode lifecycle, config vs operational nodes, input/close handlers, status updates, registerType)
- Node-RED Configuration Management (storing/retrieving config, reference resolution, persistence, validation)
- Node-RED UI/Frontend Development (HTML templates, jQuery forms, editor hooks, editableList API)
- Node-RED Status & Debug System (status indicators, debug logging, error reporting, performance monitoring)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SKILL.md created with YAML frontmatter (name, description)
- [x] #2 Covers node architecture patterns with code examples
- [x] #3 Covers UI/frontend development patterns
- [x] #4 Covers configuration management
- [x] #5 Covers status and debug system
- [x] #6 References directory contains detailed API docs
- [x] #7 Scripts directory contains node scaffolding generator
<!-- AC:END -->
