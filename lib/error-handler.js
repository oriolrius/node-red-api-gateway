'use strict';

/**
 * Error response formats
 */
const ERROR_FORMATS = ['rfc7807', 'simple', 'legacy'];

/**
 * Default error configuration
 */
const ERROR_DEFAULTS = {
    format: 'rfc7807',
    includeStackTrace: false,
    logErrors: true,
    defaultType: 'about:blank'
};

/**
 * Standard HTTP status codes and their default titles
 */
const HTTP_STATUS_TITLES = {
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Payload Too Large',
    414: 'URI Too Long',
    415: 'Unsupported Media Type',
    416: 'Range Not Satisfiable',
    417: 'Expectation Failed',
    418: "I'm a Teapot",
    421: 'Misdirected Request',
    422: 'Unprocessable Entity',
    423: 'Locked',
    424: 'Failed Dependency',
    425: 'Too Early',
    426: 'Upgrade Required',
    428: 'Precondition Required',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    451: 'Unavailable For Legal Reasons',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates',
    507: 'Insufficient Storage',
    508: 'Loop Detected',
    510: 'Not Extended',
    511: 'Network Authentication Required'
};

/**
 * Common error type URIs for RFC 7807
 */
const ERROR_TYPE_URIS = {
    validation: 'urn:error:validation',
    authentication: 'urn:error:authentication',
    authorization: 'urn:error:authorization',
    notFound: 'urn:error:not-found',
    rateLimit: 'urn:error:rate-limit',
    conflict: 'urn:error:conflict',
    serverError: 'urn:error:server-error',
    timeout: 'urn:error:timeout',
    badRequest: 'urn:error:bad-request',
    serviceUnavailable: 'urn:error:service-unavailable'
};

/**
 * Custom error code mappings
 * Maps internal error codes to HTTP status codes and details
 */
const DEFAULT_ERROR_CODES = {
    'VALIDATION_ERROR': { status: 400, type: ERROR_TYPE_URIS.validation, title: 'Validation Error' },
    'INVALID_INPUT': { status: 400, type: ERROR_TYPE_URIS.badRequest, title: 'Invalid Input' },
    'MISSING_FIELD': { status: 400, type: ERROR_TYPE_URIS.validation, title: 'Missing Required Field' },
    'INVALID_FORMAT': { status: 400, type: ERROR_TYPE_URIS.validation, title: 'Invalid Format' },
    'AUTHENTICATION_REQUIRED': { status: 401, type: ERROR_TYPE_URIS.authentication, title: 'Authentication Required' },
    'INVALID_TOKEN': { status: 401, type: ERROR_TYPE_URIS.authentication, title: 'Invalid Token' },
    'TOKEN_EXPIRED': { status: 401, type: ERROR_TYPE_URIS.authentication, title: 'Token Expired' },
    'FORBIDDEN': { status: 403, type: ERROR_TYPE_URIS.authorization, title: 'Forbidden' },
    'INSUFFICIENT_PERMISSIONS': { status: 403, type: ERROR_TYPE_URIS.authorization, title: 'Insufficient Permissions' },
    'RESOURCE_NOT_FOUND': { status: 404, type: ERROR_TYPE_URIS.notFound, title: 'Resource Not Found' },
    'ENDPOINT_NOT_FOUND': { status: 404, type: ERROR_TYPE_URIS.notFound, title: 'Endpoint Not Found' },
    'METHOD_NOT_ALLOWED': { status: 405, type: 'urn:error:method-not-allowed', title: 'Method Not Allowed' },
    'CONFLICT': { status: 409, type: ERROR_TYPE_URIS.conflict, title: 'Resource Conflict' },
    'DUPLICATE_RESOURCE': { status: 409, type: ERROR_TYPE_URIS.conflict, title: 'Duplicate Resource' },
    'RATE_LIMIT_EXCEEDED': { status: 429, type: ERROR_TYPE_URIS.rateLimit, title: 'Rate Limit Exceeded' },
    'INTERNAL_ERROR': { status: 500, type: ERROR_TYPE_URIS.serverError, title: 'Internal Server Error' },
    'DATABASE_ERROR': { status: 500, type: ERROR_TYPE_URIS.serverError, title: 'Database Error' },
    'SERVICE_UNAVAILABLE': { status: 503, type: ERROR_TYPE_URIS.serviceUnavailable, title: 'Service Unavailable' },
    'GATEWAY_TIMEOUT': { status: 504, type: ERROR_TYPE_URIS.timeout, title: 'Gateway Timeout' }
};

/**
 * Validates error handler configuration
 * @param {Object} config - Error handler configuration
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validateErrorConfig(config) {
    const errors = [];

    if (config.format && !ERROR_FORMATS.includes(config.format)) {
        errors.push(`Invalid error format. Must be one of: ${ERROR_FORMATS.join(', ')}`);
    }

    if (config.includeStackTrace !== undefined && typeof config.includeStackTrace !== 'boolean') {
        errors.push('includeStackTrace must be a boolean');
    }

    if (config.logErrors !== undefined && typeof config.logErrors !== 'boolean') {
        errors.push('logErrors must be a boolean');
    }

    if (config.customErrorCodes !== undefined) {
        if (typeof config.customErrorCodes !== 'object' || config.customErrorCodes === null) {
            errors.push('customErrorCodes must be an object');
        } else {
            for (const [code, mapping] of Object.entries(config.customErrorCodes)) {
                if (typeof mapping !== 'object' || mapping === null) {
                    errors.push(`Custom error code '${code}' must have an object mapping`);
                } else if (typeof mapping.status !== 'number' || mapping.status < 400 || mapping.status > 599) {
                    errors.push(`Custom error code '${code}' must have a valid HTTP status code (400-599)`);
                }
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Gets the default title for an HTTP status code
 * @param {number} statusCode - HTTP status code
 * @returns {string} Default title
 */
function getStatusTitle(statusCode) {
    return HTTP_STATUS_TITLES[statusCode] || `Error ${statusCode}`;
}

/**
 * RFC 7807 Problem Details error response
 * @param {Object} options - Error options
 * @param {number} options.status - HTTP status code
 * @param {string} [options.type] - URI reference for the error type
 * @param {string} [options.title] - Short human-readable summary
 * @param {string} [options.detail] - Human-readable explanation
 * @param {string} [options.instance] - URI reference for the specific occurrence
 * @param {Object} [options.extensions] - Additional properties
 * @returns {Object} RFC 7807 compliant error object
 */
function createProblemDetails(options) {
    const status = parseInt(options.status, 10) || 500;

    const problem = {
        type: options.type || ERROR_DEFAULTS.defaultType,
        title: options.title || getStatusTitle(status),
        status: status,
        detail: options.detail || null,
        instance: options.instance || null
    };

    // Remove null values for cleaner output
    if (problem.detail === null) delete problem.detail;
    if (problem.instance === null) delete problem.instance;

    // Add any extension properties
    if (options.extensions && typeof options.extensions === 'object') {
        for (const [key, value] of Object.entries(options.extensions)) {
            // Don't overwrite core properties
            if (!['type', 'title', 'status', 'detail', 'instance'].includes(key)) {
                problem[key] = value;
            }
        }
    }

    return problem;
}

/**
 * Creates a simple error response (non-RFC 7807)
 * @param {Object} options - Error options
 * @param {number} options.status - HTTP status code
 * @param {string} [options.error] - Error type/name
 * @param {string} [options.message] - Error message
 * @param {Object} [options.details] - Additional details
 * @returns {Object} Simple error object
 */
function createSimpleError(options) {
    const status = parseInt(options.status, 10) || 500;

    return {
        statusCode: status,
        error: options.error || getStatusTitle(status),
        message: options.message || options.detail || getStatusTitle(status),
        ...(options.details ? { details: options.details } : {})
    };
}

/**
 * Creates a legacy error response (backwards compatible)
 * @param {Object} options - Error options
 * @param {number} options.status - HTTP status code
 * @param {string} [options.message] - Error message
 * @param {string} [options.code] - Error code
 * @param {Object} [options.data] - Additional data
 * @returns {Object} Legacy error object
 */
function createLegacyError(options) {
    const status = parseInt(options.status, 10) || 500;

    return {
        success: false,
        error: {
            code: options.code || status.toString(),
            message: options.message || options.detail || getStatusTitle(status),
            status: status,
            ...(options.data ? { data: options.data } : {})
        }
    };
}

/**
 * Creates an error response in the specified format
 * @param {Object} options - Error options
 * @param {string} format - Response format ('rfc7807', 'simple', 'legacy')
 * @returns {Object} Formatted error response
 */
function createErrorResponse(options, format = 'rfc7807') {
    switch (format) {
        case 'simple':
            return createSimpleError(options);
        case 'legacy':
            return createLegacyError(options);
        case 'rfc7807':
        default:
            return createProblemDetails(options);
    }
}

/**
 * Parses custom error code mappings from configuration string
 * @param {string|Object} mappings - Error code mappings (JSON string or object)
 * @returns {{codes: Object, errors: Array<string>}}
 */
function parseErrorCodeMappings(mappings) {
    const errors = [];
    let codes = {};

    if (!mappings) {
        return { codes, errors };
    }

    if (typeof mappings === 'object' && mappings !== null) {
        codes = { ...mappings };
    } else if (typeof mappings === 'string') {
        const trimmed = mappings.trim();
        if (trimmed.length === 0) {
            return { codes, errors };
        }

        try {
            codes = JSON.parse(trimmed);
            if (typeof codes !== 'object' || codes === null || Array.isArray(codes)) {
                errors.push('Error code mappings must be a JSON object');
                codes = {};
            }
        } catch (e) {
            errors.push(`Invalid JSON in error code mappings: ${e.message}`);
        }
    }

    // Validate each mapping
    for (const [code, mapping] of Object.entries(codes)) {
        if (typeof mapping !== 'object' || mapping === null) {
            errors.push(`Error code '${code}' must have an object mapping`);
            delete codes[code];
        } else if (mapping.status !== undefined) {
            const status = parseInt(mapping.status, 10);
            if (isNaN(status) || status < 400 || status > 599) {
                errors.push(`Error code '${code}' has invalid status code`);
                delete codes[code];
            }
        }
    }

    return { codes, errors };
}

/**
 * API Error class for structured error handling
 */
class ApiError extends Error {
    /**
     * Create an API error
     * @param {string} code - Error code (e.g., 'VALIDATION_ERROR')
     * @param {string} [message] - Error message
     * @param {Object} [options] - Additional options
     * @param {number} [options.status] - HTTP status code (overrides code mapping)
     * @param {string} [options.type] - RFC 7807 type URI
     * @param {string} [options.title] - RFC 7807 title
     * @param {string} [options.instance] - RFC 7807 instance URI
     * @param {Object} [options.extensions] - Additional properties
     * @param {Error} [options.cause] - Original error that caused this
     */
    constructor(code, message, options = {}) {
        super(message || code);
        this.name = 'ApiError';
        this.code = code;
        this.status = options.status || null;
        this.type = options.type || null;
        this.title = options.title || null;
        this.instance = options.instance || null;
        this.extensions = options.extensions || {};
        this.cause = options.cause || null;
        this.timestamp = new Date().toISOString();

        // Capture stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ApiError);
        }
    }

    /**
     * Convert to RFC 7807 Problem Details format
     * @param {Object} [errorCodes] - Custom error code mappings
     * @param {boolean} [includeStack] - Whether to include stack trace
     * @returns {Object} Problem Details object
     */
    toProblemDetails(errorCodes = {}, includeStack = false) {
        // Get mapping from code
        const mapping = errorCodes[this.code] || DEFAULT_ERROR_CODES[this.code] || {};

        const status = this.status || mapping.status || 500;
        const type = this.type || mapping.type || ERROR_DEFAULTS.defaultType;
        const title = this.title || mapping.title || getStatusTitle(status);

        const problem = createProblemDetails({
            status,
            type,
            title,
            detail: this.message,
            instance: this.instance,
            extensions: {
                ...this.extensions,
                code: this.code,
                timestamp: this.timestamp,
                ...(includeStack && this.stack ? { stack: this.stack.split('\n') } : {})
            }
        });

        return problem;
    }

    /**
     * Convert to simple error format
     * @param {Object} [errorCodes] - Custom error code mappings
     * @param {boolean} [includeStack] - Whether to include stack trace
     * @returns {Object} Simple error object
     */
    toSimpleError(errorCodes = {}, includeStack = false) {
        const mapping = errorCodes[this.code] || DEFAULT_ERROR_CODES[this.code] || {};
        const status = this.status || mapping.status || 500;

        return createSimpleError({
            status,
            error: this.code,
            message: this.message,
            details: {
                ...this.extensions,
                timestamp: this.timestamp,
                ...(includeStack && this.stack ? { stack: this.stack.split('\n') } : {})
            }
        });
    }

    /**
     * Get HTTP status code for this error
     * @param {Object} [errorCodes] - Custom error code mappings
     * @returns {number} HTTP status code
     */
    getStatusCode(errorCodes = {}) {
        if (this.status) return this.status;
        const mapping = errorCodes[this.code] || DEFAULT_ERROR_CODES[this.code] || {};
        return mapping.status || 500;
    }
}

/**
 * Creates an ApiError from various error types
 * @param {Error|Object|string} error - The error to convert
 * @returns {ApiError} ApiError instance
 */
function fromError(error) {
    if (error instanceof ApiError) {
        return error;
    }

    if (error instanceof Error) {
        // Check if error has a code property
        const code = error.code || 'INTERNAL_ERROR';
        return new ApiError(code, error.message, {
            cause: error,
            extensions: {
                originalName: error.name
            }
        });
    }

    if (typeof error === 'object' && error !== null) {
        // Object with error information
        const code = error.code || error.errorCode || 'INTERNAL_ERROR';
        const message = error.message || error.detail || error.error || 'An error occurred';
        return new ApiError(code, message, {
            status: error.status || error.statusCode,
            type: error.type,
            title: error.title,
            instance: error.instance,
            extensions: error.extensions || error.details || {}
        });
    }

    // String or other type
    return new ApiError('INTERNAL_ERROR', String(error));
}

/**
 * Error response handler class
 */
class ErrorHandler {
    /**
     * Create an error handler
     * @param {Object} options - Configuration options
     * @param {string} [options.format='rfc7807'] - Error response format
     * @param {boolean} [options.includeStackTrace=false] - Include stack traces
     * @param {boolean} [options.logErrors=true] - Log errors
     * @param {Object} [options.customErrorCodes] - Custom error code mappings
     * @param {Function} [options.logger] - Custom logger function
     */
    constructor(options = {}) {
        this.format = ERROR_FORMATS.includes(options.format)
            ? options.format
            : ERROR_DEFAULTS.format;
        this.includeStackTrace = options.includeStackTrace === true;
        this.logErrors = options.logErrors !== false;
        this.customErrorCodes = { ...DEFAULT_ERROR_CODES, ...(options.customErrorCodes || {}) };
        this.logger = options.logger || console.error;
    }

    /**
     * Get handler configuration
     * @returns {Object} Configuration object
     */
    getConfig() {
        return {
            format: this.format,
            includeStackTrace: this.includeStackTrace,
            logErrors: this.logErrors,
            customErrorCodes: Object.keys(this.customErrorCodes)
        };
    }

    /**
     * Handle an error and create response
     * @param {Error|ApiError|Object|string} error - The error to handle
     * @param {Object} [context] - Request context for instance URI
     * @returns {{statusCode: number, body: Object, headers: Object}}
     */
    handle(error, context = {}) {
        const apiError = fromError(error);

        // Log error if enabled
        if (this.logErrors) {
            this.logger(`[${apiError.code}] ${apiError.message}`, {
                code: apiError.code,
                status: apiError.getStatusCode(this.customErrorCodes),
                timestamp: apiError.timestamp,
                ...(apiError.cause ? { cause: apiError.cause.message } : {})
            });
        }

        // Set instance from context if available
        if (context.req && !apiError.instance) {
            const path = context.req.originalUrl || context.req.url || context.req.path;
            if (path) {
                apiError.instance = path;
            }
        }

        // Create response body based on format
        let body;
        const statusCode = apiError.getStatusCode(this.customErrorCodes);

        switch (this.format) {
            case 'simple':
                body = apiError.toSimpleError(this.customErrorCodes, this.includeStackTrace);
                break;
            case 'legacy':
                body = createLegacyError({
                    status: statusCode,
                    code: apiError.code,
                    message: apiError.message,
                    data: this.includeStackTrace && apiError.stack
                        ? { stack: apiError.stack.split('\n') }
                        : undefined
                });
                break;
            case 'rfc7807':
            default:
                body = apiError.toProblemDetails(this.customErrorCodes, this.includeStackTrace);
                break;
        }

        // Set appropriate headers
        const headers = {
            'Content-Type': this.format === 'rfc7807'
                ? 'application/problem+json'
                : 'application/json'
        };

        return {
            statusCode,
            body,
            headers
        };
    }

    /**
     * Create a standard error response
     * @param {string} code - Error code
     * @param {string} [message] - Error message
     * @param {Object} [options] - Additional options
     * @returns {{statusCode: number, body: Object, headers: Object}}
     */
    createError(code, message, options = {}) {
        const apiError = new ApiError(code, message, options);
        return this.handle(apiError);
    }

    /**
     * Add custom error code mapping
     * @param {string} code - Error code
     * @param {Object} mapping - Error mapping
     */
    addErrorCode(code, mapping) {
        this.customErrorCodes[code] = mapping;
    }

    /**
     * Get error mapping for a code
     * @param {string} code - Error code
     * @returns {Object|null} Error mapping or null
     */
    getErrorMapping(code) {
        return this.customErrorCodes[code] || null;
    }
}

/**
 * Factory functions for common errors
 */
const ErrorFactory = {
    /**
     * Create a validation error
     * @param {string} message - Error message
     * @param {Array} [errors] - Validation errors array
     * @returns {ApiError}
     */
    validation(message, errors = []) {
        return new ApiError('VALIDATION_ERROR', message, {
            extensions: { errors }
        });
    },

    /**
     * Create an authentication error
     * @param {string} [message] - Error message
     * @returns {ApiError}
     */
    authentication(message = 'Authentication required') {
        return new ApiError('AUTHENTICATION_REQUIRED', message);
    },

    /**
     * Create an authorization error
     * @param {string} [message] - Error message
     * @param {Array} [missingScopes] - Missing scopes
     * @returns {ApiError}
     */
    authorization(message = 'Insufficient permissions', missingScopes = []) {
        return new ApiError('INSUFFICIENT_PERMISSIONS', message, {
            extensions: { missingScopes }
        });
    },

    /**
     * Create a not found error
     * @param {string} [resource] - Resource type
     * @param {string} [id] - Resource ID
     * @returns {ApiError}
     */
    notFound(resource = 'Resource', id = null) {
        const message = id
            ? `${resource} with ID '${id}' not found`
            : `${resource} not found`;
        return new ApiError('RESOURCE_NOT_FOUND', message, {
            extensions: { resource, id }
        });
    },

    /**
     * Create a rate limit error
     * @param {number} retryAfter - Seconds until retry allowed
     * @returns {ApiError}
     */
    rateLimit(retryAfter) {
        return new ApiError('RATE_LIMIT_EXCEEDED', 'Too many requests', {
            extensions: { retryAfter }
        });
    },

    /**
     * Create a conflict error
     * @param {string} [message] - Error message
     * @param {string} [conflictingId] - Conflicting resource ID
     * @returns {ApiError}
     */
    conflict(message = 'Resource conflict', conflictingId = null) {
        return new ApiError('CONFLICT', message, {
            extensions: conflictingId ? { conflictingId } : {}
        });
    },

    /**
     * Create an internal error
     * @param {string} [message] - Error message
     * @param {Error} [cause] - Original error
     * @returns {ApiError}
     */
    internal(message = 'Internal server error', cause = null) {
        return new ApiError('INTERNAL_ERROR', message, { cause });
    },

    /**
     * Create a service unavailable error
     * @param {string} [message] - Error message
     * @param {number} [retryAfter] - Seconds until retry
     * @returns {ApiError}
     */
    serviceUnavailable(message = 'Service temporarily unavailable', retryAfter = null) {
        return new ApiError('SERVICE_UNAVAILABLE', message, {
            extensions: retryAfter ? { retryAfter } : {}
        });
    },

    /**
     * Create a bad request error
     * @param {string} [message] - Error message
     * @param {Object} [details] - Additional details
     * @returns {ApiError}
     */
    badRequest(message = 'Bad request', details = {}) {
        return new ApiError('INVALID_INPUT', message, {
            extensions: details
        });
    },

    /**
     * Create a method not allowed error
     * @param {string} method - The attempted method
     * @param {Array} allowedMethods - Allowed methods
     * @returns {ApiError}
     */
    methodNotAllowed(method, allowedMethods = []) {
        return new ApiError('METHOD_NOT_ALLOWED', `Method ${method} not allowed`, {
            extensions: { method, allowedMethods }
        });
    }
};

module.exports = {
    ERROR_FORMATS,
    ERROR_DEFAULTS,
    HTTP_STATUS_TITLES,
    ERROR_TYPE_URIS,
    DEFAULT_ERROR_CODES,
    ApiError,
    ErrorHandler,
    ErrorFactory,
    validateErrorConfig,
    getStatusTitle,
    createProblemDetails,
    createSimpleError,
    createLegacyError,
    createErrorResponse,
    parseErrorCodeMappings,
    fromError
};
