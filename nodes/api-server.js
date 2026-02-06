'use strict';

const { OpenApiGenerator } = require('../lib/openapi-generator');
const { OpenApiParser } = require('../lib/openapi-parser');
const {
    generateRequestId,
    createTimer,
    requestSerializer,
    responseSerializer
} = require('../lib/logger');
const { getMetricsCollector } = require('../lib/metrics-collector');
const {
    pathsConflict,
    combinePaths,
    normalizePath
} = require('../lib/path-utils');
const { KeycloakClient } = require('../lib/keycloak-client');

module.exports = function(RED) {
    function ApiServerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Store configuration
        node.name = config.name;
        node.port = parseInt(config.port, 10) || 3000;
        node.host = config.host || '0.0.0.0';

        // OpenAPI configuration
        node.openapiEnabled = config.openapiEnabled !== false;  // Enabled by default
        node.openapiPath = config.openapiPath || '/openapi.json';
        node.swaggerUiEnabled = config.swaggerUiEnabled === true;
        node.swaggerUiPath = config.swaggerUiPath || '/docs';

        // Metrics configuration
        node.metricsEnabled = config.metricsEnabled !== false;  // Enabled by default
        node.metricsPath = config.metricsPath || '/metrics';
        node.metricsCollector = null;

        // Get reference to api-config node
        node.configNodeId = config.config;
        node.configNode = null;

        if (node.configNodeId) {
            node.configNode = RED.nodes.getNode(node.configNodeId);
        }

        // Registered endpoints
        node.endpoints = new Map();

        // OpenAPI generator instance
        node.openapiGenerator = null;

        // Fastify instance (will be created on deploy)
        node.fastify = null;
        node.serverStarted = false;

        // Route registration tracking
        node.registeredRoutes = new Map();  // path+method -> endpointId
        node.pendingEndpoints = [];  // Endpoints waiting for server to start

        // Server restart management
        node.restartTimer = null;  // Debounce timer for restart
        node.restartPending = false;  // Flag to indicate restart is scheduled

        // Keycloak client for OAuth2 authentication
        node.keycloakClient = null;

        /**
         * Initialize the OpenAPI generator with config settings
         */
        function initializeOpenApiGenerator() {
            const options = {
                info: {
                    title: 'API Gateway',
                    description: 'Node-RED powered API Gateway',
                    version: '1.0.0'
                },
                basePath: '',
                config: null
            };

            // Get settings from config node if available
            if (node.configNode) {
                const openApiInfo = node.configNode.getOpenApiInfo();
                options.info = openApiInfo.info;
                options.basePath = openApiInfo.basePath || '';
                options.config = node.configNode;
            }

            node.openapiGenerator = new OpenApiGenerator(options);
        }

        /**
         * Initialize Keycloak client for OAuth2 authentication
         */
        function initializeKeycloakClient() {
            if (!node.configNode || !node.configNode.oauth2Enabled) {
                return;
            }

            const logger = node.configNode.getLogger();
            node.keycloakClient = new KeycloakClient({
                keycloakUrl: node.configNode.keycloakUrl,
                realm: node.configNode.keycloakRealm,
                clientId: node.configNode.keycloakClientId,
                clientSecret: node.configNode.credentials?.keycloakClientSecret,
                timeout: 5000,
                validateIssuer: node.configNode.jwtValidateIssuer !== false,
                validateAudience: node.configNode.jwtValidateAudience === true,
                audience: node.configNode.jwtAudience,
                clockTolerance: node.configNode.jwtClockTolerance || 0,
                logger: logger
            });

            node.keycloakClient.on('circuitOpen', () => {
                node.warn('Keycloak circuit breaker opened - authentication may fail');
            });

            node.keycloakClient.on('circuitClosed', () => {
                node.log('Keycloak circuit breaker closed - authentication restored');
            });

            // Pre-fetch JWKS
            node.keycloakClient.getPublicKeys().catch(err => {
                node.warn(`Failed to pre-fetch Keycloak JWKS: ${err.message}`);
            });
        }

        /**
         * Get the full path for an endpoint including base path from config
         * @param {string} endpointPath - The endpoint's path
         * @returns {string} Full path with base path prefix
         */
        function getFullPath(endpointPath) {
            if (node.configNode) {
                const basePath = node.configNode.getFullBasePath();
                return combinePaths(basePath, endpointPath);
            }
            return normalizePath(endpointPath);
        }

        /**
         * Check for route conflicts with existing routes
         * @param {string} method - HTTP method
         * @param {string} path - Route path
         * @param {string} endpointId - ID of the endpoint being registered
         * @returns {{conflict: boolean, existingEndpointId?: string}}
         */
        function checkRouteConflict(method, path, endpointId) {
            const routeKey = `${method.toUpperCase()}:${path}`;

            // Check exact match
            if (node.registeredRoutes.has(routeKey)) {
                const existingId = node.registeredRoutes.get(routeKey);
                if (existingId !== endpointId) {
                    return { conflict: true, existingEndpointId: existingId };
                }
            }

            // Check for conflicting patterns (e.g., /users/:id vs /users/:userId)
            for (const [key, existingId] of node.registeredRoutes) {
                if (existingId === endpointId) continue;

                const [existingMethod, existingPath] = key.split(':');
                if (existingMethod === method.toUpperCase() && pathsConflict(existingPath, path)) {
                    return { conflict: true, existingEndpointId: existingId };
                }
            }

            return { conflict: false };
        }

        /**
         * Create authentication middleware for an endpoint
         * @param {Object} endpointNode - The api-endpoint node
         * @returns {Function} Fastify preHandler hook
         */
        function createAuthMiddleware(endpointNode) {
            return async function(request, reply) {
                // Skip auth if no scopes required and OAuth2 not enabled
                const requiresAuth = endpointNode.requiredScopes && endpointNode.requiredScopes.length > 0;
                if (!requiresAuth && !node.configNode?.oauth2Enabled) {
                    request.auth = { authenticated: false };
                    return;
                }

                // Extract Bearer token from Authorization header
                const authHeader = request.headers.authorization;
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    if (requiresAuth) {
                        reply.code(401).send({
                            statusCode: 401,
                            error: 'Unauthorized',
                            message: 'Missing or invalid Authorization header'
                        });
                        return;
                    }
                    request.auth = { authenticated: false };
                    return;
                }

                const token = authHeader.substring(7);

                // Validate token with Keycloak
                if (!node.keycloakClient) {
                    if (requiresAuth) {
                        reply.code(503).send({
                            statusCode: 503,
                            error: 'Service Unavailable',
                            message: 'OAuth2 authentication not configured'
                        });
                        return;
                    }
                    request.auth = { authenticated: false };
                    return;
                }

                const validationResult = await node.keycloakClient.validateToken(token);

                if (!validationResult.valid) {
                    if (requiresAuth) {
                        reply.code(401).send({
                            statusCode: 401,
                            error: 'Unauthorized',
                            message: validationResult.error || 'Invalid token'
                        });
                        return;
                    }
                    request.auth = { authenticated: false };
                    return;
                }

                // Extract user info and scopes
                const payload = validationResult.payload;
                const scopes = payload.scope ? payload.scope.split(' ') : [];

                // Extract roles from various possible locations in the token
                // 1. Standard Keycloak realm_access.roles
                if (payload.realm_access?.roles) {
                    scopes.push(...payload.realm_access.roles);
                }
                // 2. Custom claim 'roles' (from custom protocol mapper)
                if (Array.isArray(payload.roles)) {
                    scopes.push(...payload.roles);
                }
                // 3. Resource access roles (client-specific)
                if (payload.resource_access) {
                    for (const [resource, access] of Object.entries(payload.resource_access)) {
                        if (access.roles) {
                            scopes.push(...access.roles.map(r => `${resource}:${r}`));
                        }
                    }
                }

                // Determine roles array for auth context
                const roles = payload.realm_access?.roles || payload.roles || [];

                request.auth = {
                    authenticated: true,
                    sub: payload.sub,
                    preferredUsername: payload.preferred_username,
                    email: payload.email,
                    scopes: scopes,
                    roles: roles,
                    token: token,
                    payload: payload
                };

                // Record metrics for token validation
                if (node.metricsCollector) {
                    node.metricsCollector.recordKeycloakValidation({ success: true, duration: 0 });
                }
            };
        }

        /**
         * Create the route handler that forwards requests to Node-RED
         * @param {Object} endpointNode - The api-endpoint node
         * @returns {Function} Fastify route handler
         */
        function createRouteHandler(endpointNode) {
            return async function(request, reply) {
                // Build message to send to Node-RED flow
                const msg = {
                    _msgid: generateRequestId(),
                    req: {
                        method: request.method,
                        url: request.url,
                        path: request.routeOptions?.url || request.url.split('?')[0],
                        query: request.query || {},
                        params: request.params || {},
                        headers: request.headers,
                        body: request.body,
                        ip: request.ip,
                        auth: request.auth || { authenticated: false }
                    },
                    res: {
                        // Provide response helper methods
                        _reply: reply,
                        _responded: false,
                        status: function(code) {
                            this._statusCode = code;
                            return this;
                        },
                        set: function(name, value) {
                            if (!this._headers) this._headers = {};
                            this._headers[name] = value;
                            return this;
                        },
                        json: function(data) {
                            if (this._responded) return;
                            this._responded = true;
                            if (this._headers) {
                                for (const [name, value] of Object.entries(this._headers)) {
                                    this._reply.header(name, value);
                                }
                            }
                            this._reply.code(this._statusCode || 200).send(data);
                        },
                        send: function(data) {
                            if (this._responded) return;
                            this._responded = true;
                            if (this._headers) {
                                for (const [name, value] of Object.entries(this._headers)) {
                                    this._reply.header(name, value);
                                }
                            }
                            this._reply.code(this._statusCode || 200).send(data);
                        },
                        end: function() {
                            if (this._responded) return;
                            this._responded = true;
                            this._reply.code(this._statusCode || 204).send();
                        }
                    },
                    payload: request.body
                };

                // Create a promise that will be resolved when the response is sent
                return new Promise((resolve, reject) => {
                    // Set timeout for response
                    const timeout = setTimeout(() => {
                        if (!msg.res._responded) {
                            msg.res._responded = true;
                            reply.code(504).send({
                                statusCode: 504,
                                error: 'Gateway Timeout',
                                message: 'Request timed out waiting for response'
                            });
                            resolve();
                        }
                    }, 30000);  // 30 second timeout

                    // Override send methods to resolve the promise
                    const originalJson = msg.res.json.bind(msg.res);
                    const originalSend = msg.res.send.bind(msg.res);
                    const originalEnd = msg.res.end.bind(msg.res);

                    msg.res.json = function(data) {
                        clearTimeout(timeout);
                        originalJson(data);
                        resolve();
                    };
                    msg.res.send = function(data) {
                        clearTimeout(timeout);
                        originalSend(data);
                        resolve();
                    };
                    msg.res.end = function() {
                        clearTimeout(timeout);
                        originalEnd();
                        resolve();
                    };

                    // Send message through the endpoint node
                    // The endpoint node will process validation, authorization, etc.
                    // and then forward to its output
                    try {
                        endpointNode.receive(msg);
                    } catch (err) {
                        clearTimeout(timeout);
                        if (!msg.res._responded) {
                            msg.res._responded = true;
                            reply.code(500).send({
                                statusCode: 500,
                                error: 'Internal Server Error',
                                message: err.message
                            });
                        }
                        resolve();
                    }
                });
            };
        }

        /**
         * Register a single Fastify route for an endpoint
         * @param {Object} endpointNode - The api-endpoint node
         * @param {boolean} isRestart - True if this is being called during a server restart
         * @returns {boolean} True if route was registered successfully
         */
        function registerFastifyRoute(endpointNode, isRestart = false) {
            if (!node.fastify || !node.serverStarted) {
                // Queue for later registration
                if (!node.pendingEndpoints.includes(endpointNode)) {
                    node.pendingEndpoints.push(endpointNode);
                }
                return false;
            }

            const fullPath = getFullPath(endpointNode.path);
            const method = endpointNode.method.toLowerCase();

            // Check for conflicts
            const conflict = checkRouteConflict(endpointNode.method, fullPath, endpointNode.id);
            if (conflict.conflict) {
                node.warn(`Route conflict: ${endpointNode.method} ${fullPath} conflicts with endpoint ${conflict.existingEndpointId}`);
                return false;
            }

            // Check if route is already registered (skip if already tracked)
            const routeKey = `${endpointNode.method.toUpperCase()}:${fullPath}`;
            if (node.registeredRoutes.has(routeKey)) {
                // Route already registered, no action needed
                return true;
            }

            try {
                // Convert Express-style params (:id) to Fastify style (:id is the same, but we need to handle it)
                const fastifyPath = fullPath;

                // Build route options
                const routeOptions = {
                    method: method.toUpperCase(),
                    url: fastifyPath,
                    handler: createRouteHandler(endpointNode)
                };

                // Add authentication middleware if OAuth2 is enabled
                if (node.keycloakClient || (endpointNode.requiredScopes && endpointNode.requiredScopes.length > 0)) {
                    routeOptions.preHandler = createAuthMiddleware(endpointNode);
                }

                // Register the route
                node.fastify.route(routeOptions);

                // Track registered route
                node.registeredRoutes.set(routeKey, endpointNode.id);

                node.log(`Registered Fastify route: ${endpointNode.method} ${fullPath}`);
                return true;
            } catch (err) {
                // Fastify 5.x throws an error when adding routes after listen()
                // Schedule a server restart to register the new route
                if (!isRestart && err.message && err.message.includes('after')) {
                    node.log(`Route registration failed (server already listening), scheduling restart: ${endpointNode.method} ${fullPath}`);
                    scheduleRestart(`new endpoint added: ${endpointNode.method} ${fullPath}`);
                    return false;
                }
                node.error(`Failed to register route ${endpointNode.method} ${fullPath}: ${err.message}`);
                return false;
            }
        }

        /**
         * Register all pending endpoints
         */
        function registerPendingEndpoints() {
            const pending = node.pendingEndpoints.slice();
            node.pendingEndpoints = [];

            for (const endpointNode of pending) {
                registerFastifyRoute(endpointNode);
            }
        }

        /**
         * Schedule a server restart (debounced to handle multiple endpoint changes)
         * @param {string} reason - Reason for the restart (for logging)
         */
        function scheduleRestart(reason) {
            if (node.restartPending) {
                // Restart already scheduled, no need to schedule another
                return;
            }

            node.restartPending = true;

            // Clear any existing timer
            if (node.restartTimer) {
                clearTimeout(node.restartTimer);
            }

            // Debounce restart by 100ms to batch multiple endpoint registrations
            node.restartTimer = setTimeout(async () => {
                node.restartTimer = null;
                node.restartPending = false;

                node.log(`Restarting Fastify server: ${reason}`);
                await restartServer();
            }, 100);
        }

        /**
         * Restart the Fastify server to register new routes
         * Fastify 5.x doesn't allow adding routes after listen(), so we need to restart
         */
        async function restartServer() {
            if (!node.serverStarted) {
                return;
            }

            try {
                // Store current endpoints before stopping
                const currentEndpoints = Array.from(node.endpoints.values());

                node.log(`Restarting server with ${currentEndpoints.length} endpoints...`);

                // Close the current server
                if (node.fastify) {
                    await node.fastify.close();
                    node.fastify = null;
                }

                // Clear registered routes (will be re-registered)
                node.registeredRoutes.clear();

                // Mark server as not started so startServer() will proceed
                node.serverStarted = false;

                // Queue all current endpoints for re-registration
                node.pendingEndpoints = currentEndpoints.slice();

                // Start the server again (this will register all pending endpoints)
                await startServer();

                node.log('Server restart complete');
            } catch (err) {
                node.error(`Failed to restart server: ${err.message}`);
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: 'restart failed'
                });
            }
        }

        /**
         * Initialize and start the Fastify server
         */
        async function startServer() {
            if (node.serverStarted) {
                return;
            }

            try {
                // Dynamically require fastify
                let fastify;
                try {
                    fastify = require('fastify');
                } catch (err) {
                    node.warn('Fastify not installed. OpenAPI endpoints will not be available. Install with: npm install fastify');
                    return;
                }

                // Get logger from config node if available
                const logger = node.configNode?.getLogger() || null;

                // Build Fastify options
                const fastifyOptions = {
                    // Use routerOptions for Fastify 6 compatibility
                    routerOptions: {
                        ignoreTrailingSlash: true
                    },
                    requestIdHeader: 'x-request-id',
                    genReqId: (req) => {
                        // Use existing request ID or generate new one
                        return req.headers['x-request-id'] || generateRequestId();
                    }
                };

                // Configure logger for Fastify
                // Fastify 5.x only accepts a boolean or Pino configuration object (not an instance)
                // We disable Fastify's built-in logging and handle it ourselves in hooks
                fastifyOptions.logger = false;

                // Create Fastify instance
                node.fastify = fastify(fastifyOptions);

                // Add request/response timing hooks for logging and metrics
                // Always add hooks - metrics may be enabled even without logging
                node.fastify.addHook('onRequest', async (request) => {
                    request.startTime = Date.now();
                    request.timer = createTimer();

                    // Track active requests for metrics
                    if (node.metricsCollector) {
                        node.metricsCollector.incrementActiveRequests();
                    }
                });

                node.fastify.addHook('onResponse', async (request, reply) => {
                    const duration = request.timer ? request.timer.elapsed() : (Date.now() - request.startTime);

                    // Log request if logger is enabled
                    if (logger) {
                        logger.info({
                            event: 'http_request',
                            requestId: request.id,
                            method: request.method,
                            url: request.url,
                            statusCode: reply.statusCode,
                            duration: duration,
                            durationMs: `${duration}ms`,
                            userAgent: request.headers['user-agent'],
                            remoteAddress: request.ip
                        }, `${request.method} ${request.url} ${reply.statusCode} - ${duration}ms`);
                    }

                    // Record metrics
                    if (node.metricsCollector) {
                        // Extract path without query string for metrics
                        const path = request.url.split('?')[0];
                        node.metricsCollector.recordHttpRequest({
                            method: request.method,
                            path: path,
                            statusCode: reply.statusCode,
                            duration: duration
                        });
                        node.metricsCollector.decrementActiveRequests();
                    }
                });

                node.fastify.addHook('onError', async (request, reply, error) => {
                    if (logger) {
                        logger.error({
                            event: 'http_error',
                            requestId: request.id,
                            method: request.method,
                            url: request.url,
                            error: error.message,
                            stack: error.stack,
                            code: error.code
                        }, `Request error: ${error.message}`);
                    }
                });

                // Register OpenAPI spec endpoint
                if (node.openapiEnabled) {
                    // JSON endpoint
                    node.fastify.get(node.openapiPath, async (request, reply) => {
                        const spec = node.openapiGenerator.generate();

                        // Add server URL based on request
                        if (!spec.servers || spec.servers.length === 0) {
                            const protocol = request.protocol || 'http';
                            const host = request.hostname || `${node.host}:${node.port}`;
                            spec.servers = [{
                                url: `${protocol}://${host}`,
                                description: 'Current server'
                            }];
                        }

                        reply.type('application/json');
                        return spec;
                    });

                    // YAML endpoint
                    const yamlPath = node.openapiPath.replace(/\.json$/, '.yaml');
                    if (yamlPath !== node.openapiPath) {
                        node.fastify.get(yamlPath, async (request, reply) => {
                            reply.type('text/yaml');
                            return node.openapiGenerator.toYAML();
                        });
                    }
                }

                // Register Swagger UI if enabled
                if (node.swaggerUiEnabled) {
                    try {
                        // @fastify/swagger-ui requires @fastify/swagger to be registered first
                        const swagger = require('@fastify/swagger');
                        const swaggerUi = require('@fastify/swagger-ui');

                        // Register @fastify/swagger with our custom specification
                        await node.fastify.register(swagger, {
                            mode: 'dynamic',
                            openapi: {
                                info: {
                                    title: node.configNode?.openapiTitle || 'API Gateway',
                                    description: node.configNode?.openapiDescription || '',
                                    version: node.configNode?.apiVersion || '1.0.0'
                                }
                            }
                        });

                        // Register Swagger UI
                        await node.fastify.register(swaggerUi, {
                            routePrefix: node.swaggerUiPath,
                            // Use our custom OpenAPI spec endpoint instead of the auto-generated one
                            transformSpecificationClone: true,
                            transformSpecification: () => node.getOpenApiSpec(),
                            uiConfig: {
                                docExpansion: 'list',
                                deepLinking: true,
                                displayRequestDuration: true,
                                filter: true
                            },
                            // Disable CSP to allow Swagger UI scripts to run properly
                            staticCSP: false
                        });
                    } catch (err) {
                        if (err.code === 'MODULE_NOT_FOUND') {
                            node.warn('Swagger UI not available. Install with: npm install @fastify/swagger @fastify/swagger-ui');
                        } else {
                            node.warn(`Swagger UI setup failed: ${err.message}`);
                        }
                    }
                }

                // Register Prometheus metrics endpoint if enabled
                if (node.metricsEnabled) {
                    // Initialize metrics collector with server context
                    node.metricsCollector = getMetricsCollector({
                        prefix: 'api_gateway_',
                        defaultLabels: {
                            server: `${node.host}:${node.port}`
                        }
                    });

                    node.fastify.get(node.metricsPath, async (request, reply) => {
                        try {
                            const metrics = await node.metricsCollector.getMetrics();
                            reply.type(node.metricsCollector.getContentType());
                            return metrics;
                        } catch (err) {
                            reply.code(500).send({ error: 'Failed to collect metrics' });
                        }
                    });
                }

                // Register any pending endpoints BEFORE starting the server
                // Fastify 5.x doesn't allow adding routes after listen()
                node.serverStarted = true;  // Mark as started so registerFastifyRoute doesn't queue
                registerPendingEndpoints();

                // Start the server
                await node.fastify.listen({ port: node.port, host: node.host });
                node.status({
                    fill: 'green',
                    shape: 'dot',
                    text: `listening on ${node.host}:${node.port}`
                });

                node.log(`API Server started on ${node.host}:${node.port}`);
                if (node.openapiEnabled) {
                    node.log(`OpenAPI spec available at ${node.openapiPath}`);
                }
                if (node.swaggerUiEnabled) {
                    node.log(`Swagger UI available at ${node.swaggerUiPath}`);
                }
                if (node.metricsEnabled) {
                    node.log(`Prometheus metrics available at ${node.metricsPath}`);
                }

            } catch (err) {
                node.error(`Failed to start server: ${err.message}`);
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: 'failed to start'
                });
            }
        }

        /**
         * Stop the Fastify server
         */
        async function stopServer() {
            if (node.fastify && node.serverStarted) {
                try {
                    await node.fastify.close();
                    node.serverStarted = false;
                    node.fastify = null;
                    node.registeredRoutes.clear();
                    node.log('API Server stopped');
                } catch (err) {
                    node.error(`Error stopping server: ${err.message}`);
                }
            }

            // Shutdown Keycloak client
            if (node.keycloakClient) {
                node.keycloakClient.shutdown();
                node.keycloakClient = null;
            }
        }

        /**
         * Register an endpoint with this server
         * @param {Object} endpointNode - The api-endpoint node
         */
        node.registerEndpoint = function(endpointNode) {
            if (!endpointNode || !endpointNode.id) {
                return;
            }

            node.endpoints.set(endpointNode.id, endpointNode);

            // Register with OpenAPI generator
            if (node.openapiGenerator) {
                node.openapiGenerator.registerEndpoint(endpointNode);
            }

            // Register Fastify route (will queue if server not yet started)
            registerFastifyRoute(endpointNode);

            node.log(`Registered endpoint: ${endpointNode.method || 'GET'} ${endpointNode.path || '/'}`);
            updateStatus();
        };

        /**
         * Unregister an endpoint from this server
         * @param {Object} endpointNode - The api-endpoint node
         */
        node.unregisterEndpoint = function(endpointNode) {
            if (!endpointNode || !endpointNode.id) {
                return;
            }

            node.endpoints.delete(endpointNode.id);

            // Unregister from OpenAPI generator
            if (node.openapiGenerator) {
                node.openapiGenerator.unregisterEndpoint(endpointNode.id);
            }

            // Remove from registered routes tracking
            // Note: Fastify doesn't support removing routes at runtime, but we track
            // for conflict detection. Routes are effectively removed on server restart.
            const fullPath = getFullPath(endpointNode.path);
            const routeKey = `${endpointNode.method.toUpperCase()}:${fullPath}`;
            node.registeredRoutes.delete(routeKey);

            // Remove from pending endpoints if present
            const pendingIndex = node.pendingEndpoints.indexOf(endpointNode);
            if (pendingIndex !== -1) {
                node.pendingEndpoints.splice(pendingIndex, 1);
            }

            node.log(`Unregistered endpoint: ${endpointNode.method || 'GET'} ${endpointNode.path || '/'}`);
            updateStatus();
        };

        /**
         * Get the OpenAPI specification
         * @returns {Object} OpenAPI spec object
         */
        node.getOpenApiSpec = function() {
            if (!node.openapiGenerator) {
                return null;
            }
            return node.openapiGenerator.generate();
        };

        /**
         * Get the OpenAPI specification as JSON string
         * @returns {string} JSON string
         */
        node.getOpenApiJSON = function() {
            if (!node.openapiGenerator) {
                return '{}';
            }
            return node.openapiGenerator.toJSON();
        };

        /**
         * Get the OpenAPI specification as YAML string
         * @returns {string} YAML string
         */
        node.getOpenApiYAML = function() {
            if (!node.openapiGenerator) {
                return '';
            }
            return node.openapiGenerator.toYAML();
        };

        /**
         * Get registered endpoint count
         * @returns {number} Number of registered endpoints
         */
        node.getEndpointCount = function() {
            return node.endpoints.size;
        };

        /**
         * Get all registered endpoints info
         * @returns {Array} Array of endpoint info objects
         */
        node.getEndpointsInfo = function() {
            return Array.from(node.endpoints.values()).map(ep => {
                if (typeof ep.getEndpointInfo === 'function') {
                    return ep.getEndpointInfo();
                }
                return {
                    id: ep.id,
                    name: ep.name,
                    path: ep.path,
                    method: ep.method
                };
            });
        };

        /**
         * Get the metrics collector instance
         * @returns {MetricsCollector|null} Metrics collector or null if disabled
         */
        node.getMetricsCollector = function() {
            return node.metricsCollector;
        };

        /**
         * Update node status based on current state
         */
        function updateStatus() {
            const endpointCount = node.endpoints.size;
            if (node.serverStarted) {
                node.status({
                    fill: 'green',
                    shape: 'dot',
                    text: `${node.host}:${node.port} (${endpointCount} endpoints)`
                });
            } else {
                node.status({
                    fill: 'yellow',
                    shape: 'ring',
                    text: `${endpointCount} endpoints registered`
                });
            }
        }

        // Initialize OpenAPI generator
        initializeOpenApiGenerator();

        // Initialize Keycloak client for OAuth2 authentication
        initializeKeycloakClient();

        // Start server if we have fastify dependencies
        // Use setImmediate to allow endpoints to register first
        setImmediate(() => {
            startServer().catch(err => {
                node.error(`Server startup error: ${err.message}`);
            });
        });

        // Handle input messages (pass through for now)
        node.on("input", function(msg, send, done) {
            // Node-RED 1.0+ compatibility
            send = send || function() { node.send.apply(node, arguments); };

            try {
                // Add server info to message
                msg.server = {
                    host: node.host,
                    port: node.port,
                    endpointCount: node.endpoints.size,
                    openapiEnabled: node.openapiEnabled,
                    openapiPath: node.openapiPath,
                    swaggerUiEnabled: node.swaggerUiEnabled,
                    swaggerUiPath: node.swaggerUiPath,
                    metricsEnabled: node.metricsEnabled,
                    metricsPath: node.metricsPath
                };

                send(msg);
                if (done) {
                    done();
                }
            } catch (err) {
                if (done) {
                    done(err);
                } else {
                    node.error(err, msg);
                }
            }
        });

        node.on("close", async function(removed, done) {
            // Clear any pending restart timer
            if (node.restartTimer) {
                clearTimeout(node.restartTimer);
                node.restartTimer = null;
            }
            node.restartPending = false;

            // Stop the server (this also clears registered routes and Keycloak client)
            await stopServer();

            // Clear registered endpoints
            node.endpoints.clear();

            // Clear pending endpoints
            node.pendingEndpoints = [];

            // Clear OpenAPI generator
            if (node.openapiGenerator) {
                node.openapiGenerator.clearEndpoints();
                node.openapiGenerator = null;
            }

            if (done) {
                done();
            }
        });
    }

    RED.nodes.registerType("api-server", ApiServerNode);

    // HTTP Admin endpoint for OpenAPI import
    RED.httpAdmin.post('/api-gateway/import-openapi', RED.auth.needsPermission('flows.write'), function(req, res) {
        const parser = new OpenApiParser({ detectCrud: true });

        try {
            let content = req.body.content || '';

            // Handle both raw text and form data
            if (typeof content !== 'string') {
                content = JSON.stringify(content);
            }

            if (!content || content.trim() === '') {
                return res.status(400).json({
                    success: false,
                    error: 'No OpenAPI content provided'
                });
            }

            // Parse the OpenAPI spec
            const result = parser.parse(content);

            // Apply filters if provided
            let endpoints = result.endpoints;

            if (req.body.filters) {
                endpoints = parser.getFilteredEndpoints(req.body.filters);
            }

            // Return parsed result
            res.json({
                success: true,
                apiInfo: result.apiInfo,
                servers: result.servers,
                securitySchemes: result.securitySchemes,
                tags: result.tags,
                endpoints: endpoints,
                summary: {
                    ...result.summary,
                    filteredCount: endpoints.length
                }
            });

        } catch (err) {
            res.status(400).json({
                success: false,
                error: err.message
            });
        }
    });

    // HTTP Admin endpoint to get supported filters/tags from a parsed spec
    RED.httpAdmin.post('/api-gateway/preview-openapi', RED.auth.needsPermission('flows.read'), function(req, res) {
        const parser = new OpenApiParser({ detectCrud: true });

        try {
            let content = req.body.content || '';

            if (typeof content !== 'string') {
                content = JSON.stringify(content);
            }

            if (!content || content.trim() === '') {
                return res.status(400).json({
                    success: false,
                    error: 'No OpenAPI content provided'
                });
            }

            // Parse to get preview information
            const result = parser.parse(content);

            // Return preview with tags, methods, and summary for filtering UI
            res.json({
                success: true,
                apiInfo: result.apiInfo,
                tags: result.tags,
                summary: result.summary,
                // Include unique paths for partial import selection
                paths: [...new Set(result.endpoints.map(e => e._metadata?.originalPath || e.path))]
            });

        } catch (err) {
            res.status(400).json({
                success: false,
                error: err.message
            });
        }
    });
};
