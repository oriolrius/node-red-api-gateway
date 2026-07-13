/**
 * Request/Response transformation utilities for API endpoint data shaping.
 * Uses JSONata for expression-based transformations.
 */

const jsonata = require("jsonata");

/**
 * Cache for compiled JSONata expressions
 */
const expressionCache = new Map();

/**
 * Transformation result object
 */
class TransformationResult {
    constructor(success, data = null, error = null) {
        this.success = success;
        this.data = data;
        this.error = error;
    }

    /**
     * Creates a successful transformation result
     * @param {*} data - The transformed data
     * @returns {TransformationResult}
     */
    static ok(data) {
        return new TransformationResult(true, data, null);
    }

    /**
     * Creates a failed transformation result
     * @param {string} error - Error message
     * @returns {TransformationResult}
     */
    static fail(error) {
        return new TransformationResult(false, null, error);
    }

    /**
     * Converts error to HTTP response format
     * @returns {Object} Error response object
     */
    toHttpError() {
        return {
            statusCode: 500,
            error: "Internal Server Error",
            message: "Transformation failed",
            details: {
                error: this.error
            }
        };
    }
}

/**
 * Validates a JSONata expression string
 * @param {string} exprStr - JSONata expression string
 * @returns {{valid: boolean, error?: string}}
 */
function validateExpression(exprStr) {
    if (!exprStr || typeof exprStr !== "string") {
        return { valid: false, error: "Expression must be a non-empty string" };
    }

    const trimmed = exprStr.trim();
    if (!trimmed) {
        return { valid: true }; // Empty expression is valid (no-op)
    }

    try {
        jsonata(trimmed);
        return { valid: true };
    } catch (err) {
        return { valid: false, error: err.message };
    }
}

/**
 * Compiles a JSONata expression, using cache for repeated compilations
 * @param {string} exprStr - JSONata expression string
 * @returns {{expression: Object|null, error?: string}}
 */
function compileExpression(exprStr) {
    if (!exprStr || typeof exprStr !== "string") {
        return { expression: null, error: "Expression must be a non-empty string" };
    }

    const trimmed = exprStr.trim();
    if (!trimmed) {
        return { expression: null }; // Empty expression returns null (no-op)
    }

    // Check cache first
    if (expressionCache.has(trimmed)) {
        return { expression: expressionCache.get(trimmed) };
    }

    try {
        const expression = jsonata(trimmed);
        expressionCache.set(trimmed, expression);
        return { expression };
    } catch (err) {
        return { expression: null, error: err.message };
    }
}

/**
 * Clears the expression cache
 */
function clearExpressionCache() {
    expressionCache.clear();
}

/**
 * Transforms data using a JSONata expression
 * @param {*} data - Data to transform
 * @param {string|Object} expression - JSONata expression string or compiled expression
 * @param {Object} context - Additional context variables for the expression
 * @returns {Promise<TransformationResult>}
 */
async function transformData(data, expression, context = {}) {
    if (!expression) {
        return TransformationResult.ok(data);
    }

    let compiledExpr;

    if (typeof expression === "string") {
        const compiled = compileExpression(expression);
        if (compiled.error) {
            return TransformationResult.fail(`Invalid expression: ${compiled.error}`);
        }
        if (!compiled.expression) {
            return TransformationResult.ok(data); // Empty expression, return as-is
        }
        compiledExpr = compiled.expression;
    } else if (typeof expression === "object" && expression !== null) {
        compiledExpr = expression;
    } else {
        return TransformationResult.fail("Expression must be a string or compiled JSONata expression");
    }

    try {
        // Bind context variables to the expression
        const bindings = {
            msg: context.msg || {},
            params: context.params || {},
            query: context.query || {},
            headers: context.headers || {},
            ...context.custom
        };

        const result = await compiledExpr.evaluate(data, bindings);
        return TransformationResult.ok(result);
    } catch (err) {
        return TransformationResult.fail(`Transformation error: ${err.message}`);
    }
}

/**
 * Transforms request body using a JSONata expression
 * @param {*} body - Request body to transform
 * @param {string} expression - JSONata expression string
 * @param {Object} context - Request context (msg, params, query, headers)
 * @returns {Promise<TransformationResult>}
 */
async function transformRequest(body, expression, context = {}) {
    return transformData(body, expression, context);
}

/**
 * Transforms response data using a JSONata expression
 * @param {*} data - Response data to transform
 * @param {string} expression - JSONata expression string
 * @param {Object} context - Response context (msg, params, query, headers)
 * @returns {Promise<TransformationResult>}
 */
async function transformResponse(data, expression, context = {}) {
    return transformData(data, expression, context);
}

/**
 * Parses a field mapping string into a mapping object
 * Supports format: "oldName->newName, anotherOld->anotherNew"
 * @param {string} mappingStr - Field mapping string
 * @returns {{mappings: Object, errors: Array<string>}}
 */
function parseFieldMapping(mappingStr) {
    const mappings = {};
    const errors = [];

    if (!mappingStr || typeof mappingStr !== "string") {
        return { mappings, errors };
    }

    const trimmed = mappingStr.trim();
    if (!trimmed) {
        return { mappings, errors };
    }

    const pairs = trimmed.split(",");

    for (const pair of pairs) {
        const trimmedPair = pair.trim();
        if (!trimmedPair) {
            continue;
        }

        // Support both -> and : as separators
        let parts = trimmedPair.split("->");

        if (parts.length !== 2) {
            parts = trimmedPair.split(":");
        }

        if (parts.length !== 2) {
            errors.push(`Invalid mapping format: "${trimmedPair}". Use "oldName->newName" or "oldName:newName"`);
            continue;
        }

        const oldName = parts[0].trim();
        const newName = parts[1].trim();

        if (!oldName || !newName) {
            errors.push(`Invalid mapping: "${trimmedPair}". Both old and new names are required`);
            continue;
        }

        // Validate field names (alphanumeric, underscores, dots for nested)
        const fieldNameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
        if (!fieldNameRegex.test(oldName)) {
            errors.push(`Invalid source field name: "${oldName}"`);
            continue;
        }
        if (!fieldNameRegex.test(newName)) {
            errors.push(`Invalid target field name: "${newName}"`);
            continue;
        }

        mappings[oldName] = newName;
    }

    return { mappings, errors };
}

/**
 * Applies field mappings to rename fields in an object
 * @param {Object} data - Object to transform
 * @param {Object|string} mappings - Mapping object or mapping string
 * @returns {TransformationResult}
 */
function applyFieldMapping(data, mappings) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return TransformationResult.ok(data);
    }

    let mappingObj = mappings;

    if (typeof mappings === "string") {
        const parsed = parseFieldMapping(mappings);
        if (parsed.errors.length > 0) {
            return TransformationResult.fail(`Field mapping errors: ${parsed.errors.join("; ")}`);
        }
        mappingObj = parsed.mappings;
    }

    if (!mappingObj || typeof mappingObj !== "object" || Object.keys(mappingObj).length === 0) {
        return TransformationResult.ok(data);
    }

    try {
        // Resolve every target value from the ORIGINAL data first, so a
        // swap ({a:'b', b:'a'}) or rename chain ({user_id:'id', id:'legacy_id'})
        // does not overwrite a source another mapping still needs. Mutating in
        // place sequentially loses data; compute renames, then apply.
        const renamed = {};
        const removedSources = new Set();
        for (const [oldName, newName] of Object.entries(mappingObj)) {
            if (oldName in data) {
                renamed[newName] = data[oldName];
                if (oldName !== newName) {
                    removedSources.add(oldName);
                }
            }
        }

        const result = {};
        // Carry over fields that are not being renamed away...
        for (const key of Object.keys(data)) {
            if (!removedSources.has(key)) {
                result[key] = data[key];
            }
        }
        // ...then apply the resolved renames (targets overwrite).
        for (const [newName, value] of Object.entries(renamed)) {
            result[newName] = value;
        }

        return TransformationResult.ok(result);
    } catch (err) {
        return TransformationResult.fail(`Field mapping error: ${err.message}`);
    }
}

/**
 * Generates a JSONata expression from field mappings
 * Useful for converting simple mappings to full JSONata expressions
 * @param {Object|string} mappings - Mapping object or string
 * @returns {{expression: string|null, error?: string}}
 */
function fieldMappingToExpression(mappings) {
    let mappingObj = mappings;

    if (typeof mappings === "string") {
        const parsed = parseFieldMapping(mappings);
        if (parsed.errors.length > 0) {
            return { expression: null, error: parsed.errors.join("; ") };
        }
        mappingObj = parsed.mappings;
    }

    if (!mappingObj || typeof mappingObj !== "object" || Object.keys(mappingObj).length === 0) {
        return { expression: null };
    }

    try {
        const assignments = Object.entries(mappingObj)
            .map(([oldName, newName]) => `"${newName}": $.${oldName}`)
            .join(", ");

        const expression = `{ ${assignments} }`;
        return { expression };
    } catch (err) {
        return { expression: null, error: err.message };
    }
}

module.exports = {
    TransformationResult,
    validateExpression,
    compileExpression,
    clearExpressionCache,
    transformData,
    transformRequest,
    transformResponse,
    parseFieldMapping,
    applyFieldMapping,
    fieldMappingToExpression
};
