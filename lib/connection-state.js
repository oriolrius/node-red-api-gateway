"use strict";

const EventEmitter = require("events");

/**
 * Connection states enum
 */
const ConnectionState = {
    CONNECTING: "connecting",
    CONNECTED: "connected",
    DISCONNECTED: "disconnected",
    ERROR: "error"
};

/**
 * Default configuration for connection state manager
 */
const DEFAULT_CONFIG = {
    initialBackoff: 1000,      // 1 second
    maxBackoff: 30000,         // 30 seconds
    backoffMultiplier: 2,
    maxRetries: Infinity,
    jitterFactor: 0.1          // 10% jitter
};

/**
 * Connection State Manager
 * Manages connection state for backend services with exponential backoff reconnection
 */
class ConnectionStateManager extends EventEmitter {
    /**
     * Create a new ConnectionStateManager
     * @param {string} serviceName - Name of the service (e.g., 'database', 'keycloak', 'opa')
     * @param {Object} options - Configuration options
     * @param {number} [options.initialBackoff=1000] - Initial backoff delay in ms
     * @param {number} [options.maxBackoff=30000] - Maximum backoff delay in ms
     * @param {number} [options.backoffMultiplier=2] - Backoff multiplier
     * @param {number} [options.maxRetries=Infinity] - Maximum retry attempts
     * @param {number} [options.jitterFactor=0.1] - Jitter factor (0-1)
     */
    constructor(serviceName, options = {}) {
        super();
        this.serviceName = serviceName;
        this.config = { ...DEFAULT_CONFIG, ...options };

        this._state = ConnectionState.DISCONNECTED;
        this._lastError = null;
        this._retryCount = 0;
        this._currentBackoff = this.config.initialBackoff;
        this._reconnectTimer = null;
        this._connectFn = null;
        this._isShuttingDown = false;
        this._registeredNodes = new Set();
    }

    /**
     * Get current connection state
     * @returns {string} Current state
     */
    get state() {
        return this._state;
    }

    /**
     * Get last error
     * @returns {Error|null} Last error or null
     */
    get lastError() {
        return this._lastError;
    }

    /**
     * Get current retry count
     * @returns {number} Number of retry attempts
     */
    get retryCount() {
        return this._retryCount;
    }

    /**
     * Check if connected
     * @returns {boolean} True if connected
     */
    get isConnected() {
        return this._state === ConnectionState.CONNECTED;
    }

    /**
     * Register a node to receive state updates
     * @param {Object} node - Node-RED node instance
     */
    registerNode(node) {
        this._registeredNodes.add(node);
        // Immediately notify the node of current state
        this._updateNodeStatus(node);
    }

    /**
     * Unregister a node from state updates
     * @param {Object} node - Node-RED node instance
     */
    unregisterNode(node) {
        this._registeredNodes.delete(node);
    }

    /**
     * Set the connection function for automatic reconnection
     * @param {Function} connectFn - Async function that attempts connection
     */
    setConnectFunction(connectFn) {
        this._connectFn = connectFn;
    }

    /**
     * Transition to a new state
     * @param {string} newState - New connection state
     * @param {Error} [error] - Optional error (for ERROR state)
     * @private
     */
    _setState(newState, error = null) {
        const previousState = this._state;
        this._state = newState;

        if (error) {
            this._lastError = error;
        }

        if (previousState !== newState) {
            this.emit("stateChange", {
                service: this.serviceName,
                previousState,
                currentState: newState,
                error: this._lastError,
                retryCount: this._retryCount
            });

            // Update all registered nodes
            this._updateAllNodes();
        }
    }

    /**
     * Update status on all registered nodes
     * @private
     */
    _updateAllNodes() {
        for (const node of this._registeredNodes) {
            this._updateNodeStatus(node);
        }
    }

    /**
     * Update status on a single node
     * @param {Object} node - Node-RED node instance
     * @private
     */
    _updateNodeStatus(node) {
        if (!node || typeof node.status !== "function") {
            return;
        }

        const statusMap = {
            [ConnectionState.CONNECTING]: {
                fill: "yellow",
                shape: "ring",
                text: `${this.serviceName}: connecting...`
            },
            [ConnectionState.CONNECTED]: {
                fill: "green",
                shape: "dot",
                text: `${this.serviceName}: connected`
            },
            [ConnectionState.DISCONNECTED]: {
                fill: "grey",
                shape: "ring",
                text: `${this.serviceName}: disconnected`
            },
            [ConnectionState.ERROR]: {
                fill: "red",
                shape: "dot",
                text: `${this.serviceName}: error${this._retryCount > 0 ? ` (retry ${this._retryCount})` : ""}`
            }
        };

        const status = statusMap[this._state] || statusMap[ConnectionState.DISCONNECTED];
        node.status(status);
    }

    /**
     * Calculate next backoff delay with jitter
     * @returns {number} Delay in milliseconds
     * @private
     */
    _calculateBackoff() {
        const baseDelay = Math.min(this._currentBackoff, this.config.maxBackoff);
        const jitter = baseDelay * this.config.jitterFactor * (Math.random() * 2 - 1);
        return Math.round(baseDelay + jitter);
    }

    /**
     * Mark connection as connecting
     */
    connecting() {
        this._setState(ConnectionState.CONNECTING);
    }

    /**
     * Mark connection as successfully connected
     */
    connected() {
        this._retryCount = 0;
        this._currentBackoff = this.config.initialBackoff;
        this._lastError = null;
        this._setState(ConnectionState.CONNECTED);
    }

    /**
     * Mark connection as disconnected
     * @param {boolean} [attemptReconnect=true] - Whether to attempt reconnection
     */
    disconnected(attemptReconnect = true) {
        this._setState(ConnectionState.DISCONNECTED);

        if (attemptReconnect && !this._isShuttingDown && this._connectFn) {
            this._scheduleReconnect();
        }
    }

    /**
     * Mark connection as errored
     * @param {Error} error - The error that occurred
     * @param {boolean} [attemptReconnect=true] - Whether to attempt reconnection
     */
    error(error, attemptReconnect = true) {
        this._setState(ConnectionState.ERROR, error);

        if (attemptReconnect && !this._isShuttingDown && this._connectFn) {
            this._scheduleReconnect();
        }
    }

    /**
     * Schedule a reconnection attempt
     * @private
     */
    _scheduleReconnect() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
        }

        if (this._retryCount >= this.config.maxRetries) {
            this.emit("maxRetriesReached", {
                service: this.serviceName,
                retryCount: this._retryCount
            });
            return;
        }

        const delay = this._calculateBackoff();

        this.emit("reconnecting", {
            service: this.serviceName,
            retryCount: this._retryCount + 1,
            delay
        });

        this._reconnectTimer = setTimeout(async () => {
            this._retryCount++;
            this._currentBackoff = Math.min(
                this._currentBackoff * this.config.backoffMultiplier,
                this.config.maxBackoff
            );

            try {
                this.connecting();
                await this._connectFn();
                // If connectFn succeeds, it should call connected()
            } catch (err) {
                this.error(err, true);
            }
        }, delay);
    }

    /**
     * Manually trigger a reconnection attempt
     * @returns {Promise<void>}
     */
    async reconnect() {
        if (!this._connectFn) {
            throw new Error("No connect function set");
        }

        this._retryCount = 0;
        this._currentBackoff = this.config.initialBackoff;

        try {
            this.connecting();
            await this._connectFn();
        } catch (err) {
            this.error(err, true);
        }
    }

    /**
     * Gracefully shutdown the connection manager
     * Clears timers and prevents further reconnection attempts
     */
    shutdown() {
        this._isShuttingDown = true;

        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        // Clear all registered nodes
        this._registeredNodes.clear();

        this._setState(ConnectionState.DISCONNECTED);

        this.emit("shutdown", {
            service: this.serviceName
        });

        this.removeAllListeners();
    }

    /**
     * Get current state info as an object
     * @returns {Object} State information
     */
    getStateInfo() {
        return {
            service: this.serviceName,
            state: this._state,
            isConnected: this.isConnected,
            lastError: this._lastError ? this._lastError.message : null,
            retryCount: this._retryCount,
            isShuttingDown: this._isShuttingDown
        };
    }
}

module.exports = {
    ConnectionState,
    ConnectionStateManager,
    DEFAULT_CONFIG
};
