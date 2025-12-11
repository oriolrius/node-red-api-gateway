'use strict';

/**
 * Pagination utilities for list endpoints
 */

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

module.exports = {
    PAGINATION_STYLES,
    PAGINATION_DEFAULTS,
    validatePaginationConfig,
    parsePaginationParams,
    generatePaginationMetadata
};
