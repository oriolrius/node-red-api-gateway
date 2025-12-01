# Advanced Async/Await Patterns

This reference provides in-depth coverage of async/await patterns for complex scenarios.

## Promise Combinators

### Promise.all - All Must Succeed

```javascript
// All promises must resolve; rejects on first failure
async function fetchAllUsers(userIds) {
    const users = await Promise.all(
        userIds.map(id => fetchUser(id))
    );
    return users;
}
```

### Promise.allSettled - Get All Results

```javascript
// Returns all results regardless of success/failure
async function tryFetchAllUsers(userIds) {
    const results = await Promise.allSettled(
        userIds.map(id => fetchUser(id))
    );

    const successful = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

    const failed = results
        .filter(r => r.status === 'rejected')
        .map(r => r.reason);

    return { successful, failed };
}
```

### Promise.race - First to Complete

```javascript
// Returns first settled promise (resolved or rejected)
async function fetchWithFallback(primaryUrl, fallbackUrl) {
    return Promise.race([
        fetch(primaryUrl).then(r => r.json()),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Primary timeout')), 3000)
        )
    ]).catch(() => fetch(fallbackUrl).then(r => r.json()));
}
```

### Promise.any - First Success

```javascript
// Returns first fulfilled; rejects only if all reject
async function fetchFromMirrors(mirrors) {
    try {
        return await Promise.any(
            mirrors.map(url => fetch(url).then(r => r.json()))
        );
    } catch (err) {
        // AggregateError contains all rejection reasons
        throw new Error(`All mirrors failed: ${err.errors.map(e => e.message)}`);
    }
}
```

## Advanced Control Flow

### Async Iteration

```javascript
// Async generator for paginated API
async function* paginatedFetch(baseUrl) {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const response = await fetch(`${baseUrl}?page=${page}`);
        const data = await response.json();

        yield* data.items;

        hasMore = data.hasNextPage;
        page++;
    }
}

// Usage
for await (const item of paginatedFetch('/api/items')) {
    processItem(item);
}
```

### Async Queue Processing

```javascript
class AsyncQueue {
    constructor(concurrency = 1) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
    }

    async push(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this._process();
        });
    }

    async _process() {
        while (this.running < this.concurrency && this.queue.length > 0) {
            const { task, resolve, reject } = this.queue.shift();
            this.running++;

            task()
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    this.running--;
                    this._process();
                });
        }
    }

    async drain() {
        while (this.running > 0 || this.queue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
}
```

### Debounce and Throttle for Async

```javascript
// Debounce: Only execute after delay with no new calls
function debounceAsync(fn, delay) {
    let timeoutId = null;
    let pendingPromise = null;

    return function(...args) {
        if (timeoutId) clearTimeout(timeoutId);

        return new Promise((resolve, reject) => {
            timeoutId = setTimeout(async () => {
                try {
                    const result = await fn.apply(this, args);
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            }, delay);
        });
    };
}

// Throttle: Execute at most once per interval
function throttleAsync(fn, interval) {
    let lastRun = 0;
    let pendingPromise = null;

    return async function(...args) {
        const now = Date.now();
        const timeSinceLastRun = now - lastRun;

        if (timeSinceLastRun >= interval) {
            lastRun = now;
            return fn.apply(this, args);
        }

        if (!pendingPromise) {
            pendingPromise = new Promise(resolve => {
                setTimeout(async () => {
                    lastRun = Date.now();
                    pendingPromise = null;
                    resolve(fn.apply(this, args));
                }, interval - timeSinceLastRun);
            });
        }

        return pendingPromise;
    };
}
```

## Semaphore Pattern

```javascript
class Semaphore {
    constructor(permits) {
        this.permits = permits;
        this.waiting = [];
    }

    async acquire() {
        if (this.permits > 0) {
            this.permits--;
            return;
        }

        return new Promise(resolve => {
            this.waiting.push(resolve);
        });
    }

    release() {
        if (this.waiting.length > 0) {
            const next = this.waiting.shift();
            next();
        } else {
            this.permits++;
        }
    }

    async withPermit(fn) {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

// Usage
const dbSemaphore = new Semaphore(10); // Max 10 concurrent DB connections

async function queryDatabase(sql) {
    return dbSemaphore.withPermit(async () => {
        const conn = await pool.getConnection();
        try {
            return await conn.query(sql);
        } finally {
            conn.release();
        }
    });
}
```

## Circuit Breaker Pattern

```javascript
const CIRCUIT_STATES = {
    CLOSED: 'closed',      // Normal operation
    OPEN: 'open',          // Failing, reject requests
    HALF_OPEN: 'half-open' // Testing if service recovered
};

class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 30000;
        this.halfOpenRequests = options.halfOpenRequests || 1;

        this.state = CIRCUIT_STATES.CLOSED;
        this.failures = 0;
        this.lastFailureTime = null;
        this.halfOpenAttempts = 0;
    }

    async execute(fn) {
        if (this.state === CIRCUIT_STATES.OPEN) {
            if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
                this.state = CIRCUIT_STATES.HALF_OPEN;
                this.halfOpenAttempts = 0;
            } else {
                throw new Error('Circuit breaker is OPEN');
            }
        }

        if (this.state === CIRCUIT_STATES.HALF_OPEN) {
            if (this.halfOpenAttempts >= this.halfOpenRequests) {
                throw new Error('Circuit breaker is HALF-OPEN, waiting for test');
            }
            this.halfOpenAttempts++;
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (err) {
            this._onFailure();
            throw err;
        }
    }

    _onSuccess() {
        this.failures = 0;
        this.state = CIRCUIT_STATES.CLOSED;
    }

    _onFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();

        if (this.failures >= this.failureThreshold) {
            this.state = CIRCUIT_STATES.OPEN;
        }
    }
}
```

## Mutex for Async Critical Sections

```javascript
class Mutex {
    constructor() {
        this._locked = false;
        this._waiting = [];
    }

    async acquire() {
        if (!this._locked) {
            this._locked = true;
            return;
        }

        return new Promise(resolve => {
            this._waiting.push(resolve);
        });
    }

    release() {
        if (this._waiting.length > 0) {
            const next = this._waiting.shift();
            next();
        } else {
            this._locked = false;
        }
    }

    async withLock(fn) {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

// Usage - ensure only one concurrent file write
const fileMutex = new Mutex();

async function writeToFile(content) {
    return fileMutex.withLock(async () => {
        await fs.promises.writeFile('data.json', content);
    });
}
```

## Lazy Initialization

```javascript
class LazyAsync {
    constructor(factory) {
        this._factory = factory;
        this._promise = null;
        this._value = undefined;
        this._initialized = false;
    }

    async get() {
        if (this._initialized) {
            return this._value;
        }

        if (!this._promise) {
            this._promise = this._factory().then(value => {
                this._value = value;
                this._initialized = true;
                return value;
            });
        }

        return this._promise;
    }

    reset() {
        this._promise = null;
        this._value = undefined;
        this._initialized = false;
    }
}

// Usage
const dbConnection = new LazyAsync(async () => {
    return await createDatabaseConnection();
});

// First call initializes, subsequent calls return cached
const conn = await dbConnection.get();
```

## Error Handling Patterns

### Retry with Jitter

```javascript
function withRetryAndJitter(fn, options = {}) {
    const {
        maxAttempts = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        jitterFactor = 0.2 // 20% jitter
    } = options;

    return async function(...args) {
        let lastError;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn.apply(this, args);
            } catch (err) {
                lastError = err;

                if (attempt === maxAttempts) break;

                const baseWait = Math.min(
                    baseDelay * Math.pow(2, attempt - 1),
                    maxDelay
                );
                const jitter = baseWait * jitterFactor * (Math.random() * 2 - 1);
                const delay = Math.max(0, baseWait + jitter);

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    };
}
```

### Error Aggregation

```javascript
class AggregateError extends Error {
    constructor(errors, message = 'Multiple errors occurred') {
        super(message);
        this.name = 'AggregateError';
        this.errors = errors;
    }
}

async function executeAll(tasks) {
    const results = await Promise.allSettled(tasks.map(t => t()));

    const errors = results
        .filter(r => r.status === 'rejected')
        .map(r => r.reason);

    if (errors.length > 0) {
        throw new AggregateError(errors);
    }

    return results.map(r => r.value);
}
```

## Testing Async Code

### Fake Timers

```javascript
// Jest example
describe('timeout behavior', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('retries after delay', async () => {
        const mockFn = jest.fn()
            .mockRejectedValueOnce(new Error('fail'))
            .mockResolvedValueOnce('success');

        const promise = withRetry(mockFn, { baseDelay: 1000 });

        // Fast-forward timer
        await jest.advanceTimersByTimeAsync(1000);

        await expect(promise).resolves.toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(2);
    });
});
```

### Testing Event Emitters

```javascript
function waitForEvent(emitter, event, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for event: ${event}`));
        }, timeout);

        emitter.once(event, (...args) => {
            clearTimeout(timer);
            resolve(args);
        });
    });
}

// Usage in tests
test('emits connected event', async () => {
    const service = new MyService();
    const connectPromise = waitForEvent(service, 'connected');

    service.connect();

    await expect(connectPromise).resolves.toBeDefined();
});
```
