/**
 * API Endpoint Editor Utilities
 *
 * Validation and UI helper functions for the api-endpoint node editor.
 * This file is loaded as a resource by Node-RED.
 */
(function() {
    'use strict';

    // Namespace for our utilities
    window.ApiEndpointEditor = window.ApiEndpointEditor || {};

    /**
     * Validate an API path
     * @param {string} path - The path to validate
     * @returns {{valid: boolean, error?: string}}
     */
    ApiEndpointEditor.validatePath = function(path) {
        if (!path || path.trim() === '') {
            return { valid: false, error: 'Path is required' };
        }
        if (!path.startsWith('/')) {
            return { valid: false, error: 'Path must start with /' };
        }
        if (path.indexOf('//') !== -1) {
            return { valid: false, error: 'Path cannot contain double slashes' };
        }
        var invalidParamRegex = /:([^/]*)/g;
        var match;
        while ((match = invalidParamRegex.exec(path)) !== null) {
            var paramName = match[1];
            if (paramName && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramName)) {
                return { valid: false, error: 'Invalid parameter name: ' + paramName };
            }
        }
        return { valid: true };
    };

    /**
     * Extract parameter names from a path
     * @param {string} path - The path to extract params from
     * @returns {string[]} Array of parameter names
     */
    ApiEndpointEditor.extractParams = function(path) {
        var params = [];
        var paramRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
        var match;
        while ((match = paramRegex.exec(path)) !== null) {
            params.push(match[1]);
        }
        return params;
    };

    /**
     * Validate a JSON schema string
     * @param {string} schemaStr - The schema string to validate
     * @returns {{valid: boolean, error?: string}}
     */
    ApiEndpointEditor.validateJsonSchema = function(schemaStr) {
        if (!schemaStr || schemaStr.trim() === '') {
            return { valid: true };
        }
        try {
            var schema = JSON.parse(schemaStr);
            if (typeof schema !== 'object' || schema === null) {
                return { valid: false, error: 'Schema must be a JSON object' };
            }
            return { valid: true };
        } catch (e) {
            return { valid: false, error: 'Invalid JSON: ' + e.message };
        }
    };

    /**
     * Validate response schemas format
     * @param {string} schemasStr - Response schemas JSON string
     * @returns {{valid: boolean, error?: string}}
     */
    ApiEndpointEditor.validateResponseSchemas = function(schemasStr) {
        if (!schemasStr || schemasStr.trim() === '') {
            return { valid: true };
        }
        try {
            var schemas = JSON.parse(schemasStr);
            if (typeof schemas !== 'object' || schemas === null || Array.isArray(schemas)) {
                return { valid: false, error: 'Must be an object mapping status codes to schemas' };
            }
            for (var statusCode in schemas) {
                if (statusCode !== 'default' && !/^[1-5][0-9]{2}$/.test(statusCode)) {
                    return { valid: false, error: 'Invalid status code: ' + statusCode };
                }
                if (typeof schemas[statusCode] !== 'object' || schemas[statusCode] === null) {
                    return { valid: false, error: 'Schema for ' + statusCode + ' must be an object' };
                }
            }
            return { valid: true };
        } catch (e) {
            return { valid: false, error: 'Invalid JSON: ' + e.message };
        }
    };

    /**
     * Format JSON in a textarea
     * @param {string} selector - jQuery selector for the textarea
     */
    ApiEndpointEditor.formatJson = function(selector) {
        var $textarea = $(selector);
        var value = $textarea.val().trim();
        if (value) {
            try {
                var obj = JSON.parse(value);
                $textarea.val(JSON.stringify(obj, null, 2));
            } catch (e) {
                // Leave as-is if not valid JSON
            }
        }
    };

    /**
     * Minify JSON in a textarea
     * @param {string} selector - jQuery selector for the textarea
     */
    ApiEndpointEditor.minifyJson = function(selector) {
        var $textarea = $(selector);
        var value = $textarea.val().trim();
        if (value) {
            try {
                var obj = JSON.parse(value);
                $textarea.val(JSON.stringify(obj));
            } catch (e) {
                // Leave as-is if not valid JSON
            }
        }
    };

    /**
     * Validate a table name for SQL safety
     * @param {string} tableName - Table name to validate
     * @returns {{valid: boolean, error?: string}}
     */
    ApiEndpointEditor.validateTableName = function(tableName) {
        if (!tableName || tableName.trim() === '') {
            return { valid: true }; // Empty is allowed
        }
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(tableName.trim())) {
            return { valid: false, error: 'Invalid table name format' };
        }
        return { valid: true };
    };

    /**
     * Validate a field name
     * Now accepts any non-empty string to support SQL Server fields with special characters
     * @param {string} fieldName - Field name to validate
     * @returns {boolean}
     */
    ApiEndpointEditor.isValidFieldName = function(fieldName) {
        // Accept any non-empty field name to support special characters like %, ñ, etc.
        return typeof fieldName === 'string' && fieldName.trim().length > 0;
    };

    /**
     * Parse a comma-separated list of field names
     * @param {string} fieldStr - Comma-separated field names
     * @returns {string[]} Valid field names
     */
    ApiEndpointEditor.parseFieldList = function(fieldStr) {
        if (!fieldStr) return [];
        return fieldStr.split(',')
            .map(function(f) { return f.trim(); })
            .filter(function(f) { return f.length > 0; });
    };

    /**
     * Validate a JSONata expression (basic syntax check)
     * @param {string} exprStr - Expression string
     * @returns {{valid: boolean, error?: string}}
     */
    ApiEndpointEditor.validateJsonataExpression = function(exprStr) {
        if (!exprStr || exprStr.trim() === '') {
            return { valid: true };
        }
        var trimmed = exprStr.trim();
        var brackets = 0, parens = 0, braces = 0;
        var inString = false, stringChar = null;

        for (var i = 0; i < trimmed.length; i++) {
            var c = trimmed[i];
            if (inString) {
                if (c === stringChar && trimmed[i-1] !== '\\') {
                    inString = false;
                }
            } else {
                if (c === '"' || c === "'") {
                    inString = true;
                    stringChar = c;
                } else if (c === '[') brackets++;
                else if (c === ']') brackets--;
                else if (c === '(') parens++;
                else if (c === ')') parens--;
                else if (c === '{') braces++;
                else if (c === '}') braces--;
            }
        }

        if (brackets !== 0) return { valid: false, error: 'Unbalanced brackets []' };
        if (parens !== 0) return { valid: false, error: 'Unbalanced parentheses ()' };
        if (braces !== 0) return { valid: false, error: 'Unbalanced braces {}' };
        if (inString) return { valid: false, error: 'Unterminated string' };

        return { valid: true };
    };

    /**
     * Validate field mappings string
     * @param {string} mappingStr - Field mappings (e.g., "oldName->newName,foo->bar")
     * @returns {{valid: boolean, error?: string}}
     */
    ApiEndpointEditor.validateFieldMappings = function(mappingStr) {
        if (!mappingStr || mappingStr.trim() === '') {
            return { valid: true };
        }
        var pairs = mappingStr.split(',');
        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i].trim();
            if (!pair) continue;

            var parts = pair.split('->');
            if (parts.length !== 2) {
                parts = pair.split(':');
            }
            if (parts.length !== 2) {
                return { valid: false, error: 'Invalid format: "' + pair + '". Use oldName->newName' };
            }

            var oldName = parts[0].trim();
            var newName = parts[1].trim();

            if (!oldName || !newName) {
                return { valid: false, error: 'Both old and new names required in: "' + pair + '"' };
            }
            if (!ApiEndpointEditor.isValidFieldName(oldName)) {
                return { valid: false, error: 'Invalid source field name: "' + oldName + '"' };
            }
            if (!ApiEndpointEditor.isValidFieldName(newName)) {
                return { valid: false, error: 'Invalid target field name: "' + newName + '"' };
            }
        }
        return { valid: true };
    };

    /**
     * Parse field mappings into array of {oldName, newName}
     * @param {string} mappingStr - Field mappings string
     * @returns {Array<{oldName: string, newName: string}>}
     */
    ApiEndpointEditor.parseFieldMappings = function(mappingStr) {
        var mappings = [];
        if (!mappingStr) return mappings;

        var pairs = mappingStr.split(',');
        pairs.forEach(function(pair) {
            pair = pair.trim();
            if (!pair) return;

            var parts = pair.split('->');
            if (parts.length !== 2) {
                parts = pair.split(':');
            }
            if (parts.length === 2) {
                var oldName = parts[0].trim();
                var newName = parts[1].trim();
                if (oldName && newName) {
                    mappings.push({ oldName: oldName, newName: newName });
                }
            }
        });
        return mappings;
    };

    /**
     * Validate custom error codes JSON
     * @param {string} codesStr - Error codes JSON string
     * @returns {{valid: boolean, error?: string}}
     */
    ApiEndpointEditor.validateCustomErrorCodes = function(codesStr) {
        if (!codesStr || codesStr.trim() === '') {
            return { valid: true };
        }
        try {
            var codes = JSON.parse(codesStr);
            if (typeof codes !== 'object' || codes === null || Array.isArray(codes)) {
                return { valid: false, error: 'Error codes must be a JSON object' };
            }
            for (var code in codes) {
                var mapping = codes[code];
                if (typeof mapping !== 'object' || mapping === null) {
                    return { valid: false, error: 'Code "' + code + '" must have an object mapping' };
                }
                if (mapping.status !== undefined) {
                    var status = parseInt(mapping.status, 10);
                    if (isNaN(status) || status < 400 || status > 599) {
                        return { valid: false, error: 'Code "' + code + '" has invalid status (must be 400-599)' };
                    }
                }
            }
            return { valid: true };
        } catch (e) {
            return { valid: false, error: 'Invalid JSON: ' + e.message };
        }
    };

    /**
     * Generate SQL preview for CRUD operations
     * @param {string} operation - CRUD operation
     * @param {string} tableName - Table name
     * @param {string} primaryKey - Primary key column
     * @returns {string} SQL preview
     */
    ApiEndpointEditor.generateSqlPreview = function(operation, tableName, primaryKey) {
        tableName = tableName || '[table_name]';
        primaryKey = primaryKey || 'id';

        switch (operation) {
            case 'list':
                return 'SELECT * FROM ' + tableName;
            case 'get':
                return 'SELECT * FROM ' + tableName + ' WHERE ' + primaryKey + ' = @' + primaryKey;
            case 'create':
                return 'INSERT INTO ' + tableName + ' (@columns) VALUES (@values)';
            case 'update':
                return 'UPDATE ' + tableName + ' SET @assignments WHERE ' + primaryKey + ' = @' + primaryKey;
            case 'delete':
                return 'DELETE FROM ' + tableName + ' WHERE ' + primaryKey + ' = @' + primaryKey;
            default:
                return '-- No operation selected';
        }
    };

    /**
     * Setup validation handler for a text input/textarea
     * @param {string} inputSelector - Input element selector
     * @param {string} errorSelector - Error display element selector
     * @param {function} validator - Validation function returning {valid, error}
     */
    ApiEndpointEditor.setupValidation = function(inputSelector, errorSelector, validator) {
        $(inputSelector).on('input change', function() {
            var validation = validator($(this).val());
            var $error = $(errorSelector);
            if (!validation.valid) {
                $(this).addClass('input-error');
                $error.text(validation.error).show();
            } else {
                $(this).removeClass('input-error');
                $error.hide();
            }
        });
    };

    /**
     * Toggle visibility of an element based on checkbox state
     * @param {string} checkboxSelector - Checkbox selector
     * @param {string} targetSelector - Target element selector
     * @param {function} [callback] - Optional callback after toggle
     */
    ApiEndpointEditor.setupToggle = function(checkboxSelector, targetSelector, callback) {
        $(checkboxSelector).on('change', function() {
            var enabled = $(this).is(':checked');
            if (enabled) {
                $(targetSelector).show();
            } else {
                $(targetSelector).hide();
            }
            if (callback) callback(enabled);
        });
    };

    /**
     * Escape HTML special characters to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    ApiEndpointEditor.escapeHtml = function(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    /**
     * Render badge elements for a list of items
     * @param {string} displaySelector - Container element selector
     * @param {string[]} items - Items to display
     * @param {string} badgeClass - CSS class for badges
     */
    ApiEndpointEditor.renderBadges = function(displaySelector, items, badgeClass) {
        var $display = $(displaySelector);
        $display.empty();
        items.forEach(function(item) {
            var escaped = ApiEndpointEditor.escapeHtml(item);
            $display.append('<span class="' + badgeClass + '">' + escaped + '</span> ');
        });
    };

    /**
     * Render scope badges with operator
     * @param {string} displaySelector - Container element selector
     * @param {string[]} scopes - Scopes to display
     * @param {string} operator - AND or OR
     */
    ApiEndpointEditor.renderScopeBadges = function(displaySelector, scopes, operator) {
        var $display = $(displaySelector);
        $display.empty();
        scopes.forEach(function(scope, index) {
            var escaped = ApiEndpointEditor.escapeHtml(scope);
            $display.append('<span class="scope-badge">' + escaped + '</span>');
            if (index < scopes.length - 1) {
                $display.append(' <span style="color: #666;">' + operator + '</span> ');
            }
        });
    };

    /**
     * Render field mapping badges
     * @param {string} displaySelector - Container element selector
     * @param {Array<{oldName: string, newName: string}>} mappings - Field mappings
     */
    ApiEndpointEditor.renderMappingBadges = function(displaySelector, mappings) {
        var $display = $(displaySelector);
        $display.empty();
        mappings.forEach(function(mapping) {
            var escapedOld = ApiEndpointEditor.escapeHtml(mapping.oldName);
            var escapedNew = ApiEndpointEditor.escapeHtml(mapping.newName);
            $display.append('<span class="mapping-badge">' + escapedOld + ' → ' + escapedNew + '</span> ');
        });
    };

    /**
     * Parse scopes from comma-separated string
     * @param {string} scopesStr - Comma-separated scopes
     * @returns {string[]}
     */
    ApiEndpointEditor.parseScopes = function(scopesStr) {
        if (!scopesStr) return [];
        return scopesStr.split(',')
            .map(function(s) { return s.trim(); })
            .filter(function(s) { return s.length > 0; });
    };

    /**
     * Normalize a path (ensure leading slash, remove trailing slash)
     * @param {string} path - Path to normalize
     * @returns {string}
     */
    ApiEndpointEditor.normalizePath = function(path) {
        var normalized = path.trim();
        if (normalized && !normalized.startsWith('/')) {
            normalized = '/' + normalized;
        }
        if (normalized && normalized.length > 1 && normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }
        return normalized || '/';
    };

})();
