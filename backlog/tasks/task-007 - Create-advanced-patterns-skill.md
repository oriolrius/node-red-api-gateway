---
id: task-007
title: Create advanced-patterns skill
status: Done
assignee: []
created_date: '2025-12-01 14:59'
updated_date: '2025-12-01 16:15'
labels:
  - skill
  - patterns
  - architecture
dependencies: []
priority: low
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a Claude skill for advanced software patterns covering:
- Factory Pattern Implementation (dynamic client creation, factory methods)
- Configuration Inheritance & Composition (config inheritance, composition, field mapping)
- Performance Optimization (caching strategies, batch processing, connection pooling)
- State & Lifecycle Management (initialization lifecycle, connection management, graceful shutdown, resource cleanup)
- Logging & Debug Strategies (structured logging, log levels, performance metrics)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SKILL.md created with YAML frontmatter
- [x] #2 Covers factory pattern with examples
- [x] #3 Covers configuration composition
- [x] #4 Covers performance optimization techniques
- [x] #5 Covers lifecycle management
- [x] #6 References contain pattern decision guide
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented advanced-patterns skill with:
- SKILL.md with YAML frontmatter and quick reference
- references/factory-pattern.md - Registry factory, async factory, Node-RED integration
- references/configuration-composition.md - Deep merge, field mapping, validation, inheritance
- references/performance-optimization.md - Caching (LRU, SWR), pooling, batching, lazy loading
- references/lifecycle-management.md - Initialization patterns, graceful shutdown, state machines
- references/pattern-decision-guide.md - Decision trees, pattern combinations, anti-patterns
<!-- SECTION:NOTES:END -->
