const should = require("should");
const sinon = require("sinon");
const {
    CircuitState,
    OpaClient,
    DEFAULT_OPA_CONFIG,
    validateOpaConfig
} = require("../../lib/opa-client");

describe("CircuitState", function() {
    it("should have correct state values", function() {
        CircuitState.CLOSED.should.equal("closed");
        CircuitState.OPEN.should.equal("open");
        CircuitState.HALF_OPEN.should.equal("half_open");
    });
});

describe("DEFAULT_OPA_CONFIG", function() {
    it("should have expected default values", function() {
        DEFAULT_OPA_CONFIG.should.have.property("opaUrl", "http://localhost:8181");
        DEFAULT_OPA_CONFIG.should.have.property("policyPath", "v1/data/api/gateway/allow");
        DEFAULT_OPA_CONFIG.should.have.property("timeout", 5000);
        DEFAULT_OPA_CONFIG.should.have.property("retryAttempts", 3);
        DEFAULT_OPA_CONFIG.should.have.property("initialBackoff", 1000);
        DEFAULT_OPA_CONFIG.should.have.property("maxBackoff", 10000);
        DEFAULT_OPA_CONFIG.should.have.property("cacheEnabled", true);
        DEFAULT_OPA_CONFIG.should.have.property("cacheTtl", 60000);
        DEFAULT_OPA_CONFIG.should.have.property("cacheMaxSize", 1000);
        DEFAULT_OPA_CONFIG.should.have.property("circuitBreakerEnabled", true);
        DEFAULT_OPA_CONFIG.should.have.property("circuitBreakerThreshold", 5);
        DEFAULT_OPA_CONFIG.should.have.property("circuitBreakerTimeout", 60000);
    });
});

describe("validateOpaConfig", function() {
    it("should validate correct config", function() {
        const result = validateOpaConfig({
            opaUrl: "http://localhost:8181",
            timeout: 5000,
            retryAttempts: 3
        });
        result.valid.should.be.true();
        result.errors.should.be.empty();
    });

    it("should reject invalid opaUrl", function() {
        const result = validateOpaConfig({ opaUrl: 123 });
        result.valid.should.be.false();
        result.errors.should.containEql("OPA URL must be a string");
    });

    it("should reject invalid timeout", function() {
        const result = validateOpaConfig({ timeout: -1 });
        result.valid.should.be.false();
        result.errors.should.containEql("Timeout must be a non-negative integer");
    });

    it("should reject invalid retryAttempts", function() {
        const result = validateOpaConfig({ retryAttempts: -5 });
        result.valid.should.be.false();
        result.errors.should.containEql("Retry attempts must be a non-negative integer");
    });

    it("should reject invalid cacheTtl", function() {
        const result = validateOpaConfig({ cacheTtl: "invalid" });
        result.valid.should.be.false();
        result.errors.should.containEql("Cache TTL must be a non-negative integer");
    });

    it("should reject invalid cacheMaxSize", function() {
        const result = validateOpaConfig({ cacheMaxSize: 0 });
        result.valid.should.be.false();
        result.errors.should.containEql("Cache max size must be a positive integer");
    });

    it("should reject invalid circuitBreakerThreshold", function() {
        const result = validateOpaConfig({ circuitBreakerThreshold: 0 });
        result.valid.should.be.false();
        result.errors.should.containEql("Circuit breaker threshold must be a positive integer");
    });
});

describe("OpaClient", function() {
    let client;
    let mockFetch;
    let clock;

    beforeEach(function() {
        mockFetch = sinon.stub();
        client = new OpaClient({
            opaUrl: "http://localhost:8181",
            policyPath: "v1/data/authz/allow",
            fetchFn: mockFetch,
            retryAttempts: 2,
            initialBackoff: 100,
            maxBackoff: 1000,
            cacheTtl: 60000,
            circuitBreakerThreshold: 3
        });
    });

    afterEach(function() {
        if (client) {
            client.shutdown();
        }
        if (clock) {
            clock.restore();
            clock = null;
        }
    });

    describe("initialization", function() {
        it("should use default config when no options provided", function() {
            const defaultClient = new OpaClient({ fetchFn: mockFetch });
            defaultClient.config.should.have.property("opaUrl", DEFAULT_OPA_CONFIG.opaUrl);
            defaultClient.config.should.have.property("timeout", DEFAULT_OPA_CONFIG.timeout);
            defaultClient.shutdown();
        });

        it("should allow custom config options", function() {
            client.config.should.have.property("opaUrl", "http://localhost:8181");
            client.config.should.have.property("policyPath", "v1/data/authz/allow");
            client.config.should.have.property("retryAttempts", 2);
        });

        it("should start with circuit breaker closed", function() {
            client.circuitState.should.equal(CircuitState.CLOSED);
            client.isCircuitOpen.should.be.false();
        });
    });

    describe("evaluate", function() {
        it("should evaluate policy and return result", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            const input = { user: "alice", action: "read" };
            const { result, allowed, cached } = await client.evaluate(input);

            result.should.equal(true);
            allowed.should.be.true();
            cached.should.be.false();
            mockFetch.calledOnce.should.be.true();
        });

        it("should send correct request format", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await client.evaluate({ user: "alice" });

            const call = mockFetch.firstCall;
            call.args[0].should.equal("http://localhost:8181/v1/data/authz/allow");
            call.args[1].method.should.equal("POST");
            call.args[1].headers["Content-Type"].should.equal("application/json");

            const body = JSON.parse(call.args[1].body);
            body.should.have.property("input");
            body.input.should.have.property("user", "alice");
        });

        it("should handle OPA result with allow property", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: { allow: true, reasons: ["admin"] } })
            });

            const { allowed, result } = await client.evaluate({ user: "admin" });

            allowed.should.be.true();
            result.should.have.property("allow", true);
            result.should.have.property("reasons");
        });

        it("should handle OPA result with allowed property", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: { allowed: false } })
            });

            const { allowed } = await client.evaluate({ user: "guest" });

            allowed.should.be.false();
        });

        it("should handle non-boolean OPA result", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: { permissions: ["read"] } })
            });

            const { allowed } = await client.evaluate({ user: "user" });

            // Should default to false when no clear allowed/allow property
            allowed.should.be.false();
        });

        it("should throw on HTTP error", async function() {
            mockFetch.resolves({
                ok: false,
                status: 500
            });

            try {
                await client.evaluate({ user: "alice" });
                should.fail("Expected error");
            } catch (err) {
                err.message.should.containEql("500");
            }
        });

        it("should throw on network error", async function() {
            mockFetch.rejects(new Error("Connection refused"));

            try {
                await client.evaluate({ user: "alice" });
                should.fail("Expected error");
            } catch (err) {
                err.message.should.equal("Connection refused");
            }
        });
    });

    describe("caching", function() {
        it("should cache successful results", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            const input = { user: "alice", action: "read" };

            // First call - not cached
            const first = await client.evaluate(input);
            first.cached.should.be.false();

            // Second call - should be cached
            const second = await client.evaluate(input);
            second.cached.should.be.true();
            second.result.should.equal(true);

            // Fetch should only be called once
            mockFetch.calledOnce.should.be.true();
        });

        it("should use different cache keys for different inputs", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await client.evaluate({ user: "alice" });
            await client.evaluate({ user: "bob" });

            mockFetch.calledTwice.should.be.true();
        });

        it("should expire cached entries", async function() {
            clock = sinon.useFakeTimers();

            const shortCacheClient = new OpaClient({
                fetchFn: mockFetch,
                cacheTtl: 1000
            });

            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await shortCacheClient.evaluate({ user: "alice" });
            mockFetch.calledOnce.should.be.true();

            // Advance time past TTL
            clock.tick(1001);

            await shortCacheClient.evaluate({ user: "alice" });
            mockFetch.calledTwice.should.be.true();

            shortCacheClient.shutdown();
        });

        it("should evict oldest entries when cache is full", async function() {
            const smallCacheClient = new OpaClient({
                fetchFn: mockFetch,
                cacheMaxSize: 2
            });

            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await smallCacheClient.evaluate({ user: "alice" });
            await smallCacheClient.evaluate({ user: "bob" });
            await smallCacheClient.evaluate({ user: "charlie" });

            // Alice should be evicted
            const stats = smallCacheClient.getStatistics();
            stats.current.cacheSize.should.equal(2);

            smallCacheClient.shutdown();
        });

        it("should allow clearing cache", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await client.evaluate({ user: "alice" });
            client._cache.size.should.be.greaterThan(0);

            client.clearCache();
            client._cache.size.should.equal(0);
        });

        it("should not cache when caching is disabled", async function() {
            const noCacheClient = new OpaClient({
                fetchFn: mockFetch,
                cacheEnabled: false
            });

            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await noCacheClient.evaluate({ user: "alice" });
            await noCacheClient.evaluate({ user: "alice" });

            mockFetch.calledTwice.should.be.true();
            noCacheClient.shutdown();
        });
    });

    describe("retry logic", function() {
        it("should retry on failure", async function() {
            mockFetch
                .onFirstCall().rejects(new Error("Temporary failure"))
                .onSecondCall().resolves({
                    ok: true,
                    json: async () => ({ result: true })
                });

            const { result } = await client.evaluate({ user: "alice" });

            result.should.equal(true);
            mockFetch.calledTwice.should.be.true();
        });

        it("should emit retry events", async function() {
            mockFetch
                .onFirstCall().rejects(new Error("Temporary failure"))
                .onSecondCall().resolves({
                    ok: true,
                    json: async () => ({ result: true })
                });

            let retryEvent = null;
            client.on("retry", event => { retryEvent = event; });

            await client.evaluate({ user: "alice" });

            retryEvent.should.not.be.null();
            retryEvent.should.have.property("attempt", 1);
            retryEvent.should.have.property("maxAttempts", 2);
            retryEvent.should.have.property("delay");
            retryEvent.should.have.property("error", "Temporary failure");
        });

        it("should fail after max retries", async function() {
            mockFetch.rejects(new Error("Persistent failure"));

            try {
                await client.evaluate({ user: "alice" });
                should.fail("Expected error");
            } catch (err) {
                err.message.should.equal("Persistent failure");
            }

            // Initial + 2 retries = 3 calls
            mockFetch.callCount.should.equal(3);
        });

        it("should use exponential backoff", async function() {
            const backoffs = [];
            const originalCalculate = client._calculateBackoff.bind(client);

            client._calculateBackoff = function(attempt) {
                const delay = originalCalculate(attempt);
                backoffs.push(delay);
                return delay;
            };

            mockFetch.rejects(new Error("Failure"));

            try {
                await client.evaluate({ user: "alice" });
            } catch (err) {
                // Expected
            }

            // First backoff should be around initialBackoff (100ms)
            backoffs[0].should.be.approximately(100, 20);
            // Second backoff should be around 2x (200ms)
            backoffs[1].should.be.approximately(200, 40);
        });

        it("should not retry when retryAttempts is 0", async function() {
            const noRetryClient = new OpaClient({
                fetchFn: mockFetch,
                retryAttempts: 0,
                circuitBreakerEnabled: false
            });

            mockFetch.rejects(new Error("Failure"));

            try {
                await noRetryClient.evaluate({ user: "alice" });
            } catch (err) {
                // Expected
            }

            mockFetch.calledOnce.should.be.true();
            noRetryClient.shutdown();
        });
    });

    describe("circuit breaker", function() {
        it("should open after threshold failures", async function() {
            mockFetch.rejects(new Error("Service down"));

            // Make requests until circuit opens
            for (let i = 0; i < 3; i++) {
                try {
                    await client.evaluate({ user: "alice", attempt: i });
                } catch (err) {
                    // Expected
                }
            }

            client.circuitState.should.equal(CircuitState.OPEN);
            client.isCircuitOpen.should.be.true();
        });

        it("should emit circuitOpen event", async function() {
            mockFetch.rejects(new Error("Service down"));

            let openEvent = null;
            client.on("circuitOpen", event => { openEvent = event; });

            for (let i = 0; i < 3; i++) {
                try {
                    await client.evaluate({ user: "alice", attempt: i });
                } catch (err) {
                    // Expected
                }
            }

            openEvent.should.not.be.null();
            openEvent.should.have.property("previousState", CircuitState.CLOSED);
            openEvent.should.have.property("currentState", CircuitState.OPEN);
        });

        it("should fail fast when circuit is open", async function() {
            // Force circuit open
            client._circuitState = CircuitState.OPEN;
            client._circuitOpenTime = Date.now();

            try {
                await client.evaluate({ user: "alice" });
                should.fail("Expected error");
            } catch (err) {
                err.code.should.equal("CIRCUIT_OPEN");
                err.message.should.equal("Circuit breaker is open");
            }

            // Should not call fetch
            mockFetch.called.should.be.false();
        });

        it("should transition to half-open after timeout", async function() {
            // Manually set up the circuit breaker state without using the client's internal timers
            // The circuit breaker timeout for this client is 60000ms (default)
            client._circuitState = CircuitState.OPEN;
            // Set open time to 61 seconds in the past (past the timeout)
            client._circuitOpenTime = Date.now() - 61000;

            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            let halfOpenEvent = null;
            client.on("circuitHalfOpen", event => { halfOpenEvent = event; });

            await client.evaluate({ user: "alice" });

            halfOpenEvent.should.not.be.null();
            halfOpenEvent.should.have.property("previousState", CircuitState.OPEN);
            halfOpenEvent.should.have.property("currentState", CircuitState.HALF_OPEN);
        });

        it("should close after successful requests in half-open", async function() {
            // Manually set up the circuit breaker state
            client._circuitState = CircuitState.OPEN;
            // Set open time to 61 seconds in the past (past the timeout)
            client._circuitOpenTime = Date.now() - 61000;

            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            let closeEvent = null;
            client.on("circuitClosed", event => { closeEvent = event; });

            // Need 2 successes (default successThreshold)
            await client.evaluate({ user: "alice" });
            await client.evaluate({ user: "bob" });

            closeEvent.should.not.be.null();
            client.circuitState.should.equal(CircuitState.CLOSED);
        });

        it("should re-open on failure in half-open", async function() {
            client._circuitState = CircuitState.HALF_OPEN;
            client._successCount = 0;

            mockFetch.rejects(new Error("Still failing"));

            try {
                await client.evaluate({ user: "alice" });
            } catch (err) {
                // Expected
            }

            client.circuitState.should.equal(CircuitState.OPEN);
        });

        it("should allow manual reset", function() {
            client._circuitState = CircuitState.OPEN;
            client._failureCount = 10;

            let resetEvent = null;
            client.on("circuitReset", event => { resetEvent = event; });

            client.resetCircuitBreaker();

            client.circuitState.should.equal(CircuitState.CLOSED);
            client._failureCount.should.equal(0);
            resetEvent.should.not.be.null();
        });

        it("should not use circuit breaker when disabled", async function() {
            const noCircuitClient = new OpaClient({
                fetchFn: mockFetch,
                circuitBreakerEnabled: false,
                retryAttempts: 0
            });

            mockFetch.rejects(new Error("Failure"));

            // Make many failures
            for (let i = 0; i < 10; i++) {
                try {
                    await noCircuitClient.evaluate({ user: "alice", attempt: i });
                } catch (err) {
                    // Expected
                }
            }

            // All calls should go through
            mockFetch.callCount.should.equal(10);
            noCircuitClient.shutdown();
        });
    });

    describe("isAllowed", function() {
        it("should return true when policy allows", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: { allow: true } })
            });

            const allowed = await client.isAllowed(
                { id: "user1", roles: ["admin"] },
                "GET",
                "/api/users"
            );

            allowed.should.be.true();
        });

        it("should return false when policy denies", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: { allow: false } })
            });

            const allowed = await client.isAllowed(
                { id: "user1", roles: ["guest"] },
                "DELETE",
                "/api/users/123"
            );

            allowed.should.be.false();
        });

        it("should include body in request when provided", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await client.isAllowed(
                { id: "user1" },
                "POST",
                "/api/users",
                { name: "New User" }
            );

            const body = JSON.parse(mockFetch.firstCall.args[1].body);
            body.input.request.should.have.property("body");
            body.input.request.body.should.have.property("name", "New User");
        });

        it("should normalize method to uppercase", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await client.isAllowed({ id: "user1" }, "get", "/api/users");

            const body = JSON.parse(mockFetch.firstCall.args[1].body);
            body.input.request.method.should.equal("GET");
        });

        it("should return false and emit error on failure", async function() {
            mockFetch.rejects(new Error("Network error"));

            let errorEvent = null;
            client.on("error", err => { errorEvent = err; });

            const allowed = await client.isAllowed({ id: "user1" }, "GET", "/api");

            allowed.should.be.false();
            errorEvent.should.not.be.null();
        });
    });

    describe("getHealthStatus", function() {
        it("should return healthy when OPA responds", async function() {
            mockFetch.resolves({
                ok: true,
                status: 200
            });

            const health = await client.getHealthStatus();

            health.healthy.should.be.true();
            health.message.should.equal("OPA server is healthy");
            health.details.should.have.property("url", "http://localhost:8181");
            health.details.should.have.property("policyPath", "v1/data/authz/allow");
        });

        it("should return unhealthy on error response", async function() {
            mockFetch.resolves({
                ok: false,
                status: 503
            });

            const health = await client.getHealthStatus();

            health.healthy.should.be.false();
            health.message.should.containEql("503");
        });

        it("should return unhealthy on network error", async function() {
            mockFetch.rejects(new Error("Connection refused"));

            const health = await client.getHealthStatus();

            health.healthy.should.be.false();
            health.message.should.equal("Connection refused");
        });

        it("should return unhealthy on timeout", async function() {
            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            mockFetch.rejects(abortError);

            const health = await client.getHealthStatus();

            health.healthy.should.be.false();
            health.message.should.equal("OPA health check timeout");
        });

        it("should include circuit state in details", async function() {
            client._circuitState = CircuitState.OPEN;

            mockFetch.resolves({
                ok: true,
                status: 200
            });

            const health = await client.getHealthStatus();
            health.details.should.have.property("circuitState", CircuitState.OPEN);
        });
    });

    describe("getStatistics", function() {
        it("should return comprehensive statistics", async function() {
            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await client.evaluate({ user: "alice" });
            await client.evaluate({ user: "alice" }); // Cache hit

            const stats = client.getStatistics();

            stats.should.have.property("config");
            stats.config.should.have.property("opaUrl");
            stats.config.should.have.property("policyPath");

            stats.should.have.property("current");
            stats.current.should.have.property("cacheSize");
            stats.current.should.have.property("circuitState");

            stats.should.have.property("cumulative");
            stats.cumulative.should.have.property("totalRequests", 2);
            stats.cumulative.should.have.property("cacheHits", 1);
            stats.cumulative.should.have.property("cacheMisses", 1);
            stats.cumulative.should.have.property("cacheHitRate", "50.00%");
        });

        it("should track retry count", async function() {
            mockFetch
                .onFirstCall().rejects(new Error("Retry 1"))
                .onSecondCall().resolves({
                    ok: true,
                    json: async () => ({ result: true })
                });

            await client.evaluate({ user: "alice" });

            const stats = client.getStatistics();
            stats.cumulative.retries.should.be.greaterThan(0);
        });

        it("should track circuit breaker trips", async function() {
            mockFetch.rejects(new Error("Failure"));

            // Trip circuit breaker
            for (let i = 0; i < 3; i++) {
                try {
                    await client.evaluate({ user: "alice", attempt: i });
                } catch (err) {
                    // Expected
                }
            }

            const stats = client.getStatistics();
            stats.cumulative.circuitBreakerTrips.should.be.greaterThan(0);
        });
    });

    describe("shutdown", function() {
        it("should clear all state on shutdown", function() {
            client._cache.set("test", { result: true, timestamp: Date.now(), expires: 0 });
            client._circuitState = CircuitState.OPEN;

            client.shutdown();

            client._cache.size.should.equal(0);
            client._circuitState.should.equal(CircuitState.CLOSED);
        });

        it("should emit shutdown event", function(done) {
            client.on("shutdown", () => done());
            client.shutdown();
        });

        it("should clear cleanup timer", function() {
            client._cleanupTimer.should.not.be.null();
            client.shutdown();
            should(client._cleanupTimer).be.null();
        });
    });

    describe("timeout handling", function() {
        it("should handle request timeout", async function() {
            const timeoutClient = new OpaClient({
                fetchFn: mockFetch,
                timeout: 100,
                retryAttempts: 0,
                circuitBreakerEnabled: false
            });

            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            mockFetch.rejects(abortError);

            try {
                await timeoutClient.evaluate({ user: "alice" });
                should.fail("Expected error");
            } catch (err) {
                err.code.should.equal("TIMEOUT");
                err.message.should.equal("OPA request timeout");
            }

            timeoutClient.shutdown();
        });
    });

    describe("URL handling", function() {
        it("should handle trailing slash in opaUrl", async function() {
            const trailingSlashClient = new OpaClient({
                fetchFn: mockFetch,
                opaUrl: "http://localhost:8181/",
                policyPath: "v1/data/authz"
            });

            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await trailingSlashClient.evaluate({ user: "alice" });

            const url = mockFetch.firstCall.args[0];
            url.should.equal("http://localhost:8181/v1/data/authz");

            trailingSlashClient.shutdown();
        });

        it("should handle leading slash in policyPath", async function() {
            const leadingSlashClient = new OpaClient({
                fetchFn: mockFetch,
                opaUrl: "http://localhost:8181",
                policyPath: "/v1/data/authz"
            });

            mockFetch.resolves({
                ok: true,
                json: async () => ({ result: true })
            });

            await leadingSlashClient.evaluate({ user: "alice" });

            const url = mockFetch.firstCall.args[0];
            url.should.equal("http://localhost:8181/v1/data/authz");

            leadingSlashClient.shutdown();
        });
    });
});
