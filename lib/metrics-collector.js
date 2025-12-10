'use strict';

const client = require('prom-client');

/**
 * Default Prometheus metric labels used across all metrics
 */
const DEFAULT_LABELS = ['method', 'path', 'status_code'];

/**
 * Default latency histogram buckets in milliseconds
 * Covers typical API response times from very fast to slow
 */
const DEFAULT_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Default configuration for MetricsCollector
 */
const DEFAULT_METRICS_CONFIG = {
    prefix: 'api_gateway_',
    defaultLabels: {},
    buckets: DEFAULT_LATENCY_BUCKETS,
    collectDefaultMetrics: true,
    defaultMetricsPrefix: 'nodejs_'
};

/**
 * Validates metrics configuration
 * @param {Object} config - Configuration object
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateMetricsConfig(config) {
    const errors = [];

    if (config.prefix && typeof config.prefix !== 'string') {
        errors.push('prefix must be a string');
    }

    if (config.defaultLabels && typeof config.defaultLabels !== 'object') {
        errors.push('defaultLabels must be an object');
    }

    if (config.buckets) {
        if (!Array.isArray(config.buckets)) {
            errors.push('buckets must be an array');
        } else if (!config.buckets.every(b => typeof b === 'number' && b > 0)) {
            errors.push('buckets must contain positive numbers');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Normalize path for metric labels to prevent high cardinality
 * Replaces UUIDs, numeric IDs, and other dynamic segments with placeholders
 * @param {string} path - Request path
 * @returns {string} Normalized path
 */
function normalizePath(path) {
    if (!path || typeof path !== 'string') {
        return '/';
    }

    return path
        // Replace UUIDs
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
        // Replace alphanumeric IDs that look like database IDs (e.g., MongoDB ObjectIds)
        // Must come before numeric IDs to avoid partial replacement
        .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:objectId')
        // Replace numeric IDs (standalone numbers in path segments)
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        // Remove query strings
        .replace(/\?.*$/, '')
        // Normalize trailing slashes
        .replace(/\/+$/, '') || '/';
}

/**
 * MetricsCollector class for gathering and exposing Prometheus metrics
 *
 * Collects:
 * - HTTP request counts by method, path, and status code
 * - HTTP request latency histograms
 * - Error counts and rates
 * - External service latencies (Keycloak, OPA)
 */
class MetricsCollector {
    /**
     * Create a new MetricsCollector
     * @param {Object} [config] - Configuration options
     * @param {string} [config.prefix='api_gateway_'] - Metric name prefix
     * @param {Object} [config.defaultLabels={}] - Default labels for all metrics
     * @param {number[]} [config.buckets] - Histogram bucket boundaries in ms
     * @param {boolean} [config.collectDefaultMetrics=true] - Collect Node.js default metrics
     * @param {string} [config.defaultMetricsPrefix='nodejs_'] - Prefix for default metrics
     */
    constructor(config = {}) {
        this.config = { ...DEFAULT_METRICS_CONFIG, ...config };

        // Create a new registry for this collector
        this.registry = new client.Registry();

        // Set default labels if provided
        if (this.config.defaultLabels && Object.keys(this.config.defaultLabels).length > 0) {
            this.registry.setDefaultLabels(this.config.defaultLabels);
        }

        // Collect Node.js default metrics if enabled
        if (this.config.collectDefaultMetrics) {
            client.collectDefaultMetrics({
                register: this.registry,
                prefix: this.config.defaultMetricsPrefix
            });
        }

        // Initialize metrics
        this._initializeMetrics();

        // Track whether we've been shut down
        this._shutdown = false;
    }

    /**
     * Initialize all Prometheus metrics
     * @private
     */
    _initializeMetrics() {
        const prefix = this.config.prefix;

        // HTTP Request Counter
        this.httpRequestsTotal = new client.Counter({
            name: `${prefix}http_requests_total`,
            help: 'Total number of HTTP requests',
            labelNames: DEFAULT_LABELS,
            registers: [this.registry]
        });

        // HTTP Request Duration Histogram
        this.httpRequestDuration = new client.Histogram({
            name: `${prefix}http_request_duration_ms`,
            help: 'HTTP request duration in milliseconds',
            labelNames: DEFAULT_LABELS,
            buckets: this.config.buckets,
            registers: [this.registry]
        });

        // HTTP Errors Counter
        this.httpErrorsTotal = new client.Counter({
            name: `${prefix}http_errors_total`,
            help: 'Total number of HTTP errors (4xx and 5xx responses)',
            labelNames: [...DEFAULT_LABELS, 'error_type'],
            registers: [this.registry]
        });

        // HTTP Status Code Counter (for distribution)
        this.httpStatusCodes = new client.Counter({
            name: `${prefix}http_status_codes_total`,
            help: 'HTTP response status codes distribution',
            labelNames: ['status_code', 'status_class'],
            registers: [this.registry]
        });

        // Keycloak Token Validation Duration
        this.keycloakValidationDuration = new client.Histogram({
            name: `${prefix}keycloak_validation_duration_ms`,
            help: 'Keycloak token validation duration in milliseconds',
            labelNames: ['result', 'validation_type'],
            buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
            registers: [this.registry]
        });

        // Keycloak Operations Counter
        this.keycloakOperationsTotal = new client.Counter({
            name: `${prefix}keycloak_operations_total`,
            help: 'Total Keycloak operations',
            labelNames: ['operation', 'result'],
            registers: [this.registry]
        });

        // Keycloak Cache Metrics
        this.keycloakCacheHits = new client.Counter({
            name: `${prefix}keycloak_cache_hits_total`,
            help: 'Keycloak cache hits',
            registers: [this.registry]
        });

        this.keycloakCacheMisses = new client.Counter({
            name: `${prefix}keycloak_cache_misses_total`,
            help: 'Keycloak cache misses',
            registers: [this.registry]
        });

        // Keycloak Circuit Breaker
        this.keycloakCircuitBreakerState = new client.Gauge({
            name: `${prefix}keycloak_circuit_breaker_state`,
            help: 'Keycloak circuit breaker state (0=closed, 1=half-open, 2=open)',
            registers: [this.registry]
        });

        // OPA Policy Evaluation Duration
        this.opaPolicyDuration = new client.Histogram({
            name: `${prefix}opa_policy_duration_ms`,
            help: 'OPA policy evaluation duration in milliseconds',
            labelNames: ['policy', 'result'],
            buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
            registers: [this.registry]
        });

        // OPA Operations Counter
        this.opaOperationsTotal = new client.Counter({
            name: `${prefix}opa_operations_total`,
            help: 'Total OPA operations',
            labelNames: ['operation', 'result'],
            registers: [this.registry]
        });

        // OPA Cache Metrics
        this.opaCacheHits = new client.Counter({
            name: `${prefix}opa_cache_hits_total`,
            help: 'OPA cache hits',
            registers: [this.registry]
        });

        this.opaCacheMisses = new client.Counter({
            name: `${prefix}opa_cache_misses_total`,
            help: 'OPA cache misses',
            registers: [this.registry]
        });

        // OPA Circuit Breaker
        this.opaCircuitBreakerState = new client.Gauge({
            name: `${prefix}opa_circuit_breaker_state`,
            help: 'OPA circuit breaker state (0=closed, 1=half-open, 2=open)',
            registers: [this.registry]
        });

        // Rate Limiter Metrics
        this.rateLimitedRequestsTotal = new client.Counter({
            name: `${prefix}rate_limited_requests_total`,
            help: 'Total number of rate limited requests',
            labelNames: ['path', 'limit_type'],
            registers: [this.registry]
        });

        // Cache Metrics (Response Cache)
        this.responseCacheHits = new client.Counter({
            name: `${prefix}response_cache_hits_total`,
            help: 'Response cache hits',
            labelNames: ['path'],
            registers: [this.registry]
        });

        this.responseCacheMisses = new client.Counter({
            name: `${prefix}response_cache_misses_total`,
            help: 'Response cache misses',
            labelNames: ['path'],
            registers: [this.registry]
        });

        // Active Requests Gauge
        this.activeRequests = new client.Gauge({
            name: `${prefix}active_requests`,
            help: 'Number of currently active requests',
            registers: [this.registry]
        });

        // Connection Pool Metrics (if applicable)
        this.connectionPoolSize = new client.Gauge({
            name: `${prefix}connection_pool_size`,
            help: 'Current connection pool size',
            labelNames: ['pool', 'state'],
            registers: [this.registry]
        });
    }

    /**
     * Record an HTTP request completion
     * @param {Object} options - Request details
     * @param {string} options.method - HTTP method
     * @param {string} options.path - Request path
     * @param {number} options.statusCode - HTTP status code
     * @param {number} options.duration - Request duration in milliseconds
     */
    recordHttpRequest({ method, path, statusCode, duration }) {
        if (this._shutdown) return;

        const normalizedPath = normalizePath(path);
        const labels = {
            method: method.toUpperCase(),
            path: normalizedPath,
            status_code: String(statusCode)
        };

        // Increment request counter
        this.httpRequestsTotal.inc(labels);

        // Record duration
        this.httpRequestDuration.observe(labels, duration);

        // Record status code distribution
        const statusClass = `${Math.floor(statusCode / 100)}xx`;
        this.httpStatusCodes.inc({ status_code: String(statusCode), status_class: statusClass });

        // Record errors (4xx and 5xx)
        if (statusCode >= 400) {
            const errorType = statusCode >= 500 ? 'server_error' : 'client_error';
            this.httpErrorsTotal.inc({ ...labels, error_type: errorType });
        }
    }

    /**
     * Increment active request count
     */
    incrementActiveRequests() {
        if (!this._shutdown) {
            this.activeRequests.inc();
        }
    }

    /**
     * Decrement active request count
     */
    decrementActiveRequests() {
        if (!this._shutdown) {
            this.activeRequests.dec();
        }
    }

    /**
     * Record Keycloak token validation
     * @param {Object} options - Validation details
     * @param {number} options.duration - Validation duration in milliseconds
     * @param {boolean} options.success - Whether validation succeeded
     * @param {string} [options.validationType='jwt'] - Type of validation
     */
    recordKeycloakValidation({ duration, success, validationType = 'jwt' }) {
        if (this._shutdown) return;

        const result = success ? 'success' : 'failure';
        this.keycloakValidationDuration.observe({ result, validation_type: validationType }, duration);
        this.keycloakOperationsTotal.inc({ operation: 'validation', result });
    }

    /**
     * Record Keycloak cache operation
     * @param {boolean} hit - Whether it was a cache hit
     */
    recordKeycloakCache(hit) {
        if (this._shutdown) return;

        if (hit) {
            this.keycloakCacheHits.inc();
        } else {
            this.keycloakCacheMisses.inc();
        }
    }

    /**
     * Update Keycloak circuit breaker state
     * @param {string} state - Circuit state ('closed', 'half-open', 'open')
     */
    setKeycloakCircuitState(state) {
        if (this._shutdown) return;

        const stateValue = { 'closed': 0, 'half-open': 1, 'open': 2 }[state.toLowerCase()] ?? 0;
        this.keycloakCircuitBreakerState.set(stateValue);
    }

    /**
     * Record OPA policy evaluation
     * @param {Object} options - Evaluation details
     * @param {number} options.duration - Evaluation duration in milliseconds
     * @param {boolean} options.allowed - Whether policy allowed the request
     * @param {string} [options.policy='default'] - Policy name/path
     */
    recordOpaEvaluation({ duration, allowed, policy = 'default' }) {
        if (this._shutdown) return;

        const result = allowed ? 'allow' : 'deny';
        this.opaPolicyDuration.observe({ policy, result }, duration);
        this.opaOperationsTotal.inc({ operation: 'evaluate', result });
    }

    /**
     * Record OPA cache operation
     * @param {boolean} hit - Whether it was a cache hit
     */
    recordOpaCache(hit) {
        if (this._shutdown) return;

        if (hit) {
            this.opaCacheHits.inc();
        } else {
            this.opaCacheMisses.inc();
        }
    }

    /**
     * Update OPA circuit breaker state
     * @param {string} state - Circuit state ('closed', 'half-open', 'open')
     */
    setOpaCircuitState(state) {
        if (this._shutdown) return;

        const stateValue = { 'closed': 0, 'half-open': 1, 'open': 2 }[state.toLowerCase()] ?? 0;
        this.opaCircuitBreakerState.set(stateValue);
    }

    /**
     * Record a rate-limited request
     * @param {string} path - Request path that was rate limited
     * @param {string} [limitType='default'] - Type of rate limit applied
     */
    recordRateLimited(path, limitType = 'default') {
        if (this._shutdown) return;

        this.rateLimitedRequestsTotal.inc({ path: normalizePath(path), limit_type: limitType });
    }

    /**
     * Record response cache operation
     * @param {string} path - Request path
     * @param {boolean} hit - Whether it was a cache hit
     */
    recordResponseCache(path, hit) {
        if (this._shutdown) return;

        const normalizedPath = normalizePath(path);
        if (hit) {
            this.responseCacheHits.inc({ path: normalizedPath });
        } else {
            this.responseCacheMisses.inc({ path: normalizedPath });
        }
    }

    /**
     * Update connection pool metrics
     * @param {string} poolName - Name of the connection pool
     * @param {Object} stats - Pool statistics
     * @param {number} stats.active - Active connections
     * @param {number} stats.idle - Idle connections
     * @param {number} stats.waiting - Waiting requests
     */
    updateConnectionPool(poolName, { active = 0, idle = 0, waiting = 0 }) {
        if (this._shutdown) return;

        this.connectionPoolSize.set({ pool: poolName, state: 'active' }, active);
        this.connectionPoolSize.set({ pool: poolName, state: 'idle' }, idle);
        this.connectionPoolSize.set({ pool: poolName, state: 'waiting' }, waiting);
    }

    /**
     * Sync metrics from Keycloak client statistics
     * @param {Object} stats - Statistics from KeycloakClient.getStatistics()
     */
    syncKeycloakStats(stats) {
        if (this._shutdown || !stats) return;

        // Update circuit breaker state
        if (stats.current?.circuitState) {
            this.setKeycloakCircuitState(stats.current.circuitState);
        }
    }

    /**
     * Sync metrics from OPA client statistics
     * @param {Object} stats - Statistics from OpaClient.getStatistics()
     */
    syncOpaStats(stats) {
        if (this._shutdown || !stats) return;

        // Update circuit breaker state
        if (stats.current?.circuitState) {
            this.setOpaCircuitState(stats.current.circuitState);
        }
    }

    /**
     * Get metrics in Prometheus text format
     * @returns {Promise<string>} Prometheus formatted metrics
     */
    async getMetrics() {
        return this.registry.metrics();
    }

    /**
     * Get metrics content type for HTTP response
     * @returns {string} Content type header value
     */
    getContentType() {
        return this.registry.contentType;
    }

    /**
     * Get the Prometheus registry
     * @returns {Registry} Prometheus registry
     */
    getRegistry() {
        return this.registry;
    }

    /**
     * Reset all metrics (useful for testing)
     */
    reset() {
        this.registry.resetMetrics();
    }

    /**
     * Gracefully shutdown the metrics collector
     */
    shutdown() {
        this._shutdown = true;
        this.registry.clear();
    }
}

// Singleton instance for shared use
let sharedInstance = null;

/**
 * Get or create the shared MetricsCollector instance
 * @param {Object} [config] - Configuration (only used on first call)
 * @returns {MetricsCollector}
 */
function getMetricsCollector(config) {
    if (!sharedInstance) {
        sharedInstance = new MetricsCollector(config);
    }
    return sharedInstance;
}

/**
 * Reset the shared instance (useful for testing)
 */
function resetSharedInstance() {
    if (sharedInstance) {
        sharedInstance.shutdown();
        sharedInstance = null;
    }
}

module.exports = {
    MetricsCollector,
    getMetricsCollector,
    resetSharedInstance,
    validateMetricsConfig,
    normalizePath,
    DEFAULT_METRICS_CONFIG,
    DEFAULT_LATENCY_BUCKETS,
    DEFAULT_LABELS
};
