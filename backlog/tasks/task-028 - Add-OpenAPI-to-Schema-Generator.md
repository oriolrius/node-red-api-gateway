---
id: task-028
title: Add OpenAPI-to-Schema Generator
status: To Do
assignee: []
created_date: '2025-12-10 09:27'
labels:
  - infrastructure
  - openapi
  - tooling
  - automation
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a tool that parses existing OpenAPI specifications and automatically configures API Endpoint nodes based on the specification. This generator should support importing API definitions from YAML and JSON files, extracting endpoint paths, methods, schemas, and security requirements, and automatically creating Node-RED flow configurations that match the OpenAPI spec. This enables rapid API gateway configuration from existing API documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 OpenAPI spec parser created supporting both YAML and JSON formats
- [ ] #2 Automatic extraction of endpoints, methods, paths, and schemas from spec
- [ ] #3 Node-RED API Endpoint node configuration generator created
- [ ] #4 Request/response schema mapping implemented for endpoint nodes
- [ ] #5 Security requirement detection and configuration implemented
- [ ] #6 Command-line tool or UI feature for importing and generating flows from OpenAPI specs
<!-- AC:END -->
