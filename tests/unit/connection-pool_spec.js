const should = require("should");
const sinon = require("sinon");
const { PoolState, ConnectionPoolManager, DEFAULT_POOL_CONFIG } = require("../../lib/connection-pool");

describe("ConnectionPool", function() {
    describe("PoolState enum", function() {
        it("should have correct state values", function() {
            PoolState.INITIALIZING.should.equal("initializing");
            PoolState.RUNNING.should.equal("running");
            PoolState.DRAINING.should.equal("draining");
            PoolState.CLOSED.should.equal("closed");
        });
    });

    describe("DEFAULT_POOL_CONFIG", function() {
        it("should have expected default values", function() {
            DEFAULT_POOL_CONFIG.should.have.property("minConnections", 0);
            DEFAULT_POOL_CONFIG.should.have.property("maxConnections", 10);
            DEFAULT_POOL_CONFIG.should.have.property("idleTimeout", 30000);
            DEFAULT_POOL_CONFIG.should.have.property("acquireTimeout", 15000);
            DEFAULT_POOL_CONFIG.should.have.property("createRetryInterval", 1000);
            DEFAULT_POOL_CONFIG.should.have.property("validateOnBorrow", true);
            DEFAULT_POOL_CONFIG.should.have.property("evictionInterval", 60000);
        });
    });
});

describe("ConnectionPoolManager", function() {
    let pool;
    let clock;
    let connectionId;

    function createMockFactory() {
        connectionId = 0;
        return {
            create: sinon.stub().callsFake(async () => {
                return { id: ++connectionId, connected: true };
            }),
            destroy: sinon.stub().resolves(),
            validate: sinon.stub().resolves(true)
        };
    }

    beforeEach(function() {
        pool = new ConnectionPoolManager("test-pool");
    });

    afterEach(async function() {
        this.timeout(5000);
        if (clock) {
            clock.restore();
            clock = null;
        }
        if (pool && pool.state !== PoolState.CLOSED) {
            await pool.shutdown(1000);
        }
    });

    describe("initialization", function() {
        it("should initialize with INITIALIZING state", function() {
            pool.state.should.equal(PoolState.INITIALIZING);
        });

        it("should store pool name", function() {
            pool.poolName.should.equal("test-pool");
        });

        it("should use default config when no options provided", function() {
            pool.config.should.have.property("minConnections", DEFAULT_POOL_CONFIG.minConnections);
            pool.config.should.have.property("maxConnections", DEFAULT_POOL_CONFIG.maxConnections);
            pool.config.should.have.property("idleTimeout", DEFAULT_POOL_CONFIG.idleTimeout);
            pool.config.should.have.property("acquireTimeout", DEFAULT_POOL_CONFIG.acquireTimeout);
        });

        it("should allow custom config options", function() {
            const customPool = new ConnectionPoolManager("custom", {
                minConnections: 2,
                maxConnections: 20,
                idleTimeout: 60000,
                acquireTimeout: 30000
            });
            customPool.config.should.have.property("minConnections", 2);
            customPool.config.should.have.property("maxConnections", 20);
            customPool.config.should.have.property("idleTimeout", 60000);
            customPool.config.should.have.property("acquireTimeout", 30000);
        });

        it("should throw error if factory not set before initialize", async function() {
            try {
                await pool.initialize();
                should.fail("Expected error");
            } catch (err) {
                err.message.should.containEql("Connection factory not set");
            }
        });
    });

    describe("setFactory", function() {
        it("should accept factory with create and destroy functions", function() {
            const factory = createMockFactory();
            (function() {
                pool.setFactory(factory);
            }).should.not.throw();
        });

        it("should throw error if create function missing", function() {
            (function() {
                pool.setFactory({ destroy: sinon.stub() });
            }).should.throw(/create function/);
        });

        it("should throw error if destroy function missing", function() {
            (function() {
                pool.setFactory({ create: sinon.stub() });
            }).should.throw(/destroy function/);
        });
    });

    describe("pool initialization", function() {
        it("should create minimum connections on initialize", async function() {
            const customPool = new ConnectionPoolManager("min-pool", {
                minConnections: 3,
                maxConnections: 10
            });
            const factory = createMockFactory();
            customPool.setFactory(factory);

            await customPool.initialize();

            customPool.state.should.equal(PoolState.RUNNING);
            customPool.availableCount.should.equal(3);
            factory.create.callCount.should.equal(3);

            await customPool.shutdown();
        });

        it("should emit initialized event", async function() {
            pool.setFactory(createMockFactory());

            let eventData = null;
            pool.on("initialized", function(data) {
                eventData = data;
            });

            await pool.initialize();

            should.exist(eventData);
            eventData.should.have.property("pool", "test-pool");
            eventData.should.have.property("size", 0);
        });

        it("should transition to RUNNING state", async function() {
            pool.setFactory(createMockFactory());
            await pool.initialize();

            pool.state.should.equal(PoolState.RUNNING);
            pool.isRunning.should.be.true();
        });
    });

    describe("acquire and release", function() {
        beforeEach(async function() {
            pool.setFactory(createMockFactory());
            await pool.initialize();
        });

        it("should create connection when pool is empty", async function() {
            const conn = await pool.acquire();

            should.exist(conn);
            conn.should.have.property("id");
            conn.should.have.property("connected", true);
            pool.borrowedCount.should.equal(1);
        });

        it("should return connection from pool when available", async function() {
            const conn1 = await pool.acquire();
            await pool.release(conn1);

            pool.availableCount.should.equal(1);

            const conn2 = await pool.acquire();
            conn2.id.should.equal(conn1.id); // Same connection
        });

        it("should release connection back to pool", async function() {
            const conn = await pool.acquire();
            pool.borrowedCount.should.equal(1);
            pool.availableCount.should.equal(0);

            await pool.release(conn);

            pool.borrowedCount.should.equal(0);
            pool.availableCount.should.equal(1);
        });

        it("should emit connectionAcquired event", async function() {
            let eventData = null;
            pool.on("connectionAcquired", function(data) {
                eventData = data;
            });

            await pool.acquire();

            should.exist(eventData);
            eventData.should.have.property("pool", "test-pool");
            eventData.should.have.property("available");
            eventData.should.have.property("borrowed");
        });

        it("should emit connectionReleased event", async function() {
            const conn = await pool.acquire();

            let eventData = null;
            pool.on("connectionReleased", function(data) {
                eventData = data;
            });

            await pool.release(conn);

            should.exist(eventData);
            eventData.should.have.property("pool", "test-pool");
        });

        it("should not exceed maxConnections", async function() {
            this.timeout(5000);
            const smallPool = new ConnectionPoolManager("small", {
                minConnections: 0,
                maxConnections: 2,
                acquireTimeout: 100
            });
            smallPool.setFactory(createMockFactory());
            await smallPool.initialize();

            const conn1 = await smallPool.acquire();
            const conn2 = await smallPool.acquire();

            smallPool.totalCount.should.equal(2);

            // Third acquire should timeout
            try {
                await smallPool.acquire(100);
                should.fail("Expected timeout");
            } catch (err) {
                err.message.should.containEql("timeout");
            }

            await smallPool.release(conn1);
            await smallPool.release(conn2);
            await smallPool.shutdown(1000);
        });
    });

    describe("acquire timeout", function() {
        beforeEach(async function() {
            pool = new ConnectionPoolManager("timeout-pool", {
                maxConnections: 1,
                acquireTimeout: 100
            });
            pool.setFactory(createMockFactory());
            await pool.initialize();
        });

        it("should timeout if no connection available", async function() {
            // Borrow the only connection
            await pool.acquire();

            try {
                await pool.acquire(50);
                should.fail("Expected timeout");
            } catch (err) {
                err.message.should.containEql("timeout");
            }
        });

        it("should emit acquireTimeout event", async function() {
            await pool.acquire();

            let eventData = null;
            pool.on("acquireTimeout", function(data) {
                eventData = data;
            });

            try {
                await pool.acquire(50);
            } catch (err) {
                // Expected
            }

            should.exist(eventData);
            eventData.should.have.property("pool", "timeout-pool");
            eventData.should.have.property("timeout", 50);
        });

        it("should update totalTimeouts stat", async function() {
            await pool.acquire();

            try {
                await pool.acquire(50);
            } catch (err) {
                // Expected
            }

            const stats = pool.getStatistics();
            stats.cumulative.totalTimeouts.should.equal(1);
        });
    });

    describe("connection validation", function() {
        it("should validate connection before returning", async function() {
            const factory = createMockFactory();
            pool.setFactory(factory);
            await pool.initialize();

            const conn = await pool.acquire();
            await pool.release(conn);

            factory.validate.resetHistory();

            await pool.acquire();

            factory.validate.calledOnce.should.be.true();
        });

        it("should destroy invalid connections", async function() {
            const factory = createMockFactory();
            factory.validate.onCall(0).resolves(false); // First validation fails
            factory.validate.onCall(1).resolves(true);  // Second succeeds

            pool.setFactory(factory);
            await pool.initialize();

            // Pre-create a connection
            const conn1 = await pool.acquire();
            await pool.release(conn1);

            factory.validate.resetHistory();
            factory.destroy.resetHistory();

            // Acquire should validate, fail, destroy, create new
            const conn2 = await pool.acquire();

            factory.destroy.calledOnce.should.be.true();
            conn2.id.should.not.equal(conn1.id); // Different connection
        });
    });

    describe("statistics", function() {
        beforeEach(async function() {
            pool.setFactory(createMockFactory());
            await pool.initialize();
        });

        it("should return complete statistics", function() {
            const stats = pool.getStatistics();

            stats.should.have.property("pool", "test-pool");
            stats.should.have.property("state", PoolState.RUNNING);
            stats.should.have.property("config");
            stats.should.have.property("current");
            stats.should.have.property("cumulative");
            stats.should.have.property("peaks");

            stats.config.should.have.property("minConnections");
            stats.config.should.have.property("maxConnections");

            stats.current.should.have.property("total");
            stats.current.should.have.property("available");
            stats.current.should.have.property("borrowed");
            stats.current.should.have.property("pending");

            stats.cumulative.should.have.property("totalCreated");
            stats.cumulative.should.have.property("totalDestroyed");
            stats.cumulative.should.have.property("totalAcquired");
            stats.cumulative.should.have.property("totalReleased");
        });

        it("should track cumulative stats", async function() {
            const conn1 = await pool.acquire();
            const conn2 = await pool.acquire();
            await pool.release(conn1);
            await pool.release(conn2);

            const stats = pool.getStatistics();
            stats.cumulative.totalCreated.should.equal(2);
            stats.cumulative.totalAcquired.should.equal(2);
            stats.cumulative.totalReleased.should.equal(2);
        });

        it("should track peak stats", async function() {
            const conn1 = await pool.acquire();
            const conn2 = await pool.acquire();
            const conn3 = await pool.acquire();

            const stats = pool.getStatistics();
            stats.peaks.peakSize.should.equal(3);
            stats.peaks.peakBorrowed.should.equal(3);

            await pool.release(conn1);
            await pool.release(conn2);
            await pool.release(conn3);
        });

        it("should return simplified status", function() {
            const status = pool.getStatus();

            status.should.have.property("state", PoolState.RUNNING);
            status.should.have.property("available");
            status.should.have.property("borrowed");
            status.should.have.property("pending");
            status.should.have.property("total");
        });
    });

    describe("idle eviction", function() {
        beforeEach(function() {
            clock = sinon.useFakeTimers();
        });

        it("should evict idle connections", async function() {
            const customPool = new ConnectionPoolManager("evict-pool", {
                minConnections: 0,
                maxConnections: 5,
                idleTimeout: 1000,
                evictionInterval: 500
            });
            const factory = createMockFactory();
            customPool.setFactory(factory);
            await customPool.initialize();

            // Create connections
            const conn1 = await customPool.acquire();
            const conn2 = await customPool.acquire();
            await customPool.release(conn1);
            await customPool.release(conn2);

            customPool.availableCount.should.equal(2);

            // Advance time past idle timeout
            clock.tick(1500);

            // Wait for eviction
            await Promise.resolve();

            customPool.availableCount.should.equal(0);

            await customPool.shutdown();
        });

        it("should keep minConnections even if idle", async function() {
            const customPool = new ConnectionPoolManager("min-evict-pool", {
                minConnections: 2,
                maxConnections: 5,
                idleTimeout: 1000,
                evictionInterval: 500
            });
            const factory = createMockFactory();
            customPool.setFactory(factory);
            await customPool.initialize();

            // Create extra connections
            const conn1 = await customPool.acquire();
            const conn2 = await customPool.acquire();
            const conn3 = await customPool.acquire();
            await customPool.release(conn1);
            await customPool.release(conn2);
            await customPool.release(conn3);

            customPool.totalCount.should.equal(3);

            // Advance time past idle timeout
            clock.tick(1500);
            await Promise.resolve();

            // Should keep minConnections
            customPool.totalCount.should.be.aboveOrEqual(2);

            await customPool.shutdown();
        });

        it("should emit idleEviction event", async function() {
            const customPool = new ConnectionPoolManager("evict-event-pool", {
                minConnections: 0,
                maxConnections: 5,
                idleTimeout: 500,
                evictionInterval: 300
            });
            customPool.setFactory(createMockFactory());
            await customPool.initialize();

            const conn = await customPool.acquire();
            await customPool.release(conn);

            let eventData = null;
            customPool.on("idleEviction", function(data) {
                eventData = data;
            });

            // Manually trigger eviction with fake time
            customPool._pool[0].lastUsedAt = Date.now() - 1000; // Make it old
            await customPool._evictIdleConnections();

            should.exist(eventData);
            eventData.should.have.property("pool", "evict-event-pool");
            eventData.should.have.property("evicted", 1);

            await customPool.shutdown();
        });
    });

    describe("drain", function() {
        beforeEach(async function() {
            pool.setFactory(createMockFactory());
            await pool.initialize();
        });

        it("should transition to DRAINING state", async function() {
            await pool.drain(100);
            pool.state.should.equal(PoolState.DRAINING);
        });

        it("should reject pending acquire requests", async function() {
            const smallPool = new ConnectionPoolManager("drain-pool", {
                maxConnections: 1,
                acquireTimeout: 5000
            });
            smallPool.setFactory(createMockFactory());
            await smallPool.initialize();

            await smallPool.acquire(); // Take the only connection

            let rejected = false;
            const acquirePromise = smallPool.acquire().catch(() => {
                rejected = true;
            });

            // Drain should reject the pending acquire
            await smallPool.drain(100);

            await acquirePromise;
            rejected.should.be.true();

            await smallPool.shutdown();
        });

        it("should wait for borrowed connections to be released", async function() {
            clock = sinon.useFakeTimers();

            const conn = await pool.acquire();
            pool.borrowedCount.should.equal(1);

            let drained = false;
            const drainPromise = pool.drain(1000).then(() => {
                drained = true;
            });

            clock.tick(100);
            await Promise.resolve();
            drained.should.be.false();

            // Release the connection
            await pool.release(conn);
            clock.tick(100);
            await Promise.resolve();

            await drainPromise;
            drained.should.be.true();
        });
    });

    describe("shutdown", function() {
        beforeEach(async function() {
            pool.setFactory(createMockFactory());
            await pool.initialize();
        });

        it("should transition to CLOSED state", async function() {
            await pool.shutdown();
            pool.state.should.equal(PoolState.CLOSED);
        });

        it("should destroy all connections", async function() {
            const conn1 = await pool.acquire();
            const conn2 = await pool.acquire();
            await pool.release(conn1);
            await pool.release(conn2);

            const factory = pool._destroyFn;

            await pool.shutdown();

            factory.callCount.should.equal(2);
        });

        it("should emit shutdown event", async function() {
            let eventData = null;
            pool.on("shutdown", function(data) {
                eventData = data;
            });

            await pool.shutdown();

            should.exist(eventData);
            eventData.should.have.property("pool", "test-pool");
            eventData.should.have.property("stats");
        });

        it("should be idempotent", async function() {
            await pool.shutdown();
            await pool.shutdown(); // Should not throw
            pool.state.should.equal(PoolState.CLOSED);
        });

        it("should prevent new acquires", async function() {
            await pool.shutdown();

            try {
                await pool.acquire();
                should.fail("Expected error");
            } catch (err) {
                // May say "shutting down" or "CLOSED" depending on timing
                (err.message.includes("shutting down") || err.message.includes("CLOSED")).should.be.true();
            }
        });
    });

    describe("clear", function() {
        beforeEach(async function() {
            pool.setFactory(createMockFactory());
            await pool.initialize();
        });

        it("should destroy all connections and reinitialize", async function() {
            const conn1 = await pool.acquire();
            await pool.acquire();
            await pool.release(conn1);

            pool.totalCount.should.equal(2);

            await pool.clear();

            // Pool should be reinitialized
            pool.state.should.equal(PoolState.RUNNING);
            pool.totalCount.should.equal(0);
        });

        it("should emit cleared event", async function() {
            let eventData = null;
            pool.on("cleared", function(data) {
                eventData = data;
            });

            await pool.clear();

            should.exist(eventData);
            eventData.should.have.property("pool", "test-pool");
        });
    });

    describe("error handling", function() {
        it("should handle create errors", async function() {
            const factory = createMockFactory();
            factory.create.rejects(new Error("Connection refused"));
            pool.setFactory(factory);

            let errorEvent = null;
            pool.on("createError", function(data) {
                errorEvent = data;
            });

            await pool.initialize();

            // Try to acquire - will fail to create
            try {
                await pool.acquire(100);
            } catch (err) {
                // Expected timeout
            }

            should.exist(errorEvent);
            errorEvent.should.have.property("pool", "test-pool");
            errorEvent.error.message.should.equal("Connection refused");
        });

        it("should track error count in stats", async function() {
            const factory = createMockFactory();
            factory.create.rejects(new Error("Failed"));
            pool.setFactory(factory);
            await pool.initialize();

            try {
                await pool.acquire(100);
            } catch (err) {
                // Expected
            }

            const stats = pool.getStatistics();
            stats.cumulative.totalErrors.should.be.above(0);
        });
    });
});
