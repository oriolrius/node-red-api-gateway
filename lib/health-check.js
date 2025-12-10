'use strict';

const EventEmitter = require('events');

/**
 * Health status enum
 */
const HealthStatus = {
    HEALTHY: 'healthy',
    DEGRADED: 'degraded',
    UNHEALTHY: 'unhealthy',
    UNKNOWN: 'unknown'
};

/**
 * Default configuration for health check manager
 */
const DEFAULT_HEALTH_CONFIG = {
    checkInterval: 30000,      // 30 seconds between checks
    timeout: 5000,             // 5 second timeout per check
    unhealthyThreshold: 3,     // Number of failures before unhealthy
    healthyThreshold: 1        // Number of successes before healthy
};

/**
 * Health Check Result
 */
class HealthCheckResult {
    /**
     * Create a health check result
     * @param {string} service - Service name
     * @param {string} status - Health status
     * @param {number} responseTime - Response time in ms
     * @param {string|null} message - Optional message
     * @param {Object|null} details - Optional additional details
     */
    constructor(service, status, responseTime = 0, message = null, details = null) {
        this.service = service;
        this.status = status;
        this.responseTime = responseTime;
        this.message = message;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }

    /**
     * Check if result indicates healthy status
     * @returns {boolean}
     */
    get isHealthy() {
        return this.status === HealthStatus.HEALTHY;
    }

    /**
     * Convert to plain object
     * @returns {Object}
     */
    toJSON() {
        return {
            service: this.service,
            status: this.status,
            responseTime: this.responseTime,
            message: this.message,
            details: this.details,
            timestamp: this.timestamp
        };
    }
}

/**
 * Health Check Manager
 * Manages health checks for backend services
 */
class HealthCheckManager extends EventEmitter {
    /**
     * Create a new HealthCheckManager
     * @param {Object} options - Configuration options
     * @param {number} [options.checkInterval=30000] - Interval between checks in ms
     * @param {number} [options.timeout=5000] - Timeout for each check in ms
     * @param {number} [options.unhealthyThreshold=3] - Failures before unhealthy
     * @param {number} [options.healthyThreshold=1] - Successes before healthy
     */
    constructor(options = {}) {
        super();
        this.config = { ...DEFAULT_HEALTH_CONFIG, ...options };

        this._healthChecks = new Map();  // service -> check function
        this._results = new Map();       // service -> latest result
        this._failureCounts = new Map(); // service -> consecutive failures
        this._successCounts = new Map(); // service -> consecutive successes
        this._checkTimer = null;
        this._isRunning = false;
        this._isShuttingDown = false;
    }

    /**
     * Register a health check for a service
     * @param {string} service - Service name
     * @param {Function} checkFn - Async function that performs the health check
     *                             Should return { healthy: boolean, message?: string, details?: object }
     */
    registerCheck(service, checkFn) {
        this._healthChecks.set(service, checkFn);
        this._failureCounts.set(service, 0);
        this._successCounts.set(service, 0);
        this._results.set(service, new HealthCheckResult(
            service,
            HealthStatus.UNKNOWN,
            0,
            'Health check not yet performed'
        ));
    }

    /**
     * Unregister a health check
     * @param {string} service - Service name
     */
    unregisterCheck(service) {
        this._healthChecks.delete(service);
        this._results.delete(service);
        this._failureCounts.delete(service);
        this._successCounts.delete(service);
    }

    /**
     * Perform a single health check with timeout
     * @param {string} service - Service name
     * @returns {Promise<HealthCheckResult>}
     */
    async checkService(service) {
        const checkFn = this._healthChecks.get(service);
        if (!checkFn) {
            return new HealthCheckResult(
                service,
                HealthStatus.UNKNOWN,
                0,
                'No health check registered'
            );
        }

        const startTime = Date.now();

        try {
            // Create timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Health check timeout')), this.config.timeout);
            });

            // Race between check and timeout
            const result = await Promise.race([checkFn(), timeoutPromise]);
            const responseTime = Date.now() - startTime;

            if (result && result.healthy) {
                // Increment success count, reset failure count
                this._successCounts.set(service, (this._successCounts.get(service) || 0) + 1);
                this._failureCounts.set(service, 0);

                const status = this._successCounts.get(service) >= this.config.healthyThreshold
                    ? HealthStatus.HEALTHY
                    : HealthStatus.DEGRADED;

                const checkResult = new HealthCheckResult(
                    service,
                    status,
                    responseTime,
                    result.message || 'Service is responding',
                    result.details
                );

                this._results.set(service, checkResult);
                return checkResult;
            } else {
                // Check returned unhealthy
                return this._handleFailure(service, startTime, result?.message || 'Service reported unhealthy', result?.details);
            }
        } catch (err) {
            return this._handleFailure(service, startTime, err.message);
        }
    }

    /**
     * Handle a health check failure
     * @param {string} service - Service name
     * @param {number} startTime - Start timestamp
     * @param {string} message - Error message
     * @param {Object} [details] - Optional details
     * @returns {HealthCheckResult}
     * @private
     */
    _handleFailure(service, startTime, message, details = null) {
        const responseTime = Date.now() - startTime;

        // Increment failure count, reset success count
        this._failureCounts.set(service, (this._failureCounts.get(service) || 0) + 1);
        this._successCounts.set(service, 0);

        const failureCount = this._failureCounts.get(service);
        const status = failureCount >= this.config.unhealthyThreshold
            ? HealthStatus.UNHEALTHY
            : HealthStatus.DEGRADED;

        const checkResult = new HealthCheckResult(
            service,
            status,
            responseTime,
            message,
            details
        );

        this._results.set(service, checkResult);
        return checkResult;
    }

    /**
     * Run all registered health checks
     * @returns {Promise<Map<string, HealthCheckResult>>}
     */
    async checkAll() {
        const results = new Map();
        const promises = [];

        for (const service of this._healthChecks.keys()) {
            promises.push(
                this.checkService(service).then(result => {
                    results.set(service, result);
                })
            );
        }

        await Promise.all(promises);

        this.emit('checkComplete', {
            results: Object.fromEntries(results),
            aggregatedStatus: this.getAggregatedStatus()
        });

        return results;
    }

    /**
     * Get the latest result for a service
     * @param {string} service - Service name
     * @returns {HealthCheckResult|undefined}
     */
    getResult(service) {
        return this._results.get(service);
    }

    /**
     * Get all latest results
     * @returns {Object} Map of service -> result
     */
    getAllResults() {
        const results = {};
        for (const [service, result] of this._results) {
            results[service] = result.toJSON();
        }
        return results;
    }

    /**
     * Calculate aggregated health status across all services
     * @returns {string} HealthStatus value
     */
    getAggregatedStatus() {
        if (this._results.size === 0) {
            return HealthStatus.UNKNOWN;
        }

        let hasUnhealthy = false;
        let hasDegraded = false;
        let hasUnknown = false;

        for (const result of this._results.values()) {
            switch (result.status) {
                case HealthStatus.UNHEALTHY:
                    hasUnhealthy = true;
                    break;
                case HealthStatus.DEGRADED:
                    hasDegraded = true;
                    break;
                case HealthStatus.UNKNOWN:
                    hasUnknown = true;
                    break;
            }
        }

        // If any service is unhealthy, overall is unhealthy
        if (hasUnhealthy) {
            return HealthStatus.UNHEALTHY;
        }

        // If any service is degraded or unknown, overall is degraded
        if (hasDegraded || hasUnknown) {
            return HealthStatus.DEGRADED;
        }

        // All services are healthy
        return HealthStatus.HEALTHY;
    }

    /**
     * Get full health report
     * @returns {Object} Health report with status and details
     */
    getHealthReport() {
        return {
            status: this.getAggregatedStatus(),
            timestamp: new Date().toISOString(),
            services: this.getAllResults(),
            config: {
                checkInterval: this.config.checkInterval,
                timeout: this.config.timeout
            }
        };
    }

    /**
     * Start periodic health checks
     */
    start() {
        if (this._isRunning || this._isShuttingDown) {
            return;
        }

        this._isRunning = true;

        // Run initial check
        this.checkAll().catch(err => {
            this.emit('error', err);
        });

        // Schedule periodic checks
        this._checkTimer = setInterval(() => {
            if (!this._isShuttingDown) {
                this.checkAll().catch(err => {
                    this.emit('error', err);
                });
            }
        }, this.config.checkInterval);
    }

    /**
     * Stop periodic health checks
     */
    stop() {
        this._isRunning = false;

        if (this._checkTimer) {
            clearInterval(this._checkTimer);
            this._checkTimer = null;
        }
    }

    /**
     * Gracefully shutdown the health check manager
     */
    shutdown() {
        this._isShuttingDown = true;
        this.stop();
        this._healthChecks.clear();
        this._results.clear();
        this._failureCounts.clear();
        this._successCounts.clear();

        this.emit('shutdown');
        this.removeAllListeners();
    }
}

/**
 * Database health check factory
 * Creates a health check function for database connectivity
 * @param {Object} config - Database configuration
 * @param {Function} [pingFn] - Optional custom ping function
 * @returns {Function} Health check function
 */
function createDatabaseHealthCheck(config, pingFn = null) {
    return async () => {
        if (pingFn) {
            try {
                await pingFn();
                return { healthy: true, message: 'Database connection OK' };
            } catch (err) {
                return { healthy: false, message: err.message };
            }
        }

        // Default: just check if config is valid
        if (!config.dbHost || !config.dbType || config.dbType === 'none') {
            return { healthy: false, message: 'Database not configured' };
        }

        return {
            healthy: true,
            message: 'Database configured (connection test requires active pool)',
            details: {
                type: config.dbType,
                host: config.dbHost,
                port: config.dbPort,
                database: config.dbName
            }
        };
    };
}

/**
 * Keycloak health check factory
 * Creates a health check function for Keycloak server
 * @param {Object} config - Keycloak configuration
 * @param {Function} [fetchFn] - Optional custom fetch function (for testing)
 * @returns {Function} Health check function
 */
function createKeycloakHealthCheck(config, fetchFn = null) {
    const fetch = fetchFn || globalThis.fetch;

    return async () => {
        if (!config.keycloakUrl) {
            return { healthy: false, message: 'Keycloak URL not configured' };
        }

        try {
            // Keycloak exposes a health endpoint
            const healthUrl = `${config.keycloakUrl.replace(/\/$/, '')}/health/ready`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            try {
                const response = await fetch(healthUrl, {
                    method: 'GET',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (response.ok) {
                    return {
                        healthy: true,
                        message: 'Keycloak server is ready',
                        details: {
                            url: config.keycloakUrl,
                            realm: config.keycloakRealm
                        }
                    };
                } else {
                    return {
                        healthy: false,
                        message: `Keycloak returned status ${response.status}`,
                        details: { statusCode: response.status }
                    };
                }
            } catch (fetchErr) {
                clearTimeout(timeoutId);
                throw fetchErr;
            }
        } catch (err) {
            return {
                healthy: false,
                message: err.name === 'AbortError' ? 'Keycloak health check timeout' : err.message,
                details: { url: config.keycloakUrl }
            };
        }
    };
}

/**
 * OPA health check factory
 * Creates a health check function for OPA server
 * @param {Object} config - OPA configuration
 * @param {Function} [fetchFn] - Optional custom fetch function (for testing)
 * @returns {Function} Health check function
 */
function createOpaHealthCheck(config, fetchFn = null) {
    const fetch = fetchFn || globalThis.fetch;

    return async () => {
        if (!config.opaUrl) {
            return { healthy: false, message: 'OPA URL not configured' };
        }

        try {
            // OPA exposes a health endpoint at /health
            const healthUrl = `${config.opaUrl.replace(/\/$/, '')}/health`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.opaTimeout || 5000);

            try {
                const response = await fetch(healthUrl, {
                    method: 'GET',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (response.ok) {
                    return {
                        healthy: true,
                        message: 'OPA server is healthy',
                        details: {
                            url: config.opaUrl,
                            policyPath: config.opaPolicyPath
                        }
                    };
                } else {
                    return {
                        healthy: false,
                        message: `OPA returned status ${response.status}`,
                        details: { statusCode: response.status }
                    };
                }
            } catch (fetchErr) {
                clearTimeout(timeoutId);
                throw fetchErr;
            }
        } catch (err) {
            return {
                healthy: false,
                message: err.name === 'AbortError' ? 'OPA health check timeout' : err.message,
                details: { url: config.opaUrl }
            };
        }
    };
}

module.exports = {
    HealthStatus,
    HealthCheckResult,
    HealthCheckManager,
    DEFAULT_HEALTH_CONFIG,
    createDatabaseHealthCheck,
    createKeycloakHealthCheck,
    createOpaHealthCheck
};
