---
name: fastify-server
description: Comprehensive guide for Fastify web framework development. This skill should be used when creating HTTP/REST APIs with Fastify, implementing route handlers, working with plugins and hooks, handling request validation, or integrating Fastify servers into Node-RED nodes. Covers server setup, routing patterns, plugin architecture, lifecycle hooks, error handling, and graceful shutdown.
---

# Fastify Server

## Overview

Fastify is a high-performance, low-overhead web framework for Node.js focused on developer experience and plugin architecture. This skill provides patterns for building robust HTTP servers with Fastify, with emphasis on integration scenarios such as embedding Fastify within Node-RED nodes.

## Quick Reference

| Task | Pattern |
|------|---------|
| Create server | `fastify({ logger: true })` |
| Define route | `fastify.get('/path', handler)` |
| Add plugin | `fastify.register(plugin, options)` |
| Validate request | Use JSON Schema in route options |
| Handle errors | `fastify.setErrorHandler(handler)` |
| Graceful shutdown | `fastify.close()` returns Promise |

## Server Setup and Configuration

### Basic Server Creation

```javascript
const fastify = require('fastify');

const server = fastify({
  logger: true,                    // Enable built-in pino logger
  ignoreTrailingSlash: true,       // /foo and /foo/ treated as same
  caseSensitive: false,            // /Foo and /foo treated as same
  requestIdHeader: 'x-request-id', // Custom request ID header
  trustProxy: true,                // Trust X-Forwarded-* headers
  maxParamLength: 100,             // Max URL parameter length
});
```

### Configuration Options

```javascript
const server = fastify({
  // Logging
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  },

  // Performance
  connectionTimeout: 0,           // Connection timeout (0 = disabled)
  keepAliveTimeout: 72000,        // Keep-alive timeout in ms
  bodyLimit: 1048576,             // Max body size (1MB default)

  // HTTP/2
  http2: false,                   // Enable HTTP/2
  https: null,                    // HTTPS options { key, cert }

  // Custom behavior
  disableRequestLogging: false,   // Disable automatic request logging
  requestIdLogLabel: 'reqId',     // Label for request ID in logs
  genReqId: (req) => nanoid(),    // Custom request ID generator
});
```

### Starting and Stopping the Server

```javascript
// Start listening
await server.listen({ port: 3000, host: '0.0.0.0' });

// Get address after starting
const address = server.server.address();
console.log(`Server listening on ${address.port}`);

// Graceful shutdown
await server.close();
```

## Route Definition

### HTTP Methods

```javascript
// Individual methods
fastify.get('/users', getUsers);
fastify.post('/users', createUser);
fastify.put('/users/:id', updateUser);
fastify.patch('/users/:id', patchUser);
fastify.delete('/users/:id', deleteUser);
fastify.head('/users', headUsers);
fastify.options('/users', optionsUsers);

// All methods on a route
fastify.all('/webhook', webhookHandler);

// Route shorthand with options
fastify.get('/users/:id', {
  schema: { /* validation schema */ },
  preHandler: [authMiddleware],
}, async (request, reply) => {
  return { user: request.params.id };
});
```

### URL Parameters and Query Strings

```javascript
// URL parameters - available in request.params
fastify.get('/users/:userId/posts/:postId', async (request, reply) => {
  const { userId, postId } = request.params;
  return { userId, postId };
});

// Wildcard parameters
fastify.get('/files/*', async (request, reply) => {
  const filePath = request.params['*']; // Everything after /files/
  return { path: filePath };
});

// Query parameters - available in request.query
// GET /search?q=hello&page=1
fastify.get('/search', async (request, reply) => {
  const { q, page = 1 } = request.query;
  return { query: q, page: parseInt(page) };
});
```

### Request Body

```javascript
// JSON body (automatically parsed for Content-Type: application/json)
fastify.post('/users', async (request, reply) => {
  const { name, email } = request.body;
  return { created: { name, email } };
});

// Raw body access (requires configuration)
const server = fastify({
  bodyLimit: 1048576,
});

// Add raw body parser for specific content types
server.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
  done(null, body);
});
```

### Response Handling

```javascript
fastify.get('/example', async (request, reply) => {
  // Return value is automatically serialized to JSON
  return { data: 'value' };
});

fastify.get('/manual', async (request, reply) => {
  // Set status code
  reply.code(201);

  // Set headers
  reply.header('X-Custom', 'value');
  reply.type('application/json');

  // Send response
  return { created: true };
});

// Redirect
fastify.get('/old', async (request, reply) => {
  return reply.redirect('/new');
});

// Send specific types
fastify.get('/html', async (request, reply) => {
  reply.type('text/html');
  return '<h1>Hello</h1>';
});

// Streaming response
fastify.get('/stream', async (request, reply) => {
  const stream = fs.createReadStream('file.txt');
  return reply.send(stream);
});
```

### Route Prefix and Organization

```javascript
// Register routes with prefix
fastify.register(async function userRoutes(fastify, opts) {
  // These routes will be prefixed with /api/v1
  fastify.get('/users', listUsers);
  fastify.post('/users', createUser);
}, { prefix: '/api/v1' });

// Separate route files
// routes/users.js
module.exports = async function(fastify, opts) {
  fastify.get('/', listUsers);
  fastify.get('/:id', getUser);
};

// main.js
fastify.register(require('./routes/users'), { prefix: '/users' });
```

## Plugin Architecture

### Creating Plugins

```javascript
// Simple plugin
async function myPlugin(fastify, options) {
  fastify.decorate('myUtil', () => 'utility function');

  fastify.addHook('onRequest', async (request, reply) => {
    request.customProperty = 'value';
  });
}

// Register plugin
fastify.register(myPlugin, { option1: 'value' });

// Plugin with fastify-plugin (breaks encapsulation)
const fp = require('fastify-plugin');

module.exports = fp(async function(fastify, opts) {
  fastify.decorate('sharedUtil', () => 'available everywhere');
}, {
  name: 'my-shared-plugin',
  fastify: '4.x',
});
```

### Encapsulation

```javascript
// By default, plugins are encapsulated (changes don't leak out)
fastify.register(async function(fastify) {
  // This decorator only available in this scope
  fastify.decorate('localUtil', () => {});

  // Routes here can use localUtil
  fastify.get('/local', async (req, reply) => {
    return fastify.localUtil();
  });
});

// Main scope cannot access localUtil
// fastify.localUtil // undefined
```

### Decorators

```javascript
// Decorate fastify instance
fastify.decorate('db', databaseConnection);
fastify.decorate('config', { apiKey: 'xxx' });

// Decorate request object (per-request data)
fastify.decorateRequest('user', null);
fastify.addHook('onRequest', async (request) => {
  request.user = await getUser(request.headers.authorization);
});

// Decorate reply object
fastify.decorateReply('sendError', function(code, message) {
  this.code(code).send({ error: message });
});

// Usage in route
fastify.get('/profile', async (request, reply) => {
  if (!request.user) {
    return reply.sendError(401, 'Unauthorized');
  }
  return { user: request.user };
});
```

### Common Plugins

```javascript
// CORS
await fastify.register(require('@fastify/cors'), {
  origin: ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

// Helmet (security headers)
await fastify.register(require('@fastify/helmet'));

// Rate limiting
await fastify.register(require('@fastify/rate-limit'), {
  max: 100,
  timeWindow: '1 minute',
});

// JWT authentication
await fastify.register(require('@fastify/jwt'), {
  secret: 'supersecret',
});

// Static file serving
await fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/public/',
});
```

## Lifecycle Hooks

### Request Lifecycle Order

```
onRequest → preParsing → preValidation → preHandler → handler → preSerialization → onSend → onResponse
```

### Hook Implementations

```javascript
// onRequest - First hook, before body parsing
fastify.addHook('onRequest', async (request, reply) => {
  request.startTime = Date.now();
});

// preParsing - Before body is parsed, can modify stream
fastify.addHook('preParsing', async (request, reply, payload) => {
  // Return modified payload stream if needed
  return payload;
});

// preValidation - After parsing, before schema validation
fastify.addHook('preValidation', async (request, reply) => {
  // Modify request.body before validation
});

// preHandler - After validation, before route handler
fastify.addHook('preHandler', async (request, reply) => {
  // Authentication, authorization checks
  if (!request.headers.authorization) {
    reply.code(401).send({ error: 'Unauthorized' });
    return; // Stop processing
  }
});

// preSerialization - Before response serialization
fastify.addHook('preSerialization', async (request, reply, payload) => {
  // Modify payload before it's serialized
  return { ...payload, timestamp: Date.now() };
});

// onSend - After serialization, before sending
fastify.addHook('onSend', async (request, reply, payload) => {
  // Modify serialized payload (string/buffer)
  return payload;
});

// onResponse - After response sent (for logging/cleanup)
fastify.addHook('onResponse', async (request, reply) => {
  const duration = Date.now() - request.startTime;
  request.log.info({ duration }, 'Request completed');
});

// onError - When an error occurs
fastify.addHook('onError', async (request, reply, error) => {
  // Log or process errors
  request.log.error(error);
});
```

### Route-Level Hooks

```javascript
fastify.get('/protected', {
  preHandler: async (request, reply) => {
    // Only runs for this route
    await verifyToken(request);
  },
  preSerialization: async (request, reply, payload) => {
    return sanitizeResponse(payload);
  },
}, async (request, reply) => {
  return { data: 'protected' };
});
```

### Application Lifecycle Hooks

```javascript
// onReady - After server is ready, before listening
fastify.addHook('onReady', async () => {
  // Initialize connections, warm caches
  await database.connect();
});

// onClose - During server shutdown
fastify.addHook('onClose', async (instance) => {
  // Cleanup resources
  await database.disconnect();
});

// onListen - After server starts listening (Fastify 4.x+)
fastify.addHook('onListen', async () => {
  console.log('Server is now listening');
});

// onRoute - When a route is registered
fastify.addHook('onRoute', (routeOptions) => {
  console.log(`Route registered: ${routeOptions.method} ${routeOptions.url}`);
});

// onRegister - When a plugin is registered
fastify.addHook('onRegister', (instance, opts) => {
  console.log('Plugin registered with prefix:', opts.prefix);
});
```

## Error Handling

### Custom Error Handler

```javascript
fastify.setErrorHandler(async (error, request, reply) => {
  request.log.error(error);

  // Validation errors
  if (error.validation) {
    return reply.code(400).send({
      error: 'Validation Error',
      message: error.message,
      details: error.validation,
    });
  }

  // Custom application errors
  if (error.statusCode) {
    return reply.code(error.statusCode).send({
      error: error.name,
      message: error.message,
    });
  }

  // Default server error
  return reply.code(500).send({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
  });
});
```

### Creating Custom Errors

```javascript
const createError = require('@fastify/error');

// Define custom error types
const NotFoundError = createError('NOT_FOUND', 'Resource %s not found', 404);
const UnauthorizedError = createError('UNAUTHORIZED', 'Authentication required', 401);
const ForbiddenError = createError('FORBIDDEN', 'Access denied to %s', 403);

// Usage in routes
fastify.get('/users/:id', async (request, reply) => {
  const user = await db.findUser(request.params.id);
  if (!user) {
    throw new NotFoundError(request.params.id);
  }
  return user;
});
```

### Not Found Handler

```javascript
fastify.setNotFoundHandler({
  preHandler: async (request, reply) => {
    // Optional pre-handler for 404s
  },
}, async (request, reply) => {
  return reply.code(404).send({
    error: 'Not Found',
    message: `Route ${request.method} ${request.url} not found`,
  });
});
```

## Schema Validation

### JSON Schema Validation

```javascript
const userSchema = {
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    role: { type: 'string', enum: ['user', 'admin', 'moderator'] },
  },
  additionalProperties: false,
};

fastify.post('/users', {
  schema: {
    body: userSchema,
    response: {
      201: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
        },
      },
    },
  },
}, async (request, reply) => {
  const user = await createUser(request.body);
  reply.code(201);
  return user;
});
```

### Route Schema Options

```javascript
fastify.get('/users/:id', {
  schema: {
    // Validate URL parameters
    params: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[0-9a-f]{24}$' },
      },
    },
    // Validate query string
    querystring: {
      type: 'object',
      properties: {
        include: { type: 'string', enum: ['posts', 'comments'] },
      },
    },
    // Validate headers
    headers: {
      type: 'object',
      properties: {
        'x-api-key': { type: 'string' },
      },
      required: ['x-api-key'],
    },
    // Define response schema (for serialization)
    response: {
      200: { /* schema */ },
      404: { /* schema */ },
    },
  },
}, handler);
```

### TypeBox for Type-Safe Schemas

See `references/typebox-schemas.md` for comprehensive TypeBox examples and patterns.

```javascript
const { Type } = require('@sinclair/typebox');

const UserSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  email: Type.String({ format: 'email' }),
  age: Type.Optional(Type.Integer({ minimum: 0 })),
});

fastify.post('/users', {
  schema: {
    body: UserSchema,
  },
}, async (request, reply) => {
  // request.body is typed if using TypeScript
  return { created: request.body };
});
```

## Node-RED Integration

### Embedding Fastify in a Node-RED Node

```javascript
module.exports = function(RED) {
  function FastifyServerNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const fastify = require('fastify')({
      logger: {
        level: config.logLevel || 'info',
        // Use Node-RED log transport
        stream: {
          write: (msg) => {
            const parsed = JSON.parse(msg);
            node.log(parsed.msg);
          },
        },
      },
    });

    // Store reference for other nodes
    node.server = fastify;

    // Track registered routes for cleanup
    const registeredRoutes = new Set();

    // Method to add routes dynamically
    node.addRoute = function(method, path, handler) {
      const routeKey = `${method.toUpperCase()} ${path}`;
      if (!registeredRoutes.has(routeKey)) {
        fastify[method.toLowerCase()](path, handler);
        registeredRoutes.add(routeKey);
      }
    };

    // Start server
    async function startServer() {
      try {
        await fastify.listen({
          port: config.port || 3000,
          host: config.host || '0.0.0.0',
        });
        node.status({ fill: 'green', shape: 'dot', text: `listening on ${config.port}` });
      } catch (err) {
        node.error(`Failed to start server: ${err.message}`);
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
      }
    }

    startServer();

    // Graceful shutdown on node close
    node.on('close', async function(done) {
      node.status({ fill: 'yellow', shape: 'ring', text: 'closing' });
      try {
        await fastify.close();
        node.status({});
      } catch (err) {
        node.error(`Error during shutdown: ${err.message}`);
      }
      done();
    });
  }

  RED.nodes.registerType('fastify-server', FastifyServerNode);
};
```

### Route Node Pattern

```javascript
module.exports = function(RED) {
  function FastifyRouteNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get the server config node
    const serverNode = RED.nodes.getNode(config.server);
    if (!serverNode) {
      node.error('No server configuration');
      return;
    }

    const method = config.method || 'get';
    const path = config.path || '/';

    // Register route handler
    serverNode.addRoute(method, path, async (request, reply) => {
      // Create Node-RED message from request
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

      // Send message to output
      node.send(msg);

      // Wait for response (set by response node)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Response timeout'));
        }, config.timeout || 30000);

        msg._resolve = (response) => {
          clearTimeout(timeout);
          resolve(response);
        };
        msg._reject = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
      });
    });

    node.status({ fill: 'green', shape: 'dot', text: `${method.toUpperCase()} ${path}` });
  }

  RED.nodes.registerType('fastify-route', FastifyRouteNode);
};
```

### Response Node Pattern

```javascript
module.exports = function(RED) {
  function FastifyResponseNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.on('input', function(msg) {
      if (msg._resolve) {
        const statusCode = msg.statusCode || 200;
        const headers = msg.headers || {};

        // Set headers on the reply object
        if (msg._fastifyReply) {
          msg._fastifyReply.code(statusCode);
          Object.entries(headers).forEach(([key, value]) => {
            msg._fastifyReply.header(key, value);
          });
        }

        // Resolve the promise with the payload
        msg._resolve(msg.payload);
      } else {
        node.warn('No pending request to respond to');
      }
    });
  }

  RED.nodes.registerType('fastify-response', FastifyResponseNode);
};
```

### Graceful Shutdown Patterns

```javascript
// Pattern 1: Using Node-RED lifecycle
node.on('close', async function(removed, done) {
  // removed = true if node is being removed from flow
  // removed = false if Node-RED is restarting/closing

  const shutdownTimeout = 10000; // 10 seconds
  const timer = setTimeout(() => {
    node.warn('Shutdown timed out, forcing close');
    done();
  }, shutdownTimeout);

  try {
    // Stop accepting new connections
    node.status({ fill: 'yellow', shape: 'ring', text: 'draining' });

    // Close Fastify (waits for in-flight requests)
    await fastify.close();

    clearTimeout(timer);
    node.status({});
  } catch (err) {
    clearTimeout(timer);
    node.error(`Shutdown error: ${err.message}`);
  }
  done();
});

// Pattern 2: External shutdown signal
process.on('SIGTERM', async () => {
  // Node-RED handles this, but for standalone testing:
  await fastify.close();
  process.exit(0);
});
```

### Testing Fastify Nodes

```javascript
const helper = require('node-red-node-test-helper');
const fastifyServerNode = require('../nodes/fastify-server');
const fastifyRouteNode = require('../nodes/fastify-route');

describe('Fastify Server Node', function() {
  beforeEach(function(done) {
    helper.startServer(done);
  });

  afterEach(function(done) {
    helper.unload().then(() => helper.stopServer(done));
  });

  it('should start server on configured port', async function() {
    const flow = [
      { id: 'server1', type: 'fastify-server', port: 3456 },
    ];

    await helper.load([fastifyServerNode], flow);
    const serverNode = helper.getNode('server1');

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 100));

    // Test that server is running
    const response = await fetch('http://localhost:3456/health');
    expect(response.ok).to.be.true;
  });

  it('should handle routes and send messages', async function() {
    const flow = [
      { id: 'server1', type: 'fastify-server', port: 3457 },
      { id: 'route1', type: 'fastify-route', server: 'server1', method: 'get', path: '/test', wires: [['helper1']] },
      { id: 'helper1', type: 'helper' },
    ];

    await helper.load([fastifyServerNode, fastifyRouteNode], flow);
    const helperNode = helper.getNode('helper1');

    // Wait for message
    const msgPromise = new Promise(resolve => {
      helperNode.on('input', resolve);
    });

    // Make request
    fetch('http://localhost:3457/test');

    const msg = await msgPromise;
    expect(msg.req.method).to.equal('GET');
    expect(msg.req.url).to.equal('/test');
  });
});
```

## Resources

### References

- `references/typebox-schemas.md` - Comprehensive TypeBox schema examples and validation patterns

### External Documentation

- [Fastify Documentation](https://fastify.dev/docs/latest/)
- [Fastify Ecosystem Plugins](https://fastify.dev/ecosystem/)
- [@sinclair/typebox](https://github.com/sinclairzx81/typebox)
