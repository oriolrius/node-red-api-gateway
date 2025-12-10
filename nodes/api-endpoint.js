const {
    HTTP_METHODS,
    isValidMethod,
    normalizeMethod,
    validatePath,
    extractParamNames,
    extractParams,
    normalizePath
} = require('../lib/path-utils');

const {
    SchemaValidator,
    validateBody,
    validateQuery,
    validateParams,
    createParamSchema,
    parseSchema,
    ValidationResult
} = require('../lib/schema-validator');

module.exports = function(RED) {
    function ApiEndpointNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Store configuration
        node.name = config.name;
        node.path = normalizePath(config.path || '/');
        node.method = normalizeMethod(config.method || 'GET');

        // Schema validation configuration
        node.validationEnabled = config.validationEnabled !== false;
        node.bodySchema = null;
        node.querySchema = null;
        node.paramsSchema = null;

        // Parse and compile schemas if validation is enabled
        if (node.validationEnabled) {
            // Body schema
            if (config.bodySchema) {
                const parsed = parseSchema(config.bodySchema);
                if (parsed.error) {
                    node.warn(`Invalid body schema: ${parsed.error}`);
                } else {
                    node.bodySchema = parsed.schema;
                }
            }

            // Query schema
            if (config.querySchema) {
                const parsed = parseSchema(config.querySchema);
                if (parsed.error) {
                    node.warn(`Invalid query schema: ${parsed.error}`);
                } else {
                    node.querySchema = parsed.schema;
                }
            }

            // Path params schema (can be JSON or simple type mapping)
            if (config.paramsSchema) {
                const parsed = parseSchema(config.paramsSchema);
                if (parsed.error) {
                    node.warn(`Invalid params schema: ${parsed.error}`);
                } else {
                    node.paramsSchema = parsed.schema;
                }
            }
        }

        // Get reference to api-server config node
        node.server = config.server;
        node.serverNode = null;

        if (node.server) {
            node.serverNode = RED.nodes.getNode(node.server);
            if (node.serverNode) {
                // Register this endpoint with the server
                if (typeof node.serverNode.registerEndpoint === 'function') {
                    node.serverNode.registerEndpoint(node);
                }
            } else {
                node.warn('API Server configuration not found');
            }
        }

        // Validate path configuration
        const pathValidation = validatePath(node.path);
        if (!pathValidation.valid) {
            node.warn(`Invalid path configuration: ${pathValidation.error}`);
        }

        // Extract parameter names for use in request handling
        node.paramNames = extractParamNames(node.path);

        // Method to extract params from a request path
        node.extractRequestParams = function(requestPath) {
            return extractParams(node.path, requestPath);
        };

        // Method to validate request data
        node.validateRequest = function(req) {
            const errors = [];

            // Validate body if schema defined
            if (node.bodySchema && req.body !== undefined) {
                const result = validateBody(req.body, node.bodySchema);
                if (!result.valid) {
                    errors.push(...result.errors.map(e => ({
                        ...e,
                        location: 'body'
                    })));
                }
            }

            // Validate query params if schema defined
            if (node.querySchema && req.query) {
                const result = validateQuery(req.query, node.querySchema);
                if (!result.valid) {
                    errors.push(...result.errors.map(e => ({
                        ...e,
                        location: 'query'
                    })));
                }
            }

            // Validate path params if schema defined
            if (node.paramsSchema && req.params) {
                const result = validateParams(req.params, node.paramsSchema);
                if (!result.valid) {
                    errors.push(...result.errors.map(e => ({
                        ...e,
                        location: 'params'
                    })));
                }
            }

            if (errors.length > 0) {
                return ValidationResult.failure(errors);
            }

            return ValidationResult.success(req);
        };

        // Method to get endpoint info (used by api-server for route registration)
        node.getEndpointInfo = function() {
            return {
                id: node.id,
                name: node.name,
                path: node.path,
                method: node.method,
                paramNames: node.paramNames,
                validationEnabled: node.validationEnabled,
                hasBodySchema: !!node.bodySchema,
                hasQuerySchema: !!node.querySchema,
                hasParamsSchema: !!node.paramsSchema
            };
        };

        node.on("input", function(msg, send, done) {
            // Node-RED 1.0+ compatibility
            send = send || function() { node.send.apply(node, arguments); };

            try {
                // Add endpoint metadata to message
                msg.endpoint = {
                    path: node.path,
                    method: node.method,
                    paramNames: node.paramNames,
                    validationEnabled: node.validationEnabled
                };

                // If request path is provided, extract parameters
                if (msg.req && msg.req.path) {
                    const extraction = node.extractRequestParams(msg.req.path);
                    if (extraction.match) {
                        msg.req.params = extraction.params;
                    }
                }

                // Perform validation if enabled and request data is present
                if (node.validationEnabled && msg.req) {
                    const validationResult = node.validateRequest(msg.req);

                    if (!validationResult.valid) {
                        // Add validation error to message
                        msg.validationError = validationResult.toHttpError();

                        // Send error response if res object is available
                        if (msg.res && typeof msg.res.status === 'function') {
                            const errorResponse = msg.validationError;
                            msg.res.status(errorResponse.statusCode).json(errorResponse);
                            if (done) {
                                done();
                            }
                            return;
                        }

                        // Otherwise, still send the message with error info
                        // Let downstream nodes handle the error
                        msg.payload = msg.validationError;
                    }
                }

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

        node.on("close", function(removed, done) {
            // Unregister from server if connected
            if (node.serverNode && typeof node.serverNode.unregisterEndpoint === 'function') {
                node.serverNode.unregisterEndpoint(node);
            }

            if (done) {
                done();
            }
        });
    }

    RED.nodes.registerType("api-endpoint", ApiEndpointNode);
};
