"use strict";

/**
 * OpenAPI 3.1 Specification Generator
 *
 * Generates OpenAPI 3.1 specifications from registered API endpoints.
 * Collects endpoint metadata, schemas, and security requirements to
 * build a complete API specification.
 */

/**
 * Default OpenAPI info object
 */
const DEFAULT_INFO = {
    title: "API Gateway",
    description: "Node-RED powered API Gateway",
    version: "1.0.0"
};

// Schema-object containers that hold a nested schema (value is a schema).
const SCHEMA_VALUE_CONTAINERS = [
    "not",
    "if",
    "then",
    "else",
    "contains",
    "propertyNames",
    "unevaluatedItems",
    "unevaluatedProperties"
];

// Schema-object containers that hold an array of schemas.
const SCHEMA_ARRAY_CONTAINERS = ["allOf", "anyOf", "oneOf", "prefixItems"];

// Schema-object containers that hold a map of name -> schema.
const SCHEMA_MAP_CONTAINERS = ["properties", "patternProperties", "$defs", "dependentSchemas"];

/**
 * Normalize a JSON Schema for emission inside an OpenAPI 3.1 document.
 *
 * 3.1 references JSON Schema 2020-12 verbatim, so this is mostly an
 * identity transform. It only:
 *   - strips OpenAPI-only schema decorations Ajv 2020 doesn't evaluate
 *     (`discriminator`, `xml`); `externalDocs` and `deprecated` stay,
 *     they remain valid metadata on Schema Objects in 3.1.
 *   - defensively rewrites any stray `nullable: true` into the 2020-12
 *     `type: [..., "null"]` form so we never emit 3.0 syntax even if
 *     an imported schema slipped one through.
 *   - recurses through every 2020-12 schema container so the defensive
 *     rewrite reaches deeply-nested schemas.
 *
 * @param {Object} schema - JSON Schema object
 * @returns {Object} OpenAPI 3.1 compatible schema
 */
function jsonSchemaToOpenApi(schema) {
    if (!schema || typeof schema !== "object") {
        return schema;
    }
    if (Array.isArray(schema)) {
        return schema.map(jsonSchemaToOpenApi);
    }

    const result = { ...schema };

    // Drop OpenAPI-only decorations that aren't part of JSON Schema 2020-12.
    // Keep `externalDocs` and `deprecated` — both remain valid annotations
    // on Schema Objects in OAS 3.1.
    delete result.discriminator;
    delete result.xml;

    // Defensive: rewrite 3.0-style `nullable: true` into 2020-12 type-array.
    // Tests assert this never fires on normal generation; this is a runtime
    // safety net for schemas imported from 3.0 sources.
    if (result.nullable === true) {
        delete result.nullable;
        if (result.type !== undefined) {
            if (Array.isArray(result.type)) {
                if (!result.type.includes("null")) {
                    result.type = [...result.type, "null"];
                }
            } else {
                result.type = [result.type, "null"];
            }
        }
    } else if (result.nullable === false) {
        delete result.nullable;
    }

    // Defensive: rewrite 3.0-style boolean exclusives to 2020-12 numeric form.
    if (result.exclusiveMinimum === true && typeof result.minimum === "number") {
        result.exclusiveMinimum = result.minimum;
        delete result.minimum;
    } else if (result.exclusiveMinimum === false) {
        delete result.exclusiveMinimum;
    }
    if (result.exclusiveMaximum === true && typeof result.maximum === "number") {
        result.exclusiveMaximum = result.maximum;
        delete result.maximum;
    } else if (result.exclusiveMaximum === false) {
        delete result.exclusiveMaximum;
    }

    // Recurse through every 2020-12 schema container.
    for (const key of SCHEMA_MAP_CONTAINERS) {
        if (result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
            const out = {};
            for (const [k, v] of Object.entries(result[key])) {
                out[k] = jsonSchemaToOpenApi(v);
            }
            result[key] = out;
        }
    }
    for (const key of SCHEMA_ARRAY_CONTAINERS) {
        if (Array.isArray(result[key])) {
            result[key] = result[key].map(jsonSchemaToOpenApi);
        }
    }
    for (const key of SCHEMA_VALUE_CONTAINERS) {
        if (result[key] && typeof result[key] === "object") {
            result[key] = jsonSchemaToOpenApi(result[key]);
        }
    }

    // `items` is a single schema in 2020-12 (array-form is `prefixItems`).
    if (result.items && typeof result.items === "object") {
        if (Array.isArray(result.items)) {
            // Tolerate legacy array-form by mapping into prefixItems.
            result.prefixItems = (result.prefixItems || []).concat(result.items.map(jsonSchemaToOpenApi));
            delete result.items;
        } else {
            result.items = jsonSchemaToOpenApi(result.items);
        }
    }

    // `additionalProperties` may be a boolean OR a schema.
    if (result.additionalProperties && typeof result.additionalProperties === "object") {
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
        .replace(/^\//, "")           // Remove leading slash
        .replace(/\/:([^/]+)/g, "_$1") // Convert :param to _param
        .replace(/\//g, "_")          // Convert remaining slashes to underscores
        .replace(/-/g, "_");          // Convert hyphens to underscores

    const methodLower = method.toLowerCase();

    if (!normalizedPath) {
        return methodLower + "Root";
    }

    return methodLower + normalizedPath.charAt(0).toUpperCase() + normalizedPath.slice(1);
}

/**
 * Convert Express-style path parameters to OpenAPI format
 * @param {string} path - Path with :param style parameters
 * @returns {string} Path with {param} style parameters
 */
function convertPathToOpenApi(path) {
    return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "{$1}");
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
            in: "path",
            required: true,
            schema: { type: "string" }
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
            in: "query",
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
function buildRequestBody(bodySchema, contentType = "application/json") {
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
function buildResponses(responseSchemas, successStatusCode, contentType = "application/json") {
    const responses = {};

    // Add responses from schemas
    if (responseSchemas && typeof responseSchemas === "object") {
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
                    schema: { type: "object" }
                }
            }
        };
    }

    // Add common error responses if not defined
    if (!responses["400"]) {
        responses["400"] = {
            description: "Bad Request",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            type: { type: "string" },
                            title: { type: "string" },
                            status: { type: "integer" },
                            detail: { type: "string" }
                        }
                    }
                }
            }
        };
    }

    if (!responses["500"]) {
        responses["500"] = {
            description: "Internal Server Error",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            type: { type: "string" },
                            title: { type: "string" },
                            status: { type: "integer" },
                            detail: { type: "string" }
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
        "200": "Successful response",
        "201": "Resource created successfully",
        "204": "No content",
        "400": "Bad request",
        "401": "Unauthorized",
        "403": "Forbidden",
        "404": "Not found",
        "409": "Conflict",
        "422": "Unprocessable entity",
        "429": "Too many requests",
        "500": "Internal server error",
        "default": "Default response"
    };
    return descriptions[String(statusCode)] || `Response with status ${statusCode}`;
}

/**
 * Build security requirement from endpoint scopes
 * @param {Array<string>} requiredScopes - Required OAuth2 scopes
 * @param {string} scopeOperator - 'AND' or 'OR'
 * @returns {Array} OpenAPI security requirement array
 */
function buildSecurityRequirement(requiredScopes, _scopeOperator) {
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

    const baseUrl = config.keycloakUrl || "https://auth.example.com";
    const realm = config.keycloakRealm || "master";

    return {
        type: "oauth2",
        description: "OAuth2 authentication via Keycloak",
        flows: {
            clientCredentials: {
                tokenUrl: `${baseUrl}/realms/${realm}/protocol/openid-connect/token`,
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
                    scopes[scope] = `Access to ${scope.replace(/[:.]/g, " ")}`;
                }
            }
        }
    }

    return scopes;
}

/**
 * Build filter parameters for OpenAPI spec
 * @param {Array<string>} filterableFields - List of filterable field names
 * @param {boolean} includeOperators - Whether to include operator variants (default: true)
 * @returns {Array} OpenAPI parameter objects for filtering
 */
function buildFilterParameters(filterableFields, includeOperators = true) {
    if (!filterableFields || filterableFields.length === 0) {
        return [];
    }

    const params = [];
    const operators = ["eq", "ne", "gt", "gte", "lt", "lte", "like", "in"];
    const operatorDescriptions = {
        eq: "equals",
        ne: "not equals",
        gt: "greater than",
        gte: "greater than or equal",
        lt: "less than",
        lte: "less than or equal",
        like: "pattern match (use % as wildcard)",
        in: "in list (comma-separated values)"
    };

    for (const field of filterableFields) {
        // Basic equality filter
        params.push({
            name: `filter[${field}]`,
            in: "query",
            required: false,
            description: `Filter by ${field} (equality)`,
            schema: { type: "string" }
        });

        // Operator variants
        if (includeOperators) {
            for (const op of operators) {
                params.push({
                    name: `filter[${field}][${op}]`,
                    in: "query",
                    required: false,
                    description: `Filter by ${field} (${operatorDescriptions[op]})`,
                    schema: { type: "string" }
                });
            }
        }
    }

    return params;
}

/**
 * Build sort parameters for OpenAPI spec
 * @param {Array<string>} sortableFields - List of sortable field names
 * @param {string} defaultSortField - Default sort field
 * @param {string} defaultSortDirection - Default sort direction
 * @returns {Array} OpenAPI parameter objects for sorting
 */
function buildSortParameters(sortableFields, defaultSortField, defaultSortDirection) {
    if (!sortableFields || sortableFields.length === 0) {
        return [];
    }

    const enumValues = [];
    for (const field of sortableFields) {
        enumValues.push(field);      // ascending
        enumValues.push(`-${field}`); // descending
    }

    return [{
        name: "sort",
        in: "query",
        required: false,
        description: `Sort by field. Prefix with - for descending. Allowed: ${sortableFields.join(", ")}`,
        schema: {
            type: "string",
            enum: enumValues,
            default: defaultSortField ? (defaultSortDirection === "desc" ? `-${defaultSortField}` : defaultSortField) : undefined
        }
    }];
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
    const pathParts = endpointInfo.path.split("/").filter(p => p && !p.startsWith(":"));
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

    // Query parameters from schema
    if (endpointNode && endpointNode.querySchema) {
        parameters.push(...buildQueryParameters(endpointNode.querySchema));
    }

    // Filter parameters (if filtering is enabled)
    if (endpointInfo.filteringEnabled && endpointInfo.filterableFields && endpointInfo.filterableFields.length > 0) {
        parameters.push(...buildFilterParameters(endpointInfo.filterableFields));
    }

    // Sort parameters (if sorting is enabled)
    if (endpointInfo.sortingEnabled && endpointInfo.sortableFields && endpointInfo.sortableFields.length > 0) {
        parameters.push(...buildSortParameters(
            endpointInfo.sortableFields,
            endpointInfo.defaultSortField,
            endpointInfo.defaultSortDirection
        ));
    }

    if (parameters.length > 0) {
        operation.parameters = parameters;
    }

    // Request body (for POST, PUT, PATCH)
    const methodsWithBody = ["POST", "PUT", "PATCH"];
    if (methodsWithBody.includes(endpointInfo.method) && endpointNode && endpointNode.bodySchema) {
        operation.requestBody = buildRequestBody(endpointNode.bodySchema);
    }

    // Responses
    const responseSchemas = endpointNode ? endpointNode.responseSchemas : {};
    operation.responses = buildResponses(
        responseSchemas,
        endpointInfo.successStatusCode || 200,
        endpointInfo.responseContentType || "application/json"
    );

    // Security
    // Note: Check requiredScopes directly since hasRequiredScopes may not be set
    // if getEndpointInfo wasn't called (timing issue during registration)
    if (endpointInfo.requiredScopes && endpointInfo.requiredScopes.length > 0) {
        operation.security = buildSecurityRequirement(
            endpointInfo.requiredScopes,
            endpointInfo.scopeOperator
        );
    }

    // Add rate limiting info if enabled
    if (endpointInfo.rateLimitingEnabled) {
        operation["x-rate-limit"] = {
            requests: endpointInfo.rateLimitRequests,
            windowMs: endpointInfo.rateLimitWindowMs
        };
    }

    // Add caching info if enabled
    if (endpointInfo.cachingEnabled) {
        operation["x-cache"] = {
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
        this.basePath = options.basePath || "";
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

        const info = typeof endpointNode.getEndpointInfo === "function"
            ? endpointNode.getEndpointInfo()
            : endpointNode;

        this.endpoints.set(endpointNode.id, {
            info,
            node: endpointNode
        });

        // Collect tags
        const pathParts = info.path.split("/").filter(p => p && !p.startsWith(":"));
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
     * @returns {Object} OpenAPI 3.1 specification object
     */
    generate() {
        const spec = {
            openapi: "3.1.0",
            jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
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
                oauth2Scheme.flows.clientCredentials.scopes = scopes;
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
            const yaml = require("js-yaml");
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
    buildFilterParameters,
    buildSortParameters,
    buildRequestBody,
    buildResponses,
    buildSecurityRequirement,
    buildOAuth2SecurityScheme,
    collectScopes,
    buildOperation,
    getStatusDescription,
    DEFAULT_INFO
};
