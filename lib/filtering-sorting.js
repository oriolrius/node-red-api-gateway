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

module.exports = {
    SORT_DIRECTIONS,
    FILTER_SORT_DEFAULTS,
    parseFieldList,
    validateFieldName,
    parseFilterParams,
    parseSortParams,
    generateWhereClause,
    generateOrderByClause
};
