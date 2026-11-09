"use strict";

/**
 * Map database driver errors to safe RFC 7807 problem responses.
 *
 * Raw SQL Server messages carry schema details (table, column and constraint
 * names), so API clients get a generic detail by default; the raw message is
 * only returned when the endpoint explicitly opts in (dev mode).
 */

const DEFAULT_PROBLEM_TYPE_BASE = "https://api.example.com/errors/";

// SQL Server error numbers (sys.messages)
const SQL_UNIQUE_VIOLATIONS = new Set([2627, 2601]);          // PRIMARY KEY / UNIQUE constraint, unique index
const SQL_FK_OR_CHECK_VIOLATION = 547;                       // FOREIGN KEY / CHECK constraint conflict
const SQL_INVALID_DATA = new Set([
    515,    // Cannot insert NULL into a NOT NULL column
    245,    // Conversion failed (varchar -> int, ...)
    241,    // Conversion failed (date/time from string)
    242,    // Out-of-range datetime conversion
    8114,   // Error converting data type
    8115,   // Arithmetic overflow converting to data type
    220,    // Arithmetic overflow for data type
    8152,   // String or binary data would be truncated
    2628,   // String or binary data would be truncated in table/column
    8169,   // Conversion failed converting to uniqueidentifier
    206     // Operand type clash
]);
const CONNECTION_ERROR_CODES = new Set(["ESOCKET", "ECONNCLOSED", "ELOGIN", "ETIMEOUT", "ECONNRESET", "ENOTOPEN"]);

const CLASSES = {
    conflict: { status: 409, slug: "conflict", title: "Conflict", detail: "The request conflicts with the current state of the resource" },
    invalid: { status: 400, slug: "invalid-data", title: "Bad Request", detail: "The request data was rejected by the database" },
    unavailable: { status: 503, slug: "service-unavailable", title: "Service Unavailable", detail: "Database temporarily unavailable" },
    busy: { status: 503, slug: "service-busy", title: "Service Unavailable", detail: "Database connection pool is busy, retry later" },
    internal: { status: 500, slug: "database-error", title: "Database Error", detail: "Database error" }
};

/**
 * Extract the SQL Server error number from an mssql/tedious error.
 * @param {Error} err
 * @returns {number|null}
 */
function getSqlErrorNumber(err) {
    if (!err) return null;
    const candidates = [err.number, err.originalError?.number, err.originalError?.info?.number, err.info?.number];
    for (const n of candidates) {
        if (typeof n === "number") return n;
    }
    return null;
}

/**
 * True when the error is a pool acquire timeout: every connection in the
 * mssql pool stayed busy for dbPoolAcquireTimeout. mssql passes tarn's
 * TimeoutError through unwrapped (no code, no SQL number); the class has no
 * own `name`, so match on the constructor name.
 * @param {Error} err
 * @returns {boolean}
 */
function isPoolAcquireTimeout(err) {
    return !!err && typeof err === "object" &&
        (err.name === "TimeoutError" || err.constructor?.name === "TimeoutError") &&
        !err.code && getSqlErrorNumber(err) === null;
}

/**
 * Classify a database error.
 * @param {Error} err
 * @param {string} [operation] - CRUD operation (list/get/create/update/delete)
 * @returns {{status: number, slug: string, title: string, detail: string, sqlNumber: number|null}}
 */
function classifyDbError(err, operation) {
    const number = getSqlErrorNumber(err);
    let cls = CLASSES.internal;
    if (number !== null && SQL_UNIQUE_VIOLATIONS.has(number)) {
        cls = CLASSES.conflict;
    } else if (number === SQL_FK_OR_CHECK_VIOLATION) {
        // Deleting a row that other rows still reference is a state conflict;
        // on insert/update the client sent a value the constraints reject.
        cls = operation === "delete" ? CLASSES.conflict : CLASSES.invalid;
    } else if (number !== null && SQL_INVALID_DATA.has(number)) {
        cls = CLASSES.invalid;
    } else if (err && CONNECTION_ERROR_CODES.has(err.code)) {
        cls = CLASSES.unavailable;
    } else if (isPoolAcquireTimeout(err)) {
        // Capacity, not an internal fault: let clients back off and retry.
        cls = CLASSES.busy;
    }
    return { ...cls, sqlNumber: number };
}

/**
 * Join a problem type base URI and a slug.
 * @param {string} base - e.g. "https://errors.example.org/" or "urn:problem:"
 * @param {string} slug
 * @returns {string}
 */
function problemTypeUri(base, slug) {
    const b = (typeof base === "string" && base.trim()) ? base.trim() : DEFAULT_PROBLEM_TYPE_BASE;
    return /[/:#]$/.test(b) ? `${b}${slug}` : `${b}/${slug}`;
}

/**
 * Build the RFC 7807 body for a database error.
 * @param {Error} err
 * @param {Object} options
 * @param {string} [options.operation] - CRUD operation
 * @param {boolean} [options.expose=false] - return the raw driver message (dev mode only)
 * @param {string} [options.requestId] - correlation id, added as an extension member
 * @param {string} [options.typeBase] - problem type base URI
 * @param {number} [options.retryAfter=1] - Retry-After seconds for 503 answers
 * @returns {{status: number, body: Object, headers: Object}}
 */
function buildDbErrorResponse(err, options = {}) {
    const cls = classifyDbError(err, options.operation);
    const body = {
        type: problemTypeUri(options.typeBase, cls.slug),
        title: cls.title,
        status: cls.status,
        detail: options.expose && err && err.message ? err.message : cls.detail
    };
    if (options.requestId) {
        body.requestId = options.requestId;
    }
    const headers = {};
    if (cls.status === 503) {
        const retryAfter = Number.isInteger(options.retryAfter) && options.retryAfter > 0 ? options.retryAfter : 1;
        headers["Retry-After"] = String(retryAfter);
    }
    return { status: cls.status, body, headers };
}

module.exports = {
    DEFAULT_PROBLEM_TYPE_BASE,
    getSqlErrorNumber,
    isPoolAcquireTimeout,
    classifyDbError,
    problemTypeUri,
    buildDbErrorResponse
};
