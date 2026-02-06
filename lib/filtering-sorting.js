'use strict';

/**
 * Filtering and sorting utilities for list endpoints
 */

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
 * Escapes a field name for safe use in SQL Server queries.
 * Uses bracket notation [fieldName] and escapes any ] characters.
 * @param {string} fieldName - The field name to escape
 * @returns {string} Escaped field name safe for SQL
 */
function escapeFieldName(fieldName) {
    // SQL Server bracket escaping: replace ] with ]]
    const escaped = fieldName.replace(/\]/g, ']]');
    return `[${escaped}]`;
}

/**
 * Parses a comma-separated list of field names
 * Accepts any non-empty field names (validation against allowed list happens separately)
 * @param {string|Array} fields - Comma-separated string or array of field names
 * @returns {Array<string>} Array of field names
 */
function parseFieldList(fields) {
    if (!fields) {
        return [];
    }
    if (Array.isArray(fields)) {
        return fields.map(f => String(f).trim()).filter(f => f.length > 0);
    }
    if (typeof fields === 'string') {
        return fields.split(',').map(f => f.trim()).filter(f => f.length > 0);
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
    if (trimmed.length === 0) {
        return { valid: false, error: 'Field name cannot be empty' };
    }
    // Only validate against allowedFields if the list is provided
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
    // Use a more permissive regex that captures anything between brackets
    for (const [key, value] of Object.entries(query)) {
        // Match filter[field] or filter[field][operator]
        // Field name can contain any characters except ]
        const simpleMatch = key.match(/^filter\[([^\]]+)\]$/);
        const operatorMatch = key.match(/^filter\[([^\]]+)\]\[(eq|ne|gt|gte|lt|lte|like|in)\]$/);

        let field = null;
        let operator = 'eq';

        if (operatorMatch) {
            field = operatorMatch[1];
            operator = operatorMatch[2];
        } else if (simpleMatch) {
            field = simpleMatch[1];
        }

        if (field) {
            // Validate field name against allowed list
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
 * Generates a safe parameter name from a field name
 * Replaces non-alphanumeric characters with underscores
 * @param {string} fieldName - The field name
 * @param {number} index - Parameter index for uniqueness
 * @returns {string} Safe parameter name
 */
function safeParamName(fieldName, index) {
    // Replace any non-alphanumeric characters with underscore
    const safe = fieldName.replace(/[^a-zA-Z0-9]/g, '_');
    return `filter_${safe}_${index}`;
}

/**
 * Generates SQL WHERE clause from filters
 * Uses SQL Server bracket notation for field names to handle special characters
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
        const paramName = safeParamName(filter.field, paramIndex);
        const escapedField = escapeFieldName(filter.field);
        paramIndex++;

        switch (filter.operator) {
            case 'eq':
                conditions.push(`${escapedField} = ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'ne':
                conditions.push(`${escapedField} != ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'gt':
                conditions.push(`${escapedField} > ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'gte':
                conditions.push(`${escapedField} >= ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'lt':
                conditions.push(`${escapedField} < ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'lte':
                conditions.push(`${escapedField} <= ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'like':
                conditions.push(`${escapedField} LIKE ${paramPrefix}${paramName}`);
                params[paramName] = filter.value;
                break;
            case 'in':
                if (Array.isArray(filter.value) && filter.value.length > 0) {
                    const inParams = filter.value.map((v, i) => {
                        const inParamName = `${paramName}_${i}`;
                        params[inParamName] = v;
                        return `${paramPrefix}${inParamName}`;
                    });
                    conditions.push(`${escapedField} IN (${inParams.join(', ')})`);
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
 * Uses SQL Server bracket notation for field names to handle special characters
 * @param {Array<{field: string, direction: string}>} sorts - Parsed sorts
 * @returns {string} ORDER BY clause
 */
function generateOrderByClause(sorts) {
    if (!sorts || sorts.length === 0) {
        return '';
    }

    const orderParts = sorts.map(sort =>
        `${escapeFieldName(sort.field)} ${sort.direction.toUpperCase()}`
    );

    return `ORDER BY ${orderParts.join(', ')}`;
}

module.exports = {
    SORT_DIRECTIONS,
    FILTER_SORT_DEFAULTS,
    escapeFieldName,
    parseFieldList,
    validateFieldName,
    parseFilterParams,
    parseSortParams,
    generateWhereClause,
    generateOrderByClause
};
