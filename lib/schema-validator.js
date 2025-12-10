/**
 * JSON Schema validation utilities for API endpoint request validation.
 * Uses AJV (Another JSON Schema Validator) for JSON Schema draft-07 support.
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

/**
 * Creates a configured AJV instance with common formats
 * @param {Object} options - AJV options
 * @returns {Ajv} Configured AJV instance
 */
function createAjv(options = {}) {
    const ajv = new Ajv({
        allErrors: true,
        verbose: true,
        strict: false,
        coerceTypes: options.coerceTypes || false,
        useDefaults: options.useDefaults || true,
        removeAdditional: options.removeAdditional || false,
        ...options
    });

    // Add common string formats (email, uri, date-time, etc.)
    addFormats(ajv);

    return ajv;
}

// Shared AJV instance for validation
let sharedAjv = null;

/**
 * Gets or creates the shared AJV instance
 * @returns {Ajv} Shared AJV instance
 */
function getAjv() {
    if (!sharedAjv) {
        sharedAjv = createAjv();
    }
    return sharedAjv;
}

/**
 * Validation result object
 */
class ValidationResult {
    constructor(valid, errors = [], data = null) {
        this.valid = valid;
        this.errors = errors;
        this.data = data;
    }

    /**
     * Creates a successful validation result
     * @param {*} data - The validated (possibly coerced) data
     * @returns {ValidationResult}
     */
    static success(data) {
        return new ValidationResult(true, [], data);
    }

    /**
     * Creates a failed validation result
     * @param {Array} errors - Array of validation errors
     * @returns {ValidationResult}
     */
    static failure(errors) {
        return new ValidationResult(false, errors, null);
    }

    /**
     * Converts errors to HTTP response format
     * @returns {Object} Error response object
     */
    toHttpError() {
        return {
            statusCode: 400,
            error: 'Bad Request',
            message: 'Validation failed',
            details: this.errors.map(err => ({
                path: err.instancePath || err.dataPath || '',
                message: err.message,
                keyword: err.keyword,
                params: err.params
            }))
        };
    }
}

/**
 * Schema validator class for validating request data
 */
class SchemaValidator {
    constructor(options = {}) {
        this.ajv = options.ajv || getAjv();
        this.compiledSchemas = new Map();
    }

    /**
     * Compiles a JSON schema for repeated use
     * @param {string} key - Unique key for the schema
     * @param {Object} schema - JSON Schema object
     * @returns {Function} Compiled validator function
     */
    compile(key, schema) {
        if (!schema || typeof schema !== 'object') {
            throw new Error('Schema must be an object');
        }

        try {
            const validate = this.ajv.compile(schema);
            this.compiledSchemas.set(key, validate);
            return validate;
        } catch (err) {
            throw new Error(`Failed to compile schema: ${err.message}`);
        }
    }

    /**
     * Gets a compiled schema by key
     * @param {string} key - Schema key
     * @returns {Function|null} Compiled validator or null
     */
    getCompiled(key) {
        return this.compiledSchemas.get(key) || null;
    }

    /**
     * Validates data against a schema
     * @param {*} data - Data to validate
     * @param {Object|string} schema - JSON Schema object or compiled schema key
     * @returns {ValidationResult} Validation result
     */
    validate(data, schema) {
        let validate;

        if (typeof schema === 'string') {
            validate = this.compiledSchemas.get(schema);
            if (!validate) {
                return ValidationResult.failure([{
                    message: `Schema not found: ${schema}`,
                    keyword: 'schema',
                    params: { key: schema }
                }]);
            }
        } else if (typeof schema === 'object') {
            try {
                validate = this.ajv.compile(schema);
            } catch (err) {
                return ValidationResult.failure([{
                    message: `Invalid schema: ${err.message}`,
                    keyword: 'schema',
                    params: {}
                }]);
            }
        } else {
            return ValidationResult.failure([{
                message: 'Schema must be an object or compiled schema key',
                keyword: 'schema',
                params: {}
            }]);
        }

        // Clone data to avoid mutation if useDefaults is enabled
        const dataCopy = JSON.parse(JSON.stringify(data));
        const valid = validate(dataCopy);

        if (valid) {
            return ValidationResult.success(dataCopy);
        }

        return ValidationResult.failure(validate.errors || []);
    }

    /**
     * Clears all compiled schemas
     */
    clear() {
        this.compiledSchemas.clear();
    }
}

/**
 * Validates request body against a JSON schema
 * @param {*} body - Request body to validate
 * @param {Object} schema - JSON Schema for body validation
 * @returns {ValidationResult}
 */
function validateBody(body, schema) {
    if (!schema) {
        return ValidationResult.success(body);
    }

    const validator = new SchemaValidator();
    return validator.validate(body, schema);
}

/**
 * Validates query parameters against a schema
 * @param {Object} query - Query parameters object
 * @param {Object} schema - JSON Schema for query validation
 * @returns {ValidationResult}
 */
function validateQuery(query, schema) {
    if (!schema) {
        return ValidationResult.success(query);
    }

    // Create a validator with type coercion for query params (they're always strings)
    const ajv = createAjv({ coerceTypes: true });
    const validator = new SchemaValidator({ ajv });
    return validator.validate(query || {}, schema);
}

/**
 * Validates path parameters against type definitions
 * @param {Object} params - Path parameters object
 * @param {Object} schema - Schema defining parameter types
 * @returns {ValidationResult}
 */
function validateParams(params, schema) {
    if (!schema) {
        return ValidationResult.success(params);
    }

    // Create a validator with type coercion for path params
    const ajv = createAjv({ coerceTypes: true });
    const validator = new SchemaValidator({ ajv });
    return validator.validate(params || {}, schema);
}

/**
 * Creates a simple schema for path parameter types
 * @param {Object} paramTypes - Object mapping param names to types
 * @returns {Object} JSON Schema
 * @example
 * createParamSchema({ id: 'integer', name: 'string' })
 */
function createParamSchema(paramTypes) {
    if (!paramTypes || typeof paramTypes !== 'object') {
        return null;
    }

    const properties = {};
    const required = [];

    for (const [name, type] of Object.entries(paramTypes)) {
        if (typeof type === 'string') {
            properties[name] = { type: mapParamType(type) };
        } else if (typeof type === 'object') {
            properties[name] = type;
        }
        required.push(name);
    }

    return {
        type: 'object',
        properties,
        required,
        additionalProperties: false
    };
}

/**
 * Maps simple type names to JSON Schema types
 * @param {string} type - Simple type name
 * @returns {string} JSON Schema type
 */
function mapParamType(type) {
    const typeMap = {
        'string': 'string',
        'str': 'string',
        'integer': 'integer',
        'int': 'integer',
        'number': 'number',
        'num': 'number',
        'boolean': 'boolean',
        'bool': 'boolean'
    };
    return typeMap[type.toLowerCase()] || 'string';
}

/**
 * Validates a JSON Schema is syntactically correct
 * @param {Object} schema - Schema to validate
 * @returns {{valid: boolean, error?: string}}
 */
function validateSchema(schema) {
    if (!schema || typeof schema !== 'object') {
        return { valid: false, error: 'Schema must be an object' };
    }

    try {
        const ajv = getAjv();
        ajv.compile(schema);
        return { valid: true };
    } catch (err) {
        return { valid: false, error: err.message };
    }
}

/**
 * Parses a JSON schema string safely
 * @param {string} schemaStr - JSON string representation of schema
 * @returns {{schema: Object|null, error?: string}}
 */
function parseSchema(schemaStr) {
    if (!schemaStr || typeof schemaStr !== 'string') {
        return { schema: null, error: 'Schema string is required' };
    }

    try {
        const schema = JSON.parse(schemaStr);
        const validation = validateSchema(schema);
        if (!validation.valid) {
            return { schema: null, error: validation.error };
        }
        return { schema };
    } catch (err) {
        return { schema: null, error: `Invalid JSON: ${err.message}` };
    }
}

module.exports = {
    createAjv,
    getAjv,
    ValidationResult,
    SchemaValidator,
    validateBody,
    validateQuery,
    validateParams,
    createParamSchema,
    mapParamType,
    validateSchema,
    parseSchema
};
