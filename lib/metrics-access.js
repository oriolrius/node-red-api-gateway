"use strict";

/**
 * Access control for the apigw-server Prometheus metrics route.
 *
 * The metrics route shares the API listener, so it gets its own guard:
 *  - an optional source-IP allowlist (IPs and CIDRs, IPv4 and IPv6), and
 *  - one authentication mode:
 *      none   - public, no credentials (explicit opt-in)
 *      bearer - static token, "Authorization: Bearer <token>"
 *      basic  - static username/password, "Authorization: Basic ..."
 *      oauth2 - OAuth2 access token validated by the gateway's Keycloak client,
 *               optionally requiring scopes/roles
 */

const crypto = require("crypto");
const net = require("net");
const { parseScopes, checkScopes } = require("./authorization");

const METRICS_AUTH_MODES = ["none", "bearer", "basic", "oauth2"];

/**
 * Strip the IPv4-mapped IPv6 prefix so "::ffff:10.0.0.1" matches "10.0.0.0/8".
 * @param {string} ip
 * @returns {string}
 */
function normalizeIp(ip) {
    if (typeof ip !== "string") return "";
    const trimmed = ip.trim();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
    return mapped ? mapped[1] : trimmed;
}

/**
 * Build a net.BlockList from a comma-separated list of IPs and CIDRs.
 * @param {string|string[]} allowedIps
 * @returns {{blockList: net.BlockList|null, entries: string[], invalid: string[]}}
 */
function parseAllowedIps(allowedIps) {
    const raw = Array.isArray(allowedIps) ? allowedIps : String(allowedIps || "").split(",");
    const entries = raw.map((s) => String(s).trim()).filter(Boolean);
    if (entries.length === 0) {
        return { blockList: null, entries, invalid: [] };
    }
    const blockList = new net.BlockList();
    const invalid = [];
    for (const entry of entries) {
        const [addr, prefixStr] = entry.split("/");
        const ip = normalizeIp(addr);
        const family = net.isIP(ip);
        if (!family) {
            invalid.push(entry);
            continue;
        }
        const type = family === 6 ? "ipv6" : "ipv4";
        if (prefixStr === undefined) {
            blockList.addAddress(ip, type);
            continue;
        }
        const prefix = Number(prefixStr);
        const max = family === 6 ? 128 : 32;
        if (!/^\d+$/.test(prefixStr) || prefix > max) {
            invalid.push(entry);
            continue;
        }
        blockList.addSubnet(ip, prefix, type);
    }
    return { blockList, entries, invalid };
}

/**
 * @param {net.BlockList|null} blockList - null means "any source allowed"
 * @param {string} ip
 * @returns {boolean}
 */
function isIpAllowed(blockList, ip) {
    if (!blockList) return true;
    const addr = normalizeIp(ip);
    const family = net.isIP(addr);
    if (!family) return false;
    return blockList.check(addr, family === 6 ? "ipv6" : "ipv4");
}

/**
 * Constant-time string comparison (hashing first equalises the lengths).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

/**
 * Normalise metrics access settings from an apigw-server config + credentials.
 * @param {Object} config - node config (metricsAuth, metricsAllowedIps, metricsRequiredScopes, metricsScopeOperator)
 * @param {Object} [credentials] - node credentials (metricsToken, metricsUsername, metricsPassword)
 * @returns {Object} normalised settings, with `errors` listing misconfiguration
 */
function parseMetricsAccess(config = {}, credentials = {}) {
    const mode = METRICS_AUTH_MODES.includes(config.metricsAuth) ? config.metricsAuth : "none";
    const ips = parseAllowedIps(config.metricsAllowedIps);
    const creds = credentials || {};
    const settings = {
        auth: mode,
        token: creds.metricsToken || "",
        username: creds.metricsUsername || "",
        password: creds.metricsPassword || "",
        requiredScopes: parseScopes(config.metricsRequiredScopes),
        scopeOperator: config.metricsScopeOperator === "OR" ? "OR" : "AND",
        allowedIps: ips.entries,
        blockList: ips.blockList,
        errors: []
    };
    if (ips.invalid.length > 0) {
        settings.errors.push(`Invalid metrics allowlist entries: ${ips.invalid.join(", ")}`);
    }
    if (mode === "bearer" && !settings.token) {
        settings.errors.push("Metrics auth is 'bearer' but no metrics token is set");
    }
    if (mode === "basic" && (!settings.username || !settings.password)) {
        settings.errors.push("Metrics auth is 'basic' but the username or password is not set");
    }
    return settings;
}

/**
 * Create a Fastify preHandler that guards the metrics route.
 * Misconfiguration fails closed (503) rather than exposing metrics.
 * @param {Object} settings - output of parseMetricsAccess()
 * @param {Object} [deps]
 * @param {function(string): Promise<{valid: boolean, scopes?: string[], error?: string}>} [deps.validateToken]
 *        OAuth2 token validator; resolves to null/undefined when OAuth2 is not configured
 * @returns {Function} async (request, reply) preHandler
 */
function createMetricsGuard(settings, deps = {}) {
    function deny(reply, status, message, extraHeaders) {
        if (extraHeaders) {
            for (const [name, value] of Object.entries(extraHeaders)) reply.header(name, value);
        }
        const errors = { 401: "Unauthorized", 403: "Forbidden", 503: "Service Unavailable" };
        return reply.code(status).send({ statusCode: status, error: errors[status], message });
    }

    return async function metricsGuard(request, reply) {
        if (settings.errors.length > 0) {
            return deny(reply, 503, "Metrics endpoint misconfigured");
        }

        if (!isIpAllowed(settings.blockList, request.ip)) {
            return deny(reply, 403, "Source address not allowed");
        }

        const header = request.headers.authorization || "";

        switch (settings.auth) {
        case "bearer": {
            const challenge = { "WWW-Authenticate": "Bearer realm=\"metrics\"" };
            if (!header.startsWith("Bearer ")) {
                return deny(reply, 401, "Missing bearer token", challenge);
            }
            if (!safeEqual(header.slice(7), settings.token)) {
                return deny(reply, 401, "Invalid bearer token", challenge);
            }
            return;
        }
        case "basic": {
            const challenge = { "WWW-Authenticate": "Basic realm=\"metrics\", charset=\"UTF-8\"" };
            if (!header.startsWith("Basic ")) {
                return deny(reply, 401, "Missing basic credentials", challenge);
            }
            const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
            const sep = decoded.indexOf(":");
            const user = sep >= 0 ? decoded.slice(0, sep) : "";
            const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
            // Evaluate both comparisons so timing does not reveal which part failed
            const userOk = safeEqual(user, settings.username);
            const passOk = safeEqual(pass, settings.password);
            if (!(userOk && passOk)) {
                return deny(reply, 401, "Invalid credentials", challenge);
            }
            return;
        }
        case "oauth2": {
            const challenge = { "WWW-Authenticate": "Bearer realm=\"metrics\"" };
            if (!header.startsWith("Bearer ")) {
                return deny(reply, 401, "Missing bearer token", challenge);
            }
            const result = deps.validateToken ? await deps.validateToken(header.slice(7)) : null;
            if (!result) {
                return deny(reply, 503, "OAuth2 authentication not configured");
            }
            if (!result.valid) {
                return deny(reply, 401, result.error || "Invalid token", challenge);
            }
            const scopeCheck = checkScopes(result.scopes || [], settings.requiredScopes, settings.scopeOperator);
            if (!scopeCheck.authorized) {
                return deny(reply, 403, "Insufficient scope");
            }
            return;
        }
        default:
            return;
        }
    };
}

module.exports = {
    METRICS_AUTH_MODES,
    normalizeIp,
    parseAllowedIps,
    isIpAllowed,
    safeEqual,
    parseMetricsAccess,
    createMetricsGuard
};
