"use strict";

/**
 * Rate limit key types
 */
const RATE_LIMIT_KEY_TYPES = ["ip", "user", "apiKey", "custom"];

/**
 * Default rate limiter configuration
 */
const RATE_LIMIT_DEFAULTS = {
    requests: 100,       // requests per window
    windowMs: 60000,     // 1 minute in milliseconds
    keyType: "ip"        // default key type
};

/**
 * Validates rate limit configuration
 * @param {Object} config - Rate limit configuration
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validateRateLimitConfig(config) {
    const errors = [];

    if (config.requests !== undefined) {
        const requests = parseInt(config.requests, 10);
        if (isNaN(requests) || requests < 1) {
            errors.push("Rate limit requests must be a positive integer");
        }
    }

    if (config.windowMs !== undefined) {
        const windowMs = parseInt(config.windowMs, 10);
        if (isNaN(windowMs) || windowMs < 1000) {
            errors.push("Rate limit window must be at least 1000ms (1 second)");
        }
    }

    if (config.keyType && !RATE_LIMIT_KEY_TYPES.includes(config.keyType)) {
        errors.push(`Invalid rate limit key type. Must be one of: ${RATE_LIMIT_KEY_TYPES.join(", ")}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Extracts rate limit key from request based on key type
 * @param {Object} req - Express-like request object
 * @param {string} keyType - Type of key to extract (ip, user, apiKey, custom)
 * @param {string} customKeyPath - Path for custom key extraction
 * @param {Object} [options] - Extraction options
 * @param {boolean} [options.trustProxy=false] - Honour X-Forwarded-For as the
 *   client IP. Only enable behind a trusted reverse proxy that overwrites the
 *   header; otherwise a client can spoof it to bypass IP rate limiting.
 * @returns {string|null} The extracted key or null if not found
 */
function extractRateLimitKey(req, keyType, customKeyPath, options = {}) {
    if (!req) {
        return null;
    }

    switch (keyType) {
    case "ip": {
        // X-Forwarded-For is client-controlled, so only honour it when a
        // trusted proxy is configured. Otherwise use the socket peer address,
        // which cannot be spoofed - this prevents both rate-limit bypass and
        // unbounded bucket-map growth from an attacker cycling fake IPs.
        const forwarded = options.trustProxy && req.headers
            ? req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
            : null;
        return forwarded ||
                   req.ip ||
                   req.connection?.remoteAddress ||
                   req.socket?.remoteAddress ||
                   "unknown";
    }

    case "user":
        // Extract user ID from auth context
        return (req.auth && (req.auth.userId || req.auth.sub || req.auth.user?.id)) ||
                   (req.user && (req.user.id || req.user.sub)) ||
                   null;

    case "apiKey":
        // Extract API key from header or query parameter
        return (req.headers && (req.headers["x-api-key"] || req.headers["authorization"]?.replace(/^Bearer\s+/i, ""))) ||
                   (req.query && req.query.apikey) ||
                   null;

    case "custom":
        // Extract using custom path (e.g., 'headers.x-tenant-id')
        if (!customKeyPath) {
            return null;
        }
        return getNestedValue(req, customKeyPath);

    default:
        return null;
    }
}

/**
 * Gets a nested value from an object using dot notation path
 * @param {Object} obj - Object to extract value from
 * @param {string} path - Dot notation path (e.g., 'headers.x-tenant-id')
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
 * Token bucket entry for rate limiting
 * @typedef {Object} TokenBucket
 * @property {number} tokens - Current number of available tokens
 * @property {number} lastRefill - Timestamp of last token refill
 * @property {number} totalRequests - Total requests made in this window
 */

/**
 * Rate Limiter using Token Bucket algorithm
 * Manages rate limiting for API endpoints
 */
class RateLimiter {
    /**
     * Create a new RateLimiter
     * @param {Object} options - Configuration options
     * @param {number} [options.requests=100] - Maximum requests per window
     * @param {number} [options.windowMs=60000] - Time window in milliseconds
     * @param {string} [options.keyType='ip'] - Key type for rate limiting (ip, user, apiKey, custom)
     * @param {string} [options.customKeyPath] - Path for custom key extraction
     * @param {number} [options.cleanupInterval=60000] - Interval for cleaning up expired entries
     */
    constructor(options = {}) {
        this.requests = parseInt(options.requests, 10) || RATE_LIMIT_DEFAULTS.requests;
        this.windowMs = parseInt(options.windowMs, 10) || RATE_LIMIT_DEFAULTS.windowMs;
        this.keyType = RATE_LIMIT_KEY_TYPES.includes(options.keyType)
            ? options.keyType
            : RATE_LIMIT_DEFAULTS.keyType;
        this.customKeyPath = options.customKeyPath || null;
        this.cleanupInterval = options.cleanupInterval || 60000;
        this.trustProxy = options.trustProxy === true;
        // Hard cap on distinct tracked keys, so a flood of unique keys can't
        // grow the bucket map without bound before the periodic cleanup runs.
        this.maxBuckets = parseInt(options.maxBuckets, 10) || 10000;

        // Token buckets keyed by rate limit key
        this._buckets = new Map();

        // Statistics
        this._stats = {
            totalChecks: 0,
            totalAllowed: 0,
            totalBlocked: 0,
            peakConcurrentKeys: 0
        };

        // Start cleanup timer
        this._cleanupTimer = null;
        this._startCleanupTimer();
    }

    /**
     * Get rate limiter configuration
     * @returns {Object} Configuration object
     */
    getConfig() {
        return {
            requests: this.requests,
            windowMs: this.windowMs,
            keyType: this.keyType,
            customKeyPath: this.customKeyPath
        };
    }

    /**
     * Check if a request should be allowed and consume a token if so
     * @param {string} key - The rate limit key
     * @returns {{allowed: boolean, remaining: number, limit: number, resetTime: number, retryAfter: number|null}}
     */
    check(key) {
        if (!key) {
            // If no key provided, allow the request (can't rate limit without a key)
            return {
                allowed: true,
                remaining: this.requests,
                limit: this.requests,
                resetTime: Date.now() + this.windowMs,
                retryAfter: null
            };
        }

        const now = Date.now();
        let bucket = this._buckets.get(key);

        // Create new bucket if doesn't exist
        if (!bucket) {
            // Enforce the size cap before inserting: evict the oldest-inserted
            // buckets (Map preserves insertion order) so memory stays bounded
            // even under a unique-key flood between cleanup runs.
            while (this._buckets.size >= this.maxBuckets) {
                const oldest = this._buckets.keys().next().value;
                if (oldest === undefined) break;
                this._buckets.delete(oldest);
            }
            bucket = {
                tokens: this.requests,
                lastRefill: now,
                totalRequests: 0
            };
            this._buckets.set(key, bucket);
        }

        // Refill tokens based on time elapsed
        const timeSinceRefill = now - bucket.lastRefill;
        if (timeSinceRefill >= this.windowMs) {
            // Full window has passed, reset bucket
            bucket.tokens = this.requests;
            bucket.lastRefill = now;
            bucket.totalRequests = 0;
        }

        // Update stats
        this._stats.totalChecks++;
        if (this._buckets.size > this._stats.peakConcurrentKeys) {
            this._stats.peakConcurrentKeys = this._buckets.size;
        }

        // Calculate reset time
        const resetTime = bucket.lastRefill + this.windowMs;

        // Check if request is allowed
        if (bucket.tokens > 0) {
            bucket.tokens--;
            bucket.totalRequests++;
            this._stats.totalAllowed++;

            return {
                allowed: true,
                remaining: bucket.tokens,
                limit: this.requests,
                resetTime: resetTime,
                retryAfter: null
            };
        } else {
            // Rate limited
            this._stats.totalBlocked++;
            const retryAfter = Math.ceil((resetTime - now) / 1000);

            return {
                allowed: false,
                remaining: 0,
                limit: this.requests,
                resetTime: resetTime,
                retryAfter: retryAfter > 0 ? retryAfter : 1
            };
        }
    }

    /**
     * Check rate limit using request object (convenience method)
     * @param {Object} req - Express-like request object
     * @returns {{allowed: boolean, remaining: number, limit: number, resetTime: number, retryAfter: number|null, key: string|null}}
     */
    checkRequest(req) {
        const key = extractRateLimitKey(req, this.keyType, this.customKeyPath, { trustProxy: this.trustProxy });
        const result = this.check(key);
        return {
            ...result,
            key: key
        };
    }

    /**
     * Get the current status for a specific key
     * @param {string} key - The rate limit key
     * @returns {{tokens: number, limit: number, resetTime: number}|null}
     */
    getStatus(key) {
        const bucket = this._buckets.get(key);
        if (!bucket) {
            return null;
        }

        const now = Date.now();
        const timeSinceRefill = now - bucket.lastRefill;

        // Check if bucket should have been reset
        if (timeSinceRefill >= this.windowMs) {
            return {
                tokens: this.requests,
                limit: this.requests,
                resetTime: now + this.windowMs
            };
        }

        return {
            tokens: bucket.tokens,
            limit: this.requests,
            resetTime: bucket.lastRefill + this.windowMs
        };
    }

    /**
     * Reset rate limit for a specific key
     * @param {string} key - The rate limit key to reset
     */
    reset(key) {
        this._buckets.delete(key);
    }

    /**
     * Clear all rate limit data
     */
    clear() {
        this._buckets.clear();
    }

    /**
     * Get rate limiter statistics
     * @returns {Object} Statistics object
     */
    getStatistics() {
        return {
            config: this.getConfig(),
            current: {
                activeKeys: this._buckets.size
            },
            cumulative: {
                totalChecks: this._stats.totalChecks,
                totalAllowed: this._stats.totalAllowed,
                totalBlocked: this._stats.totalBlocked,
                blockRate: this._stats.totalChecks > 0
                    ? ((this._stats.totalBlocked / this._stats.totalChecks) * 100).toFixed(2) + "%"
                    : "0%"
            },
            peaks: {
                peakConcurrentKeys: this._stats.peakConcurrentKeys
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

        this._cleanupTimer = setInterval(() => {
            this._cleanup();
        }, this.cleanupInterval);

        // Ensure the timer doesn't prevent the process from exiting
        if (this._cleanupTimer.unref) {
            this._cleanupTimer.unref();
        }
    }

    /**
     * Remove expired bucket entries
     * @private
     */
    _cleanup() {
        const now = Date.now();
        const expiredBefore = now - this.windowMs;

        for (const [key, bucket] of this._buckets.entries()) {
            // Remove entries that haven't been used for more than one window
            if (bucket.lastRefill < expiredBefore) {
                this._buckets.delete(key);
            }
        }
    }

    /**
     * Shutdown the rate limiter and clean up resources
     */
    shutdown() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
        this._buckets.clear();
    }
}

/**
 * Generates rate limit HTTP headers
 * @param {Object} result - Result from RateLimiter.check()
 * @returns {Object} Headers object with rate limit headers
 */
function generateRateLimitHeaders(result) {
    const headers = {
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.floor(result.resetTime / 1000))
    };

    if (!result.allowed && result.retryAfter) {
        headers["Retry-After"] = String(result.retryAfter);
    }

    return headers;
}

/**
 * Creates a 429 Too Many Requests error response object
 * @param {Object} result - Result from RateLimiter.check()
 * @param {string} [key] - The rate limit key (for debugging)
 * @returns {Object} Error response object
 */
function createRateLimitError(result, _key) {
    return {
        statusCode: 429,
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please try again later.",
        details: {
            limit: result.limit,
            remaining: result.remaining,
            resetTime: new Date(result.resetTime).toISOString(),
            retryAfter: result.retryAfter
        }
    };
}

module.exports = {
    RATE_LIMIT_KEY_TYPES,
    RATE_LIMIT_DEFAULTS,
    RateLimiter,
    validateRateLimitConfig,
    extractRateLimitKey,
    generateRateLimitHeaders,
    createRateLimitError
};
