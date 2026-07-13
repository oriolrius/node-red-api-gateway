const should = require("should");
const sinon = require("sinon");
const {
    RATE_LIMIT_KEY_TYPES,
    RATE_LIMIT_DEFAULTS,
    RateLimiter,
    validateRateLimitConfig,
    extractRateLimitKey,
    generateRateLimitHeaders,
    createRateLimitError
} = require("../../lib/rate-limiter");

describe("Rate Limiter", function() {
    describe("Constants", function() {
        describe("RATE_LIMIT_KEY_TYPES", function() {
            it("should contain expected key types", function() {
                RATE_LIMIT_KEY_TYPES.should.containDeep(["ip", "user", "apiKey", "custom"]);
                RATE_LIMIT_KEY_TYPES.should.have.length(4);
            });
        });

        describe("RATE_LIMIT_DEFAULTS", function() {
            it("should have expected default values", function() {
                RATE_LIMIT_DEFAULTS.should.have.property("requests", 100);
                RATE_LIMIT_DEFAULTS.should.have.property("windowMs", 60000);
                RATE_LIMIT_DEFAULTS.should.have.property("keyType", "ip");
            });
        });
    });

    describe("validateRateLimitConfig", function() {
        it("should return valid for empty config", function() {
            const result = validateRateLimitConfig({});
            result.valid.should.be.true();
            result.errors.should.have.length(0);
        });

        it("should return valid for valid config", function() {
            const result = validateRateLimitConfig({
                requests: 100,
                windowMs: 60000,
                keyType: "ip"
            });
            result.valid.should.be.true();
            result.errors.should.have.length(0);
        });

        it("should reject requests less than 1", function() {
            const result = validateRateLimitConfig({ requests: 0 });
            result.valid.should.be.false();
            result.errors.should.containEql("Rate limit requests must be a positive integer");
        });

        it("should reject negative requests", function() {
            const result = validateRateLimitConfig({ requests: -5 });
            result.valid.should.be.false();
        });

        it("should reject non-numeric requests", function() {
            const result = validateRateLimitConfig({ requests: "abc" });
            result.valid.should.be.false();
        });

        it("should reject windowMs less than 1000", function() {
            const result = validateRateLimitConfig({ windowMs: 500 });
            result.valid.should.be.false();
            result.errors.should.containEql("Rate limit window must be at least 1000ms (1 second)");
        });

        it("should reject invalid keyType", function() {
            const result = validateRateLimitConfig({ keyType: "invalid" });
            result.valid.should.be.false();
            result.errors[0].should.containEql("Invalid rate limit key type");
        });

        it("should accept all valid keyTypes", function() {
            for (const keyType of RATE_LIMIT_KEY_TYPES) {
                const result = validateRateLimitConfig({ keyType });
                result.valid.should.be.true();
            }
        });

        it("should collect multiple errors", function() {
            const result = validateRateLimitConfig({
                requests: -1,
                windowMs: 100,
                keyType: "invalid"
            });
            result.valid.should.be.false();
            result.errors.should.have.length(3);
        });
    });

    describe("extractRateLimitKey", function() {
        it("should return null for null request", function() {
            const key = extractRateLimitKey(null, "ip");
            should(key).be.null();
        });

        describe("ip key type", function() {
            it("should extract from x-forwarded-for only when trustProxy is set", function() {
                const req = {
                    headers: { "x-forwarded-for": "192.168.1.1, 10.0.0.1" }
                };
                const key = extractRateLimitKey(req, "ip", null, { trustProxy: true });
                key.should.equal("192.168.1.1");
            });

            it("should ignore x-forwarded-for by default (anti-spoof) and use req.ip", function() {
                const req = {
                    headers: { "x-forwarded-for": "1.2.3.4" },
                    ip: "192.168.1.9"
                };
                const key = extractRateLimitKey(req, "ip");
                key.should.equal("192.168.1.9");
            });

            it("should extract from req.ip", function() {
                const req = {
                    headers: {},
                    ip: "192.168.1.2"
                };
                const key = extractRateLimitKey(req, "ip");
                key.should.equal("192.168.1.2");
            });

            it("should extract from connection.remoteAddress", function() {
                const req = {
                    headers: {},
                    connection: { remoteAddress: "192.168.1.3" }
                };
                const key = extractRateLimitKey(req, "ip");
                key.should.equal("192.168.1.3");
            });

            it("should extract from socket.remoteAddress", function() {
                const req = {
                    headers: {},
                    socket: { remoteAddress: "192.168.1.4" }
                };
                const key = extractRateLimitKey(req, "ip");
                key.should.equal("192.168.1.4");
            });

            it("should return unknown when no IP found", function() {
                const req = { headers: {} };
                const key = extractRateLimitKey(req, "ip");
                key.should.equal("unknown");
            });
        });

        describe("user key type", function() {
            it("should extract from auth.userId", function() {
                const req = { auth: { userId: "user123" } };
                const key = extractRateLimitKey(req, "user");
                key.should.equal("user123");
            });

            it("should extract from auth.sub", function() {
                const req = { auth: { sub: "sub456" } };
                const key = extractRateLimitKey(req, "user");
                key.should.equal("sub456");
            });

            it("should extract from auth.user.id", function() {
                const req = { auth: { user: { id: "nested789" } } };
                const key = extractRateLimitKey(req, "user");
                key.should.equal("nested789");
            });

            it("should extract from req.user.id", function() {
                const req = { user: { id: "userObj123" } };
                const key = extractRateLimitKey(req, "user");
                key.should.equal("userObj123");
            });

            it("should return null when no user found", function() {
                const req = {};
                const key = extractRateLimitKey(req, "user");
                should(key).be.null();
            });
        });

        describe("apiKey key type", function() {
            it("should extract from x-api-key header", function() {
                const req = { headers: { "x-api-key": "apikey123" } };
                const key = extractRateLimitKey(req, "apiKey");
                key.should.equal("apikey123");
            });

            it("should extract from Bearer authorization header", function() {
                const req = { headers: { "authorization": "Bearer token456" } };
                const key = extractRateLimitKey(req, "apiKey");
                key.should.equal("token456");
            });

            it("should extract from query parameter", function() {
                const req = { headers: {}, query: { apikey: "querykey789" } };
                const key = extractRateLimitKey(req, "apiKey");
                key.should.equal("querykey789");
            });

            it("should return null when no API key found", function() {
                const req = { headers: {}, query: {} };
                const key = extractRateLimitKey(req, "apiKey");
                should(key).be.null();
            });
        });

        describe("custom key type", function() {
            it("should extract using custom path", function() {
                const req = {
                    headers: { "x-tenant-id": "tenant123" }
                };
                const key = extractRateLimitKey(req, "custom", "headers.x-tenant-id");
                key.should.equal("tenant123");
            });

            it("should extract nested values", function() {
                const req = {
                    body: { user: { organization: { id: "org456" } } }
                };
                const key = extractRateLimitKey(req, "custom", "body.user.organization.id");
                key.should.equal("org456");
            });

            it("should return undefined for invalid path", function() {
                const req = { headers: {} };
                const key = extractRateLimitKey(req, "custom", "invalid.path");
                should(key).be.undefined();
            });

            it("should return null when no custom path provided", function() {
                const req = { headers: {} };
                const key = extractRateLimitKey(req, "custom", null);
                should(key).be.null();
            });
        });
    });

    describe("generateRateLimitHeaders", function() {
        it("should generate standard headers for allowed request", function() {
            const result = {
                allowed: true,
                limit: 100,
                remaining: 95,
                resetTime: 1704110460000,
                retryAfter: null
            };
            const headers = generateRateLimitHeaders(result);

            headers.should.have.property("X-RateLimit-Limit", "100");
            headers.should.have.property("X-RateLimit-Remaining", "95");
            headers.should.have.property("X-RateLimit-Reset", "1704110460");
            headers.should.not.have.property("Retry-After");
        });

        it("should include Retry-After for blocked request", function() {
            const result = {
                allowed: false,
                limit: 100,
                remaining: 0,
                resetTime: 1704110460000,
                retryAfter: 30
            };
            const headers = generateRateLimitHeaders(result);

            headers.should.have.property("X-RateLimit-Limit", "100");
            headers.should.have.property("X-RateLimit-Remaining", "0");
            headers.should.have.property("Retry-After", "30");
        });
    });

    describe("createRateLimitError", function() {
        it("should create 429 error response", function() {
            const result = {
                limit: 100,
                remaining: 0,
                resetTime: 1704110460000,
                retryAfter: 30
            };
            const error = createRateLimitError(result, "test-key");

            error.should.have.property("statusCode", 429);
            error.should.have.property("error", "Too Many Requests");
            error.should.have.property("message", "Rate limit exceeded. Please try again later.");
            error.details.should.have.property("limit", 100);
            error.details.should.have.property("remaining", 0);
            error.details.should.have.property("retryAfter", 30);
        });
    });
});

describe("RateLimiter", function() {
    let limiter;
    let clock;

    beforeEach(function() {
        limiter = new RateLimiter({
            requests: 10,
            windowMs: 60000,
            keyType: "ip"
        });
    });

    afterEach(function() {
        if (clock) {
            clock.restore();
            clock = null;
        }
        if (limiter) {
            limiter.shutdown();
        }
    });

    describe("initialization", function() {
        it("should initialize with default values", function() {
            const defaultLimiter = new RateLimiter();
            defaultLimiter.requests.should.equal(RATE_LIMIT_DEFAULTS.requests);
            defaultLimiter.windowMs.should.equal(RATE_LIMIT_DEFAULTS.windowMs);
            defaultLimiter.keyType.should.equal(RATE_LIMIT_DEFAULTS.keyType);
            defaultLimiter.shutdown();
        });

        it("should accept custom configuration", function() {
            limiter.requests.should.equal(10);
            limiter.windowMs.should.equal(60000);
            limiter.keyType.should.equal("ip");
        });

        it("should use default keyType for invalid type", function() {
            const invalidLimiter = new RateLimiter({ keyType: "invalid" });
            invalidLimiter.keyType.should.equal("ip");
            invalidLimiter.shutdown();
        });

        it("should store customKeyPath", function() {
            const customLimiter = new RateLimiter({
                keyType: "custom",
                customKeyPath: "headers.x-tenant-id"
            });
            customLimiter.customKeyPath.should.equal("headers.x-tenant-id");
            customLimiter.shutdown();
        });
    });

    describe("getConfig", function() {
        it("should return configuration object", function() {
            const config = limiter.getConfig();
            config.should.have.property("requests", 10);
            config.should.have.property("windowMs", 60000);
            config.should.have.property("keyType", "ip");
            config.should.have.property("customKeyPath", null);
        });
    });

    describe("check", function() {
        it("should allow requests within limit", function() {
            const result = limiter.check("test-key");
            result.allowed.should.be.true();
            result.remaining.should.equal(9);
            result.limit.should.equal(10);
        });

        it("should decrement remaining with each request", function() {
            for (let i = 0; i < 5; i++) {
                limiter.check("test-key");
            }
            const result = limiter.check("test-key");
            result.remaining.should.equal(4);
        });

        it("should block when limit exceeded", function() {
            // Exhaust limit
            for (let i = 0; i < 10; i++) {
                limiter.check("test-key");
            }

            const result = limiter.check("test-key");
            result.allowed.should.be.false();
            result.remaining.should.equal(0);
            result.retryAfter.should.be.greaterThan(0);
        });

        it("should allow when no key provided", function() {
            const result = limiter.check(null);
            result.allowed.should.be.true();
            result.remaining.should.equal(10);
        });

        it("should track different keys independently", function() {
            // Exhaust key1
            for (let i = 0; i < 10; i++) {
                limiter.check("key1");
            }

            // key2 should still have full limit
            const result = limiter.check("key2");
            result.allowed.should.be.true();
            result.remaining.should.equal(9);
        });

        it("should reset tokens after window expires", function() {
            clock = sinon.useFakeTimers();

            // Exhaust limit
            for (let i = 0; i < 10; i++) {
                limiter.check("test-key");
            }

            const blockedResult = limiter.check("test-key");
            blockedResult.allowed.should.be.false();

            // Advance time past window
            clock.tick(60001);

            const resetResult = limiter.check("test-key");
            resetResult.allowed.should.be.true();
            resetResult.remaining.should.equal(9);
        });
    });

    describe("checkRequest", function() {
        it("should extract key from request and check", function() {
            const req = {
                headers: {},
                ip: "192.168.1.1"
            };
            const result = limiter.checkRequest(req);
            result.allowed.should.be.true();
            result.key.should.equal("192.168.1.1");
        });

        it("should honour x-forwarded-for when trustProxy is enabled", function() {
            const proxied = new RateLimiter({ requests: 5, windowMs: 60000, keyType: "ip", trustProxy: true });
            const req = { headers: { "x-forwarded-for": "203.0.113.7" } };
            const result = proxied.checkRequest(req);
            result.key.should.equal("203.0.113.7");
            proxied.shutdown();
        });

        it("should use configured key type", function() {
            const userLimiter = new RateLimiter({ keyType: "user" });
            const req = { auth: { userId: "user123" } };
            const result = userLimiter.checkRequest(req);
            result.key.should.equal("user123");
            userLimiter.shutdown();
        });
    });

    describe("getStatus", function() {
        it("should return null for unknown key", function() {
            const status = limiter.getStatus("unknown-key");
            should(status).be.null();
        });

        it("should return status for known key", function() {
            limiter.check("test-key");
            const status = limiter.getStatus("test-key");
            status.should.have.property("tokens", 9);
            status.should.have.property("limit", 10);
            status.should.have.property("resetTime");
        });

        it("should return full tokens after window expires", function() {
            clock = sinon.useFakeTimers();

            limiter.check("test-key");

            // Advance time past window
            clock.tick(60001);

            const status = limiter.getStatus("test-key");
            status.tokens.should.equal(10);
        });
    });

    describe("reset", function() {
        it("should reset rate limit for key", function() {
            // Use some tokens
            for (let i = 0; i < 5; i++) {
                limiter.check("test-key");
            }

            limiter.reset("test-key");

            // Should get fresh limit
            const result = limiter.check("test-key");
            result.remaining.should.equal(9);
        });

        it("should not affect other keys", function() {
            limiter.check("key1");
            limiter.check("key2");

            limiter.reset("key1");

            const status = limiter.getStatus("key2");
            status.tokens.should.equal(9);
        });
    });

    describe("clear", function() {
        it("should clear all rate limit data", function() {
            limiter.check("key1");
            limiter.check("key2");
            limiter.check("key3");

            limiter.clear();

            should(limiter.getStatus("key1")).be.null();
            should(limiter.getStatus("key2")).be.null();
            should(limiter.getStatus("key3")).be.null();
        });
    });

    describe("getStatistics", function() {
        it("should return statistics object", function() {
            const stats = limiter.getStatistics();
            stats.should.have.property("config");
            stats.should.have.property("current");
            stats.should.have.property("cumulative");
            stats.should.have.property("peaks");
        });

        it("should track total checks", function() {
            limiter.check("test-key");
            limiter.check("test-key");
            limiter.check("test-key");

            const stats = limiter.getStatistics();
            stats.cumulative.totalChecks.should.equal(3);
        });

        it("should track allowed and blocked counts", function() {
            // Allow 10
            for (let i = 0; i < 10; i++) {
                limiter.check("test-key");
            }
            // Block 2
            limiter.check("test-key");
            limiter.check("test-key");

            const stats = limiter.getStatistics();
            stats.cumulative.totalAllowed.should.equal(10);
            stats.cumulative.totalBlocked.should.equal(2);
        });

        it("should calculate block rate", function() {
            // Allow 10
            for (let i = 0; i < 10; i++) {
                limiter.check("test-key");
            }
            // Block 10
            for (let i = 0; i < 10; i++) {
                limiter.check("test-key");
            }

            const stats = limiter.getStatistics();
            stats.cumulative.blockRate.should.equal("50.00%");
        });

        it("should track active keys", function() {
            limiter.check("key1");
            limiter.check("key2");
            limiter.check("key3");

            const stats = limiter.getStatistics();
            stats.current.activeKeys.should.equal(3);
        });

        it("should track peak concurrent keys", function() {
            limiter.check("key1");
            limiter.check("key2");
            limiter.check("key3");
            limiter.reset("key2");

            const stats = limiter.getStatistics();
            stats.peaks.peakConcurrentKeys.should.equal(3);
        });
    });

    describe("cleanup", function() {
        it("should remove expired entries", function() {
            clock = sinon.useFakeTimers();

            limiter.check("test-key");

            // Advance past window
            clock.tick(61000);

            // Trigger cleanup
            limiter._cleanup();

            should(limiter.getStatus("test-key")).be.null();
        });

        it("should keep recent entries", function() {
            clock = sinon.useFakeTimers();

            limiter.check("test-key");

            // Advance less than window
            clock.tick(30000);

            // Trigger cleanup
            limiter._cleanup();

            should(limiter.getStatus("test-key")).not.be.null();
        });
    });

    describe("shutdown", function() {
        it("should clear all data on shutdown", function() {
            limiter.check("key1");
            limiter.check("key2");

            limiter.shutdown();

            should(limiter.getStatus("key1")).be.null();
            should(limiter.getStatus("key2")).be.null();
        });

        it("should stop cleanup timer", function() {
            limiter.shutdown();
            should(limiter._cleanupTimer).be.null();
        });
    });
});
