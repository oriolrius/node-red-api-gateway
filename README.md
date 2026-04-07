# @oriolrius/node-red-api-gateway

A comprehensive Node-RED node package for building enterprise-grade REST APIs with built-in support for authentication, authorization, validation, caching, rate limiting, and OpenAPI documentation.

## Features

- **API Server**: Fastify-powered HTTP server with automatic OpenAPI spec generation
- **Endpoint Definition**: Declarative API endpoint configuration with JSON Schema validation
- **Authentication**: OAuth2/OpenID Connect via Keycloak integration
- **Authorization**: Role/scope-based access control with OPA (Open Policy Agent) support
- **Validation**: Request/response validation with JSON Schema
- **Pagination**: Offset-based and cursor-based pagination
- **Filtering & Sorting**: Configurable field filtering and sorting with SQL clause generation
- **Rate Limiting**: Token bucket algorithm with per-IP, per-user, or custom key strategies
- **Caching**: Response caching with ETag support and configurable TTL
- **Error Handling**: RFC 7807 Problem Details format
- **Metrics**: Prometheus metrics endpoint for monitoring
- **Logging**: Structured JSON logging with Pino

## Installation

### From npm

```bash
cd ~/.node-red
npm install @oriolrius/node-red-api-gateway
```

### For Development

```bash
cd ~/.node-red
npm install /path/to/node-red-api-gateway
```

Or using npm link:

```bash
# In the node-red-api-gateway directory
npm link

# In your Node-RED user directory
cd ~/.node-red
npm link @oriolrius/node-red-api-gateway
```

## Quick Start

### 1. Basic API Setup

1. Drag an **apigw-config** node onto the canvas and configure:
   - API Version: `v1`
   - Base Path: `/api`
   - OpenAPI Title: `My API`

2. Drag an **apigw-server** node and configure:
   - Port: `3000`
   - Config: Select your apigw-config node
   - Enable Swagger UI: `true`

3. Drag an **apigw-endpoint** node and configure:
   - Path: `/hello`
   - Method: `GET`
   - Server: Select your apigw-server node

4. Connect a **function** node to handle the request:

```javascript
msg.res.json({ message: "Hello, World!" });
return null;
```

5. Deploy and access:
   - API: `http://localhost:3000/api/v1/hello`
   - Swagger UI: `http://localhost:3000/docs`
   - OpenAPI Spec: `http://localhost:3000/openapi.json`

### 2. Import Example Flows

The package includes several example flows demonstrating different features:

1. In Node-RED, click the menu (hamburger icon)
2. Select **Import** > **Examples** > **@oriolrius/node-red-api-gateway**
3. Choose an example:
   - **Basic CRUD API** - Complete CRUD operations for a products API
   - **OAuth2 Authenticated API** - Keycloak authentication with role-based access
   - **OPA Protected API** - Policy-based access control with Open Policy Agent
   - **Pagination & Filtering** - Advanced list operations with pagination and filtering

## Nodes

### apigw-config

Configuration node for centralized settings shared across apigw-server and apigw-endpoint nodes.

**Database Configuration:**
- Database type (PostgreSQL, MSSQL, MySQL, etc.)
- Connection pooling settings
- Credentials (stored securely)

**OAuth2/Keycloak Configuration:**
- Keycloak URL and realm
- Client ID and secret
- JWT validation settings (issuer, audience, clock tolerance)

**OPA Configuration:**
- OPA server URL
- Policy path
- Cache TTL and timeout settings

**API Settings:**
- Version string and base path
- OpenAPI metadata (title, description, contact, license)

**Logging:**
- Log level (debug, info, warn, error)
- Output format (console, file)
- Header redaction

### apigw-server

HTTP server node that hosts your API endpoints.

**Configuration:**
- Host and port
- Reference to apigw-config node
- OpenAPI specification endpoint (`/openapi.json`)
- Swagger UI documentation (`/docs`)
- Prometheus metrics endpoint (`/metrics`)

**Features:**
- Automatic route registration from apigw-endpoint nodes
- Route conflict detection
- Graceful shutdown

### apigw-endpoint

Individual API endpoint definition node.

**Core Settings:**
- HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
- Path with parameters (e.g., `/users/:id`)
- Success status code
- Response content type

**Validation:**
- Body schema (JSON Schema)
- Query parameter schema
- Path parameter schema
- Response schemas (for OpenAPI documentation)

**Authorization:**
- Required scopes/roles
- Scope operator (AND/OR)

**CRUD Operations:**
- Operation type (list, get, create, update, delete)
- Table name and primary key
- Auto-generate SQL templates

**Pagination:**
- Style: offset-based or cursor-based
- Default and maximum page size

**Filtering & Sorting:**
- Configurable filterable fields
- Configurable sortable fields
- Default sort field and direction

**Transformation:**
- Request transformation (JSONata expression)
- Response transformation (JSONata expression)
- Field mappings

**Rate Limiting:**
- Requests per time window
- Key type (IP, user, API key, custom)

**Caching:**
- TTL (time to live)
- Cache key strategy
- Vary headers
- ETag support

**Error Handling:**
- Error format (RFC 7807, generic, custom)
- Stack trace inclusion (dev mode)
- Custom error code mappings

## Examples

### Basic CRUD Endpoint

```javascript
// In your function node connected to an apigw-endpoint
const products = [
  { id: 1, name: "Widget", price: 29.99 },
  { id: 2, name: "Gadget", price: 49.99 }
];

// List endpoint
msg.res.json({
  data: products,
  total: products.length
});
return null;
```

### Request Validation

Configure the apigw-endpoint with a body schema:

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "price": { "type": "number", "minimum": 0 }
  },
  "required": ["name", "price"]
}
```

Invalid requests automatically return 400 errors with validation details.

### OAuth2 Protected Endpoint

1. Configure apigw-config with Keycloak settings
2. Set `requiredScopes` on apigw-endpoint (e.g., `admin, user:write`)
3. Access user info in your function:

```javascript
const auth = msg.req.auth;
if (auth.authenticated) {
  console.log('User:', auth.preferredUsername);
  console.log('Roles:', auth.roles);
}
```

### Pagination

Enable pagination on list endpoints:

```javascript
// Pagination context is populated by apigw-endpoint
const { page, limit, offset } = msg.pagination || {};

// Query database with pagination
const results = await db.query(
  `SELECT * FROM products LIMIT ${limit} OFFSET ${offset}`
);
const total = await db.query('SELECT COUNT(*) FROM products');

// Use endpoint's helper to generate metadata
const paginationMeta = msg.endpoint.generatePaginationMeta(
  msg.pagination,
  { total: total[0].count, results: results.length }
);

msg.res.json({
  data: results,
  pagination: paginationMeta
});
```

### Rate Limiting

Enable rate limiting on apigw-endpoint:
- Requests: `100`
- Window: `60000` (1 minute)
- Key Type: `ip` (or `user` for per-user limits)

Rate limit info is available in `msg.rateLimit`:

```javascript
console.log('Remaining requests:', msg.rateLimit.remaining);
```

### Response Caching

Enable caching on apigw-endpoint:
- TTL: `30000` (30 seconds)
- Key Strategy: `full` (includes query string)
- Vary Headers: `authorization` (for user-specific caching)

The cache context is available in `msg.cache`:

```javascript
if (msg.cache.hit) {
  console.log('Cache hit! Age:', msg.cache.age);
}
```

## Development

### Prerequisites

- Node.js >= 20.0.0
- npm >= 8.0.0

### Setup

```bash
npm install
```

### Running Tests

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Running End-to-End Tests

```bash
# Start the Docker stack (Node-RED, Keycloak, OPA, SQL Server)
npm run docker:e2e:up

# Run e2e tests
npm run test:e2e

# Stop the Docker stack
npm run docker:e2e:down
```

### Linting

```bash
# Check for linting errors
npm run lint

# Fix linting errors automatically
npm run lint:fix
```

### Development Node-RED

```bash
# Launch a development Node-RED instance
npm run dev
```

## Scripts

Utility scripts are located in the `scripts/` directory. See [scripts/README.md](scripts/README.md) for details.

### Certificate Management

Download SSL certificates from Nginx Proxy Manager for e2e tests:

```bash
./scripts/download-apigw-cert.sh
```

This script uses [npm-cli](https://github.com/oriolrius/npm-cli) via `uvx` to download certificates and only updates files if they differ.

## Project Structure

```
node-red-api-gateway/
├── nodes/                     # Node-RED nodes
│   ├── api-config.js/html    # Configuration node (apigw-config)
│   ├── api-server.js/html    # HTTP server node (apigw-server)
│   ├── api-endpoint.js/html  # Endpoint definition node (apigw-endpoint)
│   └── icons/                # Node icons
├── lib/                       # Shared utility modules
│   ├── path-utils.js         # Path manipulation
│   ├── schema-validator.js   # JSON Schema validation
│   ├── rate-limiter.js       # Token bucket rate limiting
│   ├── response-cache.js     # Response caching
│   ├── error-handler.js      # Error handling
│   ├── pagination.js         # Pagination helpers
│   ├── filtering-sorting.js  # Filter/sort parsing
│   ├── crud-generator.js     # SQL generation
│   ├── keycloak-client.js    # OAuth2/JWT validation
│   ├── opa-client.js         # OPA integration
│   ├── openapi-generator.js  # OpenAPI spec generation
│   ├── openapi-parser.js     # OpenAPI import
│   ├── logger.js             # Pino logging
│   └── metrics-collector.js  # Prometheus metrics
├── examples/                  # Example flows
├── scripts/                   # Utility scripts (see scripts/README.md)
├── tests/                     # Test suites
│   ├── unit/                 # Unit tests
│   └── e2e/                  # End-to-end tests
└── package.json
```

## API Reference

### Message Properties

When a request hits an apigw-endpoint, the following properties are available on `msg`:

| Property | Type | Description |
|----------|------|-------------|
| `msg.req` | Object | Request object (method, url, headers, body, params, query) |
| `msg.req.auth` | Object | Authentication info (if OAuth2 enabled) |
| `msg.res` | Object | Response helpers (json, send, status, set, end) |
| `msg.endpoint` | Object | Endpoint configuration |
| `msg.pagination` | Object | Parsed pagination params (if enabled) |
| `msg.filtering` | Object | Parsed filters and WHERE clause (if enabled) |
| `msg.sorting` | Object | Parsed sorts and ORDER BY clause (if enabled) |
| `msg.crud` | Object | CRUD operation context (if configured) |
| `msg.cache` | Object | Cache status (hit, key, age) |
| `msg.rateLimit` | Object | Rate limit status (allowed, remaining, limit) |

### Response Helpers

```javascript
// Send JSON response
msg.res.json({ data: "value" });

// Set status code
msg.res.status(201).json({ id: 1 });

// Set headers
msg.res.set('X-Custom-Header', 'value');

// End without body
msg.res.status(204).end();
```

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to the main repository.
