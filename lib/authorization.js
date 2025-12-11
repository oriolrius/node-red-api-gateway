'use strict';

/**
 * Authorization utilities for scope-based access control
 */

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

module.exports = {
    parseScopes,
    checkScopes
};
