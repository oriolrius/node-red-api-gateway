---
id: doc-009
title: Logging System Architecture and Usage
type: other
created_date: '2025-12-10 18:19'
---
# Logging System Architecture and Usage

## Overview

The Node-RED API Gateway implements structured JSON logging throughout the application using **Pino**, a high-performance JSON logger. All log entries are structured with consistent metadata, request IDs, timing information, and optional user context. This enables comprehensive visibility into gateway operations, security events, and performance characteristics.

## Configuration

Logging behavior is configured through the **api-config** node UI with optional environment variable overrides. Environment variables take precedence over UI settings.

### UI Configuration (api-config Node)

The following settings are available in the node's UI:

- **loggingEnabled** - Enable/disable logging (default: true)
- **logLevel** - Minimum log level (default: info)
- **logOutput** - Output destination: console, file, or both (default: console)
- **logPrettyPrint** - Pretty-print JSON in console output (default: false)
- **logFilePath** - Path for log file output (default: ./logs/api-gateway.log)
- **logRedactHeaders** - Redact sensitive headers in logs (default: true)
- **logIncludeUserContext** - Include authenticated user context in logs (default: true)

### Environment Variables

Environment variables override UI settings:

- `API_GATEWAY_LOG_LEVEL` - Set log level (trace, debug, info, warn, error, fatal, silent)
- `API_GATEWAY_LOG_OUTPUT` - Set output destination (console, file, both)
- `API_GATEWAY_LOG_PRETTY` - Enable pretty-printing (true/false)
- `API_GATEWAY_LOG_FILE` - Set log file path
- `API_GATEWAY_LOG_REDACT_HEADERS` - Enable header redaction (true/false)
- `API_GATEWAY_LOG_INCLUDE_USER` - Include user context (true/false)

**Priority:** Environment variables > UI configuration > Defaults

## Log Levels

Pino supports the following log levels, from most to least verbose:

- **trace** (10) - Very detailed diagnostic information
- **debug** (20) - Debugging information
- **info** (30) - General informational messages
- **warn** (40) - Warning messages for potentially harmful situations
- **error** (50) - Error messages for error conditions
- **fatal** (60) - Critical errors that may cause shutdown
- **silent** (Infinity) - No logging

Only messages at or above the configured level are logged.

## Log Output Options

### console
Logs are written to Node-RED's console output. When `logPrettyPrint` is enabled, output is formatted for human readability. When disabled, each line is a complete JSON object.

### file
Logs are written to the specified file path. Useful for production environments and log aggregation systems. File output is always JSON format (not affected by pretty-print setting).

### both
Logs are written to both console and file simultaneously.

## Key Features

### Request ID Generation and Propagation

Every HTTP request receives a unique request ID for tracing:

- Generated from incoming `x-request-id` header or created as UUID
- Included in all log entries for that request
- Propagated in responses via `x-request-id` header
- Enables request tracing across multiple systems

### Request/Response Timing

Automatic timing information is collected:

- **timestamp** - When the request was received
- **duration** - Total request processing time in milliseconds
- **statusCode** - HTTP response status code
- Captured at response completion via Fastify hooks

### User Context Enrichment

After JWT validation by the Keycloak client:

- User ID and username are extracted from token
- Associated with the request log context
- Included in all child logger entries for that request
- Enables audit trails and user-specific filtering

### Sensitive Data Redaction

When enabled, the following sensitive data is automatically redacted:

- **Authorization** header (Bearer tokens)
- **Cookie** header values
- **X-API-Key** header values
- Other custom sensitive headers as configured

Redaction replaces actual values with `[REDACTED]` in log output.

### Request-Scoped Child Loggers

Each request gets a child logger instance:

- Inherits parent logger's configuration and stream settings
- Automatically includes request-scoped context (requestId, userId, etc.)
- Child loggers created via `logger.child({ context })`
- Reduces boilerplate when logging within request handlers

## Log Format

Typical JSON log entry structure:

```json
{
  "level": 30,
  "time": "2025-12-10T12:34:56.789Z",
  "pid": 12345,
  "hostname": "api-gateway",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "url": "/api/v1/users",
  "statusCode": 201,
  "duration": 145,
  "userId": "user-123",
  "username": "john.doe",
  "msg": "API request completed successfully",
  "pathname": "/api/v1/users"
}
```

### Common Fields

- **level** - Numeric log level (10-60)
- **time** - ISO 8601 timestamp of log entry
- **pid** - Process ID
- **hostname** - Server hostname
- **requestId** - Unique request identifier
- **method** - HTTP method (GET, POST, etc.)
- **url** - Request URL path
- **statusCode** - HTTP response status code
- **duration** - Request processing time in milliseconds
- **userId** - Authenticated user ID (if available)
- **username** - Authenticated username (if available)
- **msg** - Log message text
- **pathname** - Request path component

Additional fields may be present based on context or error conditions.

## Integration Points

### api-config.js
- Creates and manages the shared Pino logger instance
- Applies configuration from UI settings and environment variables
- Configures log streams (console and/or file)
- Provides logger instance to child nodes via RED context
- Handles graceful logger shutdown

### api-server.js
- Receives logger instance from api-config via RED context
- Integrates Pino with Fastify via fastify-pino plugin
- Registers request/response hooks for timing and metadata
- Generates or propagates x-request-id header
- Creates request-scoped child loggers with context

### api-endpoint.js
- Receives request-scoped child logger from api-server
- Logs endpoint-specific operations and decisions
- Includes request context in all log entries
- Tracks policy evaluation, caching, and validation steps
- Logs error conditions with appropriate severity levels

### keycloak-client.js
- Logs token validation attempts and results
- Records JWT parsing and validation failures
- Tracks JWKS cache hits/misses
- Records circuit breaker state transitions
- Logs authorization decisions based on token content

### opa-client.js
- Logs policy evaluation requests and results
- Records policy decision cache hits/misses
- Tracks circuit breaker state changes
- Logs policy evaluation errors and timeouts
- Includes evaluated data and policy path in logs

## Programmatic Usage

### Getting the Logger from Config Node

In child nodes that receive configuration from api-config:

```javascript
const logger = config.logger; // From api-config node's RED context

logger.info({ endpoint: '/api/users' }, 'Processing API request');
```

### Creating Request-Scoped Child Loggers

In request handlers:

```javascript
// Create child logger with request context
const requestLogger = logger.child({
  requestId: req.id,
  userId: req.user?.id,
  username: req.user?.username
});

// Use in request handler
requestLogger.debug({ step: 'validation' }, 'Validating request schema');
```

### Logging with Context

Include relevant context as first parameter (object) and message as second:

```javascript
logger.info(
  { 
    userId: user.id, 
    action: 'token_refresh',
    duration: elapsed
  },
  'User token refreshed successfully'
);

logger.error(
  { 
    error: err.message,
    statusCode: 500,
    endpoint: '/api/data'
  },
  'Failed to process API request'
);
```

### Log Level Selection

Use appropriate levels for different scenarios:

```javascript
logger.trace({ rawData }, 'Detailed diagnostic data');
logger.debug({ parsedToken }, 'Token structure after parsing');
logger.info({ action: 'login' }, 'User authentication succeeded');
logger.warn({ cacheSize }, 'Log file size approaching limit');
logger.error({ code: 'ECONNREFUSED' }, 'Database connection failed');
logger.fatal({ code: 'SIGTERM' }, 'Shutting down gateway');
```

## Debugging and Monitoring

### Filtering Logs

When viewing logs, filter by:

- **requestId** - Isolate all logs for a specific request
- **userId** - View all activity for a specific user
- **statusCode** - Find all error responses (4xx, 5xx)
- **level** - Show only errors and warnings
- **component** - Logs from specific integration points (keycloak-client, opa-client, etc.)

### Common Log Queries

```bash
# All requests from specific user
cat logs/api-gateway.log | jq 'select(.userId == "user-123")'

# All failed requests (5xx status)
cat logs/api-gateway.log | jq 'select(.statusCode >= 500)'

# All requests for specific endpoint
cat logs/api-gateway.log | jq 'select(.url | contains("/api/users"))'

# Trace specific request
cat logs/api-gateway.log | jq 'select(.requestId == "550e8400-e29b-41d4-a716-446655440000")'

# All errors and warnings
cat logs/api-gateway.log | jq 'select(.level >= 40)'
```

### Performance Analysis

Log entries include duration field:

```bash
# Average response time
cat logs/api-gateway.log | jq '.duration' | jq -s 'add/length'

# Slowest requests
cat logs/api-gateway.log | jq 'select(.duration > 1000)' | jq -s 'sort_by(.duration) | reverse | .[0:10]'
```

## Configuration Best Practices

### Development Environment
- **logLevel**: debug
- **logOutput**: console
- **logPrettyPrint**: true
- **logRedactHeaders**: true (keep enabled for security)

### Production Environment
- **logLevel**: info
- **logOutput**: file (or both with log aggregation)
- **logPrettyPrint**: false (raw JSON for parsing)
- **logRedactHeaders**: true
- **logIncludeUserContext**: true (for audit trails)

### High-Security Environments
- **logLevel**: warn (reduce noise from info-level logs)
- **logRedactHeaders**: true
- **logIncludeUserContext**: true
- Consider archiving logs with restricted access
- Enable log encryption for files at rest
