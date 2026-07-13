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

// A single identifier part is either a bare identifier (letter/underscore start)
// or a bracket-quoted identifier ([...] with no nested brackets or dots).
const IDENTIFIER_PART = '(?:\\[[^\\]\\[.]+\\]|[a-zA-Z_][a-zA-Z0-9_]*)';
// Up to three dot-separated parts: table, schema.table, or database.schema.table.
const QUALIFIED_NAME_RE = new RegExp(`^${IDENTIFIER_PART}(?:\\.${IDENTIFIER_PART}){0,2}$`);

/**
 * Bracket-quotes a single SQL Server identifier, escaping any embedded ] as ]].
 * Strips one existing layer of [ ] so re-quoting is idempotent.
 * @param {string} part - A single identifier (no dot separators)
 * @returns {string} Bracket-quoted identifier, e.g. [%Descuento]
 */
function quoteIdentifierPart(part) {
    const bare = String(part).trim().replace(/^\[([\s\S]*)\]$/, '$1');
    return '[' + bare.replace(/\]/g, ']]') + ']';
}

/**
 * Bracket-quotes a possibly-qualified table name part-by-part, so that
 * database.schema.table (or bracketed variants) becomes [database].[schema].[table].
 * @param {string} tableName - Table name, optionally dot-qualified
 * @returns {string} Fully bracket-quoted table name
 */
function quoteTableName(tableName) {
    return String(tableName)
        .split('.')
        .map(quoteIdentifierPart)
        .join('.');
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
    // Allow 1-3 dot-separated parts (table, schema.table, database.schema.table),
    // each a bare identifier or a bracket-quoted identifier.
    if (!QUALIFIED_NAME_RE.test(trimmed)) {
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
 * @param {Object} options - Additional options (columns, pagination, etc.)
 * @returns {{sql: string, params: Array, paramPlaceholders: Object}}
 */
function generateCrudSql(operation, tableName, primaryKey, options = {}) {
    const result = {
        sql: '',
        operation: operation,
        tableName: tableName,
        primaryKey: primaryKey,
        paramMapping: {},
        supportsPagination: false
    };

    // Bracket-quote identifiers so qualified names (database.schema.table) and
    // columns/keys containing special characters (e.g. %) are emitted safely.
    // The @-prefixed parameter placeholders keep the bare primary-key name, which
    // validateColumnName guarantees is a safe SQL parameter token.
    const table = quoteTableName(tableName);
    const pk = quoteIdentifierPart(primaryKey);

    switch (operation) {
        case 'list':
            // SQL Server 2012+ pagination with OFFSET/FETCH (requires ORDER BY)
            result.sql = `SELECT * FROM ${table} ORDER BY ${pk} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
            result.paramMapping = { offset: 'query.offset', limit: 'query.limit' };
            result.supportsPagination = true;
            break;

        case 'get':
            result.sql = `SELECT * FROM ${table} WHERE ${pk} = @${primaryKey}`;
            result.paramMapping = { [primaryKey]: `params.${primaryKey}` };
            break;

        case 'create':
            // Placeholder - actual columns come from request body
            result.sql = `INSERT INTO ${table} (@columns) VALUES (@values)`;
            result.paramMapping = { columns: 'body.*' };
            break;

        case 'update':
            // Placeholder - actual columns come from request body
            result.sql = `UPDATE ${table} SET @assignments WHERE ${pk} = @${primaryKey}`;
            result.paramMapping = {
                [primaryKey]: `params.${primaryKey}`,
                assignments: 'body.*'
            };
            break;

        case 'delete':
            result.sql = `DELETE FROM ${table} WHERE ${pk} = @${primaryKey}`;
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
    quoteIdentifierPart,
    quoteTableName,
    generateCrudSql,
    getDefaultStatusDescription
};
