"use strict";

/**
 * lib/opa-input.js — canonical OPA policy-input builder.
 *
 * Produces the single, canonical `input` document that every gateway policy
 * evaluation is built from (decision-001, "The canonical input document"). The
 * document is the union of what the shipped Rego templates actually read.
 *
 * Two properties are load-bearing:
 *
 *  1. **Fixed key order.** The OPA client's cache key is `md5(JSON.stringify(input))`,
 *     so the serialization order *is* the cache identity. Keys are inserted in a
 *     fixed sequence and nested objects are key-sorted, so two logically identical
 *     requests hash to one cache entry.
 *
 *  2. **Presence, never null.** A key whose source is absent is *omitted* — never
 *     `null`, never `{}`. In Rego only `false` and *undefined* fail a body
 *     expression, so sending `null` (e.g. for an anonymous token) can satisfy a
 *     gate meant only for authenticated callers. `params` is the sole documented
 *     exception: it is `{}` for a static route.
 *
 * The extra-input mapping facility is a **closed whitelist**: request-derived
 * data can only ever be written into `resource.*`, `environment.*`, `extra.*`
 * and the audit top-level keys — never into `token.*`, `user.*`, `method`,
 * `path` or `route`, which carry gateway-verified identity a policy authorizes
 * on. There is no expression evaluator (no JSONata): a mapping is a fixed
 * source token copied verbatim to a fixed target.
 *
 * Mapping string grammar (shared with the editor's arrow-chip UI):
 *   "<target> -> <source>, <target2> -> <source2>"
 * e.g. "resource.id -> params.id, resource.type -> 'document'"
 * The LEFT side is the (writable) target, the RIGHT side is the (readable)
 * source — mirroring the decision-001 examples where `resource.*` is a target
 * and `params.*` is a source.
 */

// SOURCE tokens (read-only, resolved from the request context) --------------
// Prefixed sources allow a dotted remainder (e.g. auth.token.sub, body.user.id).
const SOURCE_PREFIXES = ["params", "query", "headers", "body", "auth"];
// Bare scalar sources (no dot).
const SOURCE_SCALARS = ["method", "path", "route", "ip"];

// TARGET tokens (writable) --------------------------------------------------
// Prefixed targets accept exactly one key segment (resource.<key>).
const TARGET_PREFIXES = ["resource", "environment", "extra"];
// Bare scalar targets — the audit top-level keys.
const TARGET_SCALARS = ["request_id", "source_ip"];

/**
 * Strip the query string (and fragment) from a path, leaving a clean string.
 * @param {string} p - Raw path, possibly with `?...`
 * @returns {string}
 */
function stripQuery(p) {
    const str = String(p == null ? "" : p);
    const q = str.indexOf("?");
    const clean = q === -1 ? str : str.slice(0, q);
    const h = clean.indexOf("#");
    return h === -1 ? clean : clean.slice(0, h);
}

/**
 * Return a shallow copy of a plain object with keys inserted in sorted order,
 * so serialization is deterministic. Non-objects become `{}`.
 * @param {*} obj
 * @returns {Object}
 */
function sortedObject(obj) {
    const out = {};
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        return out;
    }
    for (const key of Object.keys(obj).sort()) {
        out[key] = obj[key];
    }
    return out;
}

/**
 * True when a source token is a quoted literal, e.g. 'document' or "read".
 * @param {string} token
 * @returns {boolean}
 */
function isLiteralSource(token) {
    return /^'[^']*'$/.test(token) || /^"[^"]*"$/.test(token);
}

/**
 * Resolve a dotted path against an object without prototype traversal.
 * @param {Object} obj - Root object
 * @param {string[]} segments - Path segments
 * @returns {*} Resolved value or undefined
 */
function getPath(obj, segments) {
    let cur = obj;
    for (const seg of segments) {
        if (cur == null || typeof cur !== "object") {
            return undefined;
        }
        if (!Object.prototype.hasOwnProperty.call(cur, seg)) {
            return undefined;
        }
        cur = cur[seg];
    }
    return cur;
}

/**
 * Parse a mapping string into structured `{ target, source }` entries.
 * Splits on commas, then each pair on `->` (or `:` as a fallback), mirroring
 * the editor's `parseFieldMappings`. Does not validate against the whitelist —
 * see {@link validateOpaMappings}.
 * @param {string} str - Mapping string
 * @returns {Array<{target: string, source: string, raw: string}>}
 */
function parseOpaMappings(str) {
    const mappings = [];
    if (!str || typeof str !== "string") {
        return mappings;
    }
    for (let pair of str.split(",")) {
        pair = pair.trim();
        if (!pair) {
            continue;
        }
        let parts = pair.split("->");
        if (parts.length !== 2) {
            parts = pair.split(":");
        }
        if (parts.length === 2) {
            const target = parts[0].trim();
            const source = parts[1].trim();
            if (target && source) {
                mappings.push({ target, source, raw: pair });
            }
        }
    }
    return mappings;
}

/**
 * Validate the source token of a mapping against the closed whitelist.
 * @param {string} source
 * @returns {boolean}
 */
function isValidSource(source) {
    if (isLiteralSource(source)) {
        return true;
    }
    if (SOURCE_SCALARS.includes(source)) {
        return true;
    }
    const dot = source.indexOf(".");
    if (dot === -1) {
        return false;
    }
    const prefix = source.slice(0, dot);
    const rest = source.slice(dot + 1);
    return SOURCE_PREFIXES.includes(prefix) && rest.length > 0;
}

/**
 * Validate the target token of a mapping against the closed whitelist. Targets
 * are exactly one key under a writable prefix, or an audit scalar. `token.*`,
 * `user.*`, `method`, `path` and `route` are deliberately unwritable.
 * @param {string} target
 * @returns {boolean}
 */
function isValidTarget(target) {
    if (TARGET_SCALARS.includes(target)) {
        return true;
    }
    const dot = target.indexOf(".");
    if (dot === -1) {
        return false;
    }
    const prefix = target.slice(0, dot);
    const key = target.slice(dot + 1);
    // Exactly one non-empty segment under a writable prefix.
    return TARGET_PREFIXES.includes(prefix) && key.length > 0 && key.indexOf(".") === -1;
}

/**
 * Validate a list of parsed mappings against the closed whitelist.
 * @param {Array<{target: string, source: string, raw?: string}>} mappings
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateOpaMappings(mappings) {
    const errors = [];
    for (const m of mappings || []) {
        if (!isValidTarget(m.target)) {
            errors.push(
                `Invalid mapping target "${m.target}": writable targets are ` +
                "resource.*, environment.*, extra.*, request_id, source_ip " +
                "(token.*, user.*, method, path and route are not writable)"
            );
        }
        if (!isValidSource(m.source)) {
            errors.push(
                `Invalid mapping source "${m.source}": allowed sources are ` +
                "params.*, query.*, headers.*, body.*, auth.*, method, path, " +
                "route, ip or a 'literal'"
            );
        }
    }
    return { valid: errors.length === 0, errors };
}

/**
 * Resolve a mapping source token to a concrete value from the request context.
 * @param {string} source - Whitelisted source token
 * @param {Object} ctx - The build context (see {@link buildOpaInput})
 * @param {string} method - Already-normalized HTTP method
 * @param {string} path - Already-cleaned path
 * @returns {*} Resolved value or undefined when absent
 */
function resolveSource(source, ctx, method, path) {
    if (isLiteralSource(source)) {
        return source.slice(1, -1);
    }
    switch (source) {
    case "method": return method;
    case "path": return path;
    case "route": return ctx.route;
    case "ip": return ctx.ip;
    default: break;
    }
    const dot = source.indexOf(".");
    const prefix = source.slice(0, dot);
    const segments = source.slice(dot + 1).split(".");
    switch (prefix) {
    case "params": return getPath(ctx.params, segments);
    case "query": return getPath(ctx.query, segments);
    case "headers": return getPath(ctx.headers, [segments[0].toLowerCase(), ...segments.slice(1)]);
    case "body": return getPath(ctx.body, segments);
    case "auth": return getPath(ctx.auth, segments);
    default: return undefined;
    }
}

/**
 * Build the token block from the verified auth context, honouring opaTokenMode.
 * Returns `undefined` (so the key is omitted) for anonymous requests or
 * tokenMode "none".
 * @param {Object} auth - `{ authenticated: boolean, token: <verified claims> }`
 * @param {string} tokenMode - "full" | "claims" | "none"
 * @param {string[]} tokenClaims - claim names to include when tokenMode==="claims"
 * @returns {Object|undefined}
 */
function buildToken(auth, tokenMode, tokenClaims) {
    if (tokenMode === "none") {
        return undefined;
    }
    if (!auth || auth.authenticated !== true) {
        return undefined;
    }
    const claims = auth.token;
    if (!claims || typeof claims !== "object") {
        return undefined;
    }

    if (tokenMode === "claims") {
        const out = {};
        // Build in the configured claim order for determinism; omit absent claims.
        for (const name of tokenClaims || []) {
            if (Object.prototype.hasOwnProperty.call(claims, name) && claims[name] !== undefined) {
                out[name] = claims[name];
            }
        }
        // An empty selection means no usable identity — omit the token entirely.
        return Object.keys(out).length > 0 ? out : undefined;
    }

    // "full": pass the verified claims through, key-sorted for cache stability.
    // `scope` is preserved verbatim (a space-delimited string) — never split or
    // reordered here; the policy splits it (decision-001 "Scope authorization").
    return sortedObject(claims);
}

/**
 * Build the canonical OPA input document.
 *
 * @param {Object} ctx - Build context
 * @param {string} ctx.method - HTTP method
 * @param {string} ctx.path - Request path (query stripped defensively here too)
 * @param {string} [ctx.route] - Route template (defaults to the cleaned path)
 * @param {Object} [ctx.params] - Route params ({} for a static route)
 * @param {Object} [ctx.query] - Parsed query object
 * @param {Object} [ctx.headers] - Request headers (lower-cased keys expected)
 * @param {Object} [ctx.body] - Parsed request body
 * @param {Object} [ctx.auth] - `{ authenticated, token }` gateway-verified identity
 * @param {Object} [ctx.endpoint] - `{ requiredScopes, operator }` declarative context
 * @param {string} [ctx.tokenMode="full"] - "full" | "claims" | "none"
 * @param {string[]} [ctx.tokenClaims] - claim names for tokenMode "claims"
 * @param {Array} [ctx.mappings] - parsed extra-input mappings `[{target, source}]`
 * @param {boolean} [ctx.includeBody=false] - include `input.body`
 * @param {boolean} [ctx.includeAuditFields=false] - include audit top-level keys
 * @param {string} [ctx.requestId] - audit request id (when includeAuditFields)
 * @param {string} [ctx.sourceIp] - audit source ip (when includeAuditFields)
 * @param {string} [ctx.ip] - source ip, available to mappings via `ip`
 * @param {string} [ctx.timestamp] - RFC3339 timestamp (opt-in; omit for cache hygiene)
 * @returns {Object} Canonical input document with deterministic key order
 * @throws {Error} When a mapping violates the closed whitelist
 */
function buildOpaInput(ctx = {}) {
    const method = String(ctx.method || "").toUpperCase();
    const path = stripQuery(ctx.path);
    const route = ctx.route || path;
    const tokenMode = ctx.tokenMode || "full";
    const mappings = ctx.mappings || [];

    // Fail closed and loud on any mapping that escapes the whitelist.
    const { valid, errors } = validateOpaMappings(mappings);
    if (!valid) {
        const err = new Error(`Invalid OPA input mapping(s): ${errors.join("; ")}`);
        err.code = "CONFIG_INVALID";
        throw err;
    }

    // Stage mapping outputs, then merge in fixed order below.
    const staged = { resource: {}, environment: {}, extra: {}, audit: {} };
    for (const m of mappings) {
        const value = resolveSource(m.source, ctx, method, path);
        if (value === undefined) {
            continue; // absent source -> omit target (never write null)
        }
        if (TARGET_SCALARS.includes(m.target)) {
            staged.audit[m.target] = value;
            continue;
        }
        const dot = m.target.indexOf(".");
        const prefix = m.target.slice(0, dot);
        const key = m.target.slice(dot + 1);
        staged[prefix][key] = value;
    }

    // Assemble with a FIXED insertion order — this order is the cache identity.
    const input = {};
    input.method = method;
    input.path = path;
    input.route = route;
    input.params = sortedObject(ctx.params);   // {} for a static route (documented)
    input.query = sortedObject(ctx.query);

    // endpoint: declarative context only — the gateway never evaluates it (D6).
    if (Array.isArray(ctx.endpoint && ctx.endpoint.requiredScopes) &&
        ctx.endpoint.requiredScopes.length > 0) {
        input.endpoint = {
            requiredScopes: ctx.endpoint.requiredScopes.slice(),
            operator: ctx.endpoint.operator === "OR" ? "OR" : "AND"
        };
    }

    // token: present ONLY for authenticated requests; omitted (never null) otherwise.
    const token = buildToken(ctx.auth, tokenMode, ctx.tokenClaims);
    if (token !== undefined) {
        input.token = token;
    }

    // opt-in blocks, appended in this fixed order.
    if (Object.keys(staged.resource).length > 0) {
        input.resource = sortedObject(staged.resource);
    }
    if (Object.keys(staged.environment).length > 0) {
        input.environment = sortedObject(staged.environment);
    }
    if (ctx.timestamp !== undefined && ctx.timestamp !== null) {
        input.timestamp = ctx.timestamp;
    }

    // Audit fields are TOP-LEVEL (request_id, source_ip). Only included when the
    // endpoint opts into audit — this also forces the cache off at the caller.
    if (ctx.includeAuditFields) {
        const requestId = staged.audit.request_id !== undefined ? staged.audit.request_id : ctx.requestId;
        const sourceIp = staged.audit.source_ip !== undefined ? staged.audit.source_ip : ctx.sourceIp;
        if (requestId !== undefined && requestId !== null) {
            input.request_id = requestId;
        }
        if (sourceIp !== undefined && sourceIp !== null) {
            input.source_ip = sourceIp;
        }
    }

    // body: opt-in, and never for methods that carry no body.
    if (ctx.includeBody && ctx.body !== undefined && method !== "GET" && method !== "HEAD") {
        input.body = ctx.body;
    }

    // extra.*: mapped auxiliary data, last so the documented keys keep their order.
    if (Object.keys(staged.extra).length > 0) {
        input.extra = sortedObject(staged.extra);
    }

    return input;
}

module.exports = {
    buildOpaInput,
    parseOpaMappings,
    validateOpaMappings,
    isValidSource,
    isValidTarget,
    stripQuery,
    // Exposed for the editor's source-vocabulary validator and for tests.
    SOURCE_PREFIXES,
    SOURCE_SCALARS,
    TARGET_PREFIXES,
    TARGET_SCALARS
};
