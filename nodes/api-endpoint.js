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
    validateResponse,
    createParamSchema,
    parseSchema,
    parseResponseSchemas,
    ValidationResult
} = require('../lib/schema-validator');

/**
 * Parses a scopes configuration string into an array of scope strings
 * @param {string|Array} scopes - Comma-separated string or array of scopes
 * @returns {Array<string>} Array of scope strings
 */
function parseScopes(scopes) {
    if (!scopes) {
        return [];
    }
    if (Array.isArray(scopes)) {
        return scopes.map(s => String(s).trim()).filter(s => s.length > 0);
    }
    if (typeof scopes === 'string') {
        return scopes.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }
    return [];
}

/**
 * Checks if the provided token scopes satisfy the required scopes
 * @param {Array<string>} tokenScopes - Scopes from the token/user
 * @param {Array<string>} requiredScopes - Required scopes for the endpoint
 * @param {string} operator - 'AND' (all required) or 'OR' (any required)
 * @returns {{authorized: boolean, missingScopes: Array<string>}}
 */
function checkScopes(tokenScopes, requiredScopes, operator) {
    if (!requiredScopes || requiredScopes.length === 0) {
        return { authorized: true, missingScopes: [] };
    }

    const tokenScopeSet = new Set(tokenScopes || []);

    if (operator === 'OR') {
        // At least one of the required scopes must be present
        const hasAny = requiredScopes.some(scope => tokenScopeSet.has(scope));
        return {
            authorized: hasAny,
            missingScopes: hasAny ? [] : requiredScopes
        };
    } else {
        // All required scopes must be present (AND)
        const missingScopes = requiredScopes.filter(scope => !tokenScopeSet.has(scope));
        return {
            authorized: missingScopes.length === 0,
            missingScopes
        };
    }
}

/**
 * Valid CRUD operation types
 */
const CRUD_OPERATIONS = ['none', 'list', 'get', 'create', 'update', 'delete'];

/**
 * Maps CRUD operations to their typical HTTP methods
 */
const CRUD_METHOD_MAPPING = {
    'list': 'GET',
    'get': 'GET',
    'create': 'POST',
    'update': 'PUT',
    'delete': 'DELETE'
};

/**
 * Validates CRUD operation type
 * @param {string} operation - Operation type
 * @returns {string} Valid operation type or 'none'
 */
function validateCrudOperation(operation) {
    if (!operation || typeof operation !== 'string') {
        return 'none';
    }
    const normalized = operation.toLowerCase().trim();
    return CRUD_OPERATIONS.includes(normalized) ? normalized : 'none';
}

/**
 * Validates table name for SQL safety (basic validation)
 * @param {string} tableName - Table name to validate
 * @returns {{valid: boolean, error?: string}}
 */
function validateTableName(tableName) {
    if (!tableName || typeof tableName !== 'string') {
        return { valid: false, error: 'Table name is required' };
    }
    const trimmed = tableName.trim();
    if (trimmed.length === 0) {
        return { valid: false, error: 'Table name cannot be empty' };
    }
    // Allow alphanumeric, underscores, and dots (for schema.table notation)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(trimmed)) {
        return { valid: false, error: 'Invalid table name format' };
    }
    return { valid: true };
}

/**
 * Validates column name for SQL safety
 * @param {string} columnName - Column name to validate
 * @returns {{valid: boolean, error?: string}}
 */
function validateColumnName(columnName) {
    if (!columnName || typeof columnName !== 'string') {
        return { valid: false, error: 'Column name is required' };
    }
    const trimmed = columnName.trim();
    if (trimmed.length === 0) {
        return { valid: false, error: 'Column name cannot be empty' };
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
        return { valid: false, error: 'Invalid column name format' };
    }
    return { valid: true };
}

/**
 * Generates basic SQL for CRUD operations
 * @param {string} operation - CRUD operation type
 * @param {string} tableName - Database table name
 * @param {string} primaryKey - Primary key column name
 * @param {Object} options - Additional options (columns, etc.)
 * @returns {{sql: string, params: Array, paramPlaceholders: Object}}
 */
function generateCrudSql(operation, tableName, primaryKey, options = {}) {
    const result = {
        sql: '',
        operation: operation,
        tableName: tableName,
        primaryKey: primaryKey,
        paramMapping: {}
    };

    switch (operation) {
        case 'list':
            result.sql = `SELECT * FROM ${tableName}`;
            result.paramMapping = {};
            break;

        case 'get':
            result.sql = `SELECT * FROM ${tableName} WHERE ${primaryKey} = @${primaryKey}`;
            result.paramMapping = { [primaryKey]: `params.${primaryKey}` };
            break;

        case 'create':
            // Placeholder - actual columns come from request body
            result.sql = `INSERT INTO ${tableName} (@columns) VALUES (@values)`;
            result.paramMapping = { columns: 'body.*' };
            break;

        case 'update':
            // Placeholder - actual columns come from request body
            result.sql = `UPDATE ${tableName} SET @assignments WHERE ${primaryKey} = @${primaryKey}`;
            result.paramMapping = {
                [primaryKey]: `params.${primaryKey}`,
                assignments: 'body.*'
            };
            break;

        case 'delete':
            result.sql = `DELETE FROM ${tableName} WHERE ${primaryKey} = @${primaryKey}`;
            result.paramMapping = { [primaryKey]: `params.${primaryKey}` };
            break;

        default:
            result.sql = '';
            result.paramMapping = {};
    }

    return result;
}

/**
 * Returns a default description for an HTTP status code
 * @param {string|number} statusCode - HTTP status code
 * @returns {string} Default description
 */
function getDefaultStatusDescription(statusCode) {
    const descriptions = {
        '200': 'Successful response',
        '201': 'Resource created successfully',
        '204': 'No content',
        '400': 'Bad request',
        '401': 'Unauthorized',
        '403': 'Forbidden',
        '404': 'Not found',
        '409': 'Conflict',
        '422': 'Unprocessable entity',
        '500': 'Internal server error',
        'default': 'Default response'
    };
    return descriptions[String(statusCode)] || `Response for status ${statusCode}`;
}

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

        // Response schema configuration
        node.responseSchemas = {};  // Map of status code to schema
        node.successStatusCode = parseInt(config.successStatusCode, 10) || 200;
        node.responseContentType = config.responseContentType || 'application/json';
        node.validateResponseEnabled = config.validateResponseEnabled === true;  // Dev mode only

        // Authorization scope configuration
        node.requiredScopes = parseScopes(config.requiredScopes);
        node.scopeOperator = config.scopeOperator === 'OR' ? 'OR' : 'AND';  // Default to AND (requires all scopes)

        // CRUD operation mapping configuration
        node.crudOperation = validateCrudOperation(config.crudOperation);
        node.tableName = (config.tableName || '').trim();
        node.primaryKey = (config.primaryKey || 'id').trim();
        node.autoGenerateSql = config.autoGenerateSql === true;
        node.useFlowOutput = config.useFlowOutput !== false;  // Default to true (delegate to flow)

        // Validate CRUD configuration if operation is set
        if (node.crudOperation !== 'none') {
            if (node.autoGenerateSql) {
                const tableValidation = validateTableName(node.tableName);
                if (!tableValidation.valid) {
                    node.warn(`Invalid table name: ${tableValidation.error}`);
                }
                const pkValidation = validateColumnName(node.primaryKey);
                if (!pkValidation.valid) {
                    node.warn(`Invalid primary key: ${pkValidation.error}`);
                }
            }
        }

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

        // Parse response schemas (always parse, regardless of validation enabled)
        if (config.responseSchemas) {
            const parsed = parseResponseSchemas(config.responseSchemas);
            if (parsed.error) {
                node.warn(`Invalid response schemas: ${parsed.error}`);
            } else {
                node.responseSchemas = parsed.schemas;
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

        // Method to validate response data (for dev mode debugging)
        node.validateResponseData = function(statusCode, data) {
            const schema = node.responseSchemas[statusCode] || node.responseSchemas['default'];
            if (!schema) {
                // No schema defined for this status code
                return ValidationResult.success(data);
            }
            return validateResponse(data, schema);
        };

        // Method to get response schema for a status code
        node.getResponseSchema = function(statusCode) {
            return node.responseSchemas[statusCode] || node.responseSchemas['default'] || null;
        };

        // Method to check authorization based on scopes
        node.checkAuthorization = function(tokenScopes) {
            return checkScopes(tokenScopes, node.requiredScopes, node.scopeOperator);
        };

        // Method to get CRUD SQL template (if auto-generate is enabled)
        node.getCrudSql = function() {
            if (node.crudOperation === 'none' || !node.autoGenerateSql) {
                return null;
            }
            return generateCrudSql(node.crudOperation, node.tableName, node.primaryKey);
        };

        // Method to get CRUD operation info
        node.getCrudInfo = function() {
            return {
                operation: node.crudOperation,
                tableName: node.tableName,
                primaryKey: node.primaryKey,
                autoGenerateSql: node.autoGenerateSql,
                useFlowOutput: node.useFlowOutput,
                hasCrudOperation: node.crudOperation !== 'none'
            };
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
                hasParamsSchema: !!node.paramsSchema,
                // Response configuration
                successStatusCode: node.successStatusCode,
                responseContentType: node.responseContentType,
                hasResponseSchemas: Object.keys(node.responseSchemas).length > 0,
                responseStatusCodes: Object.keys(node.responseSchemas),
                // Authorization configuration
                requiredScopes: node.requiredScopes,
                scopeOperator: node.scopeOperator,
                hasRequiredScopes: node.requiredScopes.length > 0,
                // CRUD configuration
                crudOperation: node.crudOperation,
                tableName: node.tableName,
                primaryKey: node.primaryKey,
                autoGenerateSql: node.autoGenerateSql,
                useFlowOutput: node.useFlowOutput,
                hasCrudOperation: node.crudOperation !== 'none'
            };
        };

        // Method to get OpenAPI response definitions
        node.getOpenApiResponses = function() {
            const responses = {};

            for (const [statusCode, schema] of Object.entries(node.responseSchemas)) {
                responses[statusCode] = {
                    description: schema.description || getDefaultStatusDescription(statusCode),
                    content: {
                        [node.responseContentType]: {
                            schema: schema
                        }
                    }
                };
            }

            // Ensure at least the success status code is defined
            if (!responses[node.successStatusCode]) {
                responses[node.successStatusCode] = {
                    description: getDefaultStatusDescription(node.successStatusCode),
                    content: {
                        [node.responseContentType]: {
                            schema: { type: 'object' }
                        }
                    }
                };
            }

            return responses;
        };

        // Method to get OpenAPI security definitions for this endpoint
        node.getOpenApiSecurity = function() {
            if (node.requiredScopes.length === 0) {
                return [];
            }
            // Return OAuth2 security requirement with required scopes
            return [{
                oauth2: node.requiredScopes
            }];
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
                    validationEnabled: node.validationEnabled,
                    // Response configuration for downstream handling
                    successStatusCode: node.successStatusCode,
                    responseContentType: node.responseContentType,
                    validateResponseEnabled: node.validateResponseEnabled,
                    // Authorization configuration
                    requiredScopes: node.requiredScopes,
                    scopeOperator: node.scopeOperator,
                    // CRUD operation configuration
                    crudOperation: node.crudOperation,
                    tableName: node.tableName,
                    primaryKey: node.primaryKey,
                    autoGenerateSql: node.autoGenerateSql,
                    useFlowOutput: node.useFlowOutput
                };

                // Add CRUD context if operation is configured
                if (node.crudOperation !== 'none') {
                    msg.crud = {
                        operation: node.crudOperation,
                        tableName: node.tableName,
                        primaryKey: node.primaryKey
                    };

                    // Add auto-generated SQL if enabled
                    if (node.autoGenerateSql && node.tableName) {
                        msg.crud.sql = node.getCrudSql();
                    }
                }

                // If request path is provided, extract parameters
                if (msg.req && msg.req.path) {
                    const extraction = node.extractRequestParams(msg.req.path);
                    if (extraction.match) {
                        msg.req.params = extraction.params;
                    }
                }

                // Perform authorization check if scopes are required
                if (node.requiredScopes.length > 0 && msg.req) {
                    // Get token scopes from auth context (populated by upstream auth middleware)
                    const tokenScopes = (msg.req.auth && msg.req.auth.scopes) || [];
                    const isAuthenticated = msg.req.auth && msg.req.auth.authenticated;

                    // Check if user is authenticated (401) vs lacks scopes (403)
                    if (!isAuthenticated) {
                        const authError = {
                            statusCode: 401,
                            error: 'Unauthorized',
                            message: 'Authentication required',
                            details: {
                                requiredScopes: node.requiredScopes,
                                scopeOperator: node.scopeOperator
                            }
                        };
                        msg.authorizationError = authError;

                        if (msg.res && typeof msg.res.status === 'function') {
                            msg.res.status(401).json(authError);
                            if (done) {
                                done();
                            }
                            return;
                        }

                        msg.payload = authError;
                        send(msg);
                        if (done) {
                            done();
                        }
                        return;
                    }

                    const authResult = node.checkAuthorization(tokenScopes);
                    if (!authResult.authorized) {
                        const authError = {
                            statusCode: 403,
                            error: 'Forbidden',
                            message: node.scopeOperator === 'AND'
                                ? 'Missing required scopes'
                                : 'None of the required scopes present',
                            details: {
                                requiredScopes: node.requiredScopes,
                                scopeOperator: node.scopeOperator,
                                missingScopes: authResult.missingScopes,
                                providedScopes: tokenScopes
                            }
                        };
                        msg.authorizationError = authError;

                        if (msg.res && typeof msg.res.status === 'function') {
                            msg.res.status(403).json(authError);
                            if (done) {
                                done();
                            }
                            return;
                        }

                        msg.payload = authError;
                        send(msg);
                        if (done) {
                            done();
                        }
                        return;
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
