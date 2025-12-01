---
id: task-001
title: Create node-red-node-development skill
status: Done
assignee: []
created_date: '2025-12-01 14:59'
updated_date: '2025-12-01 15:24'
labels:
  - skill
  - node-red
  - core
dependencies:
  - task-008
priority: high
ordinal: 8000
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Created comprehensive node-red-node-development skill at `.claude/skills/node-red-node-development/`

### Structure
- `SKILL.md` - Main skill file with YAML frontmatter, quick start, and key patterns
- `references/node-js-api.md` - JavaScript API (send, receive, close, status, logging)
- `references/node-html-api.md` - HTML API (registration, edit dialog, help text)
- `references/config-nodes.md` - Configuration node patterns
- `references/status-and-context.md` - Status indicators and context storage
- `references/packaging.md` - npm packaging and publishing
- `scripts/init_node.py` - Node scaffolding generator (regular and config nodes)
- `assets/` - Directory for future templates

### Coverage
1. **Node Architecture**: RED.nodes.createNode lifecycle, input/close handlers, registerType
2. **Configuration Management**: Config nodes, credentials, reference resolution
3. **UI/Frontend**: HTML templates, jQuery forms, editor hooks (oneditprepare, oneditsave)
4. **Status & Debug**: Status indicators (fill, shape, text), error reporting
5. **Scaffolding**: Python script for generating node boilerplate with --config option
<!-- SECTION:NOTES:END -->
