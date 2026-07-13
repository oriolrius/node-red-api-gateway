"use strict";

const crypto = require("crypto");

/**
 * Cache key strategy types
 */
const CACHE_KEY_STRATEGIES = ["full", "path", "query", "custom"];

/**
 * Default cache configuration
 */
const CACHE_DEFAULTS = {
    ttl: 300000,           // 5 minutes in milliseconds
    maxSize: 100,          // Maximum number of cached entries
    keyStrategy: "full",   // Default key generation strategy
    varyHeaders: []        // Headers to include in cache key variation
};

/**
 * Validates cache configuration
 * @param {Object} config - Cache configuration
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validateCacheConfig(config) {
    const errors = [];

    if (config.ttl !== undefined) {
        const ttl = parseInt(config.ttl, 10);
        if (isNaN(ttl) || ttl < 0) {
            errors.push("Cache TTL must be a non-negative integer (0 = no expiry)");
        }
    }

    if (config.maxSize !== undefined) {
        const maxSize = parseInt(config.maxSize, 10);
        if (isNaN(maxSize) || maxSize < 1) {
            errors.push("Cache max size must be a positive integer");
        }
    }

    if (config.keyStrategy && !CACHE_KEY_STRATEGIES.includes(config.keyStrategy)) {
        errors.push(`Invalid cache key strategy. Must be one of: ${CACHE_KEY_STRATEGIES.join(", ")}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Generates a cache key from request
 * @param {Object} req - Express-like request object
 * @param {string} strategy - Key generation strategy
 * @param {string} customKeyExpression - Custom key expression for 'custom' strategy
 * @param {Array<string>} varyHeaders - Headers to include in cache key
 * @returns {string} Cache key
 */
function generateCacheKey(req, strategy, customKeyExpression, varyHeaders = []) {
    if (!req) {
        return null;
    }

    let keyParts = [];

    switch (strategy) {
    case "full":
        // Include method, path, query string, and vary headers
        keyParts.push(req.method || "GET");
        keyParts.push(req.path || req.url || "/");
        if (req.query && Object.keys(req.query).length > 0) {
            // Sort query params for consistent key generation
            const sortedQuery = Object.keys(req.query)
                .sort()
                .map(k => `${k}=${req.query[k]}`)
                .join("&");
            keyParts.push(sortedQuery);
        }
        break;

    case "path":
        // Only include method and path (ignore query params)
        keyParts.push(req.method || "GET");
        keyParts.push(req.path || req.url?.split("?")[0] || "/");
        break;

    case "query":
        // Include method, path, and specific query params
        keyParts.push(req.method || "GET");
        keyParts.push(req.path || req.url?.split("?")[0] || "/");
        if (req.query && Object.keys(req.query).length > 0) {
            const sortedQuery = Object.keys(req.query)
                .sort()
                .map(k => `${k}=${req.query[k]}`)
                .join("&");
            keyParts.push(sortedQuery);
        }
        break;

    case "custom":
        // Use custom expression to extract key
        if (customKeyExpression) {
            const customValue = getNestedValue(req, customKeyExpression);
            if (customValue !== undefined && customValue !== null) {
                keyParts.push(String(customValue));
            } else {
                // Fallback to full strategy if custom expression fails
                keyParts.push(req.method || "GET");
                keyParts.push(req.path || req.url || "/");
            }
        } else {
            keyParts.push(req.method || "GET");
            keyParts.push(req.path || req.url || "/");
        }
        break;

    default:
        keyParts.push(req.method || "GET");
        keyParts.push(req.path || req.url || "/");
    }

    // Add vary headers to key
    if (varyHeaders && varyHeaders.length > 0 && req.headers) {
        for (const header of varyHeaders) {
            const headerValue = req.headers[header.toLowerCase()];
            if (headerValue) {
                keyParts.push(`${header}:${headerValue}`);
            }
        }
    }

    return keyParts.join("|");
}

/**
 * Gets a nested value from an object using dot notation path
 * @param {Object} obj - Object to extract value from
 * @param {string} path - Dot notation path
 * @returns {any} The value at the path or undefined
 */
function getNestedValue(obj, path) {
    if (!obj || !path) {
        return undefined;
    }
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}

/**
 * Generates an ETag for response data
 * @param {any} data - Response data to generate ETag for
 * @returns {string} ETag string (weak ETag format)
 */
function generateETag(data) {
    if (data === null || data === undefined) {
        return null;
    }

    let content;
    if (typeof data === "string") {
        content = data;
    } else if (Buffer.isBuffer(data)) {
        content = data.toString("base64");
    } else {
        try {
            content = JSON.stringify(data);
        } catch (e) {
            return null;
        }
    }

    const hash = crypto.createHash("md5").update(content).digest("hex").substring(0, 16);
    return `W/"${hash}"`;
}

/**
 * Checks if request has matching ETag (for conditional requests)
 * @param {Object} req - Express-like request object
 * @param {string} etag - ETag to compare against
 * @returns {boolean} True if ETag matches (304 should be returned)
 */
function checkConditionalRequest(req, etag) {
    if (!req || !etag) {
        return false;
    }

    // Check If-None-Match header
    const ifNoneMatch = req.headers && req.headers["if-none-match"];
    if (ifNoneMatch) {
        // Handle multiple ETags
        const clientETags = ifNoneMatch.split(",").map(e => e.trim());
        if (clientETags.includes("*") || clientETags.includes(etag)) {
            return true;
        }
        // Also check without weak validator prefix
        const cleanEtag = etag.replace(/^W\//, "");
        if (clientETags.some(e => e.replace(/^W\//, "") === cleanEtag)) {
            return true;
        }
    }

    return false;
}

/**
 * Generates cache control headers
 * @param {Object} config - Cache configuration
 * @param {boolean} isPrivate - Whether cache should be private
 * @returns {Object} Headers object
 */
function generateCacheHeaders(config, isPrivate = false) {
    const headers = {};
    const directives = [];

    if (isPrivate) {
        directives.push("private");
    } else {
        directives.push("public");
    }

    if (config.ttl > 0) {
        const maxAge = Math.floor(config.ttl / 1000);
        directives.push(`max-age=${maxAge}`);
    } else {
        directives.push("no-cache");
    }

    headers["Cache-Control"] = directives.join(", ");

    if (config.varyHeaders && config.varyHeaders.length > 0) {
        headers["Vary"] = config.varyHeaders.join(", ");
    }

    return headers;
}

/**
 * Cache entry structure
 * @typedef {Object} CacheEntry
 * @property {any} data - Cached response data
 * @property {number} statusCode - HTTP status code
 * @property {string} etag - ETag for the cached response
 * @property {number} timestamp - When entry was cached
 * @property {number} expires - When entry expires (0 = never)
 * @property {Object} headers - Response headers to cache
 */

/**
 * Response Cache using LRU eviction
 * Manages response caching for API endpoints
 */
class ResponseCache {
    /**
     * Create a new ResponseCache
     * @param {Object} options - Configuration options
     * @param {number} [options.ttl=300000] - Time to live in milliseconds (0 = no expiry)
     * @param {number} [options.maxSize=100] - Maximum number of cached entries
     * @param {string} [options.keyStrategy='full'] - Cache key generation strategy
     * @param {string} [options.customKeyExpression] - Custom key expression
     * @param {Array<string>} [options.varyHeaders=[]] - Headers to include in cache variation
     * @param {number} [options.cleanupInterval=60000] - Interval for cleaning up expired entries
     */
    constructor(options = {}) {
        this.ttl = parseInt(options.ttl, 10);
        if (isNaN(this.ttl) || this.ttl < 0) {
            this.ttl = CACHE_DEFAULTS.ttl;
        }
        this.maxSize = parseInt(options.maxSize, 10) || CACHE_DEFAULTS.maxSize;
        this.keyStrategy = CACHE_KEY_STRATEGIES.includes(options.keyStrategy)
            ? options.keyStrategy
            : CACHE_DEFAULTS.keyStrategy;
        this.customKeyExpression = options.customKeyExpression || null;
        this.varyHeaders = Array.isArray(options.varyHeaders)
            ? options.varyHeaders
            : CACHE_DEFAULTS.varyHeaders;
        this.cleanupInterval = options.cleanupInterval || 60000;

        // LRU cache using Map (maintains insertion order)
        this._cache = new Map();

        // Statistics
        this._stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            evictions: 0,
            expirations: 0
        };

        // Start cleanup timer
        this._cleanupTimer = null;
        this._startCleanupTimer();
    }

    /**
     * Get cache configuration
     * @returns {Object} Configuration object
     */
    getConfig() {
        return {
            ttl: this.ttl,
            maxSize: this.maxSize,
            keyStrategy: this.keyStrategy,
            customKeyExpression: this.customKeyExpression,
            varyHeaders: this.varyHeaders
        };
    }

    /**
     * Get cached response
     * @param {string} key - Cache key
     * @returns {{hit: boolean, data: any, statusCode: number, etag: string, age: number}|{hit: boolean}}
     */
    get(key) {
        if (!key) {
            this._stats.misses++;
            return { hit: false };
        }

        const entry = this._cache.get(key);
        if (!entry) {
            this._stats.misses++;
            return { hit: false };
        }

        const now = Date.now();

        // Check if expired
        if (entry.expires > 0 && now >= entry.expires) {
            this._cache.delete(key);
            this._stats.misses++;
            this._stats.expirations++;
            return { hit: false };
        }

        // Move to end for LRU (delete and re-add)
        this._cache.delete(key);
        this._cache.set(key, entry);

        this._stats.hits++;

        return {
            hit: true,
            data: entry.data,
            statusCode: entry.statusCode,
            etag: entry.etag,
            age: now - entry.timestamp,
            headers: entry.headers
        };
    }

    /**
     * Get cached response using request object
     * @param {Object} req - Express-like request object
     * @returns {{hit: boolean, data: any, statusCode: number, etag: string, age: number, key: string}|{hit: boolean, key: string}}
     */
    getByRequest(req) {
        const key = generateCacheKey(req, this.keyStrategy, this.customKeyExpression, this.varyHeaders);
        const result = this.get(key);
        return { ...result, key };
    }

    /**
     * Store response in cache
     * @param {string} key - Cache key
     * @param {any} data - Response data
     * @param {number} [statusCode=200] - HTTP status code
     * @param {Object} [headers={}] - Response headers to cache
     * @returns {string} ETag for the cached response
     */
    set(key, data, statusCode = 200, headers = {}) {
        if (!key) {
            return null;
        }

        // Evict if at capacity (remove oldest - first entry)
        while (this._cache.size >= this.maxSize) {
            const oldestKey = this._cache.keys().next().value;
            this._cache.delete(oldestKey);
            this._stats.evictions++;
        }

        const now = Date.now();
        const etag = generateETag(data);

        const entry = {
            data,
            statusCode,
            etag,
            timestamp: now,
            expires: this.ttl > 0 ? now + this.ttl : 0,
            headers
        };

        this._cache.set(key, entry);
        this._stats.sets++;

        return etag;
    }

    /**
     * Store response in cache using request object
     * @param {Object} req - Express-like request object
     * @param {any} data - Response data
     * @param {number} [statusCode=200] - HTTP status code
     * @param {Object} [headers={}] - Response headers to cache
     * @returns {{key: string, etag: string}}
     */
    setByRequest(req, data, statusCode = 200, headers = {}) {
        const key = generateCacheKey(req, this.keyStrategy, this.customKeyExpression, this.varyHeaders);
        const etag = this.set(key, data, statusCode, headers);
        return { key, etag };
    }

    /**
     * Check if a key exists in cache (without affecting LRU order)
     * @param {string} key - Cache key
     * @returns {boolean}
     */
    has(key) {
        if (!key) {
            return false;
        }
        const entry = this._cache.get(key);
        if (!entry) {
            return false;
        }
        // Check expiration
        if (entry.expires > 0 && Date.now() >= entry.expires) {
            return false;
        }
        return true;
    }

    /**
     * Delete a cache entry
     * @param {string} key - Cache key
     * @returns {boolean} True if entry was deleted
     */
    delete(key) {
        return this._cache.delete(key);
    }

    /**
     * Delete cache entry by request
     * @param {Object} req - Express-like request object
     * @returns {boolean} True if entry was deleted
     */
    deleteByRequest(req) {
        const key = generateCacheKey(req, this.keyStrategy, this.customKeyExpression, this.varyHeaders);
        return this.delete(key);
    }

    /**
     * Clear all cached entries
     */
    clear() {
        this._cache.clear();
    }

    /**
     * Get cache statistics
     * @returns {Object} Statistics object
     */
    getStatistics() {
        const totalRequests = this._stats.hits + this._stats.misses;
        return {
            config: this.getConfig(),
            current: {
                size: this._cache.size,
                maxSize: this.maxSize
            },
            cumulative: {
                hits: this._stats.hits,
                misses: this._stats.misses,
                sets: this._stats.sets,
                evictions: this._stats.evictions,
                expirations: this._stats.expirations,
                hitRate: totalRequests > 0
                    ? ((this._stats.hits / totalRequests) * 100).toFixed(2) + "%"
                    : "0%"
            }
        };
    }

    /**
     * Start the cleanup timer to remove expired entries
     * @private
     */
    _startCleanupTimer() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
        }

        // Only run cleanup if TTL is set
        if (this.ttl > 0) {
            this._cleanupTimer = setInterval(() => {
                this._cleanup();
            }, this.cleanupInterval);

            // Ensure the timer doesn't prevent the process from exiting
            if (this._cleanupTimer.unref) {
                this._cleanupTimer.unref();
            }
        }
    }

    /**
     * Remove expired cache entries
     * @private
     */
    _cleanup() {
        const now = Date.now();

        for (const [key, entry] of this._cache.entries()) {
            if (entry.expires > 0 && now >= entry.expires) {
                this._cache.delete(key);
                this._stats.expirations++;
            }
        }
    }

    /**
     * Shutdown the cache and clean up resources
     */
    shutdown() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
        this._cache.clear();
    }
}

/**
 * Parse vary headers from string
 * @param {string} varyString - Comma-separated header names
 * @returns {Array<string>} Array of header names
 */
function parseVaryHeaders(varyString) {
    if (!varyString || typeof varyString !== "string") {
        return [];
    }
    return varyString
        .split(",")
        .map(h => h.trim())
        .filter(h => h.length > 0);
}

module.exports = {
    CACHE_KEY_STRATEGIES,
    CACHE_DEFAULTS,
    ResponseCache,
    validateCacheConfig,
    generateCacheKey,
    generateETag,
    checkConditionalRequest,
    generateCacheHeaders,
    parseVaryHeaders
};
