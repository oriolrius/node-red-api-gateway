"use strict";

const EventEmitter = require("events");

/**
 * Pool states enum
 */
const PoolState = {
    INITIALIZING: "initializing",
    RUNNING: "running",
    DRAINING: "draining",
    CLOSED: "closed"
};

/**
 * Default configuration for connection pool manager
 */
const DEFAULT_POOL_CONFIG = {
    minConnections: 0,
    maxConnections: 10,
    idleTimeout: 30000,        // 30 seconds
    acquireTimeout: 15000,     // 15 seconds
    createRetryInterval: 1000, // 1 second between connection create retries
    validateOnBorrow: true,
    evictionInterval: 60000    // Check for idle connections every 60 seconds
};

/**
 * Connection Pool Manager
 * Manages a pool of database connections with statistics and lifecycle management
 */
class ConnectionPoolManager extends EventEmitter {
    /**
     * Create a new ConnectionPoolManager
     * @param {string} poolName - Name of the pool (e.g., 'database')
     * @param {Object} options - Configuration options
     * @param {number} [options.minConnections=0] - Minimum connections to maintain
     * @param {number} [options.maxConnections=10] - Maximum connections allowed
     * @param {number} [options.idleTimeout=30000] - Time in ms before idle connections are closed
     * @param {number} [options.acquireTimeout=15000] - Time in ms to wait for a connection
     * @param {boolean} [options.validateOnBorrow=true] - Validate connections before returning
     * @param {number} [options.evictionInterval=60000] - Interval in ms for idle connection eviction
     */
    constructor(poolName, options = {}) {
        super();
        this.poolName = poolName;
        this.config = { ...DEFAULT_POOL_CONFIG, ...options };

        this._state = PoolState.INITIALIZING;
        this._pool = [];                    // Available connections
        this._borrowed = new Set();         // Currently borrowed connections
        this._pendingAcquires = [];         // Queue of pending acquire requests
        this._evictionTimer = null;
        this._isShuttingDown = false;

        // Statistics
        this._stats = {
            totalCreated: 0,
            totalDestroyed: 0,
            totalAcquired: 0,
            totalReleased: 0,
            totalTimeouts: 0,
            totalErrors: 0,
            peakSize: 0,
            peakBorrowed: 0
        };

        // Connection factory (to be set by user)
        this._createFn = null;
        this._destroyFn = null;
        this._validateFn = null;
    }

    /**
     * Get current pool state
     * @returns {string} Current state
     */
    get state() {
        return this._state;
    }

    /**
     * Check if pool is running
     * @returns {boolean} True if running
     */
    get isRunning() {
        return this._state === PoolState.RUNNING;
    }

    /**
     * Get number of available connections in pool
     * @returns {number}
     */
    get availableCount() {
        return this._pool.length;
    }

    /**
     * Get number of borrowed connections
     * @returns {number}
     */
    get borrowedCount() {
        return this._borrowed.size;
    }

    /**
     * Get total connections (available + borrowed)
     * @returns {number}
     */
    get totalCount() {
        return this._pool.length + this._borrowed.size;
    }

    /**
     * Get number of pending acquire requests
     * @returns {number}
     */
    get pendingCount() {
        return this._pendingAcquires.length;
    }

    /**
     * Set the connection factory functions
     * @param {Object} factory - Factory object with create, destroy, validate functions
     * @param {Function} factory.create - Async function to create a connection
     * @param {Function} factory.destroy - Async function to destroy a connection
     * @param {Function} [factory.validate] - Async function to validate a connection
     */
    setFactory(factory) {
        if (!factory.create || typeof factory.create !== "function") {
            throw new Error("Factory must have a create function");
        }
        if (!factory.destroy || typeof factory.destroy !== "function") {
            throw new Error("Factory must have a destroy function");
        }

        this._createFn = factory.create;
        this._destroyFn = factory.destroy;
        this._validateFn = factory.validate || (async () => true);
    }

    /**
     * Initialize the pool and create minimum connections
     * @returns {Promise<void>}
     */
    async initialize() {
        if (!this._createFn) {
            throw new Error("Connection factory not set. Call setFactory() first.");
        }

        this._state = PoolState.INITIALIZING;

        // Create minimum connections
        const createPromises = [];
        for (let i = 0; i < this.config.minConnections; i++) {
            createPromises.push(this._createConnection());
        }

        try {
            await Promise.all(createPromises);
        } catch (err) {
            this.emit("error", {
                pool: this.poolName,
                error: err,
                message: "Failed to create minimum connections during initialization"
            });
        }

        this._state = PoolState.RUNNING;

        // Start eviction timer
        this._startEvictionTimer();

        this.emit("initialized", {
            pool: this.poolName,
            size: this.totalCount
        });
    }

    /**
     * Create a new connection and add to pool
     * @returns {Promise<Object>} The created connection
     * @private
     */
    async _createConnection() {
        try {
            const connection = await this._createFn();
            const wrappedConnection = {
                connection,
                createdAt: Date.now(),
                lastUsedAt: Date.now(),
                useCount: 0
            };

            this._pool.push(wrappedConnection);
            this._stats.totalCreated++;

            // Track peak size
            const currentTotal = this.totalCount;
            if (currentTotal > this._stats.peakSize) {
                this._stats.peakSize = currentTotal;
            }

            this.emit("connectionCreated", {
                pool: this.poolName,
                totalConnections: currentTotal
            });

            return wrappedConnection;
        } catch (err) {
            this._stats.totalErrors++;
            this.emit("createError", {
                pool: this.poolName,
                error: err
            });
            throw err;
        }
    }

    /**
     * Destroy a connection
     * @param {Object} wrappedConnection - Wrapped connection object
     * @private
     */
    async _destroyConnection(wrappedConnection) {
        try {
            await this._destroyFn(wrappedConnection.connection);
            this._stats.totalDestroyed++;

            this.emit("connectionDestroyed", {
                pool: this.poolName,
                totalConnections: this.totalCount
            });
        } catch (err) {
            this._stats.totalErrors++;
            this.emit("destroyError", {
                pool: this.poolName,
                error: err
            });
        }
    }

    /**
     * Acquire a connection from the pool
     * @param {number} [timeout] - Custom timeout in ms (overrides config)
     * @returns {Promise<Object>} The acquired connection
     */
    async acquire(timeout = this.config.acquireTimeout) {
        if (this._isShuttingDown) {
            throw new Error("Pool is shutting down");
        }

        if (this._state !== PoolState.RUNNING) {
            throw new Error(`Cannot acquire connection, pool state is: ${this._state}`);
        }

        return new Promise((resolve, reject) => {
            let timeoutId;
            // Build the request first so the timeout can dequeue it by object
            // identity. The queued request.resolve is a wrapper closure, so the
            // old `p.resolve === resolve` search never matched — a timed-out
            // request stayed in the queue and later silently captured a
            // connection with no caller to release it (permanent leak).
            const request = {
                resolve: (connection) => {
                    clearTimeout(timeoutId);
                    resolve(connection);
                },
                reject: (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                },
                timestamp: Date.now()
            };

            timeoutId = setTimeout(() => {
                // Remove this request from the pending queue by identity.
                const index = this._pendingAcquires.indexOf(request);
                if (index !== -1) {
                    this._pendingAcquires.splice(index, 1);
                }

                this._stats.totalTimeouts++;
                this.emit("acquireTimeout", {
                    pool: this.poolName,
                    timeout,
                    pendingCount: this.pendingCount
                });

                reject(new Error(`Connection acquire timeout after ${timeout}ms`));
            }, timeout);

            this._pendingAcquires.push(request);
            this._processAcquireQueue();
        });
    }

    /**
     * Process the acquire queue
     * @private
     */
    async _processAcquireQueue() {
        if (this._pendingAcquires.length === 0) {
            return;
        }

        // Try to get from pool
        while (this._pool.length > 0 && this._pendingAcquires.length > 0) {
            const wrappedConnection = this._pool.shift();
            const request = this._pendingAcquires.shift();

            // Validate connection if configured
            if (this.config.validateOnBorrow) {
                try {
                    const isValid = await this._validateFn(wrappedConnection.connection);
                    if (!isValid) {
                        // Connection is invalid, destroy and try again
                        await this._destroyConnection(wrappedConnection);
                        this._pendingAcquires.unshift(request); // Put request back at front
                        continue;
                    }
                } catch (err) {
                    // Validation failed, destroy and try again
                    await this._destroyConnection(wrappedConnection);
                    this._pendingAcquires.unshift(request);
                    continue;
                }
            }

            // Mark as borrowed
            this._borrowed.add(wrappedConnection);
            wrappedConnection.lastUsedAt = Date.now();
            wrappedConnection.useCount++;

            this._stats.totalAcquired++;

            // Track peak borrowed
            if (this._borrowed.size > this._stats.peakBorrowed) {
                this._stats.peakBorrowed = this._borrowed.size;
            }

            this.emit("connectionAcquired", {
                pool: this.poolName,
                available: this.availableCount,
                borrowed: this.borrowedCount
            });

            request.resolve(wrappedConnection.connection);
        }

        // Create new connections if needed and allowed
        while (
            this._pendingAcquires.length > 0 &&
            this.totalCount < this.config.maxConnections
        ) {
            try {
                const wrappedConnection = await this._createConnection();
                // Immediately borrow it
                this._pool.pop(); // Remove from pool (we just added it)
                this._borrowed.add(wrappedConnection);
                wrappedConnection.lastUsedAt = Date.now();
                wrappedConnection.useCount++;

                this._stats.totalAcquired++;

                if (this._borrowed.size > this._stats.peakBorrowed) {
                    this._stats.peakBorrowed = this._borrowed.size;
                }

                const request = this._pendingAcquires.shift();

                this.emit("connectionAcquired", {
                    pool: this.poolName,
                    available: this.availableCount,
                    borrowed: this.borrowedCount
                });

                request.resolve(wrappedConnection.connection);
            } catch (err) {
                // Creation failed, wait and retry
                await new Promise(resolve => setTimeout(resolve, this.config.createRetryInterval));
            }
        }
    }

    /**
     * Release a connection back to the pool
     * @param {Object} connection - The connection to release
     */
    async release(connection) {
        // Find the wrapped connection
        let wrappedConnection = null;
        for (const wc of this._borrowed) {
            if (wc.connection === connection) {
                wrappedConnection = wc;
                break;
            }
        }

        if (!wrappedConnection) {
            this.emit("releaseError", {
                pool: this.poolName,
                error: new Error("Connection not found in borrowed set")
            });
            return;
        }

        this._borrowed.delete(wrappedConnection);
        wrappedConnection.lastUsedAt = Date.now();

        this._stats.totalReleased++;

        // If shutting down, destroy the connection
        if (this._isShuttingDown) {
            await this._destroyConnection(wrappedConnection);
            return;
        }

        // Return to pool
        this._pool.push(wrappedConnection);

        this.emit("connectionReleased", {
            pool: this.poolName,
            available: this.availableCount,
            borrowed: this.borrowedCount
        });

        // Process any waiting acquire requests
        this._processAcquireQueue();
    }

    /**
     * Destroy a connection (remove from pool permanently)
     * @param {Object} connection - The connection to destroy
     */
    async destroy(connection) {
        // Check borrowed set
        for (const wc of this._borrowed) {
            if (wc.connection === connection) {
                this._borrowed.delete(wc);
                await this._destroyConnection(wc);
                return;
            }
        }

        // Check pool
        const index = this._pool.findIndex(wc => wc.connection === connection);
        if (index !== -1) {
            const wrappedConnection = this._pool.splice(index, 1)[0];
            await this._destroyConnection(wrappedConnection);
        }
    }

    /**
     * Start the eviction timer for idle connections
     * @private
     */
    _startEvictionTimer() {
        if (this._evictionTimer) {
            clearInterval(this._evictionTimer);
        }

        this._evictionTimer = setInterval(() => {
            this._evictIdleConnections();
        }, this.config.evictionInterval);
    }

    /**
     * Evict idle connections that have exceeded the idle timeout
     * @private
     */
    async _evictIdleConnections() {
        const now = Date.now();
        const toEvict = [];

        // Find connections to evict (keep at least minConnections)
        for (let i = this._pool.length - 1; i >= 0; i--) {
            if (this.totalCount <= this.config.minConnections) {
                break;
            }

            const wc = this._pool[i];
            const idleTime = now - wc.lastUsedAt;

            if (idleTime > this.config.idleTimeout) {
                toEvict.push(this._pool.splice(i, 1)[0]);
            }
        }

        // Destroy evicted connections
        for (const wc of toEvict) {
            await this._destroyConnection(wc);
        }

        if (toEvict.length > 0) {
            this.emit("idleEviction", {
                pool: this.poolName,
                evicted: toEvict.length,
                remaining: this.totalCount
            });
        }
    }

    /**
     * Get pool statistics
     * @returns {Object} Pool statistics
     */
    getStatistics() {
        return {
            pool: this.poolName,
            state: this._state,
            config: {
                minConnections: this.config.minConnections,
                maxConnections: this.config.maxConnections,
                idleTimeout: this.config.idleTimeout,
                acquireTimeout: this.config.acquireTimeout
            },
            current: {
                total: this.totalCount,
                available: this.availableCount,
                borrowed: this.borrowedCount,
                pending: this.pendingCount
            },
            cumulative: {
                totalCreated: this._stats.totalCreated,
                totalDestroyed: this._stats.totalDestroyed,
                totalAcquired: this._stats.totalAcquired,
                totalReleased: this._stats.totalReleased,
                totalTimeouts: this._stats.totalTimeouts,
                totalErrors: this._stats.totalErrors
            },
            peaks: {
                peakSize: this._stats.peakSize,
                peakBorrowed: this._stats.peakBorrowed
            }
        };
    }

    /**
     * Get simplified pool status for quick checks
     * @returns {Object} Pool status
     */
    getStatus() {
        return {
            state: this._state,
            available: this.availableCount,
            borrowed: this.borrowedCount,
            pending: this.pendingCount,
            total: this.totalCount
        };
    }

    /**
     * Drain the pool - wait for borrowed connections and prevent new borrows
     * @param {number} [timeout=30000] - Maximum time to wait for connections to be returned
     * @returns {Promise<void>}
     */
    async drain(timeout = 30000) {
        this._state = PoolState.DRAINING;
        this._isShuttingDown = true;

        // Reject all pending acquire requests
        while (this._pendingAcquires.length > 0) {
            const request = this._pendingAcquires.shift();
            request.reject(new Error("Pool is draining"));
        }

        this.emit("draining", {
            pool: this.poolName,
            borrowed: this.borrowedCount
        });

        // Wait for borrowed connections to be returned
        const startTime = Date.now();
        while (this._borrowed.size > 0 && (Date.now() - startTime) < timeout) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Force destroy remaining borrowed connections after timeout
        if (this._borrowed.size > 0) {
            this.emit("forceDrain", {
                pool: this.poolName,
                forced: this._borrowed.size
            });

            for (const wc of this._borrowed) {
                await this._destroyConnection(wc);
            }
            this._borrowed.clear();
        }
    }

    /**
     * Gracefully shutdown the pool
     * @param {number} [drainTimeout=30000] - Timeout for draining borrowed connections
     * @returns {Promise<void>}
     */
    async shutdown(drainTimeout = 30000) {
        if (this._state === PoolState.CLOSED) {
            return;
        }

        // Stop eviction timer
        if (this._evictionTimer) {
            clearInterval(this._evictionTimer);
            this._evictionTimer = null;
        }

        // Drain borrowed connections
        await this.drain(drainTimeout);

        // Destroy all remaining connections in pool
        while (this._pool.length > 0) {
            const wc = this._pool.pop();
            await this._destroyConnection(wc);
        }

        this._state = PoolState.CLOSED;

        this.emit("shutdown", {
            pool: this.poolName,
            stats: this.getStatistics()
        });

        this.removeAllListeners();
    }

    /**
     * Clear all connections and reset the pool
     * @returns {Promise<void>}
     */
    async clear() {
        const wasRunning = this._state === PoolState.RUNNING;

        // Destroy all connections
        for (const wc of this._borrowed) {
            await this._destroyConnection(wc);
        }
        this._borrowed.clear();

        while (this._pool.length > 0) {
            const wc = this._pool.pop();
            await this._destroyConnection(wc);
        }

        // Reject pending acquires
        while (this._pendingAcquires.length > 0) {
            const request = this._pendingAcquires.shift();
            request.reject(new Error("Pool was cleared"));
        }

        this.emit("cleared", {
            pool: this.poolName
        });

        // Re-initialize if was running
        if (wasRunning && !this._isShuttingDown) {
            await this.initialize();
        }
    }
}

module.exports = {
    PoolState,
    ConnectionPoolManager,
    DEFAULT_POOL_CONFIG
};
