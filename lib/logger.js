'use strict';

const crypto = require('crypto');

/**
 * Valid log levels (ordered by severity)
 */
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

/**
 * Valid log output destinations
 */
const LOG_OUTPUTS = ['console', 'file', 'both'];

/**
 * Default logger configuration
 */
const LOG_DEFAULTS = {
    level: 'info',
    output: 'console',
    prettyPrint: false,
    filePath: './logs/api-gateway.log',
    redactPaths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.secret'],
    requestIdHeader: 'x-request-id',
    includeTimestamp: true,
    includeHostname: false,
    includePid: true
};

/**
 * Environment variable mappings for configuration override
 */
const ENV_VAR_MAPPINGS = {
    level: 'API_GATEWAY_LOG_LEVEL',
    output: 'API_GATEWAY_LOG_OUTPUT',
    prettyPrint: 'API_GATEWAY_LOG_PRETTY',
    filePath: 'API_GATEWAY_LOG_FILE'
};

/**
 * Validates logger configuration
 * @param {Object} config - Logger configuration
 * @returns {{valid: boolean, errors: Array<string>}} Validation result
 */
function validateLoggerConfig(config) {
    const errors = [];

    if (!config || typeof config !== 'object') {
        return { valid: false, errors: ['Configuration must be an object'] };
    }

    // Validate log level
    if (config.level !== undefined) {
        if (!LOG_LEVELS.includes(config.level)) {
            errors.push(`Invalid log level '${config.level}'. Valid levels: ${LOG_LEVELS.join(', ')}`);
        }
    }

    // Validate output destination
    if (config.output !== undefined) {
        if (!LOG_OUTPUTS.includes(config.output)) {
            errors.push(`Invalid log output '${config.output}'. Valid outputs: ${LOG_OUTPUTS.join(', ')}`);
        }
    }

    // Validate file path if output includes file
    if (config.output === 'file' || config.output === 'both') {
        if (!config.filePath || typeof config.filePath !== 'string' || config.filePath.trim() === '') {
            errors.push('File path is required when output includes file');
        }
    }

    // Validate redact paths if provided
    if (config.redactPaths !== undefined) {
        if (!Array.isArray(config.redactPaths)) {
            errors.push('Redact paths must be an array');
        } else {
            config.redactPaths.forEach((path, index) => {
                if (typeof path !== 'string') {
                    errors.push(`Redact path at index ${index} must be a string`);
                }
            });
        }
    }

    // Validate request ID header
    if (config.requestIdHeader !== undefined) {
        if (typeof config.requestIdHeader !== 'string' || config.requestIdHeader.trim() === '') {
            errors.push('Request ID header must be a non-empty string');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Applies environment variable overrides to configuration
 * @param {Object} config - Base configuration
 * @returns {Object} Configuration with environment overrides applied
 */
function applyEnvOverrides(config) {
    const result = { ...config };

    // Log level override
    const envLevel = process.env[ENV_VAR_MAPPINGS.level];
    if (envLevel && LOG_LEVELS.includes(envLevel.toLowerCase())) {
        result.level = envLevel.toLowerCase();
    }

    // Output override
    const envOutput = process.env[ENV_VAR_MAPPINGS.output];
    if (envOutput && LOG_OUTPUTS.includes(envOutput.toLowerCase())) {
        result.output = envOutput.toLowerCase();
    }

    // Pretty print override
    const envPretty = process.env[ENV_VAR_MAPPINGS.prettyPrint];
    if (envPretty !== undefined) {
        result.prettyPrint = envPretty === 'true' || envPretty === '1';
    }

    // File path override
    const envFilePath = process.env[ENV_VAR_MAPPINGS.filePath];
    if (envFilePath) {
        result.filePath = envFilePath;
    }

    return result;
}

/**
 * Generates a unique request ID
 * @returns {string} Request ID in format req-{timestamp}-{random}
 */
function generateRequestId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex');
    return `req-${timestamp}-${random}`;
}

/**
 * Creates a timer for measuring operation duration
 * @returns {{start: number, elapsed: Function, format: Function}}
 */
function createTimer() {
    const start = Date.now();
    return {
        start,
        /**
         * Get elapsed time in milliseconds
         * @returns {number} Elapsed milliseconds
         */
        elapsed() {
            return Date.now() - start;
        },
        /**
         * Get formatted elapsed time string
         * @returns {string} Formatted duration (e.g., "45ms")
         */
        format() {
            return `${this.elapsed()}ms`;
        }
    };
}

/**
 * Creates a Pino logger instance with the specified configuration
 * @param {Object} [options] - Logger configuration options
 * @param {string} [options.level='info'] - Log level
 * @param {string} [options.output='console'] - Output destination
 * @param {boolean} [options.prettyPrint=false] - Enable pretty printing
 * @param {string} [options.filePath] - Log file path
 * @param {Array<string>} [options.redactPaths] - Paths to redact
 * @param {string} [options.requestIdHeader] - Request ID header name
 * @param {boolean} [options.includeTimestamp=true] - Include timestamp
 * @param {boolean} [options.includeHostname=false] - Include hostname
 * @param {boolean} [options.includePid=true] - Include process ID
 * @returns {Object} Pino logger instance
 */
function createLogger(options = {}) {
    // Merge defaults with options
    let config = {
        ...LOG_DEFAULTS,
        ...options
    };

    // Apply environment variable overrides
    config = applyEnvOverrides(config);

    // Validate final configuration
    const validation = validateLoggerConfig(config);
    if (!validation.valid) {
        // Log warnings but continue with defaults
        validation.errors.forEach(err => {
            console.warn(`[Logger Config Warning] ${err}`);
        });
    }

    // Dynamically require pino
    let pino;
    try {
        pino = require('pino');
    } catch (err) {
        // Pino not available, return a console-based fallback logger
        return createFallbackLogger(config);
    }

    // Build Pino configuration
    const pinoConfig = {
        level: config.level,
        base: {
            ...(config.includePid ? { pid: process.pid } : {}),
            ...(config.includeHostname ? { hostname: require('os').hostname() } : {})
        },
        timestamp: config.includeTimestamp ? pino.stdTimeFunctions.isoTime : false,
        redact: {
            paths: config.redactPaths || LOG_DEFAULTS.redactPaths,
            censor: '[REDACTED]'
        }
    };

    // Configure transport based on output destination
    let transport = null;

    if (config.prettyPrint && config.output === 'console') {
        // Try to use pino-pretty for console output
        try {
            require.resolve('pino-pretty');
            transport = pino.transport({
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    ignore: 'pid,hostname'
                }
            });
        } catch (err) {
            // pino-pretty not available, use standard output
        }
    } else if (config.output === 'file') {
        transport = pino.transport({
            target: 'pino/file',
            options: { destination: config.filePath }
        });
    } else if (config.output === 'both') {
        const targets = [
            { target: 'pino/file', options: { destination: 1 } } // stdout
        ];

        if (config.filePath) {
            targets.push({
                target: 'pino/file',
                options: { destination: config.filePath }
            });
        }

        if (config.prettyPrint) {
            try {
                require.resolve('pino-pretty');
                targets[0] = {
                    target: 'pino-pretty',
                    options: {
                        colorize: true,
                        translateTime: 'SYS:HH:MM:ss.l',
                        ignore: 'pid,hostname',
                        destination: 1
                    }
                };
            } catch (err) {
                // pino-pretty not available
            }
        }

        transport = pino.transport({ targets });
    }

    // Create logger with or without transport
    const logger = transport ? pino(pinoConfig, transport) : pino(pinoConfig);

    // Attach configuration for reference
    logger._config = config;

    return logger;
}

/**
 * Creates a fallback console-based logger when Pino is not available
 * @param {Object} config - Logger configuration
 * @returns {Object} Fallback logger object
 */
function createFallbackLogger(config) {
    const levelPriority = {
        trace: 10,
        debug: 20,
        info: 30,
        warn: 40,
        error: 50,
        fatal: 60,
        silent: Infinity
    };

    const currentLevel = levelPriority[config.level] || levelPriority.info;

    /**
     * Creates a log function for a specific level
     * @param {string} level - Log level
     * @param {Function} consoleFn - Console function to use
     * @returns {Function} Log function
     */
    function createLogFn(level, consoleFn) {
        const priority = levelPriority[level];
        return function(objOrMsg, msg) {
            if (priority < currentLevel) return;

            const timestamp = new Date().toISOString();
            let logObj, message;

            if (typeof objOrMsg === 'object' && objOrMsg !== null) {
                logObj = objOrMsg;
                message = msg || '';
            } else {
                logObj = {};
                message = objOrMsg || '';
            }

            const output = {
                level,
                time: timestamp,
                ...logObj,
                msg: message
            };

            if (config.prettyPrint) {
                consoleFn(`[${timestamp}] ${level.toUpperCase()}: ${message}`, logObj);
            } else {
                consoleFn(JSON.stringify(output));
            }
        };
    }

    const logger = {
        trace: createLogFn('trace', console.debug),
        debug: createLogFn('debug', console.debug),
        info: createLogFn('info', console.info),
        warn: createLogFn('warn', console.warn),
        error: createLogFn('error', console.error),
        fatal: createLogFn('fatal', console.error),
        child(bindings) {
            // Create a child logger with bound context
            const childLogger = { ...this };
            const originalMethods = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

            originalMethods.forEach(level => {
                const originalFn = this[level].bind(this);
                childLogger[level] = function(objOrMsg, msg) {
                    if (typeof objOrMsg === 'object' && objOrMsg !== null) {
                        originalFn({ ...bindings, ...objOrMsg }, msg);
                    } else {
                        originalFn(bindings, objOrMsg);
                    }
                };
            });

            childLogger.child = (additionalBindings) => {
                return this.child({ ...bindings, ...additionalBindings });
            };

            return childLogger;
        },
        level: config.level,
        _config: config,
        _isFallback: true
    };

    return logger;
}

/**
 * Creates a request-scoped child logger with request context
 * @param {Object} baseLogger - Parent Pino logger instance
 * @param {Object} context - Request context
 * @param {string} [context.requestId] - Request ID
 * @param {string} [context.method] - HTTP method
 * @param {string} [context.path] - Request path
 * @param {string} [context.userId] - User ID from authentication
 * @param {string} [context.username] - Username from authentication
 * @param {string} [context.nodeId] - Node-RED node ID
 * @returns {Object} Child logger with bound context
 */
function createRequestLogger(baseLogger, context = {}) {
    if (!baseLogger || typeof baseLogger.child !== 'function') {
        return baseLogger;
    }

    const bindings = {};

    if (context.requestId) bindings.requestId = context.requestId;
    if (context.method) bindings.method = context.method;
    if (context.path) bindings.path = context.path;
    if (context.userId) bindings.userId = context.userId;
    if (context.username) bindings.username = context.username;
    if (context.nodeId) bindings.nodeId = context.nodeId;

    return baseLogger.child(bindings);
}

/**
 * Creates a bridge that routes Node-RED node logging to Pino
 * @param {Object} pinoLogger - Pino logger instance
 * @param {Object} node - Node-RED node instance
 * @returns {Object} Bridge object with Node-RED compatible methods
 */
function createNodeRedLoggerBridge(pinoLogger, node) {
    if (!pinoLogger) {
        return null;
    }

    const nodeContext = {
        nodeId: node?.id,
        nodeName: node?.name,
        nodeType: node?.type
    };

    const childLogger = pinoLogger.child({ component: 'node-red', ...nodeContext });

    return {
        /**
         * Log at info level (maps to node.log)
         * @param {string} msg - Log message
         */
        log(msg) {
            childLogger.info({ event: 'node_log' }, msg);
            // Also call original Node-RED log if available
            if (node && typeof node._origLog === 'function') {
                node._origLog(msg);
            }
        },

        /**
         * Log at warn level (maps to node.warn)
         * @param {string} msg - Warning message
         */
        warn(msg) {
            childLogger.warn({ event: 'node_warn' }, msg);
            if (node && typeof node._origWarn === 'function') {
                node._origWarn(msg);
            }
        },

        /**
         * Log at error level (maps to node.error)
         * @param {string|Error} err - Error or message
         * @param {Object} [msgContext] - Message context
         */
        error(err, msgContext) {
            const errObj = err instanceof Error ? {
                error: err.message,
                stack: err.stack,
                code: err.code
            } : { error: err };

            childLogger.error({ event: 'node_error', ...errObj }, typeof err === 'string' ? err : err.message);
            if (node && typeof node._origError === 'function') {
                node._origError(err, msgContext);
            }
        },

        /**
         * Log at debug level (maps to node.debug)
         * @param {string} msg - Debug message
         */
        debug(msg) {
            childLogger.debug({ event: 'node_debug' }, msg);
        },

        /**
         * Log at trace level
         * @param {string} msg - Trace message
         */
        trace(msg) {
            childLogger.trace({ event: 'node_trace' }, msg);
        },

        /**
         * Get the underlying Pino child logger
         * @returns {Object} Pino logger
         */
        getLogger() {
            return childLogger;
        }
    };
}

/**
 * Standard logger interface definition for lib modules
 * @typedef {Object} LoggerInterface
 * @property {Function} trace - Trace level logging (context, message)
 * @property {Function} debug - Debug level logging (context, message)
 * @property {Function} info - Info level logging (context, message)
 * @property {Function} warn - Warning level logging (context, message)
 * @property {Function} error - Error level logging (context, message)
 * @property {Function} fatal - Fatal level logging (context, message)
 * @property {Function} child - Create child logger with bound context
 */

/**
 * Creates a no-op logger for when logging is disabled
 * @returns {Object} No-op logger object
 */
function createNoopLogger() {
    const noop = () => {};
    return {
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
        fatal: noop,
        child: () => createNoopLogger(),
        level: 'silent',
        _isNoop: true
    };
}

/**
 * Gets the request ID from an HTTP request
 * @param {Object} req - HTTP request object
 * @param {string} [headerName='x-request-id'] - Header name to check
 * @returns {string} Request ID (existing or newly generated)
 */
function getRequestId(req, headerName = 'x-request-id') {
    if (!req) {
        return generateRequestId();
    }

    // Check for existing request ID in headers
    const existingId = req.headers?.[headerName] ||
                       req.headers?.[headerName.toLowerCase()] ||
                       req.id;

    return existingId || generateRequestId();
}

/**
 * Serializer for HTTP request objects (for Pino)
 * @param {Object} req - HTTP request object
 * @returns {Object} Serialized request
 */
function requestSerializer(req) {
    if (!req) return req;

    return {
        method: req.method,
        url: req.url || req.originalUrl,
        path: req.path,
        query: req.query,
        hostname: req.hostname,
        remoteAddress: req.ip || req.connection?.remoteAddress,
        requestId: req.id || req.headers?.['x-request-id'],
        userAgent: req.headers?.['user-agent'],
        contentType: req.headers?.['content-type'],
        contentLength: req.headers?.['content-length']
    };
}

/**
 * Serializer for HTTP response objects (for Pino)
 * @param {Object} res - HTTP response object
 * @returns {Object} Serialized response
 */
function responseSerializer(res) {
    if (!res) return res;

    return {
        statusCode: res.statusCode,
        contentType: res.getHeader?.('content-type'),
        contentLength: res.getHeader?.('content-length')
    };
}

/**
 * Serializer for Error objects (for Pino)
 * @param {Error} err - Error object
 * @returns {Object} Serialized error
 */
function errorSerializer(err) {
    if (!err) return err;

    return {
        type: err.constructor?.name || 'Error',
        message: err.message,
        code: err.code,
        stack: err.stack,
        ...(err.cause ? { cause: errorSerializer(err.cause) } : {})
    };
}

module.exports = {
    // Constants
    LOG_LEVELS,
    LOG_OUTPUTS,
    LOG_DEFAULTS,
    ENV_VAR_MAPPINGS,

    // Configuration
    validateLoggerConfig,
    applyEnvOverrides,

    // Logger creation
    createLogger,
    createFallbackLogger,
    createRequestLogger,
    createNodeRedLoggerBridge,
    createNoopLogger,

    // Request ID utilities
    generateRequestId,
    getRequestId,

    // Timing utilities
    createTimer,

    // Serializers (for Pino/Fastify integration)
    requestSerializer,
    responseSerializer,
    errorSerializer
};
