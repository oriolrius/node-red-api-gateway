"use strict";

const EventEmitter = require("events");
const crypto = require("crypto");

/**
 * Circuit breaker states
 */
const CircuitState = {
    CLOSED: "closed",      // Normal operation, requests go through
    OPEN: "open",          // Circuit is open, requests fail fast
    HALF_OPEN: "half_open" // Testing if service is recovered
};

/**
 * Default OPA client configuration
 */
const DEFAULT_OPA_CONFIG = {
    // Connection
    opaUrl: "http://localhost:8181",
    policyPath: "v1/data/api/gateway/allow",
    timeout: 5000,

    // Retry settings
    retryAttempts: 3,
    initialBackoff: 1000,
    maxBackoff: 10000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,

    // Cache settings
    cacheEnabled: true,
    cacheTtl: 60000,        // 1 minute
    cacheMaxSize: 1000,

    // Circuit breaker settings
    circuitBreakerEnabled: true,
    circuitBreakerThreshold: 5,     // Failures before opening
    circuitBreakerTimeout: 60000,   // Time before half-open
    circuitBreakerSuccessThreshold: 2  // Successes to close from half-open
};

/**
 * Validates OPA client configuration
 * @param {Object} config - Configuration to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validateOpaConfig(config) {
    const errors = [];

    if (config.opaUrl && typeof config.opaUrl !== "string") {
        errors.push("OPA URL must be a string");
    }

    if (config.timeout !== undefined) {
        const timeout = parseInt(config.timeout, 10);
        if (isNaN(timeout) || timeout < 0) {
            errors.push("Timeout must be a non-negative integer");
        }
    }

    if (config.retryAttempts !== undefined) {
        const attempts = parseInt(config.retryAttempts, 10);
        if (isNaN(attempts) || attempts < 0) {
            errors.push("Retry attempts must be a non-negative integer");
        }
    }

    if (config.cacheTtl !== undefined) {
        const ttl = parseInt(config.cacheTtl, 10);
        if (isNaN(ttl) || ttl < 0) {
            errors.push("Cache TTL must be a non-negative integer");
        }
    }

    if (config.cacheMaxSize !== undefined) {
        const maxSize = parseInt(config.cacheMaxSize, 10);
        if (isNaN(maxSize) || maxSize < 1) {
            errors.push("Cache max size must be a positive integer");
        }
    }

    if (config.circuitBreakerThreshold !== undefined) {
        const threshold = parseInt(config.circuitBreakerThreshold, 10);
        if (isNaN(threshold) || threshold < 1) {
            errors.push("Circuit breaker threshold must be a positive integer");
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Cache entry for OPA results
 * @typedef {Object} CacheEntry
 * @property {any} result - Cached result
 * @property {number} timestamp - When entry was cached
 * @property {number} expires - When entry expires
 */

/**
 * OPA Client
 * Provides policy evaluation with caching, retry logic, and circuit breaker
 */
class OpaClient extends EventEmitter {
    /**
     * Create a new OPA Client
     * @param {Object} options - Configuration options
     * @param {string} [options.opaUrl='http://localhost:8181'] - OPA server URL
     * @param {string} [options.policyPath='v1/data/api/gateway/allow'] - Policy path
     * @param {number} [options.timeout=5000] - Request timeout in ms
     * @param {number} [options.retryAttempts=3] - Number of retry attempts
     * @param {number} [options.initialBackoff=1000] - Initial backoff delay in ms
     * @param {number} [options.maxBackoff=10000] - Maximum backoff delay in ms
     * @param {number} [options.backoffMultiplier=2] - Backoff multiplier
     * @param {number} [options.jitterFactor=0.1] - Jitter factor (0-1)
     * @param {boolean} [options.cacheEnabled=true] - Enable result caching
     * @param {number} [options.cacheTtl=60000] - Cache TTL in ms
     * @param {number} [options.cacheMaxSize=1000] - Maximum cache entries
     * @param {boolean} [options.circuitBreakerEnabled=true] - Enable circuit breaker
     * @param {number} [options.circuitBreakerThreshold=5] - Failures before opening
     * @param {number} [options.circuitBreakerTimeout=60000] - Time before half-open in ms
     * @param {number} [options.circuitBreakerSuccessThreshold=2] - Successes to close
     * @param {Function} [options.fetchFn] - Custom fetch function (for testing)
     * @param {Object} [options.logger] - Logger instance for structured logging
     */
    constructor(options = {}) {
        super();
        this.config = { ...DEFAULT_OPA_CONFIG, ...options };

        // Logger for structured logging
        this._logger = options.logger || null;

        // HTTP client
        this._fetch = options.fetchFn || globalThis.fetch;

        // Cache (LRU using Map)
        this._cache = new Map();

        // Circuit breaker state
        this._circuitState = CircuitState.CLOSED;
        this._failureCount = 0;
        this._successCount = 0;
        this._lastFailureTime = null;
        this._circuitOpenTime = null;

        // Statistics
        this._stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            cacheHits: 0,
            cacheMisses: 0,
            retries: 0,
            circuitBreakerTrips: 0
        };

        // Cleanup timer for expired cache entries
        this._cleanupTimer = null;
        if (this.config.cacheEnabled && this.config.cacheTtl > 0) {
            this._startCleanupTimer();
        }
    }

    /**
     * Log a message with context
     * @private
     * @param {string} level - Log level (trace, debug, info, warn, error)
     * @param {string} message - Log message
     * @param {Object} [context={}] - Additional context
     */
    _log(level, message, context = {}) {
        if (this._logger && typeof this._logger[level] === "function") {
            this._logger[level]({ component: "opa-client", ...context }, message);
        }
    }

    /**
     * Get current circuit breaker state
     * @returns {string} Circuit state
     */
    get circuitState() {
        return this._circuitState;
    }

    /**
     * Check if circuit breaker is open
     * @returns {boolean}
     */
    get isCircuitOpen() {
        return this._circuitState === CircuitState.OPEN;
    }

    /**
     * Generate cache key from input
     * @param {Object} input - Policy evaluation input
     * @returns {string} Cache key
     * @private
     */
    _generateCacheKey(input) {
        const content = JSON.stringify(input);
        return crypto.createHash("md5").update(content).digest("hex");
    }

    /**
     * Get cached result
     * @param {string} key - Cache key
     * @returns {{hit: boolean, result?: any}}
     * @private
     */
    _getCached(key) {
        if (!this.config.cacheEnabled) {
            return { hit: false };
        }

        const entry = this._cache.get(key);
        if (!entry) {
            this._stats.cacheMisses++;
            return { hit: false };
        }

        const now = Date.now();
        if (entry.expires > 0 && now >= entry.expires) {
            this._cache.delete(key);
            this._stats.cacheMisses++;
            return { hit: false };
        }

        // Move to end for LRU
        this._cache.delete(key);
        this._cache.set(key, entry);

        this._stats.cacheHits++;
        return { hit: true, result: entry.result };
    }

    /**
     * Store result in cache
     * @param {string} key - Cache key
     * @param {any} result - Result to cache
     * @private
     */
    _setCache(key, result) {
        if (!this.config.cacheEnabled) {
            return;
        }

        // Evict oldest if at capacity
        while (this._cache.size >= this.config.cacheMaxSize) {
            const oldestKey = this._cache.keys().next().value;
            this._cache.delete(oldestKey);
        }

        const now = Date.now();
        this._cache.set(key, {
            result,
            timestamp: now,
            expires: this.config.cacheTtl > 0 ? now + this.config.cacheTtl : 0
        });
    }

    /**
     * Start cleanup timer for expired cache entries
     * @private
     */
    _startCleanupTimer() {
        const interval = Math.max(this.config.cacheTtl, 60000);
        this._cleanupTimer = setInterval(() => {
            this._cleanupCache();
        }, interval);

        if (this._cleanupTimer.unref) {
            this._cleanupTimer.unref();
        }
    }

    /**
     * Remove expired cache entries
     * @private
     */
    _cleanupCache() {
        const now = Date.now();
        for (const [key, entry] of this._cache.entries()) {
            if (entry.expires > 0 && now >= entry.expires) {
                this._cache.delete(key);
            }
        }
    }

    /**
     * Clear all cached entries
     */
    clearCache() {
        this._cache.clear();
    }

    /**
     * Calculate backoff delay with jitter
     * @param {number} attempt - Current attempt number (0-based)
     * @returns {number} Delay in milliseconds
     * @private
     */
    _calculateBackoff(attempt) {
        const baseDelay = Math.min(
            this.config.initialBackoff * Math.pow(this.config.backoffMultiplier, attempt),
            this.config.maxBackoff
        );
        const jitter = baseDelay * this.config.jitterFactor * (Math.random() * 2 - 1);
        return Math.round(baseDelay + jitter);
    }

    /**
     * Check circuit breaker state and update if needed
     * @returns {boolean} True if request should proceed
     * @private
     */
    _checkCircuitBreaker() {
        if (!this.config.circuitBreakerEnabled) {
            return true;
        }

        const now = Date.now();

        switch (this._circuitState) {
        case CircuitState.CLOSED:
            return true;

        case CircuitState.OPEN:
            // Check if timeout has passed
            if (this._circuitOpenTime &&
                    now - this._circuitOpenTime >= this.config.circuitBreakerTimeout) {
                this._circuitState = CircuitState.HALF_OPEN;
                this._successCount = 0;
                this.emit("circuitHalfOpen", {
                    previousState: CircuitState.OPEN,
                    currentState: CircuitState.HALF_OPEN
                });
                return true;
            }
            return false;

        case CircuitState.HALF_OPEN:
            return true;

        default:
            return true;
        }
    }

    /**
     * Record a successful request for circuit breaker
     * @private
     */
    _recordSuccess() {
        if (!this.config.circuitBreakerEnabled) {
            return;
        }

        this._successCount++;
        this._failureCount = 0;
        this._stats.successfulRequests++;

        if (this._circuitState === CircuitState.HALF_OPEN &&
            this._successCount >= this.config.circuitBreakerSuccessThreshold) {
            this._circuitState = CircuitState.CLOSED;
            this._circuitOpenTime = null;
            this.emit("circuitClosed", {
                previousState: CircuitState.HALF_OPEN,
                currentState: CircuitState.CLOSED
            });
        }
    }

    /**
     * Record a failed request for circuit breaker
     * @private
     */
    _recordFailure() {
        if (!this.config.circuitBreakerEnabled) {
            this._stats.failedRequests++;
            return;
        }

        this._failureCount++;
        this._successCount = 0;
        this._lastFailureTime = Date.now();
        this._stats.failedRequests++;

        // If in half-open, immediately open
        if (this._circuitState === CircuitState.HALF_OPEN) {
            this._openCircuit();
            return;
        }

        // Check if threshold reached
        if (this._circuitState === CircuitState.CLOSED &&
            this._failureCount >= this.config.circuitBreakerThreshold) {
            this._openCircuit();
        }
    }

    /**
     * Open the circuit breaker
     * @private
     */
    _openCircuit() {
        const previousState = this._circuitState;
        this._circuitState = CircuitState.OPEN;
        this._circuitOpenTime = Date.now();
        this._stats.circuitBreakerTrips++;

        this._log("warn", "Circuit breaker opened", {
            event: "circuit_breaker_open",
            previousState,
            failureCount: this._failureCount
        });

        this.emit("circuitOpen", {
            previousState,
            currentState: CircuitState.OPEN,
            failureCount: this._failureCount
        });
    }

    /**
     * Manually reset the circuit breaker
     */
    resetCircuitBreaker() {
        const previousState = this._circuitState;
        this._circuitState = CircuitState.CLOSED;
        this._failureCount = 0;
        this._successCount = 0;
        this._circuitOpenTime = null;

        this.emit("circuitReset", {
            previousState,
            currentState: CircuitState.CLOSED
        });
    }

    /**
     * Make HTTP request to OPA with timeout
     * @param {string} url - Request URL
     * @param {Object} body - Request body
     * @returns {Promise<Object>} OPA response
     * @private
     */
    async _makeRequest(url, body) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await this._fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`OPA returned status ${response.status}`);
                error.statusCode = response.status;
                throw error;
            }

            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);

            if (err.name === "AbortError") {
                const error = new Error("OPA request timeout");
                error.code = "TIMEOUT";
                throw error;
            }

            throw err;
        }
    }

    /**
     * Evaluate policy with retry logic
     * @param {Object} input - Policy evaluation input
     * @returns {Promise<Object>} OPA response
     * @private
     */
    async _evaluateWithRetry(input) {
        const url = `${this.config.opaUrl.replace(/\/$/, "")}/${this.config.policyPath.replace(/^\//, "")}`;
        const body = { input };

        let lastError;
        for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
            // Check circuit breaker before each attempt
            if (!this._checkCircuitBreaker()) {
                const error = new Error("Circuit breaker is open");
                error.code = "CIRCUIT_OPEN";
                throw error;
            }

            try {
                const result = await this._makeRequest(url, body);
                this._recordSuccess();
                return result;
            } catch (err) {
                lastError = err;

                // Don't retry on circuit breaker open
                if (err.code === "CIRCUIT_OPEN") {
                    throw err;
                }

                // Record failure for circuit breaker
                this._recordFailure();

                // Don't retry on last attempt
                if (attempt < this.config.retryAttempts) {
                    this._stats.retries++;
                    const delay = this._calculateBackoff(attempt);
                    this.emit("retry", {
                        attempt: attempt + 1,
                        maxAttempts: this.config.retryAttempts,
                        delay,
                        error: err.message
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    /**
     * Evaluate a policy with the given input
     * @param {Object} input - Policy evaluation input (arbitrary JSON)
     * @returns {Promise<{result: any, allowed: boolean, cached: boolean}>}
     */
    async evaluate(input) {
        this._stats.totalRequests++;

        // Check circuit breaker first
        if (!this._checkCircuitBreaker()) {
            const error = new Error("Circuit breaker is open");
            error.code = "CIRCUIT_OPEN";
            throw error;
        }

        // Check cache
        const cacheKey = this._generateCacheKey(input);
        const cached = this._getCached(cacheKey);

        if (cached.hit) {
            this._log("debug", "Policy evaluation cache hit", {
                event: "policy_cache_hit",
                allowed: this._extractAllowed(cached.result)
            });
            return {
                result: cached.result,
                allowed: this._extractAllowed(cached.result),
                cached: true
            };
        }

        // Evaluate policy with retry
        const response = await this._evaluateWithRetry(input);

        // Cache the result
        this._setCache(cacheKey, response.result);

        const allowed = this._extractAllowed(response.result);
        this._log("debug", "Policy evaluation completed", {
            event: "policy_evaluation",
            allowed: allowed,
            cached: false
        });

        return {
            result: response.result,
            allowed: allowed,
            cached: false
        };
    }

    /**
     * Extract allowed boolean from OPA result
     * @param {any} result - OPA result
     * @returns {boolean}
     * @private
     */
    _extractAllowed(result) {
        // Handle direct boolean result
        if (typeof result === "boolean") {
            return result;
        }

        // Handle object with 'allow' or 'allowed' property
        if (result && typeof result === "object") {
            if (typeof result.allow === "boolean") {
                return result.allow;
            }
            if (typeof result.allowed === "boolean") {
                return result.allowed;
            }
        }

        // Default to false if we can't determine
        return false;
    }

    /**
     * Convenience method to check if a request is allowed
     * @param {Object} user - User object with id, roles, etc.
     * @param {string} method - HTTP method (GET, POST, etc.)
     * @param {string} path - Request path
     * @param {Object} [body] - Request body (optional)
     * @returns {Promise<boolean>} True if allowed
     */
    async isAllowed(user, method, path, body = null) {
        const input = {
            user,
            request: {
                method: method.toUpperCase(),
                path,
                body
            }
        };

        try {
            const { allowed } = await this.evaluate(input);
            return allowed;
        } catch (err) {
            // Log error and deny by default
            this.emit("error", err);
            return false;
        }
    }

    /**
     * Check OPA server health
     * @returns {Promise<{healthy: boolean, message: string, details?: Object}>}
     */
    async getHealthStatus() {
        const healthUrl = `${this.config.opaUrl.replace(/\/$/, "")}/health`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await this._fetch(healthUrl, {
                method: "GET",
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                return {
                    healthy: true,
                    message: "OPA server is healthy",
                    details: {
                        url: this.config.opaUrl,
                        policyPath: this.config.policyPath,
                        circuitState: this._circuitState
                    }
                };
            } else {
                return {
                    healthy: false,
                    message: `OPA returned status ${response.status}`,
                    details: {
                        statusCode: response.status,
                        circuitState: this._circuitState
                    }
                };
            }
        } catch (err) {
            clearTimeout(timeoutId);
            return {
                healthy: false,
                message: err.name === "AbortError" ? "OPA health check timeout" : err.message,
                details: {
                    url: this.config.opaUrl,
                    error: err.message,
                    circuitState: this._circuitState
                }
            };
        }
    }

    /**
     * Get client statistics
     * @returns {Object} Statistics object
     */
    getStatistics() {
        const totalCacheRequests = this._stats.cacheHits + this._stats.cacheMisses;
        return {
            config: {
                opaUrl: this.config.opaUrl,
                policyPath: this.config.policyPath,
                timeout: this.config.timeout,
                retryAttempts: this.config.retryAttempts,
                cacheEnabled: this.config.cacheEnabled,
                cacheTtl: this.config.cacheTtl,
                circuitBreakerEnabled: this.config.circuitBreakerEnabled
            },
            current: {
                cacheSize: this._cache.size,
                cacheMaxSize: this.config.cacheMaxSize,
                circuitState: this._circuitState,
                failureCount: this._failureCount,
                successCount: this._successCount
            },
            cumulative: {
                totalRequests: this._stats.totalRequests,
                successfulRequests: this._stats.successfulRequests,
                failedRequests: this._stats.failedRequests,
                cacheHits: this._stats.cacheHits,
                cacheMisses: this._stats.cacheMisses,
                cacheHitRate: totalCacheRequests > 0
                    ? ((this._stats.cacheHits / totalCacheRequests) * 100).toFixed(2) + "%"
                    : "0%",
                retries: this._stats.retries,
                circuitBreakerTrips: this._stats.circuitBreakerTrips
            }
        };
    }

    /**
     * Gracefully shutdown the OPA client
     */
    shutdown() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }

        this._cache.clear();
        this._circuitState = CircuitState.CLOSED;
        this._failureCount = 0;
        this._successCount = 0;

        this.emit("shutdown");
        this.removeAllListeners();
    }
}

module.exports = {
    CircuitState,
    OpaClient,
    DEFAULT_OPA_CONFIG,
    validateOpaConfig
};
