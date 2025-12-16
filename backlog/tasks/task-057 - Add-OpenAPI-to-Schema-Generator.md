---
id: task-057
title: Add OpenAPI-to-Schema Generator
status: Done
assignee: []
created_date: '2025-12-10 09:35'
updated_date: '2025-12-11 04:51'
labels:
  - infrastructure
  - openapi
  - import
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parse existing OpenAPI specifications and auto-configure endpoint nodes. Support importing API definitions from YAML/JSON files.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Parse OpenAPI 3.0 YAML/JSON files
- [x] #2 Generate endpoint node configurations
- [x] #3 Import via Node-RED editor UI
- [x] #4 Map security schemes to config
- [x] #5 Support partial imports (selected paths)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started work on 2025-12-11: Parsing OpenAPI specs and generating endpoint configurations

Completed on 2025-12-11: Implemented OpenAPI-to-Schema Generator with full functionality:
- Created lib/openapi-parser.js with comprehensive parsing capabilities
- Supports parsing OpenAPI 3.0 YAML and JSON specifications
- Generates endpoint node configurations with all schema types
- Maps OAuth2 security schemes to requiredScopes configuration
- Supports partial imports via path, tag, and method filtering
- Added import UI to api-server.html with preview and selection
- HTTP admin endpoints for preview and import functionality
- 86 unit tests covering all parser functionality
- All acceptance criteria completed

Committing OpenAPI import implementation with parser library, UI, and comprehensive tests

Commit 2148dab: feat(node): add OpenAPI import with partial selection support
<!-- SECTION:NOTES:END -->
