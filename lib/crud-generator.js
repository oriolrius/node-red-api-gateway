'use strict';

/**
 * CRUD SQL generation utilities
 */

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

module.exports = {
    CRUD_OPERATIONS,
    CRUD_METHOD_MAPPING,
    validateCrudOperation,
    validateTableName,
    validateColumnName,
    generateCrudSql,
    getDefaultStatusDescription
};
