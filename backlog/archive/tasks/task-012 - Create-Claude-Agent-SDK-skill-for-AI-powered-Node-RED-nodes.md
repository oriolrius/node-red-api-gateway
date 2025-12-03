---
id: task-012
title: Create Claude Agent SDK skill for AI-powered Node-RED nodes
status: Done
assignee: []
created_date: '2025-12-03 10:11'
updated_date: '2025-12-03 10:21'
labels:
  - skill
  - ai
  - node-red
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a comprehensive skill that guides development using the Claude Agent SDK, enabling AI-based features to be added to Node-RED nodes. The skill should cover SDK setup, API patterns, streaming responses, tool use, and integration patterns specific to Node-RED's async architecture.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SKILL.md with proper frontmatter and trigger conditions
- [x] #2 Reference documentation for Claude Agent SDK basics (authentication, client setup)
- [x] #3 Reference documentation for conversation patterns (messages, streaming, tool use)
- [x] #4 Reference documentation for Node-RED integration patterns (async handling, node lifecycle)
- [x] #5 Example code snippets for common use cases
- [x] #6 Integration guidance with existing javascript-async-patterns skill
- [x] #7 Add this skill at SKILLS.md
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started work on 2025-12-03

Completed on 2025-12-03

Deliverables:
- SKILL.md: Created with comprehensive overview, quick reference, and modular structure covering SDK setup, API interactions, streaming patterns, tool use, and Node-RED integration
- references/sdk-basics.md: Installation, authentication, client setup, model selection, error handling, and rate limiting
- references/streaming-patterns.md: Server-sent event streaming, timeout management, cancellation, backpressure handling, and production patterns
- references/tool-patterns.md: Defining custom tools, permission scopes, hooks and events, debugging, and best practices
- references/node-red-integration.md: Node architecture patterns, async pattern integration with javascript-async-patterns skill, Node-RED lifecycle integration, and editor HTML development
- SKILLS.md: Updated with new claude-agent-sdk-skill entry

All documentation includes practical code examples and integration patterns specific to Node-RED development.
<!-- SECTION:NOTES:END -->
