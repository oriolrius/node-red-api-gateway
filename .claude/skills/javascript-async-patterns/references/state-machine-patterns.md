# Connection State Machine Patterns

This reference provides comprehensive patterns for implementing robust connection state management.

## State Machine Fundamentals

### Basic State Definition

```javascript
// Define states as constants to avoid typos
const STATES = Object.freeze({
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    DISCONNECTING: 'disconnecting',
    FAILED: 'failed'
});

// Define valid transitions
const TRANSITIONS = Object.freeze({
    [STATES.DISCONNECTED]: [STATES.CONNECTING],
    [STATES.CONNECTING]: [STATES.CONNECTED, STATES.DISCONNECTED, STATES.FAILED],
    [STATES.CONNECTED]: [STATES.DISCONNECTING, STATES.RECONNECTING],
    [STATES.RECONNECTING]: [STATES.CONNECTED, STATES.DISCONNECTED, STATES.FAILED],
    [STATES.DISCONNECTING]: [STATES.DISCONNECTED],
    [STATES.FAILED]: [STATES.CONNECTING, STATES.DISCONNECTED]
});
```

### State Machine Base Class

```javascript
const EventEmitter = require('events');

class StateMachine extends EventEmitter {
    constructor(initialState, transitions) {
        super();
        this._state = initialState;
        this._transitions = transitions;
        this._stateHistory = [];
    }

    get state() {
        return this._state;
    }

    get stateHistory() {
        return [...this._stateHistory];
    }

    _canTransition(newState) {
        const allowed = this._transitions[this._state];
        return allowed && allowed.includes(newState);
    }

    _transition(newState, context = {}) {
        if (!this._canTransition(newState)) {
            const error = new Error(
                `Invalid state transition: ${this._state} -> ${newState}`
            );
            error.fromState = this._state;
            error.toState = newState;
            throw error;
        }

        const prevState = this._state;
        this._state = newState;

        this._stateHistory.push({
            from: prevState,
            to: newState,
            timestamp: Date.now(),
            context
        });

        // Emit state change event
        this.emit('stateChange', {
            from: prevState,
            to: newState,
            context
        });

        // Emit specific state event
        this.emit(newState, context);

        // Emit exit/enter events
        this.emit(`exit:${prevState}`, context);
        this.emit(`enter:${newState}`, context);

        return true;
    }

    // Check if currently in a specific state
    isInState(state) {
        return this._state === state;
    }

    // Check if in any of the given states
    isInAnyState(...states) {
        return states.includes(this._state);
    }
}
```

## Connection Manager Implementation

### Full Connection Manager

```javascript
class ConnectionManager extends StateMachine {
    constructor(options = {}) {
        super(STATES.DISCONNECTED, TRANSITIONS);

        this.options = {
            // Connection options
            connectionTimeout: 10000,

            // Reconnection options
            reconnect: true,
            maxReconnectAttempts: 5,
            reconnectDelay: 1000,
            maxReconnectDelay: 30000,
            reconnectBackoffFactor: 2,
            reconnectJitter: 0.2,

            // Override with provided options
            ...options
        };

        this._connection = null;
        this._reconnectAttempts = 0;
        this._reconnectTimeout = null;
        this._connectionPromise = null;
    }

    // Public API
    async connect() {
        // Already connected
        if (this.isInState(STATES.CONNECTED)) {
            return this._connection;
        }

        // Already connecting - return existing promise
        if (this.isInState(STATES.CONNECTING) && this._connectionPromise) {
            return this._connectionPromise;
        }

        // Cannot connect from current state
        if (!this._canTransition(STATES.CONNECTING)) {
            throw new Error(`Cannot connect from state: ${this.state}`);
        }

        this._reconnectAttempts = 0;
        return this._initiateConnection();
    }

    async disconnect() {
        // Already disconnected
        if (this.isInState(STATES.DISCONNECTED)) {
            return;
        }

        // Cancel any pending reconnect
        this._cancelReconnect();

        // If not connected, just transition to disconnected
        if (!this.isInState(STATES.CONNECTED)) {
            this._transition(STATES.DISCONNECTED, { reason: 'user_requested' });
            return;
        }

        this._transition(STATES.DISCONNECTING, { reason: 'user_requested' });

        try {
            await this._performDisconnect();
        } catch (err) {
            this.emit('error', err);
        } finally {
            this._connection = null;
            this._transition(STATES.DISCONNECTED, { reason: 'user_requested' });
        }
    }

    destroy() {
        this._cancelReconnect();
        this.disconnect().catch(() => {});
        this.removeAllListeners();
    }

    // Connection lifecycle
    async _initiateConnection() {
        this._transition(STATES.CONNECTING);

        this._connectionPromise = this._performConnect();

        try {
            this._connection = await this._connectionPromise;
            this._setupConnectionHandlers();
            this._transition(STATES.CONNECTED);
            return this._connection;
        } catch (err) {
            this._handleConnectionError(err);
            throw err;
        } finally {
            this._connectionPromise = null;
        }
    }

    async _performConnect() {
        // Wrap with timeout
        return withTimeout(
            this._createConnection(),
            this.options.connectionTimeout,
            'Connection timeout'
        );
    }

    // Override in subclass
    async _createConnection() {
        throw new Error('_createConnection must be implemented');
    }

    async _performDisconnect() {
        if (this._connection && typeof this._connection.close === 'function') {
            await this._connection.close();
        }
    }

    _setupConnectionHandlers() {
        if (!this._connection) return;

        // Handle connection errors
        this._connection.on('error', (err) => {
            this.emit('error', err);
        });

        // Handle unexpected disconnection
        this._connection.on('close', () => {
            this._handleUnexpectedDisconnect();
        });
    }

    _handleConnectionError(err) {
        if (this.options.reconnect && this._shouldAttemptReconnect()) {
            this._scheduleReconnect(err);
        } else {
            this._transition(STATES.FAILED, { error: err });
        }
    }

    _handleUnexpectedDisconnect() {
        this._connection = null;

        // Don't reconnect if we're intentionally disconnecting
        if (this.isInState(STATES.DISCONNECTING)) {
            return;
        }

        if (this.options.reconnect && this._shouldAttemptReconnect()) {
            this._scheduleReconnect();
        } else {
            this._transition(STATES.DISCONNECTED, {
                reason: 'connection_lost'
            });
        }
    }

    // Reconnection logic
    _shouldAttemptReconnect() {
        return this._reconnectAttempts < this.options.maxReconnectAttempts;
    }

    _scheduleReconnect(lastError = null) {
        this._transition(STATES.RECONNECTING, {
            attempt: this._reconnectAttempts + 1,
            lastError
        });

        const delay = this._calculateReconnectDelay();

        this.emit('reconnecting', {
            attempt: this._reconnectAttempts + 1,
            maxAttempts: this.options.maxReconnectAttempts,
            delay
        });

        this._reconnectTimeout = setTimeout(async () => {
            this._reconnectAttempts++;

            try {
                await this._initiateConnection();
                this._reconnectAttempts = 0;
            } catch (err) {
                // Will be handled by _handleConnectionError
            }
        }, delay);
    }

    _calculateReconnectDelay() {
        const { reconnectDelay, maxReconnectDelay, reconnectBackoffFactor, reconnectJitter } = this.options;

        // Exponential backoff
        let delay = reconnectDelay * Math.pow(reconnectBackoffFactor, this._reconnectAttempts);

        // Cap at max delay
        delay = Math.min(delay, maxReconnectDelay);

        // Add jitter
        if (reconnectJitter > 0) {
            const jitterRange = delay * reconnectJitter;
            delay += (Math.random() * 2 - 1) * jitterRange;
        }

        return Math.max(0, Math.round(delay));
    }

    _cancelReconnect() {
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }
    }
}

// Timeout utility
function withTimeout(promise, ms, message) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(message));
        }, ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        clearTimeout(timeoutId);
    });
}
```

## WebSocket Connection Example

```javascript
const WebSocket = require('ws');

class WebSocketConnection extends ConnectionManager {
    constructor(url, options = {}) {
        super(options);
        this._url = url;
        this._protocols = options.protocols;
    }

    async _createConnection() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this._url, this._protocols);

            const onOpen = () => {
                cleanup();
                resolve(ws);
            };

            const onError = (err) => {
                cleanup();
                reject(err);
            };

            const onClose = () => {
                cleanup();
                reject(new Error('WebSocket closed before connection established'));
            };

            const cleanup = () => {
                ws.removeListener('open', onOpen);
                ws.removeListener('error', onError);
                ws.removeListener('close', onClose);
            };

            ws.on('open', onOpen);
            ws.on('error', onError);
            ws.on('close', onClose);
        });
    }

    _setupConnectionHandlers() {
        super._setupConnectionHandlers();

        this._connection.on('message', (data) => {
            this.emit('message', data);
        });

        this._connection.on('ping', (data) => {
            this.emit('ping', data);
        });

        this._connection.on('pong', (data) => {
            this.emit('pong', data);
        });
    }

    async _performDisconnect() {
        return new Promise((resolve) => {
            if (this._connection.readyState === WebSocket.CLOSED) {
                resolve();
                return;
            }

            this._connection.once('close', resolve);
            this._connection.close();

            // Force close after timeout
            setTimeout(() => {
                if (this._connection.readyState !== WebSocket.CLOSED) {
                    this._connection.terminate();
                }
                resolve();
            }, 5000);
        });
    }

    send(data) {
        if (!this.isInState(STATES.CONNECTED)) {
            throw new Error('Cannot send: not connected');
        }
        this._connection.send(data);
    }
}
```

## State Guards and Actions

### State Guards Pattern

```javascript
class GuardedStateMachine extends StateMachine {
    constructor(initialState, transitions, guards = {}) {
        super(initialState, transitions);
        this._guards = guards;
    }

    _transition(newState, context = {}) {
        // Check guard conditions
        const guardKey = `${this._state}:${newState}`;
        const guard = this._guards[guardKey];

        if (guard && !guard(context)) {
            const error = new Error(
                `Guard condition failed for: ${this._state} -> ${newState}`
            );
            error.guardKey = guardKey;
            throw error;
        }

        return super._transition(newState, context);
    }
}

// Usage
const guards = {
    'disconnected:connecting': (ctx) => {
        // Only allow connecting if we have credentials
        return !!ctx.credentials;
    },
    'connected:reconnecting': (ctx) => {
        // Only auto-reconnect if enabled
        return ctx.autoReconnect !== false;
    }
};

const machine = new GuardedStateMachine(
    STATES.DISCONNECTED,
    TRANSITIONS,
    guards
);
```

### State Entry/Exit Actions

```javascript
class ActionStateMachine extends StateMachine {
    constructor(initialState, transitions, actions = {}) {
        super(initialState, transitions);
        this._actions = actions;
    }

    async _transition(newState, context = {}) {
        const prevState = this._state;

        // Execute exit action
        const exitAction = this._actions[`exit:${prevState}`];
        if (exitAction) {
            await exitAction(context);
        }

        // Perform transition
        super._transition(newState, context);

        // Execute entry action
        const entryAction = this._actions[`enter:${newState}`];
        if (entryAction) {
            await entryAction(context);
        }

        // Execute transition action
        const transitionAction = this._actions[`${prevState}:${newState}`];
        if (transitionAction) {
            await transitionAction(context);
        }

        return true;
    }
}

// Usage
const actions = {
    'enter:connecting': async (ctx) => {
        console.log('Starting connection...');
    },
    'exit:connected': async (ctx) => {
        console.log('Cleaning up connection...');
    },
    'connected:disconnecting': async (ctx) => {
        console.log('User requested disconnect');
    }
};
```

## Health Checking

### Connection Health Monitor

```javascript
class HealthMonitoredConnection extends ConnectionManager {
    constructor(url, options = {}) {
        super(options);
        this._url = url;
        this._healthCheckInterval = options.healthCheckInterval || 30000;
        this._healthCheckTimeout = options.healthCheckTimeout || 5000;
        this._healthCheckTimer = null;
        this._lastHealthCheck = null;
    }

    _setupConnectionHandlers() {
        super._setupConnectionHandlers();
        this._startHealthCheck();
    }

    _startHealthCheck() {
        this._stopHealthCheck();

        this._healthCheckTimer = setInterval(async () => {
            try {
                await this._performHealthCheck();
                this._lastHealthCheck = {
                    timestamp: Date.now(),
                    healthy: true
                };
                this.emit('healthCheck', this._lastHealthCheck);
            } catch (err) {
                this._lastHealthCheck = {
                    timestamp: Date.now(),
                    healthy: false,
                    error: err
                };
                this.emit('healthCheck', this._lastHealthCheck);
                this.emit('unhealthy', err);

                // Trigger reconnect on health check failure
                this._handleUnexpectedDisconnect();
            }
        }, this._healthCheckInterval);
    }

    _stopHealthCheck() {
        if (this._healthCheckTimer) {
            clearInterval(this._healthCheckTimer);
            this._healthCheckTimer = null;
        }
    }

    async _performHealthCheck() {
        // Override in subclass - e.g., send ping, check response
        throw new Error('_performHealthCheck must be implemented');
    }

    async disconnect() {
        this._stopHealthCheck();
        return super.disconnect();
    }

    getHealthStatus() {
        return {
            state: this.state,
            lastHealthCheck: this._lastHealthCheck,
            reconnectAttempts: this._reconnectAttempts
        };
    }
}
```

## Multiple Connection Management

### Connection Pool

```javascript
class ConnectionPool extends EventEmitter {
    constructor(factory, options = {}) {
        super();
        this._factory = factory;
        this._minConnections = options.minConnections || 1;
        this._maxConnections = options.maxConnections || 10;
        this._connections = new Set();
        this._available = [];
        this._waiting = [];
    }

    async acquire() {
        // Try to get available connection
        const available = this._available.shift();
        if (available && available.isInState(STATES.CONNECTED)) {
            return available;
        }

        // Create new if under max
        if (this._connections.size < this._maxConnections) {
            const conn = await this._createConnection();
            return conn;
        }

        // Wait for available connection
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const idx = this._waiting.indexOf(entry);
                if (idx !== -1) this._waiting.splice(idx, 1);
                reject(new Error('Connection pool timeout'));
            }, 30000);

            const entry = { resolve, reject, timeout };
            this._waiting.push(entry);
        });
    }

    release(connection) {
        if (!this._connections.has(connection)) {
            return;
        }

        // Give to waiting request
        if (this._waiting.length > 0) {
            const { resolve, timeout } = this._waiting.shift();
            clearTimeout(timeout);
            resolve(connection);
            return;
        }

        // Return to available pool
        this._available.push(connection);
    }

    async _createConnection() {
        const conn = await this._factory();
        this._connections.add(conn);

        conn.on('close', () => {
            this._connections.delete(conn);
            const idx = this._available.indexOf(conn);
            if (idx !== -1) this._available.splice(idx, 1);
        });

        return conn;
    }

    async drain() {
        const promises = Array.from(this._connections).map(c => c.disconnect());
        await Promise.allSettled(promises);
        this._connections.clear();
        this._available = [];
    }

    get stats() {
        return {
            total: this._connections.size,
            available: this._available.length,
            waiting: this._waiting.length
        };
    }
}
```

## Testing State Machines

### State Machine Test Helper

```javascript
class StateMachineTestHelper {
    constructor(machine) {
        this._machine = machine;
        this._transitions = [];

        machine.on('stateChange', (event) => {
            this._transitions.push({
                ...event,
                timestamp: Date.now()
            });
        });
    }

    get transitions() {
        return [...this._transitions];
    }

    get transitionCount() {
        return this._transitions.length;
    }

    getTransitionsFrom(state) {
        return this._transitions.filter(t => t.from === state);
    }

    getTransitionsTo(state) {
        return this._transitions.filter(t => t.to === state);
    }

    assertTransition(from, to) {
        const found = this._transitions.find(
            t => t.from === from && t.to === to
        );
        if (!found) {
            throw new Error(
                `Expected transition ${from} -> ${to} not found`
            );
        }
        return found;
    }

    assertState(expectedState) {
        if (this._machine.state !== expectedState) {
            throw new Error(
                `Expected state ${expectedState}, got ${this._machine.state}`
            );
        }
    }

    reset() {
        this._transitions = [];
    }
}
```
