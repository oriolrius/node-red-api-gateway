"use strict";

/**
 * OpenAPI 3.1 Specification Parser
 *
 * Parses OpenAPI 3.1 specifications and generates Node-RED API endpoint
 * configurations. Supports importing from YAML/JSON files. Only OpenAPI
 * 3.1.x is accepted — earlier 3.0.x specs must be migrated upstream.
 */

/**
 * Convert OpenAPI path parameters to Express-style
 * @param {string} path - Path with {param} style parameters
 * @returns {string} Path with :param style parameters
 */
function convertPathToExpress(path) {
    return path.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, ":$1");
}

/**
 * Extract parameter names from an Express-style path
 * @param {string} path - Express-style path with :param parameters
 * @returns {Array<string>} Array of parameter names
 */
function extractParamNames(path) {
    const params = [];
    const regex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let match;
    while ((match = regex.exec(path)) !== null) {
        params.push(match[1]);
    }
    return params;
}

// Schema containers that hold a single nested schema.
const PARSER_SCHEMA_VALUE_CONTAINERS = [
    "not",
    "if",
    "then",
    "else",
    "contains",
    "propertyNames",
    "unevaluatedItems",
    "unevaluatedProperties"
];
// Schema containers that hold an array of schemas.
const PARSER_SCHEMA_ARRAY_CONTAINERS = ["allOf", "anyOf", "oneOf", "prefixItems"];
// Schema containers that hold a map of name -> schema.
const PARSER_SCHEMA_MAP_CONTAINERS = ["properties", "patternProperties", "$defs", "dependentSchemas"];

/**
 * Convert an OpenAPI 3.1 Schema Object into something Ajv 2020-12 can
 * compile directly. Drops OpenAPI-only schema decorations (`discriminator`,
 * `xml`) but keeps JSON-Schema-valid metadata (`deprecated`,
 * `externalDocs`, `examples`, `const`, etc.). Resolves Schema-Object
 * `$ref`s inline; non-resolvable refs become a permissive object schema.
 *
 * @param {Object} schema - OpenAPI 3.1 Schema Object
 * @param {Object} components - Components object for $ref resolution
 * @returns {Object} Ajv-compatible JSON Schema 2020-12 object
 */
function openApiSchemaToJsonSchema(schema, components = {}, seen = new Set()) {
    if (!schema || typeof schema !== "object") {
        return schema;
    }
    if (Array.isArray(schema)) {
        return schema.map(item => openApiSchemaToJsonSchema(item, components, seen));
    }

    // Schema-Object $ref: inline the target. In 3.1 siblings are allowed,
    // but we still inline-resolve so Ajv sees a self-contained schema.
    if (schema.$ref) {
        // Break circular $refs (e.g. a tree Node whose children $ref Node):
        // inlining a cycle recurses forever. When a ref is already open on the
        // current path, collapse it to a permissive object rather than crash.
        if (seen.has(schema.$ref)) {
            return { type: "object" };
        }
        const resolved = resolveRef(schema.$ref, components);
        if (resolved) {
            const siblings = { ...schema };
            delete siblings.$ref;
            const nextSeen = new Set(seen);
            nextSeen.add(schema.$ref);
            return openApiSchemaToJsonSchema({ ...resolved, ...siblings }, components, nextSeen);
        }
        return { type: "object" };
    }

    const result = { ...schema };

    // Drop OpenAPI-only schema decorations that aren't part of JSON Schema.
    // Keep `deprecated` and `externalDocs` — both remain valid Schema
    // annotations in 3.1.
    delete result.discriminator;
    delete result.xml;

    // Recurse through every 2020-12 schema container.
    for (const key of PARSER_SCHEMA_MAP_CONTAINERS) {
        if (result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
            const out = {};
            for (const [k, v] of Object.entries(result[key])) {
                out[k] = openApiSchemaToJsonSchema(v, components, seen);
            }
            result[key] = out;
        }
    }
    for (const key of PARSER_SCHEMA_ARRAY_CONTAINERS) {
        if (Array.isArray(result[key])) {
            result[key] = result[key].map(item => openApiSchemaToJsonSchema(item, components, seen));
        }
    }
    for (const key of PARSER_SCHEMA_VALUE_CONTAINERS) {
        if (result[key] && typeof result[key] === "object") {
            result[key] = openApiSchemaToJsonSchema(result[key], components, seen);
        }
    }

    if (result.items && typeof result.items === "object" && !Array.isArray(result.items)) {
        result.items = openApiSchemaToJsonSchema(result.items, components, seen);
    }

    if (result.additionalProperties && typeof result.additionalProperties === "object") {
        result.additionalProperties = openApiSchemaToJsonSchema(result.additionalProperties, components, seen);
    }

    return result;
}

/**
 * Resolve a $ref reference to its target schema
 * @param {string} ref - The $ref string (e.g., '#/components/schemas/User')
 * @param {Object} components - Components object
 * @returns {Object|null} Resolved schema or null
 */
function resolveRef(ref, components) {
    if (!ref || typeof ref !== "string" || !ref.startsWith("#/")) {
        return null;
    }

    const parts = ref.substring(2).split("/");
    let current = { components };

    for (const part of parts) {
        if (!current || typeof current !== "object") {
            return null;
        }
        current = current[part];
    }

    return current;
}

/**
 * Build JSON Schema from OpenAPI query parameters
 * @param {Array<Object>} parameters - Array of OpenAPI parameter objects
 * @param {Object} components - Components for $ref resolution
 * @returns {Object|null} JSON Schema for query parameters or null
 */
function buildQuerySchema(parameters, components = {}) {
    const queryParams = (parameters || []).filter(p => p.in === "query");

    if (queryParams.length === 0) {
        return null;
    }

    const schema = {
        type: "object",
        properties: {},
        required: []
    };

    for (const param of queryParams) {
        const paramSchema = param.schema
            ? openApiSchemaToJsonSchema(param.schema, components)
            : { type: "string" };

        if (param.description) {
            paramSchema.description = param.description;
        }

        schema.properties[param.name] = paramSchema;

        if (param.required) {
            schema.required.push(param.name);
        }
    }

    if (schema.required.length === 0) {
        delete schema.required;
    }

    return schema;
}

/**
 * Build JSON Schema from OpenAPI path parameters
 * @param {Array<Object>} parameters - Array of OpenAPI parameter objects
 * @param {Object} components - Components for $ref resolution
 * @returns {Object|null} JSON Schema for path parameters or null
 */
function buildParamsSchema(parameters, components = {}) {
    const pathParams = (parameters || []).filter(p => p.in === "path");

    if (pathParams.length === 0) {
        return null;
    }

    const schema = {
        type: "object",
        properties: {},
        required: []
    };

    for (const param of pathParams) {
        const paramSchema = param.schema
            ? openApiSchemaToJsonSchema(param.schema, components)
            : { type: "string" };

        if (param.description) {
            paramSchema.description = param.description;
        }

        schema.properties[param.name] = paramSchema;

        // Path parameters are always required in OpenAPI
        schema.required.push(param.name);
    }

    return schema;
}

/**
 * Build JSON Schema from OpenAPI request body
 * @param {Object} requestBody - OpenAPI request body object
 * @param {Object} components - Components for $ref resolution
 * @returns {Object|null} JSON Schema for request body or null
 */
function buildBodySchema(requestBody, components = {}) {
    if (!requestBody || !requestBody.content) {
        return null;
    }

    // Handle $ref in request body
    if (requestBody.$ref) {
        const resolved = resolveRef(requestBody.$ref, components);
        if (resolved) {
            return buildBodySchema(resolved, components);
        }
        return null;
    }

    // Prefer application/json, then try other content types
    const contentTypes = ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"];

    for (const contentType of contentTypes) {
        if (requestBody.content[contentType] && requestBody.content[contentType].schema) {
            return openApiSchemaToJsonSchema(requestBody.content[contentType].schema, components);
        }
    }

    // Try any available content type
    const firstContentType = Object.keys(requestBody.content)[0];
    if (firstContentType && requestBody.content[firstContentType].schema) {
        return openApiSchemaToJsonSchema(requestBody.content[firstContentType].schema, components);
    }

    return null;
}

/**
 * Build response schemas from OpenAPI responses
 * @param {Object} responses - OpenAPI responses object
 * @param {Object} components - Components for $ref resolution
 * @returns {Object|null} Map of status code to schema or null
 */
function buildResponseSchemas(responses, components = {}) {
    if (!responses || typeof responses !== "object") {
        return null;
    }

    const schemas = {};
    let hasSchemas = false;

    for (const [statusCode, response] of Object.entries(responses)) {
        // Handle $ref in response
        let resolvedResponse = response;
        if (response.$ref) {
            resolvedResponse = resolveRef(response.$ref, components) || response;
        }

        if (resolvedResponse.content) {
            // Prefer application/json
            const contentType = resolvedResponse.content["application/json"]
                ? "application/json"
                : Object.keys(resolvedResponse.content)[0];

            if (contentType && resolvedResponse.content[contentType].schema) {
                const schema = openApiSchemaToJsonSchema(
                    resolvedResponse.content[contentType].schema,
                    components
                );

                if (resolvedResponse.description) {
                    schema.description = resolvedResponse.description;
                }

                schemas[statusCode] = schema;
                hasSchemas = true;
            }
        }
    }

    return hasSchemas ? schemas : null;
}

/**
 * Extract success status code from responses
 * @param {Object} responses - OpenAPI responses object
 * @returns {string} Success status code (default: '200')
 */
function extractSuccessStatusCode(responses) {
    if (!responses) {
        return "200";
    }

    // Check for common success codes in order of preference
    const successCodes = ["200", "201", "202", "204"];
    for (const code of successCodes) {
        if (responses[code]) {
            return code;
        }
    }

    // Check for any 2xx code
    for (const code of Object.keys(responses)) {
        if (/^2\d{2}$/.test(code)) {
            return code;
        }
    }

    return "200";
}

/**
 * Extract response content type from responses
 * @param {Object} responses - OpenAPI responses object
 * @returns {string} Content type (default: 'application/json')
 */
function extractResponseContentType(responses) {
    if (!responses) {
        return "application/json";
    }

    // Check success responses for content type
    const successCodes = ["200", "201", "202"];
    for (const code of successCodes) {
        if (responses[code] && responses[code].content) {
            const contentTypes = Object.keys(responses[code].content);
            if (contentTypes.length > 0) {
                return contentTypes[0];
            }
        }
    }

    return "application/json";
}

/**
 * Extract OAuth2 scopes from security requirements
 * @param {Array<Object>} security - Security requirements array
 * @param {Object} securitySchemes - Security schemes from components
 * @returns {Object} Object with scopes array and operator
 */
function extractSecurityScopes(security, securitySchemes = {}) {
    if (!security || !Array.isArray(security) || security.length === 0) {
        return { scopes: [], operator: "AND" };
    }

    const allScopes = new Set();

    for (const requirement of security) {
        for (const [schemeName, scopes] of Object.entries(requirement)) {
            // Check if this is an OAuth2 scheme
            const scheme = securitySchemes[schemeName];
            if (scheme && (scheme.type === "oauth2" || scheme.type === "openIdConnect")) {
                if (Array.isArray(scopes)) {
                    for (const scope of scopes) {
                        allScopes.add(scope);
                    }
                }
            }
        }
    }

    return {
        scopes: Array.from(allScopes),
        // Multiple security requirements in OpenAPI mean OR (any can be satisfied)
        // Multiple schemes within a requirement mean AND (all must be satisfied)
        operator: security.length > 1 ? "OR" : "AND"
    };
}

/**
 * Detect CRUD operation from HTTP method and path pattern
 * @param {string} method - HTTP method
 * @param {string} path - Express-style path
 * @returns {string} CRUD operation type
 */
function detectCrudOperation(method, path) {
    const hasIdParam = /:([a-zA-Z_][a-zA-Z0-9_]*)/.test(path);
    const upperMethod = method.toUpperCase();

    switch (upperMethod) {
    case "GET":
        return hasIdParam ? "read" : "list";
    case "POST":
        return "create";
    case "PUT":
    case "PATCH":
        return "update";
    case "DELETE":
        return "delete";
    default:
        return "none";
    }
}

/**
 * Extract table name from path
 * @param {string} path - API path
 * @returns {string} Inferred table name
 */
function extractTableName(path) {
    // Remove leading slash and get first path segment
    const segments = path.replace(/^\//, "").split("/");
    const firstSegment = segments[0] || "";

    // Remove parameter markers and convert to lowercase
    return firstSegment.replace(/:/g, "").toLowerCase();
}

/**
 * Parse a single OpenAPI operation into endpoint configuration
 * @param {string} path - OpenAPI path
 * @param {string} method - HTTP method
 * @param {Object} operation - OpenAPI operation object
 * @param {Object} pathParams - Path-level parameters
 * @param {Object} components - Components object
 * @param {Object} options - Parsing options
 * @returns {Object} Endpoint configuration
 */
function parseOperation(path, method, operation, pathParams = [], components = {}, options = {}) {
    const expressPath = convertPathToExpress(path);

    // Merge path-level and operation-level parameters
    const allParameters = [...pathParams];
    if (operation.parameters) {
        // Operation parameters override path parameters
        for (const param of operation.parameters) {
            const existingIdx = allParameters.findIndex(
                p => p.name === param.name && p.in === param.in
            );
            if (existingIdx >= 0) {
                allParameters[existingIdx] = param;
            } else {
                allParameters.push(param);
            }
        }
    }

    // Build schemas
    const bodySchema = buildBodySchema(operation.requestBody, components);
    const querySchema = buildQuerySchema(allParameters, components);
    const paramsSchema = buildParamsSchema(allParameters, components);
    const responseSchemas = buildResponseSchemas(operation.responses, components);

    // Extract security scopes
    const security = operation.security !== undefined
        ? operation.security
        : options.globalSecurity;
    const securityInfo = extractSecurityScopes(
        security,
        components.securitySchemes || {}
    );

    // Detect CRUD operation
    const crudOperation = options.detectCrud
        ? detectCrudOperation(method, expressPath)
        : "none";

    // Build endpoint configuration
    const config = {
        // Core configuration
        name: operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`,
        path: expressPath,
        method: method.toUpperCase(),

        // Validation
        validationEnabled: !!(bodySchema || querySchema || paramsSchema),
        bodySchema: bodySchema ? JSON.stringify(bodySchema, null, 2) : "",
        querySchema: querySchema ? JSON.stringify(querySchema, null, 2) : "",
        paramsSchema: paramsSchema ? JSON.stringify(paramsSchema, null, 2) : "",

        // Response configuration
        successStatusCode: extractSuccessStatusCode(operation.responses),
        responseContentType: extractResponseContentType(operation.responses),
        responseSchemas: responseSchemas ? JSON.stringify(responseSchemas, null, 2) : "",
        validateResponseEnabled: false,

        // Authorization
        requiredScopes: securityInfo.scopes.join(", "),
        scopeOperator: securityInfo.operator,

        // CRUD operation mapping
        crudOperation: crudOperation,
        tableName: crudOperation !== "none" ? extractTableName(expressPath) : "",
        primaryKey: "id",
        autoGenerateSql: false,
        useFlowOutput: true,

        // Pagination (defaults)
        paginationEnabled: crudOperation === "list",
        defaultPageSize: "20",
        maxPageSize: "100",
        paginationStyle: "offset",

        // Filtering (defaults)
        filteringEnabled: false,
        filterableFields: "",

        // Sorting (defaults)
        sortingEnabled: false,
        sortableFields: "",
        defaultSortField: "",
        defaultSortDirection: "asc",

        // Transformation (defaults)
        transformationEnabled: false,
        requestTransformExpression: "",
        responseTransformExpression: "",
        fieldMappings: "",

        // Rate Limiting (defaults)
        rateLimitingEnabled: false,
        rateLimitRequests: "100",
        rateLimitWindowMs: "60000",
        rateLimitKeyType: "ip",
        rateLimitCustomKeyPath: "",

        // Caching (defaults)
        cachingEnabled: false,
        cacheTTL: "300000",
        cacheMaxSize: "100",
        cacheKeyStrategy: "full",
        cacheKeyExpression: "",
        cacheVaryHeaders: "",
        cachePrivate: false,

        // Error Handling (defaults)
        errorHandlingEnabled: true,
        errorFormat: "rfc7807",
        includeStackTrace: false,
        logErrors: true,
        customErrorCodes: ""
    };

    // Add metadata for UI display
    config._metadata = {
        operationId: operation.operationId,
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags || [],
        deprecated: operation.deprecated || false,
        originalPath: path
    };

    return config;
}

/**
 * Parse OpenAPI specification and extract all endpoint configurations
 * @param {Object} spec - OpenAPI 3.1 specification object
 * @param {Object} options - Parsing options
 * @returns {Object} Parsed result with endpoints and metadata
 */
function parseOpenApiSpec(spec, options = {}) {
    if (!spec || typeof spec !== "object") {
        throw new Error("Invalid OpenAPI specification: must be an object");
    }

    // Validate OpenAPI version — 3.1.x only. 3.0.x specs must be
    // migrated upstream before import (no bi-version support).
    if (!spec.openapi || typeof spec.openapi !== "string" || !/^3\.1(\.|$)/.test(spec.openapi)) {
        throw new Error(
            `Unsupported OpenAPI version "${spec.openapi}". Only OpenAPI 3.1.x is supported — migrate the spec before importing.`
        );
    }

    const components = spec.components || {};
    const globalSecurity = spec.security || [];
    const endpoints = [];
    const tags = new Set();
    const warnings = [];

    // Parse each path (paths is optional in 3.1 when webhooks/components carry the surface)
    for (const [path, pathItem] of Object.entries(spec.paths || {})) {
        // Get path-level parameters
        const pathParams = pathItem.parameters || [];

        // Only import methods the gateway actually serves. OPTIONS/HEAD are not
        // in the runtime's supported set (normalizeMethod would silently coerce
        // them to GET, producing broken duplicate routes), so skip them and
        // surface a warning instead of importing a mis-typed endpoint.
        const methods = ["get", "post", "put", "delete", "patch"];
        for (const unsupported of ["options", "head"]) {
            if (pathItem[unsupported]) {
                warnings.push(`Skipped unsupported ${unsupported.toUpperCase()} operation on ${path} (auto-CRUD gateway serves GET/POST/PUT/DELETE/PATCH only)`);
            }
        }

        for (const method of methods) {
            if (pathItem[method]) {
                const operation = pathItem[method];

                // Collect tags
                if (operation.tags) {
                    for (const tag of operation.tags) {
                        tags.add(tag);
                    }
                }

                const endpointConfig = parseOperation(
                    path,
                    method,
                    operation,
                    pathParams,
                    components,
                    {
                        ...options,
                        globalSecurity
                    }
                );

                endpoints.push(endpointConfig);
            }
        }
    }

    // Extract API info for config node
    const apiInfo = {
        title: spec.info?.title || "API",
        description: spec.info?.description || "",
        version: spec.info?.version || "1.0.0",
        contact: spec.info?.contact || {},
        license: spec.info?.license || {},
        termsOfService: spec.info?.termsOfService || ""
    };

    // Extract server info
    const servers = (spec.servers || []).map(server => ({
        url: server.url,
        description: server.description || ""
    }));

    // Extract security schemes
    const securitySchemes = components.securitySchemes || {};

    return {
        apiInfo,
        servers,
        securitySchemes,
        tags: Array.from(tags),
        endpoints,
        warnings,
        summary: {
            totalEndpoints: endpoints.length,
            byMethod: countByMethod(endpoints),
            byTag: countByTag(endpoints),
            hasOAuth2: hasOAuth2Security(securitySchemes)
        }
    };
}

/**
 * Count endpoints by HTTP method
 * @param {Array<Object>} endpoints - Array of endpoint configs
 * @returns {Object} Count by method
 */
function countByMethod(endpoints) {
    const counts = {};
    for (const endpoint of endpoints) {
        const method = endpoint.method;
        counts[method] = (counts[method] || 0) + 1;
    }
    return counts;
}

/**
 * Count endpoints by tag
 * @param {Array<Object>} endpoints - Array of endpoint configs
 * @returns {Object} Count by tag
 */
function countByTag(endpoints) {
    const counts = {};
    for (const endpoint of endpoints) {
        const tags = endpoint._metadata?.tags || [];
        if (tags.length === 0) {
            counts["untagged"] = (counts["untagged"] || 0) + 1;
        } else {
            for (const tag of tags) {
                counts[tag] = (counts[tag] || 0) + 1;
            }
        }
    }
    return counts;
}

/**
 * Check if spec has OAuth2 security
 * @param {Object} securitySchemes - Security schemes object
 * @returns {boolean} True if OAuth2 is configured
 */
function hasOAuth2Security(securitySchemes) {
    for (const scheme of Object.values(securitySchemes)) {
        if (scheme.type === "oauth2" || scheme.type === "openIdConnect") {
            return true;
        }
    }
    return false;
}

/**
 * Parse OpenAPI from JSON string
 * @param {string} jsonString - JSON string
 * @param {Object} options - Parsing options
 * @returns {Object} Parsed result
 */
function parseFromJson(jsonString, options = {}) {
    let spec;
    try {
        spec = JSON.parse(jsonString);
    } catch (err) {
        throw new Error(`Invalid JSON: ${err.message}`);
    }
    return parseOpenApiSpec(spec, options);
}

/**
 * Parse OpenAPI from YAML string
 * @param {string} yamlString - YAML string
 * @param {Object} options - Parsing options
 * @returns {Object} Parsed result
 */
function parseFromYaml(yamlString, options = {}) {
    let yaml;
    try {
        yaml = require("js-yaml");
    } catch (err) {
        throw new Error("js-yaml package is required to parse YAML. Install with: npm install js-yaml");
    }

    let spec;
    try {
        spec = yaml.load(yamlString);
    } catch (err) {
        throw new Error(`Invalid YAML: ${err.message}`);
    }
    return parseOpenApiSpec(spec, options);
}

/**
 * Auto-detect format and parse OpenAPI specification
 * @param {string} content - JSON or YAML string
 * @param {Object} options - Parsing options
 * @returns {Object} Parsed result
 */
function parseOpenApi(content, options = {}) {
    if (!content || typeof content !== "string") {
        throw new Error("Content must be a non-empty string");
    }

    const trimmed = content.trim();

    // Detect format by first non-whitespace character
    if (trimmed.startsWith("{")) {
        return parseFromJson(trimmed, options);
    } else {
        return parseFromYaml(trimmed, options);
    }
}

/**
 * Filter endpoints by path patterns
 * @param {Array<Object>} endpoints - Array of endpoint configs
 * @param {Array<string>} pathPatterns - Array of path patterns to include
 * @returns {Array<Object>} Filtered endpoints
 */
function filterEndpointsByPath(endpoints, pathPatterns) {
    if (!pathPatterns || pathPatterns.length === 0) {
        return endpoints;
    }

    return endpoints.filter(endpoint => {
        const path = endpoint._metadata?.originalPath || endpoint.path;

        for (const pattern of pathPatterns) {
            // Support wildcard patterns
            if (pattern.includes("*")) {
                const regex = new RegExp(
                    "^" + pattern.replace(/\*/g, ".*") + "$"
                );
                if (regex.test(path)) {
                    return true;
                }
            } else if (path === pattern || path.startsWith(pattern + "/")) {
                return true;
            }
        }

        return false;
    });
}

/**
 * Filter endpoints by tags
 * @param {Array<Object>} endpoints - Array of endpoint configs
 * @param {Array<string>} tags - Array of tags to include
 * @returns {Array<Object>} Filtered endpoints
 */
function filterEndpointsByTags(endpoints, tags) {
    if (!tags || tags.length === 0) {
        return endpoints;
    }

    return endpoints.filter(endpoint => {
        const endpointTags = endpoint._metadata?.tags || [];
        return tags.some(tag => endpointTags.includes(tag));
    });
}

/**
 * Filter endpoints by methods
 * @param {Array<Object>} endpoints - Array of endpoint configs
 * @param {Array<string>} methods - Array of methods to include
 * @returns {Array<Object>} Filtered endpoints
 */
function filterEndpointsByMethods(endpoints, methods) {
    if (!methods || methods.length === 0) {
        return endpoints;
    }

    const upperMethods = methods.map(m => m.toUpperCase());
    return endpoints.filter(endpoint => upperMethods.includes(endpoint.method));
}

/**
 * OpenAPI Parser class for stateful parsing with configuration
 */
class OpenApiParser {
    /**
     * Create a new OpenAPI parser
     * @param {Object} options - Default parsing options
     */
    constructor(options = {}) {
        this.options = {
            detectCrud: true,
            ...options
        };
        this.lastResult = null;
    }

    /**
     * Parse OpenAPI specification from string
     * @param {string} content - JSON or YAML string
     * @param {Object} options - Override options
     * @returns {Object} Parsed result
     */
    parse(content, options = {}) {
        this.lastResult = parseOpenApi(content, { ...this.options, ...options });
        return this.lastResult;
    }

    /**
     * Parse from JSON string
     * @param {string} jsonString - JSON string
     * @param {Object} options - Override options
     * @returns {Object} Parsed result
     */
    parseJson(jsonString, options = {}) {
        this.lastResult = parseFromJson(jsonString, { ...this.options, ...options });
        return this.lastResult;
    }

    /**
     * Parse from YAML string
     * @param {string} yamlString - YAML string
     * @param {Object} options - Override options
     * @returns {Object} Parsed result
     */
    parseYaml(yamlString, options = {}) {
        this.lastResult = parseFromYaml(yamlString, { ...this.options, ...options });
        return this.lastResult;
    }

    /**
     * Get endpoints filtered by criteria
     * @param {Object} filters - Filter criteria
     * @returns {Array<Object>} Filtered endpoints
     */
    getFilteredEndpoints(filters = {}) {
        if (!this.lastResult) {
            throw new Error("No parsed result available. Call parse() first.");
        }

        let endpoints = [...this.lastResult.endpoints];

        if (filters.paths) {
            endpoints = filterEndpointsByPath(endpoints, filters.paths);
        }

        if (filters.tags) {
            endpoints = filterEndpointsByTags(endpoints, filters.tags);
        }

        if (filters.methods) {
            endpoints = filterEndpointsByMethods(endpoints, filters.methods);
        }

        return endpoints;
    }

    /**
     * Get summary of last parse result
     * @returns {Object|null} Summary or null
     */
    getSummary() {
        return this.lastResult?.summary || null;
    }

    /**
     * Get API info from last parse result
     * @returns {Object|null} API info or null
     */
    getApiInfo() {
        return this.lastResult?.apiInfo || null;
    }

    /**
     * Get security schemes from last parse result
     * @returns {Object|null} Security schemes or null
     */
    getSecuritySchemes() {
        return this.lastResult?.securitySchemes || null;
    }

    /**
     * Get all tags from last parse result
     * @returns {Array<string>} Array of tags
     */
    getTags() {
        return this.lastResult?.tags || [];
    }
}

module.exports = {
    OpenApiParser,
    parseOpenApi,
    parseOpenApiSpec,
    parseFromJson,
    parseFromYaml,
    convertPathToExpress,
    extractParamNames,
    openApiSchemaToJsonSchema,
    resolveRef,
    buildQuerySchema,
    buildParamsSchema,
    buildBodySchema,
    buildResponseSchemas,
    extractSuccessStatusCode,
    extractResponseContentType,
    extractSecurityScopes,
    detectCrudOperation,
    extractTableName,
    parseOperation,
    filterEndpointsByPath,
    filterEndpointsByTags,
    filterEndpointsByMethods
};
