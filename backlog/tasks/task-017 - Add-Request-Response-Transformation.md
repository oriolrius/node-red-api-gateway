---
id: task-017
title: Add Request/Response Transformation
status: To Do
assignee: []
created_date: '2025-12-10 09:26'
labels:
  - api-endpoint
  - transformation
  - data-shaping
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Transform request body before processing and response before sending. Support field mapping and data shaping using JSONata or JavaScript expressions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add 'requestTransform' property supporting JSONata/JavaScript expressions
- [ ] #2 Add 'responseTransform' property for response data shaping
- [ ] #3 Apply request transformation before schema validation
- [ ] #4 Apply response transformation after database operation but before schema validation
- [ ] #5 Include transformation error details in response on syntax errors
<!-- AC:END -->
