---
id: task-018
title: Add Rate Limiting per Endpoint
status: To Do
assignee: []
created_date: '2025-12-10 09:26'
labels:
  - api-endpoint
  - rate-limiting
  - performance
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Configure rate limits specific to individual endpoints. Override or extend server-level rate limits with per-endpoint configuration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add 'rateLimit' property for requests per window
- [ ] #2 Add 'rateLimitWindow' property (seconds) for time window
- [ ] #3 Add 'rateLimitBy' property with ip, user, or api-key selection
- [ ] #4 Return 429 Too Many Requests when limit exceeded
- [ ] #5 Include rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
<!-- AC:END -->
