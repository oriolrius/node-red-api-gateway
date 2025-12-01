---
name: openapi-fastify
description: Comprehensive guide for OpenAPI documentation with Fastify using @fastify/swagger. This skill should be used when creating self-documenting REST APIs, generating OpenAPI 3.x specs from route schemas, integrating Swagger UI or Scalar API reference, implementing security definitions, or building Node-RED nodes that expose documented API endpoints. Covers code-first and design-first workflows.
---

# OpenAPI with Fastify

## Overview

This skill covers OpenAPI documentation integration with Fastify using the official `@fastify/swagger` plugin. It enables auto-generating OpenAPI 3.x specifications from existing route schemas, exposing interactive API documentation, and integrating with Node-RED for building documented API endpoint nodes.

## Quick Reference

| Task | Package |
|------|---------|
| Generate OpenAPI spec | `@fastify/swagger` |
| Swagger UI docs | `@fastify/swagger-ui` |
| Modern API reference | `@scalar/fastify-api-reference` |
| Design-first routes | `fastify-openapi-glue` |
| Type-safe schemas | `@sinclair/typebox` |

## Installation

```bash
# Core OpenAPI generation
npm install @fastify/swagger

# Documentation UI (choose one or both)
npm install @fastify/swagger-ui
npm install @scalar/fastify-api-reference

# Optional: Design-first workflow
npm install fastify-openapi-glue

# Optional: Type-safe schemas
npm install @sinclair/typebox
```

## @fastify/swagger Setup

### Basic Configuration

```javascript
const fastify = require('fastify')();
const swagger = require('@fastify/swagger');

await fastify.register(swagger, {
  openapi: {
    info: {
      title: 'My API',
      description: 'API documentation',
      version: '1.0.0',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Development' },
      { url: 'https://api.example.com', description: 'Production' },
    ],
    tags: [
      { name: 'users', description: 'User operations' },
      { name: 'posts', description: 'Post operations' },
    ],
  },
});

// Routes must be registered AFTER swagger plugin
fastify.get('/health', {
  schema: {
    description: 'Health check endpoint',
    tags: ['system'],
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' },
        },
      },
    },
  },
}, async () => ({ status: 'ok' }));

await fastify.ready();

// Access generated spec
const spec = fastify.swagger();
console.log(JSON.stringify(spec, null, 2));
```

### Full Configuration Options

```javascript
await fastify.register(swagger, {
  // OpenAPI 3.x specification
  openapi: {
    openapi: '3.0.3',
    info: {
      title: 'API Gateway',
      description: 'Node-RED powered API Gateway',
      version: '1.0.0',
      contact: {
        name: 'API Support',
        email: 'support@example.com',
        url: 'https://example.com/support',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
      termsOfService: 'https://example.com/terms',
    },
    externalDocs: {
      description: 'Find more info here',
      url: 'https://example.com/docs',
    },
    servers: [
      {
        url: 'http://localhost:{port}',
        description: 'Development server',
        variables: {
          port: {
            default: '3000',
            enum: ['3000', '3001', '8080'],
          },
        },
      },
    ],
    tags: [
      { name: 'users', description: 'User management' },
      { name: 'auth', description: 'Authentication' },
    ],
    // Security schemes defined here, applied per-route or globally
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        oauth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://example.com/oauth/authorize',
              tokenUrl: 'https://example.com/oauth/token',
              scopes: {
                'read:users': 'Read user data',
                'write:users': 'Modify user data',
              },
            },
          },
        },
      },
    },
  },

  // Hide routes from documentation
  hideUntagged: false,

  // Transform the generated spec
  transform: ({ schema, url }) => {
    // Modify schema before generating spec
    return { schema, url };
  },

  // Transform individual route specs
  transformObject: ({ swaggerObject }) => {
    // Modify the final OpenAPI object
    return swaggerObject;
  },

  // Refine generated schemas
  refResolver: {
    buildLocalReference: (json, baseUri, fragment, i) => {
      return `def-${i}`;
    },
  },
});
```

## Route Schema for OpenAPI

### Complete Route Schema

```javascript
fastify.post('/users', {
  schema: {
    // OpenAPI metadata
    description: 'Create a new user',
    summary: 'Create user',
    tags: ['users'],
    operationId: 'createUser',
    deprecated: false,

    // Security requirements for this route
    security: [
      { bearerAuth: [] },
      { apiKey: [] },
    ],

    // External documentation
    externalDocs: {
      description: 'User creation guide',
      url: 'https://docs.example.com/users/create',
    },

    // Request body
    body: {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description: 'User full name',
          example: 'John Doe',
        },
        email: {
          type: 'string',
          format: 'email',
          description: 'User email address',
          example: 'john@example.com',
        },
        role: {
          type: 'string',
          enum: ['user', 'admin'],
          default: 'user',
          description: 'User role',
        },
      },
    },

    // URL parameters
    params: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          description: 'User ID',
        },
      },
    },

    // Query string parameters
    querystring: {
      type: 'object',
      properties: {
        include: {
          type: 'array',
          items: { type: 'string', enum: ['posts', 'comments'] },
          description: 'Related resources to include',
        },
      },
    },

    // Headers
    headers: {
      type: 'object',
      properties: {
        'x-request-id': {
          type: 'string',
          format: 'uuid',
          description: 'Request tracking ID',
        },
      },
    },

    // Response schemas by status code
    response: {
      201: {
        description: 'User created successfully',
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          createdAt: { type: 'string', format: 'date-time' },
        },
        example: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'John Doe',
          email: 'john@example.com',
          createdAt: '2024-01-15T10:30:00Z',
        },
      },
      400: {
        description: 'Validation error',
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      401: {
        description: 'Unauthorized',
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Unauthorized' },
          message: { type: 'string', example: 'Invalid or missing authentication' },
        },
      },
    },
  },
}, async (request, reply) => {
  reply.code(201);
  return createUser(request.body);
});
```

### Reusable Schema Components

```javascript
// Define reusable schemas
const UserSchema = {
  $id: 'User',
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    email: { type: 'string', format: 'email' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const ErrorSchema = {
  $id: 'Error',
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    statusCode: { type: 'integer' },
  },
};

const PaginationSchema = {
  $id: 'Pagination',
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
};

// Register schemas with Fastify
fastify.addSchema(UserSchema);
fastify.addSchema(ErrorSchema);
fastify.addSchema(PaginationSchema);

// Reference in routes using $ref
fastify.get('/users/:id', {
  schema: {
    description: 'Get user by ID',
    tags: ['users'],
    params: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    response: {
      200: { $ref: 'User#' },
      404: { $ref: 'Error#' },
    },
  },
}, getUser);

fastify.get('/users', {
  schema: {
    description: 'List all users',
    tags: ['users'],
    response: {
      200: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: { $ref: 'User#' },
          },
          pagination: { $ref: 'Pagination#' },
        },
      },
    },
  },
}, listUsers);
```

## Swagger UI Integration

### Basic Setup

```javascript
const swaggerUi = require('@fastify/swagger-ui');

await fastify.register(swagger, {
  openapi: {
    info: { title: 'My API', version: '1.0.0' },
  },
});

await fastify.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',        // 'list', 'full', 'none'
    deepLinking: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    syntaxHighlight: {
      theme: 'monokai',          // 'agate', 'arta', 'monokai', etc.
    },
  },
  uiHooks: {
    onRequest: function (request, reply, next) { next(); },
    preHandler: function (request, reply, next) { next(); },
  },
  staticCSP: true,
  transformStaticCSP: (header) => header,
  transformSpecification: (swaggerObject) => swaggerObject,
  transformSpecificationClone: true,
});

// Access points:
// /docs - Swagger UI
// /docs/json - OpenAPI JSON spec
// /docs/yaml - OpenAPI YAML spec
```

### Custom Swagger UI Configuration

```javascript
await fastify.register(swaggerUi, {
  routePrefix: '/documentation',

  // UI behavior
  uiConfig: {
    docExpansion: 'none',
    deepLinking: true,
    displayOperationId: false,
    defaultModelsExpandDepth: 1,
    defaultModelExpandDepth: 1,
    defaultModelRendering: 'model',
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    tryItOutEnabled: true,
    supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
    validatorUrl: null,
    withCredentials: false,
  },

  // Initialize with specific settings
  initOAuth: {
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    realm: 'your-realm',
    appName: 'your-app-name',
    scopeSeparator: ' ',
    scopes: 'read:users write:users',
    usePkceWithAuthorizationCodeGrant: true,
  },

  // Custom logo
  logo: {
    type: 'image/png',
    content: Buffer.from('...'),  // or fs.readFileSync('logo.png')
    href: 'https://example.com',
    target: '_blank',
  },

  // Custom CSS
  theme: {
    title: 'My API Documentation',
    css: [
      { filename: 'custom.css', content: '.swagger-ui .topbar { display: none; }' },
    ],
    favicon: [
      { filename: 'favicon.ico', rel: 'icon', type: 'image/x-icon', content: '...' },
    ],
  },
});
```

## Scalar API Reference Integration

Scalar provides a modern, beautiful alternative to Swagger UI.

```javascript
const scalar = require('@scalar/fastify-api-reference');

await fastify.register(swagger, {
  openapi: {
    info: { title: 'My API', version: '1.0.0' },
  },
});

await fastify.register(scalar, {
  routePrefix: '/reference',
  configuration: {
    // Theme customization
    theme: 'purple',  // 'default', 'alternate', 'moon', 'purple', 'solarized'
    darkMode: true,

    // Layout options
    layout: 'modern',  // 'modern', 'classic'
    showSidebar: true,

    // Search
    searchHotKey: 'k',

    // Metadata
    metaData: {
      title: 'API Reference',
      description: 'Interactive API documentation',
    },

    // Hide specific sections
    hideModels: false,
    hideDownloadButton: false,

    // Custom CSS
    customCss: `
      .scalar-app { font-family: 'Inter', sans-serif; }
    `,

    // Spec URL (auto-detected from @fastify/swagger)
    // spec: { url: '/openapi.json' },
  },
});

// Access at /reference
```

### Using Both UIs

```javascript
// Swagger UI at /docs
await fastify.register(swaggerUi, {
  routePrefix: '/docs',
});

// Scalar at /reference
await fastify.register(scalar, {
  routePrefix: '/reference',
});

// Raw spec endpoints
fastify.get('/openapi.json', async () => fastify.swagger());
fastify.get('/openapi.yaml', async (request, reply) => {
  reply.type('text/yaml');
  return fastify.swagger({ yaml: true });
});
```

## Security Definitions

### API Key Authentication

```javascript
await fastify.register(swagger, {
  openapi: {
    info: { title: 'API', version: '1.0.0' },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
          description: 'API key for authentication',
        },
      },
    },
    // Apply globally to all routes
    security: [{ apiKey: [] }],
  },
});

// Or apply per-route
fastify.get('/protected', {
  schema: {
    security: [{ apiKey: [] }],
    response: { 200: { type: 'object' } },
  },
}, handler);
```

### JWT Bearer Authentication

```javascript
await fastify.register(swagger, {
  openapi: {
    info: { title: 'API', version: '1.0.0' },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token in Authorization header',
        },
      },
    },
  },
});

fastify.get('/me', {
  schema: {
    description: 'Get current user profile',
    tags: ['users'],
    security: [{ bearerAuth: [] }],
    response: {
      200: { $ref: 'User#' },
      401: { $ref: 'Error#' },
    },
  },
}, async (request) => {
  // request.user populated by auth middleware
  return request.user;
});
```

### OAuth 2.0

```javascript
await fastify.register(swagger, {
  openapi: {
    info: { title: 'API', version: '1.0.0' },
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          description: 'OAuth 2.0 authentication',
          flows: {
            // Authorization Code flow (most common for web apps)
            authorizationCode: {
              authorizationUrl: 'https://auth.example.com/authorize',
              tokenUrl: 'https://auth.example.com/token',
              refreshUrl: 'https://auth.example.com/refresh',
              scopes: {
                'read:users': 'Read user information',
                'write:users': 'Create and update users',
                'delete:users': 'Delete users',
                'admin': 'Full administrative access',
              },
            },
            // Client Credentials flow (for machine-to-machine)
            clientCredentials: {
              tokenUrl: 'https://auth.example.com/token',
              scopes: {
                'api:read': 'Read API data',
                'api:write': 'Write API data',
              },
            },
            // Implicit flow (legacy, not recommended)
            implicit: {
              authorizationUrl: 'https://auth.example.com/authorize',
              scopes: {
                'read:users': 'Read user information',
              },
            },
          },
        },
      },
    },
  },
});

// Route requiring specific scopes
fastify.delete('/users/:id', {
  schema: {
    tags: ['users'],
    security: [{ oauth2: ['delete:users'] }],
    params: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
    },
    response: {
      204: { type: 'null', description: 'User deleted' },
      403: { $ref: 'Error#' },
    },
  },
}, deleteUser);
```

### Multiple Authentication Methods

```javascript
// Any one of the methods is acceptable (OR logic)
fastify.get('/data', {
  schema: {
    security: [
      { bearerAuth: [] },
      { apiKey: [] },
      { oauth2: ['read:data'] },
    ],
  },
}, handler);

// All methods required (AND logic - use single object)
fastify.get('/admin/data', {
  schema: {
    security: [
      { bearerAuth: [], apiKey: [] },  // Both required
    ],
  },
}, handler);

// No authentication required (override global security)
fastify.get('/public', {
  schema: {
    security: [],  // Empty array = no auth
  },
}, handler);
```

## Design-First Workflow with fastify-openapi-glue

For teams that prefer writing OpenAPI specs first and generating routes from them.

### Basic Usage

```javascript
const openapiGlue = require('fastify-openapi-glue');

// openapi.yaml or openapi.json
const specification = './openapi.yaml';

// Service handlers
const service = {
  // operationId from spec maps to method name
  getUsers: async (request, reply) => {
    return { users: [] };
  },
  createUser: async (request, reply) => {
    reply.code(201);
    return { id: '123', ...request.body };
  },
  getUserById: async (request, reply) => {
    const { id } = request.params;
    return { id, name: 'John' };
  },
};

await fastify.register(openapiGlue, {
  specification,
  service,
  prefix: '/api/v1',
});

// Routes are automatically created based on the OpenAPI spec
// Validation is automatically applied from the spec schemas
```

### OpenAPI Spec Example (openapi.yaml)

```yaml
openapi: 3.0.3
info:
  title: User API
  version: 1.0.0

paths:
  /users:
    get:
      operationId: getUsers
      summary: List all users
      tags: [users]
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
      responses:
        '200':
          description: List of users
          content:
            application/json:
              schema:
                type: object
                properties:
                  users:
                    type: array
                    items:
                      $ref: '#/components/schemas/User'

    post:
      operationId: createUser
      summary: Create a user
      tags: [users]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateUser'
      responses:
        '201':
          description: User created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'

  /users/{id}:
    get:
      operationId: getUserById
      summary: Get user by ID
      tags: [users]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: User found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '404':
          description: User not found

components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        email:
          type: string
          format: email
        createdAt:
          type: string
          format: date-time

    CreateUser:
      type: object
      required: [name, email]
      properties:
        name:
          type: string
          minLength: 1
        email:
          type: string
          format: email
```

### Advanced Configuration

```javascript
await fastify.register(openapiGlue, {
  specification: './openapi.yaml',
  service,

  // Route prefix
  prefix: '/api',

  // Security handlers
  securityHandlers: {
    bearerAuth: async (request, reply, params) => {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        throw { statusCode: 401, message: 'Missing token' };
      }
      request.user = await verifyToken(token);
    },
    apiKey: async (request, reply, params) => {
      const key = request.headers['x-api-key'];
      if (!await validateApiKey(key)) {
        throw { statusCode: 401, message: 'Invalid API key' };
      }
    },
  },

  // Handle operations not implemented in service
  noAdditional: false,  // true = error on unimplemented operations

  // Custom operation resolver
  operationResolver: (operationId, method, path) => {
    // Return handler function or null
    return service[operationId] || null;
  },
});
```

## Node-RED Integration

### OpenAPI Config Node

```javascript
module.exports = function(RED) {
  const swagger = require('@fastify/swagger');
  const swaggerUi = require('@fastify/swagger-ui');

  function OpenAPIConfigNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Store OpenAPI configuration
    node.openapi = {
      info: {
        title: config.title || 'Node-RED API',
        description: config.description || '',
        version: config.version || '1.0.0',
      },
      servers: [],
      tags: [],
      components: {
        securitySchemes: {},
      },
    };

    // Parse servers
    if (config.servers) {
      try {
        node.openapi.servers = JSON.parse(config.servers);
      } catch (e) {
        node.warn('Invalid servers JSON');
      }
    }

    // Parse tags
    if (config.tags) {
      try {
        node.openapi.tags = JSON.parse(config.tags);
      } catch (e) {
        node.warn('Invalid tags JSON');
      }
    }

    // Security schemes
    if (config.apiKeyEnabled) {
      node.openapi.components.securitySchemes.apiKey = {
        type: 'apiKey',
        name: config.apiKeyHeader || 'X-API-Key',
        in: 'header',
      };
    }

    if (config.bearerAuthEnabled) {
      node.openapi.components.securitySchemes.bearerAuth = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: config.bearerFormat || 'JWT',
      };
    }

    // Method to register swagger on a Fastify instance
    node.registerSwagger = async function(fastify) {
      await fastify.register(swagger, {
        openapi: node.openapi,
      });

      if (config.swaggerUiEnabled) {
        await fastify.register(swaggerUi, {
          routePrefix: config.docsPath || '/docs',
          uiConfig: {
            docExpansion: config.docExpansion || 'list',
            deepLinking: true,
          },
        });
      }
    };

    // Method to get current spec
    node.getSpec = function(fastify) {
      return fastify.swagger();
    };
  }

  RED.nodes.registerType('openapi-config', OpenAPIConfigNode);
};
```

### OpenAPI Config Node HTML

```html
<script type="text/javascript">
  RED.nodes.registerType('openapi-config', {
    category: 'config',
    defaults: {
      name: { value: '' },
      title: { value: 'Node-RED API' },
      description: { value: '' },
      version: { value: '1.0.0' },
      servers: { value: '[]' },
      tags: { value: '[]' },
      swaggerUiEnabled: { value: true },
      docsPath: { value: '/docs' },
      docExpansion: { value: 'list' },
      apiKeyEnabled: { value: false },
      apiKeyHeader: { value: 'X-API-Key' },
      bearerAuthEnabled: { value: false },
      bearerFormat: { value: 'JWT' },
    },
    label: function() {
      return this.name || this.title || 'OpenAPI Config';
    },
  });
</script>

<script type="text/html" data-template-name="openapi-config">
  <div class="form-row">
    <label for="node-config-input-name"><i class="fa fa-tag"></i> Name</label>
    <input type="text" id="node-config-input-name" placeholder="Name">
  </div>
  <div class="form-row">
    <label for="node-config-input-title"><i class="fa fa-file-text"></i> API Title</label>
    <input type="text" id="node-config-input-title">
  </div>
  <div class="form-row">
    <label for="node-config-input-version"><i class="fa fa-code-fork"></i> Version</label>
    <input type="text" id="node-config-input-version">
  </div>
  <div class="form-row">
    <label for="node-config-input-description"><i class="fa fa-info"></i> Description</label>
    <textarea id="node-config-input-description" rows="3" style="width:70%"></textarea>
  </div>
  <div class="form-row">
    <label><i class="fa fa-book"></i> Swagger UI</label>
    <input type="checkbox" id="node-config-input-swaggerUiEnabled" style="width:auto">
    <label for="node-config-input-swaggerUiEnabled" style="width:auto">Enable</label>
  </div>
  <div class="form-row">
    <label for="node-config-input-docsPath"><i class="fa fa-link"></i> Docs Path</label>
    <input type="text" id="node-config-input-docsPath" placeholder="/docs">
  </div>
  <div class="form-row">
    <label><i class="fa fa-key"></i> API Key Auth</label>
    <input type="checkbox" id="node-config-input-apiKeyEnabled" style="width:auto">
    <label for="node-config-input-apiKeyEnabled" style="width:auto">Enable</label>
  </div>
  <div class="form-row">
    <label><i class="fa fa-lock"></i> Bearer Auth</label>
    <input type="checkbox" id="node-config-input-bearerAuthEnabled" style="width:auto">
    <label for="node-config-input-bearerAuthEnabled" style="width:auto">Enable</label>
  </div>
</script>
```

### Documented Endpoint Node

```javascript
module.exports = function(RED) {
  function OpenAPIEndpointNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get server and OpenAPI config nodes
    const serverNode = RED.nodes.getNode(config.server);
    const openapiNode = RED.nodes.getNode(config.openapi);

    if (!serverNode) {
      node.error('No Fastify server configured');
      return;
    }

    const method = config.method || 'get';
    const path = config.path || '/';

    // Build route schema from node config
    const routeSchema = {
      description: config.description || '',
      summary: config.summary || '',
      tags: config.tags ? config.tags.split(',').map(t => t.trim()) : [],
      operationId: config.operationId || `${method}${path.replace(/\//g, '_')}`,
    };

    // Add security if configured
    if (config.security) {
      try {
        routeSchema.security = JSON.parse(config.security);
      } catch (e) {
        node.warn('Invalid security JSON');
      }
    }

    // Add request body schema
    if (config.bodySchema && ['post', 'put', 'patch'].includes(method)) {
      try {
        routeSchema.body = JSON.parse(config.bodySchema);
      } catch (e) {
        node.warn('Invalid body schema JSON');
      }
    }

    // Add query schema
    if (config.querySchema) {
      try {
        routeSchema.querystring = JSON.parse(config.querySchema);
      } catch (e) {
        node.warn('Invalid query schema JSON');
      }
    }

    // Add params schema
    if (config.paramsSchema) {
      try {
        routeSchema.params = JSON.parse(config.paramsSchema);
      } catch (e) {
        node.warn('Invalid params schema JSON');
      }
    }

    // Add response schemas
    if (config.responseSchemas) {
      try {
        routeSchema.response = JSON.parse(config.responseSchemas);
      } catch (e) {
        node.warn('Invalid response schemas JSON');
      }
    }

    // Register route with Fastify
    const fastify = serverNode.server;

    fastify[method](path, {
      schema: routeSchema,
    }, async (request, reply) => {
      // Create Node-RED message
      const msg = {
        payload: request.body || {},
        req: {
          params: request.params,
          query: request.query,
          headers: request.headers,
          method: request.method,
          url: request.url,
        },
        _fastifyReply: reply,
      };

      // Send to output and wait for response
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Response timeout'));
        }, config.timeout || 30000);

        msg._resolve = (response) => {
          clearTimeout(timeout);
          resolve(response);
        };

        node.send(msg);
      });
    });

    node.status({
      fill: 'green',
      shape: 'dot',
      text: `${method.toUpperCase()} ${path}`,
    });

    node.on('close', function(done) {
      // Routes are cleaned up when Fastify server closes
      done();
    });
  }

  RED.nodes.registerType('openapi-endpoint', OpenAPIEndpointNode);
};
```

### Complete Flow Example

```json
[
  {
    "id": "fastify-server-1",
    "type": "fastify-server",
    "name": "API Server",
    "port": "3000",
    "host": "0.0.0.0"
  },
  {
    "id": "openapi-config-1",
    "type": "openapi-config",
    "name": "API Docs",
    "title": "User Management API",
    "version": "1.0.0",
    "description": "API for managing users",
    "swaggerUiEnabled": true,
    "docsPath": "/docs",
    "bearerAuthEnabled": true
  },
  {
    "id": "endpoint-get-users",
    "type": "openapi-endpoint",
    "name": "List Users",
    "server": "fastify-server-1",
    "openapi": "openapi-config-1",
    "method": "get",
    "path": "/users",
    "description": "Get all users with pagination",
    "summary": "List users",
    "tags": "users",
    "operationId": "listUsers",
    "querySchema": "{\"type\":\"object\",\"properties\":{\"page\":{\"type\":\"integer\",\"default\":1},\"limit\":{\"type\":\"integer\",\"default\":20}}}",
    "responseSchemas": "{\"200\":{\"type\":\"object\",\"properties\":{\"users\":{\"type\":\"array\"},\"total\":{\"type\":\"integer\"}}}}",
    "wires": [["function-get-users"]]
  },
  {
    "id": "endpoint-create-user",
    "type": "openapi-endpoint",
    "name": "Create User",
    "server": "fastify-server-1",
    "openapi": "openapi-config-1",
    "method": "post",
    "path": "/users",
    "description": "Create a new user",
    "summary": "Create user",
    "tags": "users",
    "operationId": "createUser",
    "security": "[{\"bearerAuth\":[]}]",
    "bodySchema": "{\"type\":\"object\",\"required\":[\"name\",\"email\"],\"properties\":{\"name\":{\"type\":\"string\"},\"email\":{\"type\":\"string\",\"format\":\"email\"}}}",
    "responseSchemas": "{\"201\":{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"},\"name\":{\"type\":\"string\"},\"email\":{\"type\":\"string\"}}}}",
    "wires": [["function-create-user"]]
  }
]
```

## Exposing OpenAPI Spec

### JSON and YAML Endpoints

```javascript
// After registering @fastify/swagger
await fastify.ready();

// JSON endpoint
fastify.get('/openapi.json', {
  schema: {
    description: 'OpenAPI specification in JSON format',
    tags: ['documentation'],
    response: {
      200: { type: 'object' },
    },
  },
}, async () => {
  return fastify.swagger();
});

// YAML endpoint
fastify.get('/openapi.yaml', {
  schema: {
    description: 'OpenAPI specification in YAML format',
    tags: ['documentation'],
    response: {
      200: { type: 'string' },
    },
  },
}, async (request, reply) => {
  reply.type('text/yaml');
  return fastify.swagger({ yaml: true });
});

// Download endpoint
fastify.get('/openapi/download', {
  schema: {
    description: 'Download OpenAPI specification',
    tags: ['documentation'],
    querystring: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'yaml'], default: 'json' },
      },
    },
  },
}, async (request, reply) => {
  const format = request.query.format || 'json';
  const filename = `openapi.${format}`;

  reply.header('Content-Disposition', `attachment; filename="${filename}"`);

  if (format === 'yaml') {
    reply.type('text/yaml');
    return fastify.swagger({ yaml: true });
  }

  return fastify.swagger();
});
```

### Dynamic Spec Refresh

```javascript
// For Node-RED where routes may be added dynamically
fastify.get('/openapi.json', async () => {
  // Regenerate spec to include any new routes
  await fastify.ready();
  return fastify.swagger();
});
```

## Resources

### References

- `references/typebox-openapi.md` - TypeBox patterns for OpenAPI schema generation

### External Documentation

- [@fastify/swagger](https://github.com/fastify/fastify-swagger)
- [@fastify/swagger-ui](https://github.com/fastify/fastify-swagger-ui)
- [@scalar/fastify-api-reference](https://github.com/scalar/scalar/tree/main/packages/fastify-api-reference)
- [fastify-openapi-glue](https://github.com/seriousme/fastify-openapi-glue)
- [OpenAPI 3.0 Specification](https://spec.openapis.org/oas/v3.0.3)
