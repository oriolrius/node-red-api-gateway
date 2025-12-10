---
id: task-047
title: Add Rate Limiting per Endpoint
status: Done
assignee: []
created_date: '2025-12-10 09:34'
updated_date: '2025-12-10 16:31'
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
- [x] #1 Rate limit value (requests per window)
- [x] #2 Rate limit window (seconds/minutes)
- [x] #3 Rate limit key selection (ip, user, apiKey)
- [x] #4 429 Too Many Requests response
- [x] #5 Rate limit headers in response (X-RateLimit-*)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation started on 2025-12-10

Completed on 2025-12-10. Created lib/rate-limiter.js with token bucket algorithm. Added rate limiting configuration to api-endpoint.js (rateLimitingEnabled, rateLimitRequests, rateLimitWindowMs, rateLimitKeyType, rateLimitCustomKeyPath). Added rate limiting UI section in api-endpoint.html. Input handler checks rate limit and returns 429 when exceeded. Rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After) added to responses. msg.rateLimit context added to messages. 75 tests added (46 for rate limiter library, 13 for api-endpoint rate limiting, plus existing tests).
<!-- SECTION:NOTES:END -->
