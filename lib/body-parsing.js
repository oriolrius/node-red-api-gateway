"use strict";

/**
 * Request body size limit and optional raw (binary) body parsing for apigw-server.
 *
 * Fastify only parses application/json and text/plain out of the box, with a
 * 1 MiB body limit. These helpers let an apigw-server raise that limit and,
 * opt-in, accept raw bodies (e.g. image uploads) that reach the flow as a Buffer
 * in msg.req.body.
 */

const DEFAULT_BODY_LIMIT = 1048576; // 1 MiB — Fastify's own default
const DEFAULT_BINARY_CONTENT_TYPES = "image/*,application/octet-stream";

/**
 * Normalise body-parsing settings from an apigw-server node config.
 * @param {Object} config - node config (bodyLimit, binaryBodyEnabled, binaryContentTypes)
 * @returns {{bodyLimit: number, binaryBodyEnabled: boolean, binaryContentTypes: string[]}}
 */
function parseBodyOptions(config = {}) {
    const limit = parseInt(config.bodyLimit, 10);
    const types = (config.binaryContentTypes || DEFAULT_BINARY_CONTENT_TYPES)
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    return {
        bodyLimit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_BODY_LIMIT,
        binaryBodyEnabled: config.binaryBodyEnabled === true,
        binaryContentTypes: types
    };
}

/**
 * Turn a configured content type into a Fastify content-type matcher.
 * "image/*" -> /^image\/.+$/ ; anything else is matched literally.
 * @param {string} type
 * @returns {string|RegExp}
 */
function toContentTypeMatcher(type) {
    if (type.endsWith("/*")) {
        const major = type.slice(0, -2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`^${major}\\/.+$`);
    }
    return type;
}

/**
 * Register raw-body parsers on a Fastify instance (must run before listen()).
 * Bodies arrive as a Buffer; the per-parser bodyLimit matches the server limit.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{bodyLimit: number, binaryBodyEnabled: boolean, binaryContentTypes: string[]}} opts
 * @returns {Array<string|RegExp>} the matchers that were registered
 */
function registerBinaryParsers(fastify, opts) {
    if (!opts.binaryBodyEnabled) return [];
    const matchers = opts.binaryContentTypes.map(toContentTypeMatcher);
    for (const matcher of matchers) {
        if (typeof matcher === "string" && fastify.hasContentTypeParser(matcher)) continue;
        fastify.addContentTypeParser(
            matcher,
            { parseAs: "buffer", bodyLimit: opts.bodyLimit },
            (request, body, done) => done(null, body)
        );
    }
    return matchers;
}

module.exports = {
    DEFAULT_BODY_LIMIT,
    DEFAULT_BINARY_CONTENT_TYPES,
    parseBodyOptions,
    toContentTypeMatcher,
    registerBinaryParsers
};
