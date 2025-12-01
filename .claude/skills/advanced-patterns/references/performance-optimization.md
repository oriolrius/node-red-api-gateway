# Performance Optimization

## Caching Strategies

### Simple In-Memory Cache

```javascript
class SimpleCache {
    constructor(options = {}) {
        this.cache = new Map();
        this.ttl = options.ttl || 60000; // 1 minute default
        this.maxSize = options.maxSize || 1000;
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.value;
    }

    set(key, value, ttl) {
        // Evict if at capacity
        if (this.cache.size >= this.maxSize) {
            this.evictOldest();
        }

        this.cache.set(key, {
            value,
            expires: Date.now() + (ttl || this.ttl),
            created: Date.now()
        });
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    evictOldest() {
        let oldest = null;
        let oldestKey = null;

        for (const [key, entry] of this.cache) {
            if (!oldest || entry.created < oldest.created) {
                oldest = entry;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }
}
```

### LRU Cache

```javascript
class LRUCache {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return undefined;

        // Move to end (most recently used)
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);

        return value;
    }

    set(key, value) {
        // Delete if exists (to update position)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Evict oldest if at capacity
        while (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, value);
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }
}
```

### Cache with Stale-While-Revalidate

```javascript
class SWRCache {
    constructor(fetcher, options = {}) {
        this.fetcher = fetcher;
        this.cache = new Map();
        this.ttl = options.ttl || 60000;
        this.staleTtl = options.staleTtl || 300000; // Serve stale for 5 min
        this.pending = new Map();
    }

    async get(key) {
        const entry = this.cache.get(key);
        const now = Date.now();

        if (entry) {
            if (now < entry.freshUntil) {
                // Fresh - return immediately
                return entry.value;
            }

            if (now < entry.staleUntil) {
                // Stale but usable - return and revalidate in background
                this.revalidate(key);
                return entry.value;
            }
        }

        // No cache or too stale - fetch synchronously
        return this.fetch(key);
    }

    async fetch(key) {
        // Dedupe concurrent requests
        if (this.pending.has(key)) {
            return this.pending.get(key);
        }

        const promise = this.fetcher(key).then(value => {
            const now = Date.now();
            this.cache.set(key, {
                value,
                freshUntil: now + this.ttl,
                staleUntil: now + this.staleTtl
            });
            this.pending.delete(key);
            return value;
        }).catch(err => {
            this.pending.delete(key);
            throw err;
        });

        this.pending.set(key, promise);
        return promise;
    }

    revalidate(key) {
        // Don't await - fire and forget
        this.fetch(key).catch(() => {});
    }
}

// Usage
const userCache = new SWRCache(
    async (userId) => {
        const response = await fetch(`/api/users/${userId}`);
        return response.json();
    },
    { ttl: 60000, staleTtl: 300000 }
);

const user = await userCache.get('user-123');
```

## Connection Pooling

### Generic Connection Pool

```javascript
class ConnectionPool {
    constructor(factory, options = {}) {
        this.factory = factory;
        this.maxSize = options.maxSize || 10;
        this.minSize = options.minSize || 2;
        this.idleTimeout = options.idleTimeout || 30000;

        this.pool = [];
        this.inUse = new Set();
        this.waiting = [];

        // Initialize minimum connections
        this.initialize();
    }

    async initialize() {
        const promises = [];
        for (let i = 0; i < this.minSize; i++) {
            promises.push(this.createConnection());
        }
        await Promise.all(promises);
    }

    async createConnection() {
        const conn = await this.factory();
        conn._poolCreated = Date.now();
        conn._poolLastUsed = Date.now();
        this.pool.push(conn);
        return conn;
    }

    async acquire() {
        // Find available connection
        for (const conn of this.pool) {
            if (!this.inUse.has(conn)) {
                this.inUse.add(conn);
                conn._poolLastUsed = Date.now();
                return conn;
            }
        }

        // Create new if under limit
        if (this.pool.length < this.maxSize) {
            const conn = await this.createConnection();
            this.inUse.add(conn);
            return conn;
        }

        // Wait for available connection
        return new Promise((resolve) => {
            this.waiting.push(resolve);
        });
    }

    release(conn) {
        this.inUse.delete(conn);
        conn._poolLastUsed = Date.now();

        // Fulfill waiting request
        if (this.waiting.length > 0) {
            const resolve = this.waiting.shift();
            this.inUse.add(conn);
            resolve(conn);
        }
    }

    async destroy(conn) {
        this.inUse.delete(conn);
        const index = this.pool.indexOf(conn);
        if (index !== -1) {
            this.pool.splice(index, 1);
        }

        if (conn.close) {
            await conn.close();
        }
    }

    async close() {
        const promises = this.pool.map(conn => {
            if (conn.close) return conn.close();
        });
        await Promise.all(promises);
        this.pool = [];
        this.inUse.clear();
    }

    // Periodic maintenance
    startMaintenance(interval = 10000) {
        this.maintenanceTimer = setInterval(() => {
            this.maintenance();
        }, interval);
    }

    stopMaintenance() {
        if (this.maintenanceTimer) {
            clearInterval(this.maintenanceTimer);
        }
    }

    maintenance() {
        const now = Date.now();

        // Remove idle connections above minimum
        for (const conn of [...this.pool]) {
            if (this.pool.length <= this.minSize) break;
            if (this.inUse.has(conn)) continue;

            if (now - conn._poolLastUsed > this.idleTimeout) {
                this.destroy(conn);
            }
        }
    }
}

// Usage
const pool = new ConnectionPool(
    async () => {
        const client = new DbClient(config);
        await client.connect();
        return client;
    },
    { maxSize: 20, minSize: 5 }
);

pool.startMaintenance();

// In request handler
const conn = await pool.acquire();
try {
    const result = await conn.query('SELECT * FROM users');
    return result;
} finally {
    pool.release(conn);
}
```

### Node-RED Config Node with Pooling

```javascript
function BrokerConfigNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    // Connection pool
    node.pool = new ConnectionPool(
        async () => {
            const client = createBrokerClient({
                host: config.host,
                port: config.port,
                credentials: node.credentials
            });
            await client.connect();
            return client;
        },
        { maxSize: config.poolSize || 10 }
    );

    // Method for client nodes
    node.withConnection = async function(callback) {
        const conn = await node.pool.acquire();
        try {
            return await callback(conn);
        } finally {
            node.pool.release(conn);
        }
    };

    node.on('close', function(done) {
        node.pool.close().then(done).catch(done);
    });
}
```

## Batch Processing

### Request Batching

```javascript
class RequestBatcher {
    constructor(executor, options = {}) {
        this.executor = executor;
        this.maxBatchSize = options.maxBatchSize || 100;
        this.maxWaitTime = options.maxWaitTime || 50;

        this.batch = [];
        this.timer = null;
    }

    add(item) {
        return new Promise((resolve, reject) => {
            this.batch.push({ item, resolve, reject });

            if (this.batch.length >= this.maxBatchSize) {
                this.flush();
            } else if (!this.timer) {
                this.timer = setTimeout(() => this.flush(), this.maxWaitTime);
            }
        });
    }

    async flush() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.batch.length === 0) return;

        const currentBatch = this.batch;
        this.batch = [];

        try {
            const items = currentBatch.map(b => b.item);
            const results = await this.executor(items);

            currentBatch.forEach((entry, index) => {
                entry.resolve(results[index]);
            });
        } catch (err) {
            currentBatch.forEach(entry => {
                entry.reject(err);
            });
        }
    }
}

// Usage - batch database inserts
const insertBatcher = new RequestBatcher(
    async (records) => {
        return db.batchInsert('events', records);
    },
    { maxBatchSize: 100, maxWaitTime: 100 }
);

// Each call returns a promise
await insertBatcher.add({ event: 'click', timestamp: Date.now() });
```

### Message Aggregation in Node-RED

```javascript
function BatchNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    const batchSize = config.batchSize || 10;
    const timeout = config.timeout || 1000;

    let batch = [];
    let timer = null;

    function flush() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        if (batch.length === 0) return;

        const messages = batch;
        batch = [];

        node.send({
            payload: messages.map(m => m.payload),
            parts: {
                count: messages.length
            }
        });
    }

    node.on('input', function(msg, send, done) {
        batch.push(msg);

        if (batch.length >= batchSize) {
            flush();
        } else if (!timer) {
            timer = setTimeout(flush, timeout);
        }

        done();
    });

    node.on('close', function(done) {
        flush();
        done();
    });
}
```

## Lazy Loading

### Lazy Initialization

```javascript
class LazyConnection {
    constructor(factory) {
        this.factory = factory;
        this.instance = null;
        this.connecting = null;
    }

    async get() {
        if (this.instance) {
            return this.instance;
        }

        // Dedupe concurrent initialization
        if (this.connecting) {
            return this.connecting;
        }

        this.connecting = this.factory().then(instance => {
            this.instance = instance;
            this.connecting = null;
            return instance;
        }).catch(err => {
            this.connecting = null;
            throw err;
        });

        return this.connecting;
    }

    async close() {
        if (this.instance && this.instance.close) {
            await this.instance.close();
        }
        this.instance = null;
    }
}

// Usage in Node-RED
function MyNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    // Lazy - only connect when first message arrives
    const connection = new LazyConnection(async () => {
        node.status({ fill: "yellow", shape: "ring", text: "connecting" });
        const client = await createClient(config);
        node.status({ fill: "green", shape: "dot", text: "connected" });
        return client;
    });

    node.on('input', async function(msg, send, done) {
        try {
            const client = await connection.get();
            const result = await client.process(msg.payload);
            msg.payload = result;
            send(msg);
            done();
        } catch (err) {
            done(err);
        }
    });

    node.on('close', function(done) {
        connection.close().then(done).catch(done);
    });
}
```

## Debouncing and Throttling

### Debounce

```javascript
function debounce(fn, delay) {
    let timer = null;

    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// Usage - debounce status updates
const updateStatus = debounce((text) => {
    node.status({ fill: "blue", shape: "dot", text });
}, 100);
```

### Throttle

```javascript
function throttle(fn, limit) {
    let lastRun = 0;
    let pending = null;

    return function(...args) {
        const now = Date.now();

        if (now - lastRun >= limit) {
            lastRun = now;
            return fn.apply(this, args);
        }

        // Schedule for later
        if (!pending) {
            pending = setTimeout(() => {
                pending = null;
                lastRun = Date.now();
                fn.apply(this, args);
            }, limit - (now - lastRun));
        }
    };
}

// Usage - throttle API calls
const sendMetrics = throttle(async (metrics) => {
    await api.postMetrics(metrics);
}, 1000);
```

### Rate Limiting

```javascript
class RateLimiter {
    constructor(maxRequests, windowMs) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = [];
    }

    async acquire() {
        const now = Date.now();

        // Remove expired entries
        this.requests = this.requests.filter(t => now - t < this.windowMs);

        if (this.requests.length >= this.maxRequests) {
            // Calculate wait time
            const oldestRequest = this.requests[0];
            const waitTime = this.windowMs - (now - oldestRequest);

            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this.acquire();
        }

        this.requests.push(now);
    }
}

// Usage
const limiter = new RateLimiter(100, 60000); // 100 requests per minute

async function makeRequest() {
    await limiter.acquire();
    return fetch('/api/data');
}
```

## Best Practices

### Do

- Set appropriate TTL and size limits on caches
- Use connection pooling for expensive resources
- Batch operations when latency allows
- Implement lazy loading for optional features
- Clean up resources on node close

### Don't

- Cache without expiration (memory leak)
- Create unlimited pools
- Batch without timeout (data loss risk)
- Block on lazy initialization in hot path
- Ignore cleanup in error paths

### Monitoring

```javascript
class InstrumentedCache {
    constructor(cache) {
        this.cache = cache;
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0
        };
    }

    get(key) {
        const value = this.cache.get(key);
        if (value !== undefined) {
            this.stats.hits++;
        } else {
            this.stats.misses++;
        }
        return value;
    }

    set(key, value) {
        this.stats.sets++;
        return this.cache.set(key, value);
    }

    getStats() {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            hitRate: total > 0 ? this.stats.hits / total : 0
        };
    }
}
```
