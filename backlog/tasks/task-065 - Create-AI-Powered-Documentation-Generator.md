---
id: task-065
title: Create AI-Powered Documentation Generator
status: To Do
assignee: []
created_date: '2025-12-10 17:47'
labels:
  - infrastructure
  - ai
  - claude-sdk
  - documentation
dependencies:
  - task-063
  - task-064
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a documentation generator module (`lib/ai-doc-generator.js`) using Claude Agent SDK that produces comprehensive documentation from database schemas, OpenAPI specs, and OPA policies. Generates README sections, API guides, security documentation, and inline code comments. Supports multiple output formats (Markdown, HTML) and customizable documentation templates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Create AIDocGenerator class using Claude Agent SDK with streaming support
- [ ] #2 Implement generateApiDocs(openApiSpec) method that creates user-friendly API documentation with examples, use cases, and error handling guides
- [ ] #3 Implement generateSchemaDoc(schemaJson) method that creates database schema documentation with ER diagram descriptions, table purposes, and relationship explanations
- [ ] #4 Implement generatePolicyDoc(regoCode) method that creates security documentation explaining authorization rules, access patterns, and compliance considerations
- [ ] #5 Implement generateExamples(openApiSpec) method that creates curl/JavaScript/Python code examples for each endpoint
- [ ] #6 Support documentation templates with customizable sections and branding
- [ ] #7 Generate Markdown output compatible with GitHub/GitLab rendering
- [ ] #8 Support incremental documentation updates (only regenerate changed sections)
- [ ] #9 Include cross-references between API endpoints, database tables, and security policies
- [ ] #10 Unit tests with mocked Claude responses
- [ ] #11 Example templates for common documentation patterns
<!-- AC:END -->
