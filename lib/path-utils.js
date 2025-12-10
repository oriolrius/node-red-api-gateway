/**
 * Path utilities for API endpoint path parsing and parameter extraction.
 * Supports Express-style path parameters (e.g., /users/:id, /posts/:postId/comments/:commentId)
 */

// Valid HTTP methods for API endpoints
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

// Regex patterns for path validation and parsing
const PATH_PARAM_REGEX = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
const VALID_PATH_SEGMENT_REGEX = /^[a-zA-Z0-9_-]+$/;
const VALID_PARAM_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validates an HTTP method
 * @param {string} method - The HTTP method to validate
 * @returns {boolean} True if valid
 */
function isValidMethod(method) {
    if (typeof method !== 'string') {
        return false;
    }
    return HTTP_METHODS.includes(method.toUpperCase());
}

/**
 * Normalizes an HTTP method to uppercase
 * @param {string} method - The HTTP method to normalize
 * @returns {string} The normalized method
 */
function normalizeMethod(method) {
    if (typeof method !== 'string') {
        return 'GET';
    }
    const upper = method.toUpperCase();
    return HTTP_METHODS.includes(upper) ? upper : 'GET';
}

/**
 * Validates an API endpoint path
 * @param {string} path - The path to validate (e.g., /users/:id)
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validatePath(path) {
    if (typeof path !== 'string') {
        return { valid: false, error: 'Path must be a string' };
    }

    // Path must start with /
    if (!path.startsWith('/')) {
        return { valid: false, error: 'Path must start with /' };
    }

    // Empty path after slash is valid (root path)
    if (path === '/') {
        return { valid: true };
    }

    // Split path into segments (skip first empty segment from leading /)
    const segments = path.split('/').slice(1);

    // Check each segment
    for (const segment of segments) {
        // Empty segments (double slashes) are invalid
        if (segment === '') {
            return { valid: false, error: 'Path contains empty segments (double slashes)' };
        }

        // Check if it's a parameter
        if (segment.startsWith(':')) {
            const paramName = segment.slice(1);
            if (!paramName) {
                return { valid: false, error: 'Parameter name cannot be empty' };
            }
            if (!VALID_PARAM_NAME_REGEX.test(paramName)) {
                return { valid: false, error: `Invalid parameter name: ${paramName}. Must start with letter or underscore, followed by alphanumeric or underscore characters` };
            }
        } else {
            // Regular segment - check for valid characters
            if (!VALID_PATH_SEGMENT_REGEX.test(segment)) {
                return { valid: false, error: `Invalid path segment: ${segment}. Only alphanumeric, dash, and underscore characters allowed` };
            }
        }
    }

    return { valid: true };
}

/**
 * Extracts parameter names from a path template
 * @param {string} path - The path template (e.g., /users/:id/posts/:postId)
 * @returns {string[]} Array of parameter names
 */
function extractParamNames(path) {
    if (typeof path !== 'string') {
        return [];
    }

    const params = [];
    let match;

    // Reset lastIndex before using regex
    PATH_PARAM_REGEX.lastIndex = 0;

    while ((match = PATH_PARAM_REGEX.exec(path)) !== null) {
        params.push(match[1]);
    }

    return params;
}

/**
 * Converts a path template to a regex pattern for matching
 * @param {string} path - The path template (e.g., /users/:id)
 * @returns {{regex: RegExp, paramNames: string[]}} The regex and param names
 */
function pathToRegex(path) {
    if (typeof path !== 'string') {
        return { regex: /^$/, paramNames: [] };
    }

    const paramNames = extractParamNames(path);

    // First replace :param with a placeholder, then escape special chars, then replace placeholder
    const PARAM_PLACEHOLDER = '\x00PARAM\x00';
    let regexString = path
        .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, PARAM_PLACEHOLDER)  // Replace :param with placeholder
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars
        .replace(new RegExp(PARAM_PLACEHOLDER, 'g'), '([^/]+)');  // Replace placeholder with capture group

    // Make trailing slash optional
    regexString = '^' + regexString + '/?$';

    return {
        regex: new RegExp(regexString),
        paramNames
    };
}

/**
 * Extracts parameter values from a request path using a path template
 * @param {string} template - The path template (e.g., /users/:id)
 * @param {string} requestPath - The actual request path (e.g., /users/123)
 * @returns {{match: boolean, params: Object}} Match result with extracted params
 */
function extractParams(template, requestPath) {
    if (typeof template !== 'string' || typeof requestPath !== 'string') {
        return { match: false, params: {} };
    }

    const { regex, paramNames } = pathToRegex(template);
    const match = requestPath.match(regex);

    if (!match) {
        return { match: false, params: {} };
    }

    const params = {};
    paramNames.forEach((name, index) => {
        // match[0] is the full match, params start at match[1]
        params[name] = decodeURIComponent(match[index + 1]);
    });

    return { match: true, params };
}

/**
 * Normalizes a path (removes trailing slashes, ensures leading slash)
 * @param {string} path - The path to normalize
 * @returns {string} The normalized path
 */
function normalizePath(path) {
    if (typeof path !== 'string') {
        return '/';
    }

    let normalized = path.trim();

    // Ensure leading slash
    if (!normalized.startsWith('/')) {
        normalized = '/' + normalized;
    }

    // Remove trailing slashes (except for root path)
    if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }

    return normalized;
}

/**
 * Combines a base path with an endpoint path
 * @param {string} basePath - The base path (e.g., /api/v1)
 * @param {string} endpointPath - The endpoint path (e.g., /users/:id)
 * @returns {string} The combined path
 */
function combinePaths(basePath, endpointPath) {
    const normalizedBase = normalizePath(basePath);
    const normalizedEndpoint = normalizePath(endpointPath);

    // Root endpoint on any base
    if (normalizedEndpoint === '/') {
        return normalizedBase;
    }

    // Root base with endpoint
    if (normalizedBase === '/') {
        return normalizedEndpoint;
    }

    return normalizedBase + normalizedEndpoint;
}

/**
 * Checks if two paths would conflict (same pattern)
 * @param {string} path1 - First path template
 * @param {string} path2 - Second path template
 * @returns {boolean} True if paths conflict
 */
function pathsConflict(path1, path2) {
    // Normalize paths for comparison
    const norm1 = normalizePath(path1);
    const norm2 = normalizePath(path2);

    // Convert both to regex patterns and compare
    // Two paths conflict if they have the same structure (params in same positions)
    const pattern1 = norm1.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, ':param');
    const pattern2 = norm2.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, ':param');

    return pattern1 === pattern2;
}

module.exports = {
    HTTP_METHODS,
    isValidMethod,
    normalizeMethod,
    validatePath,
    extractParamNames,
    pathToRegex,
    extractParams,
    normalizePath,
    combinePaths,
    pathsConflict
};
