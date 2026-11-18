"use strict";

/**
 * OpenAPI (JSON Schema 2020-12) for auto-CRUD endpoints, built from the
 * introspected table columns (GH-8).
 *
 * The response of an auto-CRUD endpoint is deterministic: the SQL is
 * SELECT * / OUTPUT INSERTED.*, and tedious maps each SQL type to one JSON
 * shape. These schemas only describe that shape in /openapi.json. They are
 * NOT attached to the Fastify routes: a Fastify response schema switches
 * serialization to fast-json-stringify, which coerces types and drops
 * undeclared properties.
 */

const INTEGER_TYPES = new Set(["int", "smallint", "tinyint"]);
const NUMBER_TYPES = new Set(["float", "real", "decimal", "numeric", "money", "smallmoney"]);
const STRING_TYPES = new Set(["char", "nchar", "varchar", "nvarchar", "text", "ntext", "xml", "sysname"]);
const DATE_TYPES = new Set(["datetime", "datetime2", "smalldatetime", "date", "time", "datetimeoffset"]);
const BINARY_TYPES = new Set(["binary", "varbinary", "image", "timestamp", "rowversion"]);
const READ_ONLY_TYPES = new Set(["timestamp", "rowversion"]);

const BUFFER_SCHEMA = {
    type: "object",
    description: "Binary value as a serialized Node.js Buffer (about 4 JSON bytes per binary byte)",
    properties: {
        type: { const: "Buffer" },
        data: { type: "array", items: { type: "integer", minimum: 0, maximum: 255 } }
    },
    required: ["type", "data"]
};

const PROBLEM_SCHEMA = {
    type: "object",
    description: "RFC 7807 problem details",
    properties: {
        type: { type: "string" },
        title: { type: "string" },
        status: { type: "integer" },
        detail: { type: "string" },
        requestId: { type: "string" }
    },
    required: ["type", "title", "status"]
};

/**
 * JSON Schema of one column value as the API returns it (not nullable).
 * @param {Object} column - Introspected column (see api-config getTableColumns)
 * @param {Object} [options]
 * @param {boolean} [options.lowerCaseGuids=false]
 * @param {boolean} [options.useUTC=true]
 * @returns {Object}
 */
function columnReadSchema(column, options = {}) {
    const t = String(column.dataType || "").toLowerCase();
    if (INTEGER_TYPES.has(t)) {
        return { type: "integer" };
    }
    if (t === "bigint") {
        return { type: "string", pattern: "^-?[0-9]+$", description: "bigint, returned as a string" };
    }
    if (NUMBER_TYPES.has(t)) {
        return { type: "number" };
    }
    if (t === "bit") {
        return { type: "boolean" };
    }
    if (t === "uniqueidentifier") {
        return {
            type: "string",
            format: "uuid",
            description: options.lowerCaseGuids ? "GUID, lower case" : "GUID, upper case"
        };
    }
    if (STRING_TYPES.has(t)) {
        const schema = { type: "string" };
        if (Number.isInteger(column.maxLength) && column.maxLength > 0) {
            schema.maxLength = column.maxLength;
        }
        if (t === "char" || t === "nchar") {
            schema.description = "Fixed length: padded with spaces";
        }
        return schema;
    }
    if (DATE_TYPES.has(t)) {
        let description;
        if (t === "datetimeoffset") {
            description = "ISO 8601, converted to UTC";
        } else if (options.useUTC === false) {
            description = "ISO 8601; the stored value is read in the server's local time zone and returned in UTC";
        } else {
            description = "ISO 8601; the stored wall-clock time with a Z suffix (no time zone conversion)";
        }
        return { type: "string", format: "date-time", description };
    }
    if (BINARY_TYPES.has(t)) {
        return { ...BUFFER_SCHEMA, properties: { ...BUFFER_SCHEMA.properties } };
    }
    // sql_variant, geography, geometry, hierarchyid, ...: any JSON value
    return { description: `SQL type ${t || "unknown"}` };
}

/**
 * JSON Schema of one column value that the API accepts in a request body.
 * @param {Object} column
 * @param {Object} [options]
 * @returns {Object}
 */
function columnWriteSchema(column, options = {}) {
    const t = String(column.dataType || "").toLowerCase();
    if (t === "bigint") {
        // JSON numbers beyond 2^53 lose precision before the gateway sees
        // them: such values must be sent as strings.
        return {
            description: "bigint: an integer within the JavaScript safe range, or a string of digits " +
                "from -9223372036854775808 to 9223372036854775807",
            oneOf: [
                { type: "integer", minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
                // Up to 19 digits. The pattern cannot express the exact range:
                // a 19-digit value beyond it gets 400 from the gateway.
                { type: "string", pattern: "^-?[0-9]{1,19}$" }
            ]
        };
    }
    if (t === "decimal" || t === "numeric") {
        // A string is converted exactly by SQL Server; a number goes through
        // a float and is bound with the column's precision and scale.
        return {
            description: "Number, or a decimal string for exact values",
            oneOf: [{ type: "number" }, { type: "string", pattern: "^-?[0-9]+(\\.[0-9]+)?$" }]
        };
    }
    if (DATE_TYPES.has(t)) {
        return { type: "string", format: t === "date" ? "date" : (t === "time" ? "time" : "date-time") };
    }
    if (BINARY_TYPES.has(t)) {
        return {
            description: "Base64 string, \"0x\" hex string, or a serialized Buffer",
            oneOf: [{ type: "string" }, columnReadSchema(column, options)]
        };
    }
    const schema = columnReadSchema(column, options);
    if (t === "uniqueidentifier") {
        delete schema.description;
    }
    return schema;
}

/**
 * Add "null" to a schema when the column is nullable.
 * @param {Object} schema
 * @param {boolean} nullable
 * @returns {Object}
 */
function withNull(schema, nullable) {
    if (!nullable) {
        return schema;
    }
    if (typeof schema.type === "string") {
        return { ...schema, type: [schema.type, "null"] };
    }
    if (Array.isArray(schema.type)) {
        return schema.type.includes("null") ? schema : { ...schema, type: [...schema.type, "null"] };
    }
    if (schema.oneOf) {
        return { ...schema, oneOf: [...schema.oneOf, { type: "null" }] };
    }
    // Untyped (any value) already allows null
    return schema;
}

/**
 * Row schema: every column is present (null when nullable).
 * @param {Array<Object>} columns
 * @param {Object} [options]
 * @returns {Object}
 */
function buildRowSchema(columns, options = {}) {
    if (!Array.isArray(columns) || columns.length === 0) {
        return { type: "object" };
    }
    const properties = {};
    for (const column of columns) {
        const schema = withNull(columnReadSchema(column, options), column.nullable);
        if (column.identity || column.computed || READ_ONLY_TYPES.has(column.dataType)) {
            schema.readOnly = true;
        }
        properties[column.name] = schema;
    }
    return {
        type: "object",
        properties,
        required: columns.map(c => c.name),
        additionalProperties: false
    };
}

/**
 * Request body schema for create (POST) and update (PUT/PATCH).
 * Identity, computed and rowversion columns cannot be written.
 * @param {Array<Object>} columns
 * @param {string} operation - "create" or "update"
 * @param {Object} [options]
 * @returns {Object}
 */
function buildBodySchema(columns, operation, options = {}) {
    if (!Array.isArray(columns) || columns.length === 0) {
        return { type: "object" };
    }
    const writable = columns.filter(c => !c.identity && !c.computed && !READ_ONLY_TYPES.has(c.dataType));
    const properties = {};
    for (const column of writable) {
        properties[column.name] = withNull(columnWriteSchema(column, options), column.nullable);
    }
    const schema = {
        type: "object",
        properties,
        additionalProperties: false,
        minProperties: 1
    };
    if (operation === "create") {
        const required = writable.filter(c => !c.nullable && !c.hasDefault).map(c => c.name);
        if (required.length > 0) {
            schema.required = required;
        }
    }
    return schema;
}

/**
 * Query value schema for a filter on one column.
 * @param {Object|undefined} column
 * @param {string} operator - eq, ne, gt, gte, lt, lte, like, in
 * @param {Object} [options]
 * @returns {Object}
 */
function filterValueSchema(column, operator, options = {}) {
    if (!column || operator === "like" || operator === "in") {
        return { type: "string" };
    }
    const t = String(column.dataType || "").toLowerCase();
    if (BINARY_TYPES.has(t)) {
        return { type: "string" };
    }
    if (DATE_TYPES.has(t)) {
        return { type: "string", format: t === "date" ? "date" : (t === "time" ? "time" : "date-time") };
    }
    const schema = columnReadSchema(column, options);
    delete schema.description;
    if (!schema.type) {
        return { type: "string" };
    }
    return schema;
}

function jsonContent(schema) {
    return { content: { "application/json": { schema } } };
}

function problemResponse(description) {
    return { description, ...jsonContent(PROBLEM_SCHEMA) };
}

/**
 * Build the OpenAPI pieces of an auto-CRUD operation.
 * @param {Object} options
 * @param {string} options.operation - list, get, create, update, delete
 * @param {Array<Object>|null} options.columns - introspected columns (null/empty: generic object)
 * @param {boolean} options.autoExecute - the gateway runs the SQL and answers (useFlowOutput off)
 * @param {number} [options.successStatusCode=200] - configured success code (list/get/update)
 * @param {Array<string>} [options.filterableFields]
 * @param {number} [options.defaultPageSize]
 * @param {number} [options.maxPageSize]
 * @param {boolean} [options.lowerCaseGuids]
 * @param {boolean} [options.useUTC]
 * @returns {{successStatusCode: number|null, responses: Object|null, requestBody: Object|null,
 *   filterSchema: function(string, string): Object, queryParameters: Array<Object>}}
 */
function buildAutoCrudOpenApi(options = {}) {
    const { operation, columns, autoExecute } = options;
    const schemaOptions = { lowerCaseGuids: options.lowerCaseGuids === true, useUTC: options.useUTC !== false };
    const known = Array.isArray(columns) && columns.length > 0;
    const byName = new Map(known ? columns.map(c => [c.name.toLowerCase(), c]) : []);
    const row = buildRowSchema(columns, schemaOptions);

    const result = {
        successStatusCode: null,
        responses: null,
        requestBody: null,
        queryParameters: [],
        filterSchema: (field, operator) => filterValueSchema(byName.get(String(field).toLowerCase()), operator, schemaOptions)
    };

    if (operation === "create" || operation === "update") {
        result.requestBody = {
            required: true,
            ...jsonContent(buildBodySchema(columns, operation, schemaOptions))
        };
    }

    if (operation === "list" && autoExecute) {
        const maxPageSize = Number.isInteger(options.maxPageSize) && options.maxPageSize > 0 ? options.maxPageSize : 100;
        const defaultPageSize = Math.min(
            Number.isInteger(options.defaultPageSize) && options.defaultPageSize > 0 ? options.defaultPageSize : 10,
            maxPageSize
        );
        result.queryParameters = [
            { name: "limit", in: "query", required: false, description: "Page size", schema: { type: "integer", minimum: 1, maximum: maxPageSize, default: defaultPageSize } },
            { name: "offset", in: "query", required: false, description: "Rows to skip", schema: { type: "integer", minimum: 0, default: 0 } },
            { name: "page", in: "query", required: false, description: "1-based page number (used when offset is absent)", schema: { type: "integer", minimum: 1 } }
        ];
    }

    if (!autoExecute) {
        // A flow builds the response: its shape is unknown.
        return result;
    }

    const configured = parseInt(options.successStatusCode, 10);
    const success = Number.isInteger(configured) && configured >= 200 && configured < 300 ? configured : 200;
    const responses = {};
    switch (operation) {
    case "list":
        result.successStatusCode = success;
        responses[String(success)] = {
            description: "One page of rows",
            ...jsonContent({
                type: "object",
                properties: {
                    data: { type: "array", items: row },
                    total: { type: "integer", minimum: 0, description: "Number of rows that match the filters (all pages)" },
                    limit: { type: "integer", minimum: 1 },
                    offset: { type: "integer", minimum: 0 }
                },
                required: ["data", "total", "limit", "offset"],
                additionalProperties: false
            })
        };
        break;
    case "get":
        result.successStatusCode = success;
        responses[String(success)] = { description: "The row", ...jsonContent(row) };
        responses["404"] = problemResponse("Not found");
        responses["409"] = problemResponse("The key matches more than one row");
        break;
    case "create":
        result.successStatusCode = 201;
        responses["201"] = { description: "The inserted row", ...jsonContent(row) };
        responses["409"] = problemResponse("Conflict (unique or primary key violation)");
        break;
    case "update":
        result.successStatusCode = success;
        responses[String(success)] = { description: "The updated row", ...jsonContent(row) };
        responses["404"] = problemResponse("Not found");
        responses["409"] = problemResponse("Conflict (the key matches more than one row, or a unique violation)");
        break;
    case "delete":
        result.successStatusCode = 204;
        responses["204"] = { description: "Deleted" };
        responses["404"] = problemResponse("Not found");
        responses["409"] = problemResponse("Conflict (the key matches more than one row, or the row is still referenced)");
        break;
    default:
        return result;
    }
    // A configured 204 sends no body for list/get/update either
    const successKey = String(result.successStatusCode);
    if (operation !== "delete" && result.successStatusCode === 204 && responses[successKey]) {
        responses[successKey] = { description: "No content" };
    }
    responses["503"] = problemResponse("Database unavailable or busy (see Retry-After)");
    result.responses = responses;
    return result;
}

module.exports = {
    PROBLEM_SCHEMA,
    columnReadSchema,
    columnWriteSchema,
    buildRowSchema,
    buildBodySchema,
    filterValueSchema,
    buildAutoCrudOpenApi
};
