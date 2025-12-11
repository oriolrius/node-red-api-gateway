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
                    ignoreTrailingSlash: true,
                    requestIdHeader: 'x-request-id',
                    genReqId: (req) => {
                        // Use existing request ID or generate new one
                        return req.headers['x-request-id'] || generateRequestId();
                    }
                };

                // Configure logger for Fastify
                // Fastify accepts either a boolean, a Pino instance, or Pino options
                // We pass our Pino logger directly for native integration
                if (logger && !logger._isFallback && !logger._isNoop) {
                    // Pass the Pino logger instance directly
                    fastifyOptions.logger = logger;
                } else {
                    fastifyOptions.logger = false;
                }

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
                        const swaggerUi = require('@fastify/swagger-ui');
                        await node.fastify.register(swaggerUi, {
                            routePrefix: node.swaggerUiPath,
                            uiConfig: {
                                docExpansion: 'list',
                                deepLinking: true,
                                displayRequestDuration: true,
                                filter: true
                            },
                            staticCSP: true,
                            transformSpecificationClone: true
                        });
                    } catch (err) {
                        node.warn('Swagger UI not available. Install with: npm install @fastify/swagger-ui');
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

                // Start the server
                await node.fastify.listen({ port: node.port, host: node.host });
                node.serverStarted = true;
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
                    node.log('API Server stopped');
                } catch (err) {
                    node.error(`Error stopping server: ${err.message}`);
                }
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
            // Stop the server
            await stopServer();

            // Clear registered endpoints
            node.endpoints.clear();

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
