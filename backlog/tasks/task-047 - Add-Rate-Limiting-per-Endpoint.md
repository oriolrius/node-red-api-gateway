---
id: task-047
title: Add Rate Limiting per Endpoint
status: To Do
assignee: []
created_date: '2025-12-10 09:34'
labels:
  - api-endpoint
  - rate-limiting
  - security
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Configure rate limits specific to this endpoint. Support different rate limit keys (IP, user, API key).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Rate limit value (requests per window)
- [ ] #2 Rate limit window (seconds/minutes)
- [ ] #3 Rate limit key selection (ip, user, apiKey)
- [ ] #4 429 Too Many Requests response
- [ ] #5 Rate limit headers in response (X-RateLimit-*)
<!-- AC:END -->
