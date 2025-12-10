---
id: task-046
title: Add Request/Response Transformation
status: Done
assignee:
  - Claude
created_date: '2025-12-10 09:34'
updated_date: '2025-12-10 16:19'
labels:
  - api-endpoint
  - transformation
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Transform request body before processing and response before sending. Support JSONata expressions or JavaScript functions for data shaping.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Request body transformation expression
- [x] #2 Response body transformation expression
- [x] #3 JSONata expression support
- [x] #4 Field mapping/renaming capabilities
- [x] #5 Transformation errors handled gracefully
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

1. **Add JSONata dependency** to package.json
2. **Create lib/request-response-transform.js** (~200 lines)
   - TransformationResult class
   - compileExpression() - Compile and cache JSONata expressions
   - transformData() - Execute transformation with context
   - validateExpression() - Validate JSONata syntax
   - parseFieldMapping() - Parse simple field rename syntax
3. **Update api-endpoint.js**
   - Add configuration: transformationEnabled, requestTransformExpression, responseTransformExpression, fieldMappings
   - Add node methods: transformRequest(), transformResponse(), getTransformationConfig()
   - Apply request transformation before validation in input handler
   - Store response transformation in msg.endpoint for downstream use
4. **Update api-endpoint.html**
   - Add Transformation section with enable checkbox
   - Request/Response transform textareas with JSONata
   - Field mappings input
   - Validation and help text
5. **Write unit tests** for transformation functionality

## Key Design Decisions
- Request transformation happens BEFORE validation
- Response transformation stored in msg.endpoint for downstream nodes
- JSONata context includes: $, msg, params, query
- Field mapping supports simple oldName->newName syntax
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Successfully implemented request/response transformation feature with JSONata expression support and field mapping capabilities.

### Components Created/Modified:

1. **lib/request-response-transform.js** (New)
   - TransformationResult class for structured transformation results
   - Expression validation and compilation with JSONata caching
   - Transform functions for request and response data
   - Field mapping parser supporting oldName->newName syntax
   - Error handling with detailed error messages

2. **api-endpoint.js** (Updated)
   - Added transformation configuration properties:
     - transformationEnabled (boolean)
     - requestTransformExpression (JSONata string)
     - responseTransformExpression (JSONata string)
     - fieldMappings (object)
   - Implemented methods:
     - transformRequestBody() - Applied before validation
     - transformResponseData() - Stored in msg.endpoint for downstream use
     - getTransformationConfig() - Retrieves transformation settings
   - Request transformation integrated into input handler flow

3. **api-endpoint.html** (Updated)
   - New Transformation UI section with collapsible panel
   - Enable/disable checkbox for transformation feature
   - Request transformation expression textarea with JSONata syntax support
   - Response transformation expression textarea
   - Field mappings input with validation
   - Help text and documentation

4. **package.json** (Updated)
   - Added jsonata ^2.0.6 dependency

### Test Coverage:
- Comprehensive unit tests covering all transformation scenarios
- Field mapping tests with oldName->newName syntax
- JSONata expression validation and error handling
- Request transformation before validation flow
- Response transformation storage in msg.endpoint
- Error graceful handling returning 400 status with transformationError in msg
- All 523 tests passing

### Key Design Features:
- Request transformation executes BEFORE schema validation
- Response transformation stored in msg.endpoint for use by downstream nodes
- JSONata context includes: $ (transformed data), msg, params, query
- Full error handling with detailed error messages
- Field mapping applied before JSONata expressions for data preparation

Completed on 2025-12-10

All acceptance criteria met - full implementation delivered with comprehensive test coverage (523 tests passing)

## Git Commit

Commit: deeb857 - feat(node): add request/response transformation with JSONata support

All changes committed including:
- lib/request-response-transform.js (337 lines)
- nodes/api-endpoint.js (161 lines added)
- nodes/api-endpoint.html (316 lines added)
- tests/unit/request-response-transform_spec.js (492 lines)
- package.json + package-lock.json (jsonata dependency)

Total: 1,306 insertions, 7 deletions across 6 files
<!-- SECTION:NOTES:END -->
