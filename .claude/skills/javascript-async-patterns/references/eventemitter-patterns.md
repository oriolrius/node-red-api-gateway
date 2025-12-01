# EventEmitter Patterns

This reference provides comprehensive patterns for event-driven architecture using Node.js EventEmitter.

## EventEmitter Fundamentals

### Creating Custom Emitters

```javascript
const EventEmitter = require('events');

class DataService extends EventEmitter {
    constructor() {
        super();
        // Set higher limit if needed (default: 10)
        this.setMaxListeners(20);
    }

    fetchData() {
        this.emit('fetching');

        fetch('/api/data')
            .then(res => res.json())
            .then(data => this.emit('data', data))
            .catch(err => this.emit('error', err));
    }
}
```

### Event Types and Conventions

```javascript
// Common event naming patterns
class Connection extends EventEmitter {
    // State events (past tense or adjective)
    // - 'connected', 'disconnected', 'ready', 'closed'

    // Action events (present participle -ing)
    // - 'connecting', 'disconnecting', 'reconnecting'

    // Data events (noun)
    // - 'data', 'message', 'request', 'response'

    // Error event (special - uncaught causes crash)
    // - 'error'

    // Lifecycle events
    // - 'open', 'close', 'end', 'finish', 'drain'
}
```

## Listener Management

### Adding Listeners

```javascript
const emitter = new EventEmitter();

// Standard listener - persists
emitter.on('event', (data) => {
    console.log('Received:', data);
});

// One-time listener - auto-removed after first call
emitter.once('event', (data) => {
    console.log('First time only:', data);
});

// Prepend listener to front of queue
emitter.prependListener('event', (data) => {
    console.log('I run first:', data);
});

emitter.prependOnceListener('event', (data) => {
    console.log('First and only, first in queue');
});
```

### Removing Listeners

```javascript
const handler = (data) => console.log(data);

emitter.on('event', handler);

// Remove specific listener (must be same function reference)
emitter.off('event', handler);
// or
emitter.removeListener('event', handler);

// Remove all listeners for an event
emitter.removeAllListeners('event');

// Remove ALL listeners for ALL events
emitter.removeAllListeners();
```

### Listener Count and Inspection

```javascript
// Get listener count
const count = emitter.listenerCount('event');

// Get array of listeners
const listeners = emitter.listeners('event');

// Get raw listeners (including once wrappers)
const raw = emitter.rawListeners('event');

// Get all event names with listeners
const events = emitter.eventNames();
```

## Async Event Patterns

### Promisified Events

```javascript
const { once } = require('events');

// Wait for a single event
async function waitForReady(emitter) {
    const [data] = await once(emitter, 'ready');
    return data;
}

// Wait with abort signal
async function waitForReadyWithTimeout(emitter, timeout) {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), timeout);

    try {
        const [data] = await once(emitter, 'ready', {
            signal: ac.signal
        });
        return data;
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error('Timeout waiting for ready event');
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}
```

### Async Iterator Pattern

```javascript
const { on } = require('events');

// Iterate over events as async iterator
async function processMessages(emitter) {
    const ac = new AbortController();

    try {
        for await (const [message] of on(emitter, 'message', {
            signal: ac.signal
        })) {
            await handleMessage(message);

            if (message.type === 'end') {
                ac.abort();
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') throw err;
    }
}
```

### Event-to-Promise Bridge

```javascript
function eventToPromise(emitter, resolveEvent, rejectEvent = 'error') {
    return new Promise((resolve, reject) => {
        const onResolve = (...args) => {
            cleanup();
            resolve(args.length === 1 ? args[0] : args);
        };

        const onReject = (err) => {
            cleanup();
            reject(err);
        };

        const cleanup = () => {
            emitter.off(resolveEvent, onResolve);
            emitter.off(rejectEvent, onReject);
        };

        emitter.once(resolveEvent, onResolve);
        emitter.once(rejectEvent, onReject);
    });
}

// Usage
const result = await eventToPromise(connection, 'connected', 'error');
```

## Error Handling

### Safe Error Emission

```javascript
class SafeEmitter extends EventEmitter {
    constructor() {
        super();

        // Ensure at least one error handler exists
        this.on('error', (err) => {
            if (this.listenerCount('error') === 1) {
                // Only default handler - log but don't crash
                console.error('Unhandled EventEmitter error:', err);
            }
        });
    }

    // Emit with error catching
    safeEmit(event, ...args) {
        try {
            return this.emit(event, ...args);
        } catch (err) {
            // Listener threw - emit as error
            this.emit('error', new Error(
                `Listener error in '${event}': ${err.message}`
            ));
            return false;
        }
    }
}
```

### Error Event Special Behavior

```javascript
// IMPORTANT: 'error' event has special behavior

// If NO error listeners and 'error' is emitted:
// - Node.js prints stack trace and exits process

// Always have at least one error handler:
emitter.on('error', (err) => {
    console.error('Error occurred:', err);
});

// Or use try-catch around code that might emit errors
try {
    emitter.emit('error', new Error('Something went wrong'));
} catch (err) {
    // Only catches if no error listeners exist
    console.error('Caught error:', err);
}
```

## Memory Management

### Preventing Memory Leaks

```javascript
class ManagedEmitter extends EventEmitter {
    constructor() {
        super();
        this._listeners = new Map();
    }

    // Track listener for cleanup
    addManagedListener(target, event, handler) {
        const boundHandler = handler.bind(this);

        if (!this._listeners.has(target)) {
            this._listeners.set(target, []);
        }
        this._listeners.get(target).push({ event, handler: boundHandler });

        target.on(event, boundHandler);
        return boundHandler;
    }

    // Clean up all managed listeners
    removeAllManagedListeners(target) {
        const listeners = this._listeners.get(target);
        if (listeners) {
            listeners.forEach(({ event, handler }) => {
                target.off(event, handler);
            });
            this._listeners.delete(target);
        }
    }

    // Full cleanup
    destroy() {
        // Remove listeners we added to other emitters
        for (const [target] of this._listeners) {
            this.removeAllManagedListeners(target);
        }

        // Remove listeners others added to us
        this.removeAllListeners();
    }
}
```

### MaxListeners Warning

```javascript
// Increase max listeners if legitimately needed
emitter.setMaxListeners(50);

// Or set globally (affects all new emitters)
EventEmitter.defaultMaxListeners = 50;

// Set to 0 for unlimited (not recommended)
emitter.setMaxListeners(0);

// Get current max
const max = emitter.getMaxListeners();

// Handle the warning event
process.on('warning', (warning) => {
    if (warning.name === 'MaxListenersExceededWarning') {
        console.warn('Too many listeners:', warning.emitter, warning.type);
    }
});
```

## Event Forwarding Patterns

### Event Proxy

```javascript
class EventProxy extends EventEmitter {
    constructor(source) {
        super();
        this._source = source;
        this._forwardedEvents = new Set();
    }

    forward(eventName) {
        if (this._forwardedEvents.has(eventName)) return this;

        this._forwardedEvents.add(eventName);
        this._source.on(eventName, (...args) => {
            this.emit(eventName, ...args);
        });

        return this;
    }

    forwardAll(events) {
        events.forEach(e => this.forward(e));
        return this;
    }
}

// Usage
const proxy = new EventProxy(socket);
proxy.forwardAll(['data', 'error', 'close']);
proxy.on('data', handleData);
```

### Event Aggregator

```javascript
class EventAggregator extends EventEmitter {
    constructor() {
        super();
        this._sources = new Map();
    }

    addSource(name, source, events) {
        const handlers = {};

        events.forEach(event => {
            handlers[event] = (...args) => {
                this.emit(event, { source: name, args });
                this.emit(`${name}:${event}`, ...args);
            };
            source.on(event, handlers[event]);
        });

        this._sources.set(name, { source, handlers });
    }

    removeSource(name) {
        const entry = this._sources.get(name);
        if (entry) {
            Object.entries(entry.handlers).forEach(([event, handler]) => {
                entry.source.off(event, handler);
            });
            this._sources.delete(name);
        }
    }
}

// Usage
const aggregator = new EventAggregator();
aggregator.addSource('db', dbConnection, ['connected', 'error']);
aggregator.addSource('cache', cacheConnection, ['connected', 'error']);

aggregator.on('connected', ({ source, args }) => {
    console.log(`${source} connected`);
});
```

## Typed Events Pattern

```javascript
// TypeScript-friendly typed events (works in JS too)
class TypedEmitter extends EventEmitter {
    // Document expected events in JSDoc
    /**
     * @event TypedEmitter#connected
     * @param {Object} connection - The connection object
     */

    /**
     * @event TypedEmitter#data
     * @param {Buffer} data - Received data
     * @param {Object} metadata - Data metadata
     */

    /**
     * @event TypedEmitter#error
     * @param {Error} error - The error that occurred
     */

    // Type-safe emit helpers
    emitConnected(connection) {
        return this.emit('connected', connection);
    }

    emitData(data, metadata) {
        return this.emit('data', data, metadata);
    }

    emitError(error) {
        return this.emit('error', error);
    }
}
```

## Testing EventEmitters

### Event Spy

```javascript
function createEventSpy(emitter, events) {
    const calls = {};

    events.forEach(event => {
        calls[event] = [];
        emitter.on(event, (...args) => {
            calls[event].push({
                args,
                timestamp: Date.now()
            });
        });
    });

    return {
        calls,
        getCallCount: (event) => calls[event]?.length || 0,
        getLastCall: (event) => calls[event]?.slice(-1)[0],
        reset: () => events.forEach(e => calls[e] = [])
    };
}

// Usage in tests
const spy = createEventSpy(service, ['connected', 'data', 'error']);
await service.connect();
expect(spy.getCallCount('connected')).toBe(1);
```

### Mock EventEmitter

```javascript
function createMockEmitter() {
    const emitter = new EventEmitter();
    const emitSpy = [];

    const originalEmit = emitter.emit.bind(emitter);
    emitter.emit = function(event, ...args) {
        emitSpy.push({ event, args, timestamp: Date.now() });
        return originalEmit(event, ...args);
    };

    emitter.getEmitHistory = () => [...emitSpy];
    emitter.clearHistory = () => emitSpy.length = 0;

    return emitter;
}
```
