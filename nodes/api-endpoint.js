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

const {
    TransformationResult,
    validateExpression,
    compileExpression,
    transformRequest,
    transformResponse,
    parseFieldMapping,
    applyFieldMapping
} = require('../lib/request-response-transform');

const {
    RATE_LIMIT_KEY_TYPES,
    RATE_LIMIT_DEFAULTS,
    RateLimiter,
    validateRateLimitConfig,
    extractRateLimitKey,
    generateRateLimitHeaders,
    createRateLimitError
} = require('../lib/rate-limiter');

const {
    CACHE_KEY_STRATEGIES,
    CACHE_DEFAULTS,
    ResponseCache,
    validateCacheConfig,
    generateCacheKey,
    generateETag,
    checkConditionalRequest,
    generateCacheHeaders,
    parseVaryHeaders
} = require('../lib/response-cache');

const {
    ERROR_FORMATS,
    ERROR_DEFAULTS,
    ApiError,
    ErrorHandler,
    ErrorFactory,
    validateErrorConfig,
    parseErrorCodeMappings,
    fromError
} = require('../lib/error-handler');

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
 * Valid pagination styles
 */
const PAGINATION_STYLES = ['offset', 'cursor'];

/**
 * Default pagination settings
 */
const PAGINATION_DEFAULTS = {
    defaultPageSize: 20,
    maxPageSize: 100,
    style: 'offset'
};

/**
 * Validates pagination configuration
 * @param {Object} config - Pagination configuration
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validatePaginationConfig(config) {
    const errors = [];

    if (config.defaultPageSize !== undefined) {
        const defaultSize = parseInt(config.defaultPageSize, 10);
        if (isNaN(defaultSize) || defaultSize < 1) {
            errors.push('Default page size must be a positive integer');
        }
    }

    if (config.maxPageSize !== undefined) {
        const maxSize = parseInt(config.maxPageSize, 10);
        if (isNaN(maxSize) || maxSize < 1) {
            errors.push('Maximum page size must be a positive integer');
        }
    }

    if (config.defaultPageSize !== undefined && config.maxPageSize !== undefined) {
        const defaultSize = parseInt(config.defaultPageSize, 10);
        const maxSize = parseInt(config.maxPageSize, 10);
        if (!isNaN(defaultSize) && !isNaN(maxSize) && defaultSize > maxSize) {
            errors.push('Default page size cannot exceed maximum page size');
        }
    }

    if (config.paginationStyle && !PAGINATION_STYLES.includes(config.paginationStyle)) {
        errors.push(`Invalid pagination style. Must be one of: ${PAGINATION_STYLES.join(', ')}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Parses pagination parameters from query string
 * @param {Object} query - Query parameters object
 * @param {Object} config - Pagination configuration
 * @returns {{page: number, limit: number, offset: number, cursor: string|null, style: string}}
 */
function parsePaginationParams(query, config) {
    const style = config.paginationStyle || PAGINATION_DEFAULTS.style;
    const defaultPageSize = parseInt(config.defaultPageSize, 10) || PAGINATION_DEFAULTS.defaultPageSize;
    const maxPageSize = parseInt(config.maxPageSize, 10) || PAGINATION_DEFAULTS.maxPageSize;

    // Parse limit (used by both styles)
    let limit = parseInt(query.limit, 10);
    if (isNaN(limit) || limit < 1) {
        limit = defaultPageSize;
    }
    if (limit > maxPageSize) {
        limit = maxPageSize;
    }

    if (style === 'cursor') {
        // Cursor-based pagination
        const cursor = query.cursor || null;
        return {
            style: 'cursor',
            limit,
            cursor,
            // Include offset-style params as null for consistency
            page: null,
            offset: null
        };
    } else {
        // Offset-based pagination (default)
        let page = parseInt(query.page, 10);
        let offset = parseInt(query.offset, 10);

        // If offset is provided directly, use it
        if (!isNaN(offset) && offset >= 0) {
            page = Math.floor(offset / limit) + 1;
        } else if (!isNaN(page) && page >= 1) {
            offset = (page - 1) * limit;
        } else {
            page = 1;
            offset = 0;
        }

        return {
            style: 'offset',
            page,
            limit,
            offset,
            cursor: null
        };
    }
}

/**
 * Generates pagination metadata for response
 * @param {Object} params - Parsed pagination parameters
 * @param {Object} resultInfo - Information about the result set
 * @param {number} resultInfo.total - Total number of items (optional for cursor-based)
 * @param {number} resultInfo.count - Number of items in current page
 * @param {string} resultInfo.nextCursor - Next cursor value (for cursor-based)
 * @param {string} resultInfo.prevCursor - Previous cursor value (for cursor-based)
 * @returns {Object} Pagination metadata object
 */
function generatePaginationMetadata(params, resultInfo = {}) {
    const { total, count, nextCursor, prevCursor } = resultInfo;

    if (params.style === 'cursor') {
        return {
            style: 'cursor',
            limit: params.limit,
            cursor: params.cursor,
            count: count !== undefined ? count : 0,
            hasNext: !!nextCursor,
            hasPrev: !!prevCursor || !!params.cursor,
            nextCursor: nextCursor || null,
            prevCursor: prevCursor || null
        };
    } else {
        // Offset-based pagination
        const totalPages = total !== undefined ? Math.ceil(total / params.limit) : null;
        const hasNext = total !== undefined ? params.page < totalPages : (count !== undefined && count === params.limit);
        const hasPrev = params.page > 1;

        return {
            style: 'offset',
            page: params.page,
            limit: params.limit,
            offset: params.offset,
            count: count !== undefined ? count : 0,
            total: total !== undefined ? total : null,
            totalPages,
            hasNext,
            hasPrev
        };
    }
}

/**
 * Valid sort directions
 */
const SORT_DIRECTIONS = ['asc', 'desc', 'ASC', 'DESC'];

/**
 * Default filtering/sorting settings
 */
const FILTER_SORT_DEFAULTS = {
    defaultSortDirection: 'asc'
};

/**
 * Parses a comma-separated list of field names
 * @param {string|Array} fields - Comma-separated string or array of field names
 * @returns {Array<string>} Array of valid field names
 */
function parseFieldList(fields) {
    if (!fields) {
        return [];
    }
    if (Array.isArray(fields)) {
        return fields.map(f => String(f).trim()).filter(f => f.length > 0 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f));
    }
    if (typeof fields === 'string') {
        return fields.split(',').map(f => f.trim()).filter(f => f.length > 0 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f));
    }
    return [];
}

/**
 * Validates a field name against allowed fields
 * @param {string} fieldName - Field name to validate
 * @param {Array<string>} allowedFields - List of allowed field names
 * @returns {{valid: boolean, error?: string}}
 */
function validateFieldName(fieldName, allowedFields) {
    if (!fieldName || typeof fieldName !== 'string') {
        return { valid: false, error: 'Field name is required' };
    }
    const trimmed = fieldName.trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
        return { valid: false, error: 'Invalid field name format' };
    }
    if (allowedFields && allowedFields.length > 0 && !allowedFields.includes(trimmed)) {
        return { valid: false, error: `Field '${trimmed}' is not allowed` };
    }
    return { valid: true };
}

/**
 * Parses filter parameters from query string
 * Supports filter[field]=value format
 * @param {Object} query - Query parameters object
 * @param {Array<string>} allowedFields - List of allowed filterable fields
 * @returns {{filters: Array<{field: string, operator: string, value: any}>, errors: Array<string>}}
 */
function parseFilterParams(query, allowedFields = []) {
    const filters = [];
    const errors = [];

    if (!query || typeof query !== 'object') {
        return { filters, errors };
    }

    // Support filter[field]=value and filter[field][operator]=value formats
    for (const [key, value] of Object.entries(query)) {
        // Match filter[field] or filter[field][operator]
        const simpleMatch = key.match(/^filter\[([a-zA-Z_][a-zA-Z0-9_]*)\]$/);
        const operatorMatch = key.match(/^filter\[([a-zA-Z_][a-zA-Z0-9_]*)\]\[(eq|ne|gt|gte|lt|lte|like|in)\]$/);

        let field = null;
        let operator = 'eq';

        if (operatorMatch) {
            field = operatorMatch[1];
            operator = operatorMatch[2];
        } else if (simpleMatch) {
            field = simpleMatch[1];
        }

        if (field) {
            // Validate field name
            const validation = validateFieldName(field, allowedFields);
            if (!validation.valid) {
                errors.push(`Filter field '${field}': ${validation.error}`);
                continue;
            }

            // Handle 'in' operator (comma-separated values)
            let parsedValue = value;
            if (operator === 'in' && typeof value === 'string') {
                parsedValue = value.split(',').map(v => v.trim());
            }

            filters.push({
                field,
                operator,
                value: parsedValue
            });
        }
    }

    // Also support simple field=value format (treated as equality)
    for (const [key, value] of Object.entries(query)) {
        if (!key.startsWith('filter[') &&
            !['page', 'limit', 'offset', 'cursor', 'sort', 'order'].includes(key) &&
            allowedFields.length > 0 && allowedFields.includes(key)) {
            filters.push({
                field: key,
                operator: 'eq',
                value
            });
        }
    }

    return { filters, errors };
}

/**
 * Parses sort parameters from query string
 * Supports sort=field or sort=-field (descending) or sort=field1,-field2
 * @param {Object} query - Query parameters object
 * @param {Array<string>} allowedFields - List of allowed sortable fields
 * @param {string} defaultSortField - Default field to sort by
 * @param {string} defaultSortDirection - Default sort direction ('asc' or 'desc')
 * @returns {{sorts: Array<{field: string, direction: string}>, errors: Array<string>}}
 */
function parseSortParams(query, allowedFields = [], defaultSortField = null, defaultSortDirection = 'asc') {
    const sorts = [];
    const errors = [];

    if (!query || typeof query !== 'object') {
        if (defaultSortField) {
            sorts.push({ field: defaultSortField, direction: defaultSortDirection });
        }
        return { sorts, errors };
    }

    const sortParam = query.sort;

    if (!sortParam) {
        // Use default if provided
        if (defaultSortField) {
            sorts.push({ field: defaultSortField, direction: defaultSortDirection });
        }
        return { sorts, errors };
    }

    // Parse sort parameter (can be comma-separated)
    const sortFields = String(sortParam).split(',').map(s => s.trim()).filter(s => s.length > 0);

    for (const sortField of sortFields) {
        let field = sortField;
        let direction = 'asc';

        // Check for - prefix (descending)
        if (sortField.startsWith('-')) {
            field = sortField.slice(1);
            direction = 'desc';
        } else if (sortField.startsWith('+')) {
            field = sortField.slice(1);
            direction = 'asc';
        }

        // Validate field name
        const validation = validateFieldName(field, allowedFields);
        if (!validation.valid) {
            errors.push(`Sort field '${field}': ${validation.error}`);
            continue;
        }

        sorts.push({ field, direction });
    }

    // If no valid sorts and default provided, use default
    if (sorts.length === 0 && defaultSortField) {
        sorts.push({ field: defaultSortField, direction: defaultSortDirection });
    }

    return { sorts, errors };
}

/**
 * Generates SQL WHERE clause from filters
 * @param {Array<{field: string, operator: string, value: any}>} filters - Parsed filters
 * @param {string} paramPrefix - Prefix for parameter placeholders (default: '@')
 * @returns {{clause: string, params: Object}}
 */
function generateWhereClause(filters, paramPrefix = '@') {
    if (!filters || filters.length === 0) {
        return { clause: '', params: {} };
    }

    const conditions = [];
    const params = {};
    let paramIndex = 0;

    for (const filter of filters) {
        const paramName = `filter_${filter.field}_${paramIndex}`;
        paramIndex++;

        switch (filter.operator) {
            case 'eq':
                conditions.push(`${filter.field} = ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'ne':
                conditions.push(`${filter.field} != ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'gt':
                conditions.push(`${filter.field} > ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'gte':
                conditions.push(`${filter.field} >= ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'lt':
                conditions.push(`${filter.field} < ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'lte':
                conditions.push(`${filter.field} <= ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'like':
                conditions.push(`${filter.field} LIKE ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'in':
                if (Array.isArray(filter.value) && filter.value.length > 0) {
                    const inParams = filter.value.map((v, i) => {
                        const inParamName = `${paramName}_${i}`;
                        params[inParamName] = v;
                        return `${paramPrefix}${inParamName}`;
                    });
                    conditions.push(`${filter.field} IN (${inParams.join(', ')})`);
                }
                break;
        }
    }

    return {
        clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
        params
    };
}

/**
 * Generates SQL ORDER BY clause from sorts
 * @param {Array<{field: string, direction: string}>} sorts - Parsed sorts
 * @returns {string} ORDER BY clause
 */
function generateOrderByClause(sorts) {
    if (!sorts || sorts.length === 0) {
        return '';
    }

    const orderParts = sorts.map(sort =>
        `${sort.field} ${sort.direction.toUpperCase()}`
    );

    return `ORDER BY ${orderParts.join(', ')}`;
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

        // Pagination configuration
        node.paginationEnabled = config.paginationEnabled === true;
        node.defaultPageSize = parseInt(config.defaultPageSize, 10) || PAGINATION_DEFAULTS.defaultPageSize;
        node.maxPageSize = parseInt(config.maxPageSize, 10) || PAGINATION_DEFAULTS.maxPageSize;
        node.paginationStyle = PAGINATION_STYLES.includes(config.paginationStyle)
            ? config.paginationStyle
            : PAGINATION_DEFAULTS.style;

        // Validate pagination configuration if enabled
        if (node.paginationEnabled) {
            const paginationValidation = validatePaginationConfig({
                defaultPageSize: node.defaultPageSize,
                maxPageSize: node.maxPageSize,
                paginationStyle: node.paginationStyle
            });
            if (!paginationValidation.valid) {
                paginationValidation.errors.forEach(error => node.warn(`Pagination config: ${error}`));
            }
        }

        // Filtering configuration
        node.filteringEnabled = config.filteringEnabled === true;
        node.filterableFields = parseFieldList(config.filterableFields);

        // Sorting configuration
        node.sortingEnabled = config.sortingEnabled === true;
        node.sortableFields = parseFieldList(config.sortableFields);
        node.defaultSortField = (config.defaultSortField || '').trim() || null;
        node.defaultSortDirection = ['asc', 'desc'].includes(config.defaultSortDirection)
            ? config.defaultSortDirection
            : 'asc';

        // Transformation configuration
        node.transformationEnabled = config.transformationEnabled === true;
        node.requestTransformExpression = null;
        node.responseTransformExpression = null;
        node.fieldMappings = null;

        // Rate limiting configuration
        node.rateLimitingEnabled = config.rateLimitingEnabled === true;
        node.rateLimitRequests = parseInt(config.rateLimitRequests, 10) || RATE_LIMIT_DEFAULTS.requests;
        node.rateLimitWindowMs = parseInt(config.rateLimitWindowMs, 10) || RATE_LIMIT_DEFAULTS.windowMs;
        node.rateLimitKeyType = RATE_LIMIT_KEY_TYPES.includes(config.rateLimitKeyType)
            ? config.rateLimitKeyType
            : RATE_LIMIT_DEFAULTS.keyType;
        node.rateLimitCustomKeyPath = (config.rateLimitCustomKeyPath || '').trim() || null;
        node.rateLimiter = null;

        // Initialize rate limiter if enabled
        if (node.rateLimitingEnabled) {
            const rateLimitValidation = validateRateLimitConfig({
                requests: node.rateLimitRequests,
                windowMs: node.rateLimitWindowMs,
                keyType: node.rateLimitKeyType
            });
            if (!rateLimitValidation.valid) {
                rateLimitValidation.errors.forEach(error => node.warn(`Rate limit config: ${error}`));
            }

            node.rateLimiter = new RateLimiter({
                requests: node.rateLimitRequests,
                windowMs: node.rateLimitWindowMs,
                keyType: node.rateLimitKeyType,
                customKeyPath: node.rateLimitCustomKeyPath
            });
        }

        // Caching configuration
        node.cachingEnabled = config.cachingEnabled === true;
        node.cacheTTL = parseInt(config.cacheTTL, 10);
        if (isNaN(node.cacheTTL) || node.cacheTTL < 0) {
            node.cacheTTL = CACHE_DEFAULTS.ttl;
        }
        node.cacheMaxSize = parseInt(config.cacheMaxSize, 10) || CACHE_DEFAULTS.maxSize;
        node.cacheKeyStrategy = CACHE_KEY_STRATEGIES.includes(config.cacheKeyStrategy)
            ? config.cacheKeyStrategy
            : CACHE_DEFAULTS.keyStrategy;
        node.cacheKeyExpression = (config.cacheKeyExpression || '').trim() || null;
        node.cacheVaryHeaders = parseVaryHeaders(config.cacheVaryHeaders);
        node.cachePrivate = config.cachePrivate === true;
        node.responseCache = null;

        // Initialize response cache if enabled
        if (node.cachingEnabled) {
            const cacheValidation = validateCacheConfig({
                ttl: node.cacheTTL,
                maxSize: node.cacheMaxSize,
                keyStrategy: node.cacheKeyStrategy
            });
            if (!cacheValidation.valid) {
                cacheValidation.errors.forEach(error => node.warn(`Cache config: ${error}`));
            }

            node.responseCache = new ResponseCache({
                ttl: node.cacheTTL,
                maxSize: node.cacheMaxSize,
                keyStrategy: node.cacheKeyStrategy,
                customKeyExpression: node.cacheKeyExpression,
                varyHeaders: node.cacheVaryHeaders
            });
        }

        // Error handling configuration
        node.errorHandlingEnabled = config.errorHandlingEnabled !== false;  // Enabled by default
        node.errorFormat = ERROR_FORMATS.includes(config.errorFormat)
            ? config.errorFormat
            : ERROR_DEFAULTS.format;
        node.includeStackTrace = config.includeStackTrace === true;  // Dev mode only
        node.logErrors = config.logErrors !== false;  // Enabled by default
        node.customErrorCodes = {};
        node.errorHandler = null;

        // Parse custom error code mappings
        if (config.customErrorCodes) {
            const parsed = parseErrorCodeMappings(config.customErrorCodes);
            if (parsed.errors.length > 0) {
                parsed.errors.forEach(error => node.warn(`Error code mapping: ${error}`));
            }
            node.customErrorCodes = parsed.codes;
        }

        // Initialize error handler
        if (node.errorHandlingEnabled) {
            const errorValidation = validateErrorConfig({
                format: node.errorFormat,
                includeStackTrace: node.includeStackTrace,
                logErrors: node.logErrors,
                customErrorCodes: node.customErrorCodes
            });
            if (!errorValidation.valid) {
                errorValidation.errors.forEach(error => node.warn(`Error config: ${error}`));
            }

            node.errorHandler = new ErrorHandler({
                format: node.errorFormat,
                includeStackTrace: node.includeStackTrace,
                logErrors: node.logErrors,
                customErrorCodes: node.customErrorCodes,
                logger: (message, context) => {
                    node.warn(`${message} ${JSON.stringify(context)}`);
                }
            });
        }

        // Parse and validate transformation expressions if enabled
        if (node.transformationEnabled) {
            // Request transformation expression
            if (config.requestTransformExpression) {
                const validation = validateExpression(config.requestTransformExpression);
                if (validation.valid) {
                    node.requestTransformExpression = config.requestTransformExpression.trim();
                } else {
                    node.warn(`Invalid request transformation expression: ${validation.error}`);
                }
            }

            // Response transformation expression
            if (config.responseTransformExpression) {
                const validation = validateExpression(config.responseTransformExpression);
                if (validation.valid) {
                    node.responseTransformExpression = config.responseTransformExpression.trim();
                } else {
                    node.warn(`Invalid response transformation expression: ${validation.error}`);
                }
            }

            // Field mappings
            if (config.fieldMappings) {
                const parsed = parseFieldMapping(config.fieldMappings);
                if (parsed.errors.length > 0) {
                    parsed.errors.forEach(err => node.warn(`Field mapping: ${err}`));
                }
                if (Object.keys(parsed.mappings).length > 0) {
                    node.fieldMappings = parsed.mappings;
                }
            }
        }

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

        // Method to get pagination configuration
        node.getPaginationConfig = function() {
            return {
                enabled: node.paginationEnabled,
                defaultPageSize: node.defaultPageSize,
                maxPageSize: node.maxPageSize,
                style: node.paginationStyle
            };
        };

        // Method to parse pagination parameters from request query
        node.parsePagination = function(query) {
            if (!node.paginationEnabled) {
                return null;
            }
            return parsePaginationParams(query || {}, {
                paginationStyle: node.paginationStyle,
                defaultPageSize: node.defaultPageSize,
                maxPageSize: node.maxPageSize
            });
        };

        // Method to generate pagination metadata for response
        node.generatePaginationMeta = function(params, resultInfo) {
            if (!params) {
                return null;
            }
            return generatePaginationMetadata(params, resultInfo);
        };

        // Method to get filtering configuration
        node.getFilteringConfig = function() {
            return {
                enabled: node.filteringEnabled,
                filterableFields: node.filterableFields
            };
        };

        // Method to get sorting configuration
        node.getSortingConfig = function() {
            return {
                enabled: node.sortingEnabled,
                sortableFields: node.sortableFields,
                defaultSortField: node.defaultSortField,
                defaultSortDirection: node.defaultSortDirection
            };
        };

        // Method to parse filter parameters from request query
        node.parseFilters = function(query) {
            if (!node.filteringEnabled) {
                return null;
            }
            return parseFilterParams(query || {}, node.filterableFields);
        };

        // Method to parse sort parameters from request query
        node.parseSorts = function(query) {
            if (!node.sortingEnabled) {
                return null;
            }
            return parseSortParams(
                query || {},
                node.sortableFields,
                node.defaultSortField,
                node.defaultSortDirection
            );
        };

        // Method to generate SQL WHERE clause from filters
        node.generateWhereClause = function(filters, paramPrefix) {
            return generateWhereClause(filters, paramPrefix);
        };

        // Method to generate SQL ORDER BY clause from sorts
        node.generateOrderByClause = function(sorts) {
            return generateOrderByClause(sorts);
        };

        // Method to get transformation configuration
        node.getTransformationConfig = function() {
            return {
                enabled: node.transformationEnabled,
                hasRequestTransform: !!node.requestTransformExpression,
                hasResponseTransform: !!node.responseTransformExpression,
                hasFieldMappings: !!node.fieldMappings
            };
        };

        // Method to transform request body
        node.transformRequestBody = async function(body, context = {}) {
            if (!node.transformationEnabled) {
                return { success: true, data: body };
            }

            let result = body;

            // Apply field mappings first if defined
            if (node.fieldMappings) {
                const mappingResult = applyFieldMapping(result, node.fieldMappings);
                if (!mappingResult.success) {
                    return mappingResult;
                }
                result = mappingResult.data;
            }

            // Then apply JSONata expression if defined
            if (node.requestTransformExpression) {
                const transformResult = await transformRequest(result, node.requestTransformExpression, context);
                if (!transformResult.success) {
                    return transformResult;
                }
                result = transformResult.data;
            }

            return { success: true, data: result };
        };

        // Method to transform response data
        node.transformResponseData = async function(data, context = {}) {
            if (!node.transformationEnabled || !node.responseTransformExpression) {
                return { success: true, data: data };
            }

            return transformResponse(data, node.responseTransformExpression, context);
        };

        // Method to get rate limiting configuration
        node.getRateLimitingConfig = function() {
            return {
                enabled: node.rateLimitingEnabled,
                requests: node.rateLimitRequests,
                windowMs: node.rateLimitWindowMs,
                keyType: node.rateLimitKeyType,
                customKeyPath: node.rateLimitCustomKeyPath
            };
        };

        // Method to check rate limit for a request
        node.checkRateLimit = function(req) {
            if (!node.rateLimitingEnabled || !node.rateLimiter) {
                return {
                    allowed: true,
                    remaining: null,
                    limit: null,
                    resetTime: null,
                    retryAfter: null,
                    key: null
                };
            }
            return node.rateLimiter.checkRequest(req);
        };

        // Method to get rate limiter statistics
        node.getRateLimitStatistics = function() {
            if (!node.rateLimiter) {
                return null;
            }
            return node.rateLimiter.getStatistics();
        };

        // Method to reset rate limit for a specific key
        node.resetRateLimit = function(key) {
            if (node.rateLimiter) {
                node.rateLimiter.reset(key);
            }
        };

        // Method to get caching configuration
        node.getCachingConfig = function() {
            return {
                enabled: node.cachingEnabled,
                ttl: node.cacheTTL,
                maxSize: node.cacheMaxSize,
                keyStrategy: node.cacheKeyStrategy,
                keyExpression: node.cacheKeyExpression,
                varyHeaders: node.cacheVaryHeaders,
                private: node.cachePrivate
            };
        };

        // Method to check cache for a request
        node.checkCache = function(req) {
            if (!node.cachingEnabled || !node.responseCache) {
                return { hit: false, key: null };
            }
            return node.responseCache.getByRequest(req);
        };

        // Method to store response in cache
        node.storeInCache = function(req, data, statusCode = 200, headers = {}) {
            if (!node.cachingEnabled || !node.responseCache) {
                return { key: null, etag: null };
            }
            return node.responseCache.setByRequest(req, data, statusCode, headers);
        };

        // Method to invalidate cache entry
        node.invalidateCache = function(req) {
            if (node.responseCache) {
                return node.responseCache.deleteByRequest(req);
            }
            return false;
        };

        // Method to clear entire cache
        node.clearCache = function() {
            if (node.responseCache) {
                node.responseCache.clear();
            }
        };

        // Method to get cache statistics
        node.getCacheStatistics = function() {
            if (!node.responseCache) {
                return null;
            }
            return node.responseCache.getStatistics();
        };

        // Method to check conditional request (ETag/If-None-Match)
        node.checkConditionalRequest = function(req, etag) {
            return checkConditionalRequest(req, etag);
        };

        // Method to generate ETag for data
        node.generateETag = function(data) {
            return generateETag(data);
        };

        // Method to get cache headers
        node.getCacheHeaders = function() {
            if (!node.cachingEnabled) {
                return { 'Cache-Control': 'no-store' };
            }
            return generateCacheHeaders({
                ttl: node.cacheTTL,
                varyHeaders: node.cacheVaryHeaders
            }, node.cachePrivate);
        };

        // Method to get error handling configuration
        node.getErrorHandlingConfig = function() {
            return {
                enabled: node.errorHandlingEnabled,
                format: node.errorFormat,
                includeStackTrace: node.includeStackTrace,
                logErrors: node.logErrors,
                customErrorCodes: Object.keys(node.customErrorCodes)
            };
        };

        // Method to handle errors using the error handler
        node.handleError = function(error, context = {}) {
            if (!node.errorHandlingEnabled || !node.errorHandler) {
                // Return basic error response if error handling is disabled
                const apiError = fromError(error);
                return {
                    statusCode: apiError.getStatusCode(),
                    body: {
                        error: apiError.code,
                        message: apiError.message
                    },
                    headers: { 'Content-Type': 'application/json' }
                };
            }
            return node.errorHandler.handle(error, context);
        };

        // Method to create a standard error
        node.createError = function(code, message, options = {}) {
            return new ApiError(code, message, options);
        };

        // Method to create common error types
        node.createValidationError = function(message, errors = []) {
            return ErrorFactory.validation(message, errors);
        };

        node.createNotFoundError = function(resource, id) {
            return ErrorFactory.notFound(resource, id);
        };

        node.createAuthenticationError = function(message) {
            return ErrorFactory.authentication(message);
        };

        node.createAuthorizationError = function(message, missingScopes) {
            return ErrorFactory.authorization(message, missingScopes);
        };

        // Method to send error response (helper for message handling)
        node.sendErrorResponse = function(res, error, context = {}) {
            const result = node.handleError(error, context);
            if (res && typeof res.status === 'function') {
                for (const [name, value] of Object.entries(result.headers)) {
                    res.set(name, value);
                }
                res.status(result.statusCode).json(result.body);
                return true;
            }
            return false;
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
                hasCrudOperation: node.crudOperation !== 'none',
                // Pagination configuration
                paginationEnabled: node.paginationEnabled,
                defaultPageSize: node.defaultPageSize,
                maxPageSize: node.maxPageSize,
                paginationStyle: node.paginationStyle,
                // Filtering configuration
                filteringEnabled: node.filteringEnabled,
                filterableFields: node.filterableFields,
                // Sorting configuration
                sortingEnabled: node.sortingEnabled,
                sortableFields: node.sortableFields,
                defaultSortField: node.defaultSortField,
                defaultSortDirection: node.defaultSortDirection,
                // Transformation configuration
                transformationEnabled: node.transformationEnabled,
                hasRequestTransform: !!node.requestTransformExpression,
                hasResponseTransform: !!node.responseTransformExpression,
                hasFieldMappings: !!node.fieldMappings,
                // Rate limiting configuration
                rateLimitingEnabled: node.rateLimitingEnabled,
                rateLimitRequests: node.rateLimitRequests,
                rateLimitWindowMs: node.rateLimitWindowMs,
                rateLimitKeyType: node.rateLimitKeyType,
                // Caching configuration
                cachingEnabled: node.cachingEnabled,
                cacheTTL: node.cacheTTL,
                cacheMaxSize: node.cacheMaxSize,
                cacheKeyStrategy: node.cacheKeyStrategy,
                cacheVaryHeaders: node.cacheVaryHeaders,
                cachePrivate: node.cachePrivate,
                // Error handling configuration
                errorHandlingEnabled: node.errorHandlingEnabled,
                errorFormat: node.errorFormat,
                includeStackTrace: node.includeStackTrace,
                logErrors: node.logErrors
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

        node.on("input", async function(msg, send, done) {
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
                    useFlowOutput: node.useFlowOutput,
                    // Pagination configuration
                    paginationEnabled: node.paginationEnabled,
                    defaultPageSize: node.defaultPageSize,
                    maxPageSize: node.maxPageSize,
                    paginationStyle: node.paginationStyle,
                    // Filtering configuration
                    filteringEnabled: node.filteringEnabled,
                    filterableFields: node.filterableFields,
                    // Sorting configuration
                    sortingEnabled: node.sortingEnabled,
                    sortableFields: node.sortableFields,
                    defaultSortField: node.defaultSortField,
                    defaultSortDirection: node.defaultSortDirection,
                    // Transformation configuration
                    transformationEnabled: node.transformationEnabled,
                    hasRequestTransform: !!node.requestTransformExpression,
                    hasResponseTransform: !!node.responseTransformExpression,
                    responseTransformExpression: node.responseTransformExpression,
                    // Rate limiting configuration
                    rateLimitingEnabled: node.rateLimitingEnabled,
                    rateLimitRequests: node.rateLimitRequests,
                    rateLimitWindowMs: node.rateLimitWindowMs,
                    rateLimitKeyType: node.rateLimitKeyType,
                    // Caching configuration
                    cachingEnabled: node.cachingEnabled,
                    cacheTTL: node.cacheTTL,
                    cacheKeyStrategy: node.cacheKeyStrategy,
                    cacheVaryHeaders: node.cacheVaryHeaders,
                    cachePrivate: node.cachePrivate,
                    // Error handling configuration
                    errorHandlingEnabled: node.errorHandlingEnabled,
                    errorFormat: node.errorFormat,
                    includeStackTrace: node.includeStackTrace
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

                // Add pagination context if enabled
                if (node.paginationEnabled && msg.req && msg.req.query) {
                    msg.pagination = node.parsePagination(msg.req.query);
                }

                // Add filtering context if enabled
                if (node.filteringEnabled && msg.req && msg.req.query) {
                    const filterResult = node.parseFilters(msg.req.query);
                    msg.filtering = {
                        filters: filterResult.filters,
                        errors: filterResult.errors,
                        whereClause: node.generateWhereClause(filterResult.filters)
                    };
                }

                // Add sorting context if enabled
                if (node.sortingEnabled && msg.req && msg.req.query) {
                    const sortResult = node.parseSorts(msg.req.query);
                    msg.sorting = {
                        sorts: sortResult.sorts,
                        errors: sortResult.errors,
                        orderByClause: node.generateOrderByClause(sortResult.sorts)
                    };
                }

                // If request path is provided, extract parameters
                if (msg.req && msg.req.path) {
                    const extraction = node.extractRequestParams(msg.req.path);
                    if (extraction.match) {
                        msg.req.params = extraction.params;
                    }
                }

                // Perform rate limit check if enabled
                if (node.rateLimitingEnabled && msg.req) {
                    const rateLimitResult = node.checkRateLimit(msg.req);

                    // Add rate limit headers to response
                    if (msg.res && typeof msg.res.set === 'function') {
                        const headers = generateRateLimitHeaders(rateLimitResult);
                        for (const [name, value] of Object.entries(headers)) {
                            msg.res.set(name, value);
                        }
                    }

                    // Add rate limit context to message
                    msg.rateLimit = {
                        allowed: rateLimitResult.allowed,
                        limit: rateLimitResult.limit,
                        remaining: rateLimitResult.remaining,
                        resetTime: rateLimitResult.resetTime,
                        key: rateLimitResult.key
                    };

                    // If rate limited, return 429 error
                    if (!rateLimitResult.allowed) {
                        const rateLimitError = createRateLimitError(rateLimitResult, rateLimitResult.key);
                        msg.rateLimitError = rateLimitError;

                        if (msg.res && typeof msg.res.status === 'function') {
                            msg.res.status(429).json(rateLimitError);
                            if (done) {
                                done();
                            }
                            return;
                        }

                        msg.payload = rateLimitError;
                        send(msg);
                        if (done) {
                            done();
                        }
                        return;
                    }
                }

                // Perform cache check if enabled (only for cacheable methods)
                if (node.cachingEnabled && msg.req && (msg.req.method === 'GET' || msg.req.method === 'HEAD')) {
                    const cacheResult = node.checkCache(msg.req);

                    // Add cache headers to response
                    if (msg.res && typeof msg.res.set === 'function') {
                        const cacheHeaders = node.getCacheHeaders();
                        for (const [name, value] of Object.entries(cacheHeaders)) {
                            msg.res.set(name, value);
                        }
                    }

                    // Add cache context to message
                    msg.cache = {
                        hit: cacheResult.hit,
                        key: cacheResult.key,
                        age: cacheResult.age || null
                    };

                    if (cacheResult.hit) {
                        // Check for conditional request (If-None-Match)
                        if (cacheResult.etag && node.checkConditionalRequest(msg.req, cacheResult.etag)) {
                            // Return 304 Not Modified
                            if (msg.res && typeof msg.res.status === 'function') {
                                msg.res.set('ETag', cacheResult.etag);
                                msg.res.status(304).end();
                                if (done) {
                                    done();
                                }
                                return;
                            }
                        }

                        // Return cached response
                        if (msg.res && typeof msg.res.status === 'function') {
                            if (cacheResult.etag) {
                                msg.res.set('ETag', cacheResult.etag);
                            }
                            msg.res.set('X-Cache', 'HIT');
                            msg.res.set('Age', String(Math.floor((cacheResult.age || 0) / 1000)));
                            msg.res.status(cacheResult.statusCode || 200).json(cacheResult.data);
                            if (done) {
                                done();
                            }
                            return;
                        }

                        // If no res object, add cached data to message for downstream handling
                        msg.cachedResponse = {
                            data: cacheResult.data,
                            statusCode: cacheResult.statusCode,
                            etag: cacheResult.etag
                        };
                    } else {
                        // Cache miss - add header for downstream
                        if (msg.res && typeof msg.res.set === 'function') {
                            msg.res.set('X-Cache', 'MISS');
                        }
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

                // Perform request transformation if enabled and request body is present
                if (node.transformationEnabled && msg.req && msg.req.body !== undefined) {
                    const transformContext = {
                        msg: msg,
                        params: msg.req.params || {},
                        query: msg.req.query || {},
                        headers: msg.req.headers || {}
                    };

                    const transformResult = await node.transformRequestBody(msg.req.body, transformContext);

                    if (!transformResult.success) {
                        // Add transformation error to message
                        const transformError = {
                            statusCode: 400,
                            error: 'Bad Request',
                            message: 'Request transformation failed',
                            details: {
                                error: transformResult.error
                            }
                        };
                        msg.transformationError = transformError;

                        // Send error response if res object is available
                        if (msg.res && typeof msg.res.status === 'function') {
                            msg.res.status(400).json(transformError);
                            if (done) {
                                done();
                            }
                            return;
                        }

                        // Otherwise, still send the message with error info
                        msg.payload = transformError;
                        send(msg);
                        if (done) {
                            done();
                        }
                        return;
                    }

                    // Update request body with transformed data
                    msg.req.body = transformResult.data;
                    // Store original body for reference
                    msg.req.originalBody = msg.req.body;
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

            // Shutdown rate limiter if enabled
            if (node.rateLimiter) {
                node.rateLimiter.shutdown();
                node.rateLimiter = null;
            }

            // Shutdown response cache if enabled
            if (node.responseCache) {
                node.responseCache.shutdown();
                node.responseCache = null;
            }

            if (done) {
                done();
            }
        });
    }

    RED.nodes.registerType("api-endpoint", ApiEndpointNode);
};
