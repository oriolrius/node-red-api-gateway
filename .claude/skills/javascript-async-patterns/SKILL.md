---
name: javascript-async-patterns
description: Comprehensive guide for JavaScript asynchronous programming patterns. This skill should be used when implementing async/await control flow, EventEmitter-based architectures, connection state machines, retry logic, or handling complex asynchronous operations in Node.js applications.
---

# JavaScript Async Patterns

This skill provides patterns and best practices for asynchronous JavaScript programming, covering async/await control flow, event-driven architecture, and connection state management.

## When to Use This Skill

- Implementing async/await with proper error handling
- Building event-driven systems with EventEmitter
- Managing connection lifecycles (connect, reconnect, disconnect)
- Implementing state machines for connection management
- Adding retry logic with exponential backoff
- Handling timeouts and cancellation
- Managing concurrent operations

## Core Patterns Overview

### Async/Await Fundamentals

```javascript
// Basic async function structure
async function operation() {
    try {
        const result = await someAsyncWork();
        return result;
    } catch (err) {
        // Handle or rethrow
        throw err;
    }
}
```

### Sequential vs Parallel Execution

```javascript
// Sequential - each awaits before next starts
async function sequential(items) {
    const results = [];
    for (const item of items) {
        results.push(await processItem(item));
    }
    return results;
}

// Parallel - all start immediately, await all together
async function parallel(items) {
    return Promise.all(items.map(item => processItem(item)));
}

// Parallel with concurrency limit
async function parallelLimited(items, limit = 5) {
    const results = [];
    const executing = new Set();

    for (const item of items) {
        const promise = processItem(item).then(result => {
            executing.delete(promise);
            return result;
        });
        executing.add(promise);
        results.push(promise);

        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}
```

### Timeout Pattern

```javascript
function withTimeout(promise, ms, message = 'Operation timed out') {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        clearTimeout(timeoutId);
    });
}

// Usage
const result = await withTimeout(fetchData(), 5000);
```

### Retry with Exponential Backoff

```javascript
async function withRetry(fn, options = {}) {
    const {
        maxAttempts = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        factor = 2,
        shouldRetry = () => true
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn(attempt);
        } catch (err) {
            lastError = err;

            if (attempt === maxAttempts || !shouldRetry(err, attempt)) {
                throw err;
            }

            const delay = Math.min(
                baseDelay * Math.pow(factor, attempt - 1),
                maxDelay
            );
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}
```

### Cancellation with AbortController

```javascript
async function cancellableOperation(signal) {
    // Check before starting
    if (signal?.aborted) {
        throw new Error('Operation cancelled');
    }

    // Listen for abort during operation
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            reject(new Error('Operation cancelled'));
        };

        signal?.addEventListener('abort', onAbort);

        doAsyncWork()
            .then(resolve)
            .catch(reject)
            .finally(() => {
                signal?.removeEventListener('abort', onAbort);
            });
    });
}

// Usage
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000); // Cancel after 5s

try {
    await cancellableOperation(controller.signal);
} catch (err) {
    if (err.message === 'Operation cancelled') {
        // Handle cancellation
    }
}
```

## EventEmitter Patterns

### Basic EventEmitter Usage

```javascript
const EventEmitter = require('events');

class MyService extends EventEmitter {
    constructor() {
        super();
        this.state = 'idle';
    }

    async connect() {
        this.emit('connecting');
        try {
            await this._doConnect();
            this.state = 'connected';
            this.emit('connected');
        } catch (err) {
            this.emit('error', err);
            throw err;
        }
    }

    // Private method convention
    async _doConnect() {
        // Implementation
    }
}
```

### Listener Lifecycle Management

```javascript
class ConnectionManager extends EventEmitter {
    constructor() {
        super();
        this._boundHandlers = new Map();
    }

    // Store bound handlers for later removal
    _bindHandler(emitter, event, handler) {
        const bound = handler.bind(this);
        this._boundHandlers.set(handler, bound);
        emitter.on(event, bound);
        return bound;
    }

    _unbindHandler(emitter, event, handler) {
        const bound = this._boundHandlers.get(handler);
        if (bound) {
            emitter.off(event, bound);
            this._boundHandlers.delete(handler);
        }
    }

    // Clean up all listeners
    destroy() {
        this.removeAllListeners();
        this._boundHandlers.clear();
    }
}
```

### Once Pattern for Single Events

```javascript
const { once } = require('events');

// Wait for single event (returns array of args)
async function waitForConnection(emitter) {
    const [connection] = await once(emitter, 'connected');
    return connection;
}

// With timeout
async function waitForConnectionWithTimeout(emitter, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const [connection] = await once(emitter, 'connected', {
            signal: controller.signal
        });
        return connection;
    } finally {
        clearTimeout(timeoutId);
    }
}
```

### Error Event Handling

```javascript
class RobustEmitter extends EventEmitter {
    constructor() {
        super();
        // Prevent unhandled error crashes
        this.on('error', (err) => {
            // Default error handling if no other listeners
            if (this.listenerCount('error') === 1) {
                console.error('Unhandled emitter error:', err);
            }
        });
    }

    // Safe emit that catches listener errors
    safeEmit(event, ...args) {
        try {
            return this.emit(event, ...args);
        } catch (err) {
            this.emit('error', err);
            return false;
        }
    }
}
```

## Connection State Management

### State Machine Pattern

```javascript
const STATES = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    DISCONNECTING: 'disconnecting',
    FAILED: 'failed'
};

const TRANSITIONS = {
    [STATES.DISCONNECTED]: ['connecting'],
    [STATES.CONNECTING]: ['connected', 'disconnected', 'failed'],
    [STATES.CONNECTED]: ['disconnecting', 'reconnecting'],
    [STATES.RECONNECTING]: ['connected', 'disconnected', 'failed'],
    [STATES.DISCONNECTING]: ['disconnected'],
    [STATES.FAILED]: ['connecting', 'disconnected']
};

class ConnectionStateMachine extends EventEmitter {
    constructor() {
        super();
        this._state = STATES.DISCONNECTED;
    }

    get state() {
        return this._state;
    }

    _canTransition(newState) {
        const allowed = TRANSITIONS[this._state];
        return allowed && allowed.includes(newState);
    }

    _transition(newState) {
        if (!this._canTransition(newState)) {
            throw new Error(
                `Invalid transition: ${this._state} -> ${newState}`
            );
        }

        const oldState = this._state;
        this._state = newState;
        this.emit('stateChange', { from: oldState, to: newState });
        this.emit(newState);

        return true;
    }

    // State query methods
    isConnected() {
        return this._state === STATES.CONNECTED;
    }

    isConnecting() {
        return [STATES.CONNECTING, STATES.RECONNECTING].includes(this._state);
    }

    canConnect() {
        return this._canTransition(STATES.CONNECTING);
    }
}
```

### Full Connection Manager Implementation

```javascript
class ConnectionManager extends ConnectionStateMachine {
    constructor(options = {}) {
        super();
        this.options = {
            reconnect: true,
            maxReconnectAttempts: 5,
            reconnectDelay: 1000,
            maxReconnectDelay: 30000,
            reconnectFactor: 2,
            connectionTimeout: 10000,
            ...options
        };

        this._reconnectAttempts = 0;
        this._connection = null;
        this._reconnectTimeout = null;
    }

    async connect() {
        if (!this.canConnect()) {
            if (this.isConnected()) return;
            throw new Error(`Cannot connect from state: ${this.state}`);
        }

        this._transition(STATES.CONNECTING);
        this._reconnectAttempts = 0;

        try {
            await this._establishConnection();
        } catch (err) {
            this._handleConnectionFailure(err);
            throw err;
        }
    }

    async _establishConnection() {
        const connection = await withTimeout(
            this._createConnection(),
            this.options.connectionTimeout,
            'Connection timeout'
        );

        this._connection = connection;
        this._setupConnectionHandlers();
        this._transition(STATES.CONNECTED);
    }

    async _createConnection() {
        // Override in subclass
        throw new Error('_createConnection must be implemented');
    }

    _setupConnectionHandlers() {
        if (!this._connection) return;

        this._connection.on('error', (err) => {
            this.emit('error', err);
        });

        this._connection.on('close', () => {
            this._handleDisconnect();
        });
    }

    _handleDisconnect() {
        this._connection = null;

        if (this.state === STATES.DISCONNECTING) {
            this._transition(STATES.DISCONNECTED);
            return;
        }

        if (this.options.reconnect && this._shouldReconnect()) {
            this._scheduleReconnect();
        } else {
            this._transition(STATES.DISCONNECTED);
        }
    }

    _shouldReconnect() {
        return this._reconnectAttempts < this.options.maxReconnectAttempts;
    }

    _scheduleReconnect() {
        this._transition(STATES.RECONNECTING);
        this._reconnectAttempts++;

        const delay = Math.min(
            this.options.reconnectDelay *
                Math.pow(this.options.reconnectFactor, this._reconnectAttempts - 1),
            this.options.maxReconnectDelay
        );

        this.emit('reconnecting', {
            attempt: this._reconnectAttempts,
            delay,
            maxAttempts: this.options.maxReconnectAttempts
        });

        this._reconnectTimeout = setTimeout(async () => {
            try {
                await this._establishConnection();
                this._reconnectAttempts = 0;
            } catch (err) {
                if (this._shouldReconnect()) {
                    this._scheduleReconnect();
                } else {
                    this._handleConnectionFailure(err);
                }
            }
        }, delay);
    }

    _handleConnectionFailure(err) {
        this._transition(STATES.FAILED);
        this.emit('connectionFailed', err);
    }

    async disconnect() {
        if (this._reconnectTimeout) {
            clearTimeout(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }

        if (this.state === STATES.DISCONNECTED) return;

        this._transition(STATES.DISCONNECTING);

        if (this._connection) {
            try {
                await this._closeConnection();
            } catch (err) {
                this.emit('error', err);
            }
            this._connection = null;
        }

        this._transition(STATES.DISCONNECTED);
    }

    async _closeConnection() {
        // Override in subclass
    }

    destroy() {
        this.disconnect();
        this.removeAllListeners();
    }
}
```

## Error Handling Best Practices

### Async Error Propagation

```javascript
// BAD: Errors lost in callbacks
function badExample() {
    setTimeout(async () => {
        await riskyOperation(); // Error not caught!
    }, 1000);
}

// GOOD: Proper error handling
function goodExample() {
    setTimeout(async () => {
        try {
            await riskyOperation();
        } catch (err) {
            handleError(err);
        }
    }, 1000);
}

// BEST: Use event emitter for error propagation
class Service extends EventEmitter {
    scheduleTask() {
        setTimeout(async () => {
            try {
                await this.riskyOperation();
            } catch (err) {
                this.emit('error', err);
            }
        }, 1000);
    }
}
```

### Cleanup on Error

```javascript
async function operationWithCleanup() {
    let resource = null;

    try {
        resource = await acquireResource();
        const result = await useResource(resource);
        return result;
    } finally {
        if (resource) {
            try {
                await releaseResource(resource);
            } catch (cleanupErr) {
                console.error('Cleanup error:', cleanupErr);
            }
        }
    }
}
```

### Graceful Shutdown Pattern

```javascript
class Application {
    constructor() {
        this._shutdownPromise = null;
        this._isShuttingDown = false;
    }

    async shutdown(signal) {
        if (this._shutdownPromise) {
            return this._shutdownPromise;
        }

        this._isShuttingDown = true;
        this._shutdownPromise = this._performShutdown(signal);
        return this._shutdownPromise;
    }

    async _performShutdown(signal) {
        console.log(`Shutting down (${signal})...`);

        // Stop accepting new work
        await this.stopAcceptingWork();

        // Wait for in-flight operations
        await this.waitForInFlight(30000);

        // Close connections
        await this.closeConnections();

        console.log('Shutdown complete');
    }

    registerShutdownHandlers() {
        const handler = (signal) => {
            this.shutdown(signal).then(() => {
                process.exit(0);
            }).catch((err) => {
                console.error('Shutdown error:', err);
                process.exit(1);
            });
        };

        process.on('SIGTERM', () => handler('SIGTERM'));
        process.on('SIGINT', () => handler('SIGINT'));
    }
}
```

## Reference Documentation

For detailed patterns and examples, consult the references directory:

- `references/async-await-patterns.md` - Advanced async/await patterns
- `references/eventemitter-patterns.md` - EventEmitter best practices
- `references/state-machine-patterns.md` - Connection state machines

To search for specific patterns:
```bash
grep -r "pattern" references/
```
