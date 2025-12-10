'use strict';

/**
 * OpenAPI 3.0 Specification Generator
 *
 * Generates OpenAPI 3.0 specifications from registered API endpoints.
 * Collects endpoint metadata, schemas, and security requirements to
 * build a complete API specification.
 */

/**
 * Default OpenAPI info object
 */
const DEFAULT_INFO = {
    title: 'API Gateway',
    description: 'Node-RED powered API Gateway',
    version: '1.0.0'
};

/**
 * Convert JSON Schema to OpenAPI 3.0 compatible schema
 * Removes/transforms properties not supported in OpenAPI 3.0
 * @param {Object} schema - JSON Schema object
 * @returns {Object} OpenAPI 3.0 compatible schema
 */
function jsonSchemaToOpenApi(schema) {
    if (!schema || typeof schema !== 'object') {
        return schema;
    }

    // Create a shallow copy to avoid mutating original
    const result = { ...schema };

    // Remove $id as it's not used in OpenAPI inline schemas
    delete result.$id;

    // Convert JSON Schema draft-07 keywords to OpenAPI 3.0
    // OpenAPI 3.0 uses a subset of JSON Schema draft-05

    // Handle nested properties
    if (result.properties && typeof result.properties === 'object') {
        result.properties = {};
        for (const [key, value] of Object.entries(schema.properties)) {
            result.properties[key] = jsonSchemaToOpenApi(value);
        }
    }

    // Handle array items
    if (result.items) {
        if (Array.isArray(result.items)) {
            result.items = result.items.map(jsonSchemaToOpenApi);
        } else {
            result.items = jsonSchemaToOpenApi(result.items);
        }
    }

    // Handle allOf, anyOf, oneOf
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
        if (Array.isArray(result[keyword])) {
            result[keyword] = result[keyword].map(jsonSchemaToOpenApi);
        }
    }

    // Handle additionalProperties
    if (result.additionalProperties && typeof result.additionalProperties === 'object') {
        result.additionalProperties = jsonSchemaToOpenApi(result.additionalProperties);
    }

    return result;
}

/**
 * Generate a unique operation ID from method and path
 * @param {string} method - HTTP method
 * @param {string} path - Endpoint path
 * @returns {string} Operation ID
 */
function generateOperationId(method, path) {
    // Convert path to camelCase operation ID
    // e.g., GET /users/:id -> getUsers_id
    const normalizedPath = path
        .replace(/^\//, '')           // Remove leading slash
        .replace(/\/:([^/]+)/g, '_$1') // Convert :param to _param
        .replace(/\//g, '_')          // Convert remaining slashes to underscores
        .replace(/-/g, '_');          // Convert hyphens to underscores

    const methodLower = method.toLowerCase();

    if (!normalizedPath) {
        return methodLower + 'Root';
    }

    return methodLower + normalizedPath.charAt(0).toUpperCase() + normalizedPath.slice(1);
}

/**
 * Convert Express-style path parameters to OpenAPI format
 * @param {string} path - Path with :param style parameters
 * @returns {string} Path with {param} style parameters
 */
function convertPathToOpenApi(path) {
    return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

/**
 * Build path parameters schema from param names
 * @param {Array<string>} paramNames - Array of parameter names
 * @param {Object} paramsSchema - Optional params schema from endpoint
 * @returns {Array} OpenAPI parameter objects
 */
function buildPathParameters(paramNames, paramsSchema) {
    if (!paramNames || paramNames.length === 0) {
        return [];
    }

    return paramNames.map(name => {
        const param = {
            name,
            in: 'path',
            required: true,
            schema: { type: 'string' }
        };

        // If we have a params schema, try to get the specific property schema
        if (paramsSchema && paramsSchema.properties && paramsSchema.properties[name]) {
            const propSchema = paramsSchema.properties[name];
            param.schema = jsonSchemaToOpenApi(propSchema);
            if (propSchema.description) {
                param.description = propSchema.description;
            }
        }

        return param;
    });
}

/**
 * Build query parameters from query schema
 * @param {Object} querySchema - JSON Schema for query parameters
 * @returns {Array} OpenAPI parameter objects
 */
function buildQueryParameters(querySchema) {
    if (!querySchema || !querySchema.properties) {
        return [];
    }

    const params = [];
    const required = querySchema.required || [];

    for (const [name, propSchema] of Object.entries(querySchema.properties)) {
        const param = {
            name,
            in: 'query',
            required: required.includes(name),
            schema: jsonSchemaToOpenApi(propSchema)
        };

        if (propSchema.description) {
            param.description = propSchema.description;
        }

        params.push(param);
    }

    return params;
}

/**
 * Build request body object from body schema
 * @param {Object} bodySchema - JSON Schema for request body
 * @param {string} contentType - Content type (default: application/json)
 * @returns {Object|null} OpenAPI request body object or null
 */
function buildRequestBody(bodySchema, contentType = 'application/json') {
    if (!bodySchema) {
        return null;
    }

    return {
        required: true,
        content: {
            [contentType]: {
                schema: jsonSchemaToOpenApi(bodySchema)
            }
        }
    };
}

/**
 * Build response objects from response schemas
 * @param {Object} responseSchemas - Map of status code to schema
 * @param {number} successStatusCode - Success status code
 * @param {string} contentType - Response content type
 * @returns {Object} OpenAPI responses object
 */
function buildResponses(responseSchemas, successStatusCode, contentType = 'application/json') {
    const responses = {};

    // Add responses from schemas
    if (responseSchemas && typeof responseSchemas === 'object') {
        for (const [statusCode, schema] of Object.entries(responseSchemas)) {
            responses[statusCode] = {
                description: schema.description || getStatusDescription(statusCode),
                content: {
                    [contentType]: {
                        schema: jsonSchemaToOpenApi(schema)
                    }
                }
            };
        }
    }

    // Ensure success status code has a response
    if (!responses[successStatusCode]) {
        responses[successStatusCode] = {
            description: getStatusDescription(successStatusCode),
            content: {
                [contentType]: {
                    schema: { type: 'object' }
                }
            }
        };
    }

    // Add common error responses if not defined
    if (!responses['400']) {
        responses['400'] = {
            description: 'Bad Request',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            type: { type: 'string' },
                            title: { type: 'string' },
                            status: { type: 'integer' },
                            detail: { type: 'string' }
                        }
                    }
                }
            }
        };
    }

    if (!responses['500']) {
        responses['500'] = {
            description: 'Internal Server Error',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            type: { type: 'string' },
                            title: { type: 'string' },
                            status: { type: 'integer' },
                            detail: { type: 'string' }
                        }
                    }
                }
            }
        };
    }

    return responses;
}

/**
 * Get default status description
 * @param {string|number} statusCode - HTTP status code
 * @returns {string} Description
 */
function getStatusDescription(statusCode) {
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
        '429': 'Too many requests',
        '500': 'Internal server error',
        'default': 'Default response'
    };
    return descriptions[String(statusCode)] || `Response with status ${statusCode}`;
}

/**
 * Build security requirement from endpoint scopes
 * @param {Array<string>} requiredScopes - Required OAuth2 scopes
 * @param {string} scopeOperator - 'AND' or 'OR'
 * @returns {Array} OpenAPI security requirement array
 */
function buildSecurityRequirement(requiredScopes, scopeOperator) {
    if (!requiredScopes || requiredScopes.length === 0) {
        return [];
    }

    // For OpenAPI, we use oauth2 security scheme
    // The scopes are listed in the requirement
    return [{
        oauth2: requiredScopes
    }];
}

/**
 * Build OAuth2 security scheme from Keycloak config
 * @param {Object} config - Configuration node settings
 * @returns {Object} OAuth2 security scheme
 */
function buildOAuth2SecurityScheme(config) {
    if (!config || !config.oauth2Enabled) {
        return null;
    }

    const baseUrl = config.keycloakUrl || 'https://auth.example.com';
    const realm = config.keycloakRealm || 'master';

    return {
        type: 'oauth2',
        description: 'OAuth2 authentication via Keycloak',
        flows: {
            authorizationCode: {
                authorizationUrl: `${baseUrl}/realms/${realm}/protocol/openid-connect/auth`,
                tokenUrl: `${baseUrl}/realms/${realm}/protocol/openid-connect/token`,
                refreshUrl: `${baseUrl}/realms/${realm}/protocol/openid-connect/token`,
                scopes: {}  // Will be populated from endpoints
            }
        }
    };
}

/**
 * Collect all unique scopes from endpoints
 * @param {Array<Object>} endpoints - Array of endpoint info objects
 * @returns {Object} Map of scope name to description
 */
function collectScopes(endpoints) {
    const scopes = {};

    for (const endpoint of endpoints) {
        if (endpoint.requiredScopes && Array.isArray(endpoint.requiredScopes)) {
            for (const scope of endpoint.requiredScopes) {
                if (!scopes[scope]) {
                    scopes[scope] = `Access to ${scope.replace(/[:.]/g, ' ')}`;
                }
            }
        }
    }

    return scopes;
}

/**
 * Build operation object for an endpoint
 * @param {Object} endpointInfo - Endpoint information from getEndpointInfo()
 * @param {Object} endpointNode - The actual endpoint node (for accessing schemas)
 * @returns {Object} OpenAPI operation object
 */
function buildOperation(endpointInfo, endpointNode) {
    const operation = {
        operationId: generateOperationId(endpointInfo.method, endpointInfo.path),
        summary: endpointInfo.name || `${endpointInfo.method} ${endpointInfo.path}`,
        responses: {}
    };

    // Add tags based on path
    const pathParts = endpointInfo.path.split('/').filter(p => p && !p.startsWith(':'));
    if (pathParts.length > 0) {
        operation.tags = [pathParts[0]];
    }

    // Build parameters
    const parameters = [];

    // Path parameters
    if (endpointInfo.paramNames && endpointInfo.paramNames.length > 0) {
        const paramsSchema = endpointNode && endpointNode.paramsSchema;
        parameters.push(...buildPathParameters(endpointInfo.paramNames, paramsSchema));
    }

    // Query parameters
    if (endpointNode && endpointNode.querySchema) {
        parameters.push(...buildQueryParameters(endpointNode.querySchema));
    }

    if (parameters.length > 0) {
        operation.parameters = parameters;
    }

    // Request body (for POST, PUT, PATCH)
    const methodsWithBody = ['POST', 'PUT', 'PATCH'];
    if (methodsWithBody.includes(endpointInfo.method) && endpointNode && endpointNode.bodySchema) {
        operation.requestBody = buildRequestBody(endpointNode.bodySchema);
    }

    // Responses
    const responseSchemas = endpointNode ? endpointNode.responseSchemas : {};
    operation.responses = buildResponses(
        responseSchemas,
        endpointInfo.successStatusCode || 200,
        endpointInfo.responseContentType || 'application/json'
    );

    // Security
    if (endpointInfo.hasRequiredScopes && endpointInfo.requiredScopes.length > 0) {
        operation.security = buildSecurityRequirement(
            endpointInfo.requiredScopes,
            endpointInfo.scopeOperator
        );
    }

    // Add rate limiting info if enabled
    if (endpointInfo.rateLimitingEnabled) {
        operation['x-rate-limit'] = {
            requests: endpointInfo.rateLimitRequests,
            windowMs: endpointInfo.rateLimitWindowMs
        };
    }

    // Add caching info if enabled
    if (endpointInfo.cachingEnabled) {
        operation['x-cache'] = {
            ttl: endpointInfo.cacheTTL,
            private: endpointInfo.cachePrivate
        };
    }

    return operation;
}

/**
 * OpenAPI Specification Generator
 */
class OpenApiGenerator {
    /**
     * Create a new OpenAPI generator
     * @param {Object} options - Generator options
     * @param {Object} options.info - OpenAPI info object
     * @param {Array<Object>} options.servers - Server objects
     * @param {string} options.basePath - Base path for all endpoints
     * @param {Object} options.config - API config node for security settings
     */
    constructor(options = {}) {
        this.info = { ...DEFAULT_INFO, ...options.info };
        this.servers = options.servers || [];
        this.basePath = options.basePath || '';
        this.config = options.config || null;
        this.endpoints = new Map();
        this.tags = new Set();
    }

    /**
     * Register an endpoint for OpenAPI spec generation
     * @param {Object} endpointNode - The api-endpoint node
     */
    registerEndpoint(endpointNode) {
        if (!endpointNode || !endpointNode.id) {
            return;
        }

        const info = typeof endpointNode.getEndpointInfo === 'function'
            ? endpointNode.getEndpointInfo()
            : endpointNode;

        this.endpoints.set(endpointNode.id, {
            info,
            node: endpointNode
        });

        // Collect tags
        const pathParts = info.path.split('/').filter(p => p && !p.startsWith(':'));
        if (pathParts.length > 0) {
            this.tags.add(pathParts[0]);
        }
    }

    /**
     * Unregister an endpoint
     * @param {string} endpointId - Endpoint node ID
     */
    unregisterEndpoint(endpointId) {
        this.endpoints.delete(endpointId);
    }

    /**
     * Clear all registered endpoints
     */
    clearEndpoints() {
        this.endpoints.clear();
        this.tags.clear();
    }

    /**
     * Update generator configuration
     * @param {Object} options - New options
     */
    updateConfig(options) {
        if (options.info) {
            this.info = { ...this.info, ...options.info };
        }
        if (options.servers !== undefined) {
            this.servers = options.servers;
        }
        if (options.basePath !== undefined) {
            this.basePath = options.basePath;
        }
        if (options.config !== undefined) {
            this.config = options.config;
        }
    }

    /**
     * Generate the OpenAPI specification
     * @returns {Object} OpenAPI 3.0 specification object
     */
    generate() {
        const spec = {
            openapi: '3.0.3',
            info: this.info,
            paths: {},
            components: {
                schemas: {},
                securitySchemes: {}
            }
        };

        // Add servers
        if (this.servers.length > 0) {
            spec.servers = this.servers;
        }

        // Build security schemes from config
        if (this.config && this.config.oauth2Enabled) {
            const oauth2Scheme = buildOAuth2SecurityScheme(this.config);
            if (oauth2Scheme) {
                // Collect scopes from all endpoints
                const endpointInfos = Array.from(this.endpoints.values()).map(e => e.info);
                const scopes = collectScopes(endpointInfos);
                oauth2Scheme.flows.authorizationCode.scopes = scopes;
                spec.components.securitySchemes.oauth2 = oauth2Scheme;
            }
        }

        // Build paths from endpoints
        for (const { info, node } of this.endpoints.values()) {
            const openApiPath = this.basePath + convertPathToOpenApi(info.path);
            const method = info.method.toLowerCase();

            // Initialize path object if needed
            if (!spec.paths[openApiPath]) {
                spec.paths[openApiPath] = {};
            }

            // Build operation
            spec.paths[openApiPath][method] = buildOperation(info, node);
        }

        // Add tags
        if (this.tags.size > 0) {
            spec.tags = Array.from(this.tags).map(name => ({
                name,
                description: `Operations for ${name}`
            }));
        }

        // Clean up empty components
        if (Object.keys(spec.components.schemas).length === 0) {
            delete spec.components.schemas;
        }
        if (Object.keys(spec.components.securitySchemes).length === 0) {
            delete spec.components.securitySchemes;
        }
        if (Object.keys(spec.components).length === 0) {
            delete spec.components;
        }

        return spec;
    }

    /**
     * Generate OpenAPI spec as JSON string
     * @param {number} indent - Indentation level (default: 2)
     * @returns {string} JSON string
     */
    toJSON(indent = 2) {
        return JSON.stringify(this.generate(), null, indent);
    }

    /**
     * Generate OpenAPI spec as YAML string
     * Note: Requires js-yaml to be installed
     * @returns {string} YAML string
     */
    toYAML() {
        try {
            const yaml = require('js-yaml');
            return yaml.dump(this.generate(), {
                indent: 2,
                lineWidth: -1,
                noRefs: true
            });
        } catch (err) {
            // Fallback to JSON if js-yaml is not available
            return this.toJSON(2);
        }
    }

    /**
     * Get the number of registered endpoints
     * @returns {number} Endpoint count
     */
    getEndpointCount() {
        return this.endpoints.size;
    }

    /**
     * Get all registered endpoint IDs
     * @returns {Array<string>} Array of endpoint IDs
     */
    getEndpointIds() {
        return Array.from(this.endpoints.keys());
    }
}

module.exports = {
    OpenApiGenerator,
    jsonSchemaToOpenApi,
    generateOperationId,
    convertPathToOpenApi,
    buildPathParameters,
    buildQueryParameters,
    buildRequestBody,
    buildResponses,
    buildSecurityRequirement,
    buildOAuth2SecurityScheme,
    collectScopes,
    buildOperation,
    getStatusDescription,
    DEFAULT_INFO
};
