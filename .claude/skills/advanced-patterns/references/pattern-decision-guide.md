# Pattern Decision Guide

## Quick Reference

| Problem | Pattern | Complexity |
|---------|---------|------------|
| Multiple implementations of interface | Factory | Low |
| Shared configuration across nodes | Config Node + Composition | Low |
| Expensive resource reuse | Connection Pool | Medium |
| Reduce repeated API calls | Cache | Medium |
| Process items in bulk | Batching | Medium |
| Expensive optional initialization | Lazy Loading | Low |
| Prevent resource exhaustion | Rate Limiting | Medium |
| Clean startup/shutdown | Lifecycle Management | Medium |
| Track complex state | State Machine | High |

## Decision Trees

### "I need to create objects based on runtime configuration"

```
Do you need multiple implementations of the same interface?
├─ Yes → Factory Pattern
│        └─ Are implementations loaded at startup?
│           ├─ Yes → Static Registry Factory
│           └─ No → Dynamic Plugin Factory
└─ No → Simple Constructor
```

### "I need to share configuration between nodes"

```
Is the configuration shared across multiple nodes?
├─ Yes → Configuration Node
│        └─ Does each node need different overrides?
│           ├─ Yes → Config Node + Composition
│           └─ No → Config Node alone
└─ No → Node-level configuration
```

### "I need to optimize resource usage"

```
What is the bottleneck?
├─ Connection creation is slow
│  └─ Connection Pool
├─ External API calls are slow/expensive
│  ├─ Same data requested repeatedly → Cache
│  ├─ Many small operations → Batching
│  └─ Rate limited API → Rate Limiter
├─ Memory usage is high
│  └─ Lazy Loading
└─ CPU bound operations
   └─ Worker Threads (outside scope)
```

### "I need to manage node lifecycle"

```
When should resources be initialized?
├─ Immediately on deploy → Eager Initialization
├─ On first message → Lazy Initialization
└─ With retry on failure → Retry Pattern

How should shutdown be handled?
├─ Quick cleanup OK → Basic Close Handler
├─ Must complete pending work → Drain Pattern
└─ Complex state → State Machine
```

## Pattern Combinations

### HTTP API Client Node

Patterns used:
- **Configuration Composition**: Merge defaults, config node, node settings
- **Lazy Loading**: Connect on first request
- **Cache**: Cache responses with TTL
- **Rate Limiter**: Respect API rate limits

```javascript
function HttpApiNode(config) {
    RED.nodes.createNode(this, config);

    // Configuration Composition
    const serverConfig = RED.nodes.getNode(config.server);
    const finalConfig = buildConfig(DEFAULTS, serverConfig, config);

    // Cache
    const cache = new SWRCache(fetchData, { ttl: finalConfig.cacheTtl });

    // Rate Limiter
    const limiter = new RateLimiter(finalConfig.rateLimit, 60000);

    // Lazy Loading
    let client = null;
    async function getClient() {
        if (!client) {
            client = createHttpClient(finalConfig);
        }
        return client;
    }

    node.on('input', async function(msg, send, done) {
        try {
            await limiter.acquire();
            const result = await cache.get(msg.url);
            msg.payload = result;
            send(msg);
            done();
        } catch (err) {
            done(err);
        }
    });
}
```

### Message Broker Node

Patterns used:
- **Factory Pattern**: Support multiple broker types
- **Connection Pool**: Shared connections via config node
- **Lifecycle Management**: Proper startup/shutdown
- **State Machine**: Track connection state

```javascript
// Config node with pooling
function BrokerConfigNode(config) {
    RED.nodes.createNode(this, config);

    // Factory for broker type
    const handler = BrokerFactory.create(config.type);

    // Connection pool
    this.pool = new ConnectionPool(
        () => handler.createConnection(config),
        { maxSize: config.poolSize }
    );

    // Lifecycle
    this.on('close', done => this.pool.close().then(done));
}

// Client node with state machine
function BrokerClientNode(config) {
    RED.nodes.createNode(this, config);

    const broker = RED.nodes.getNode(config.broker);
    const state = new ConnectionStateMachine(this);

    state.connect().catch(err => {
        node.error(err);
    });

    node.on('input', async function(msg, send, done) {
        if (!state.isReady()) {
            done(new Error('Not connected'));
            return;
        }

        await broker.withConnection(async (conn) => {
            await conn.send(msg.payload);
            done();
        });
    });

    node.on('close', done => state.disconnect().then(done));
}
```

### Database Query Node

Patterns used:
- **Connection Pool**: Reuse database connections
- **Batching**: Batch small queries
- **Cache**: Cache query results
- **Graceful Shutdown**: Complete pending queries

```javascript
function DatabaseNode(config) {
    RED.nodes.createNode(this, config);

    const dbConfig = RED.nodes.getNode(config.database);

    // Batching for inserts
    const insertBatcher = new RequestBatcher(
        async (records) => {
            return dbConfig.withConnection(conn =>
                conn.batchInsert(config.table, records)
            );
        },
        { maxBatchSize: 100, maxWaitTime: 100 }
    );

    // Cache for selects
    const queryCache = new SimpleCache({ ttl: 30000 });

    // Pending operations for graceful shutdown
    const pending = new Set();

    node.on('input', async function(msg, send, done) {
        const opId = msg._msgid;
        pending.add(opId);

        try {
            if (msg.operation === 'insert') {
                await insertBatcher.add(msg.payload);
            } else {
                const cacheKey = JSON.stringify(msg.query);
                let result = queryCache.get(cacheKey);

                if (!result) {
                    result = await dbConfig.withConnection(conn =>
                        conn.query(msg.query)
                    );
                    queryCache.set(cacheKey, result);
                }

                msg.payload = result;
            }
            send(msg);
            done();
        } catch (err) {
            done(err);
        } finally {
            pending.delete(opId);
        }
    });

    node.on('close', async function(removed, done) {
        // Flush batched inserts
        await insertBatcher.flush();

        // Wait for pending operations
        const timeout = Date.now() + 10000;
        while (pending.size > 0 && Date.now() < timeout) {
            await sleep(100);
        }

        done();
    });
}
```

## Anti-Patterns

### Don't: Create connection per message

```javascript
// BAD
node.on('input', async function(msg, send, done) {
    const client = await createConnection(); // New connection every message!
    await client.send(msg.payload);
    await client.close();
    done();
});

// GOOD: Use pooling or persistent connection
node.on('input', async function(msg, send, done) {
    const client = await pool.acquire();
    try {
        await client.send(msg.payload);
        done();
    } finally {
        pool.release(client);
    }
});
```

### Don't: Cache without bounds

```javascript
// BAD: Unbounded cache grows forever
const cache = {};
function getCached(key) {
    if (!cache[key]) {
        cache[key] = fetchExpensiveData(key);
    }
    return cache[key];
}

// GOOD: Use TTL and size limits
const cache = new LRUCache(1000);
cache.set(key, value, { ttl: 60000 });
```

### Don't: Ignore close handler

```javascript
// BAD: Resource leak
function MyNode(config) {
    const connection = createConnection();
    // No close handler - connection never closed!
}

// GOOD: Always handle close
function MyNode(config) {
    const connection = createConnection();

    node.on('close', function(done) {
        connection.close().then(done).catch(done);
    });
}
```

### Don't: Mix sync and async incorrectly

```javascript
// BAD: Async operation in sync constructor
function MyNode(config) {
    this.client = await createConnection(); // Syntax error!
}

// GOOD: Start async, handle completion
function MyNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    node.client = null;

    createConnection()
        .then(client => { node.client = client; })
        .catch(err => { node.error(err); });
}
```

## Pattern Selection Checklist

Before implementing a pattern, verify:

- [ ] **Necessity**: Is the pattern actually needed, or is simpler code sufficient?
- [ ] **Complexity**: Does the benefit outweigh the added complexity?
- [ ] **Maintenance**: Can the team understand and maintain this pattern?
- [ ] **Testing**: Can the pattern be effectively tested?
- [ ] **Performance**: Has the performance impact been measured?

### When NOT to use patterns

- **Factory**: Single implementation, type known at compile time
- **Cache**: Data always needs to be fresh, storage cost exceeds computation cost
- **Pool**: Connections are cheap, low concurrency
- **Batching**: Latency is critical, items are independent
- **State Machine**: Simple linear state progression

## Measuring Pattern Effectiveness

### Cache Effectiveness

```javascript
const stats = cache.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
// Target: >80% hit rate for effective caching
```

### Pool Utilization

```javascript
const utilization = pool.inUse.size / pool.maxSize;
console.log(`Pool utilization: ${(utilization * 100).toFixed(1)}%`);
// Target: 50-80% average utilization
```

### Batch Efficiency

```javascript
const avgBatchSize = totalItems / totalBatches;
console.log(`Average batch size: ${avgBatchSize}`);
// Target: Close to maxBatchSize
```
