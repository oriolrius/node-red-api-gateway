const should = require("should");
const sinon = require("sinon");
const {
    CACHE_KEY_STRATEGIES,
    CACHE_DEFAULTS,
    ResponseCache,
    validateCacheConfig,
    generateCacheKey,
    generateETag,
    checkConditionalRequest,
    generateCacheHeaders,
    parseVaryHeaders
} = require("../../lib/response-cache");

describe("Response Cache", function() {
    describe("Constants", function() {
        describe("CACHE_KEY_STRATEGIES", function() {
            it("should contain expected strategies", function() {
                CACHE_KEY_STRATEGIES.should.containDeep(["full", "path", "query", "custom"]);
                CACHE_KEY_STRATEGIES.should.have.length(4);
            });
        });

        describe("CACHE_DEFAULTS", function() {
            it("should have expected default values", function() {
                CACHE_DEFAULTS.should.have.property("ttl", 300000);
                CACHE_DEFAULTS.should.have.property("maxSize", 100);
                CACHE_DEFAULTS.should.have.property("keyStrategy", "full");
                CACHE_DEFAULTS.should.have.property("varyHeaders").which.is.an.Array();
            });
        });
    });

    describe("validateCacheConfig", function() {
        it("should return valid for empty config", function() {
            const result = validateCacheConfig({});
            result.valid.should.be.true();
            result.errors.should.have.length(0);
        });

        it("should return valid for valid config", function() {
            const result = validateCacheConfig({
                ttl: 60000,
                maxSize: 50,
                keyStrategy: "full"
            });
            result.valid.should.be.true();
        });

        it("should allow zero TTL", function() {
            const result = validateCacheConfig({ ttl: 0 });
            result.valid.should.be.true();
        });

        it("should reject negative TTL", function() {
            const result = validateCacheConfig({ ttl: -1 });
            result.valid.should.be.false();
            result.errors[0].should.containEql("TTL");
        });

        it("should reject maxSize less than 1", function() {
            const result = validateCacheConfig({ maxSize: 0 });
            result.valid.should.be.false();
            result.errors[0].should.containEql("max size");
        });

        it("should reject invalid keyStrategy", function() {
            const result = validateCacheConfig({ keyStrategy: "invalid" });
            result.valid.should.be.false();
            result.errors[0].should.containEql("key strategy");
        });

        it("should accept all valid strategies", function() {
            for (const strategy of CACHE_KEY_STRATEGIES) {
                const result = validateCacheConfig({ keyStrategy: strategy });
                result.valid.should.be.true();
            }
        });
    });

    describe("generateCacheKey", function() {
        it("should return null for null request", function() {
            const key = generateCacheKey(null, "full");
            should(key).be.null();
        });

        describe("full strategy", function() {
            it("should include method, path, and sorted query", function() {
                const req = {
                    method: "GET",
                    path: "/users",
                    query: { page: "1", limit: "10" }
                };
                const key = generateCacheKey(req, "full");
                key.should.equal("GET|/users|limit=10&page=1");
            });

            it("should work without query params", function() {
                const req = { method: "GET", path: "/users" };
                const key = generateCacheKey(req, "full");
                key.should.equal("GET|/users");
            });

            it("should default to GET and /", function() {
                const req = {};
                const key = generateCacheKey(req, "full");
                key.should.equal("GET|/");
            });
        });

        describe("path strategy", function() {
            it("should include only method and path", function() {
                const req = {
                    method: "GET",
                    path: "/users",
                    query: { page: "1" }
                };
                const key = generateCacheKey(req, "path");
                key.should.equal("GET|/users");
            });

            it("should extract path from url", function() {
                const req = { method: "GET", url: "/users?page=1" };
                const key = generateCacheKey(req, "path");
                key.should.equal("GET|/users");
            });
        });

        describe("custom strategy", function() {
            it("should use custom expression", function() {
                const req = { headers: { "x-tenant-id": "tenant123" } };
                const key = generateCacheKey(req, "custom", "headers.x-tenant-id");
                key.should.equal("tenant123");
            });

            it("should fallback to full when expression fails", function() {
                const req = { method: "GET", path: "/users" };
                const key = generateCacheKey(req, "custom", "invalid.path");
                key.should.equal("GET|/users");
            });

            it("should fallback when no expression provided", function() {
                const req = { method: "GET", path: "/users" };
                const key = generateCacheKey(req, "custom", null);
                key.should.equal("GET|/users");
            });
        });

        describe("vary headers", function() {
            it("should include vary headers in key", function() {
                const req = {
                    method: "GET",
                    path: "/users",
                    headers: { "accept": "application/json", "accept-language": "en" }
                };
                const key = generateCacheKey(req, "full", null, ["Accept", "Accept-Language"]);
                key.should.containEql("Accept:application/json");
                key.should.containEql("Accept-Language:en");
            });

            it("should skip missing headers", function() {
                const req = {
                    method: "GET",
                    path: "/users",
                    headers: {}
                };
                const key = generateCacheKey(req, "full", null, ["Accept"]);
                key.should.equal("GET|/users");
            });
        });
    });

    describe("generateETag", function() {
        it("should return null for null data", function() {
            const etag = generateETag(null);
            should(etag).be.null();
        });

        it("should generate weak ETag for string", function() {
            const etag = generateETag("test data");
            etag.should.startWith('W/"');
            etag.should.endWith('"');
        });

        it("should generate weak ETag for object", function() {
            const etag = generateETag({ id: 1, name: "test" });
            etag.should.startWith('W/"');
        });

        it("should generate consistent ETag for same data", function() {
            const data = { id: 1, name: "test" };
            const etag1 = generateETag(data);
            const etag2 = generateETag(data);
            etag1.should.equal(etag2);
        });

        it("should generate different ETag for different data", function() {
            const etag1 = generateETag({ id: 1 });
            const etag2 = generateETag({ id: 2 });
            etag1.should.not.equal(etag2);
        });
    });

    describe("checkConditionalRequest", function() {
        it("should return false for null request", function() {
            const result = checkConditionalRequest(null, 'W/"abc"');
            result.should.be.false();
        });

        it("should return false for null etag", function() {
            const req = { headers: { "if-none-match": 'W/"abc"' } };
            const result = checkConditionalRequest(req, null);
            result.should.be.false();
        });

        it("should match exact ETag", function() {
            const req = { headers: { "if-none-match": 'W/"abc123"' } };
            const result = checkConditionalRequest(req, 'W/"abc123"');
            result.should.be.true();
        });

        it("should match wildcard", function() {
            const req = { headers: { "if-none-match": "*" } };
            const result = checkConditionalRequest(req, 'W/"abc123"');
            result.should.be.true();
        });

        it("should match multiple ETags", function() {
            const req = { headers: { "if-none-match": 'W/"xyz", W/"abc123", W/"def"' } };
            const result = checkConditionalRequest(req, 'W/"abc123"');
            result.should.be.true();
        });

        it("should match without weak validator prefix", function() {
            const req = { headers: { "if-none-match": '"abc123"' } };
            const result = checkConditionalRequest(req, 'W/"abc123"');
            result.should.be.true();
        });

        it("should not match different ETag", function() {
            const req = { headers: { "if-none-match": 'W/"different"' } };
            const result = checkConditionalRequest(req, 'W/"abc123"');
            result.should.be.false();
        });
    });

    describe("generateCacheHeaders", function() {
        it("should generate public cache control by default", function() {
            const headers = generateCacheHeaders({ ttl: 60000 });
            headers["Cache-Control"].should.containEql("public");
            headers["Cache-Control"].should.containEql("max-age=60");
        });

        it("should generate private cache control when specified", function() {
            const headers = generateCacheHeaders({ ttl: 60000 }, true);
            headers["Cache-Control"].should.containEql("private");
        });

        it("should generate no-cache when TTL is 0", function() {
            const headers = generateCacheHeaders({ ttl: 0 });
            headers["Cache-Control"].should.containEql("no-cache");
        });

        it("should include Vary header when specified", function() {
            const headers = generateCacheHeaders({
                ttl: 60000,
                varyHeaders: ["Accept", "Accept-Language"]
            });
            headers.should.have.property("Vary", "Accept, Accept-Language");
        });

        it("should not include Vary header when empty", function() {
            const headers = generateCacheHeaders({ ttl: 60000, varyHeaders: [] });
            headers.should.not.have.property("Vary");
        });
    });

    describe("parseVaryHeaders", function() {
        it("should return empty array for null", function() {
            parseVaryHeaders(null).should.have.length(0);
        });

        it("should return empty array for empty string", function() {
            parseVaryHeaders("").should.have.length(0);
        });

        it("should parse comma-separated headers", function() {
            const result = parseVaryHeaders("Accept, Accept-Language");
            result.should.deepEqual(["Accept", "Accept-Language"]);
        });

        it("should trim whitespace", function() {
            const result = parseVaryHeaders("  Accept  ,  Accept-Language  ");
            result.should.deepEqual(["Accept", "Accept-Language"]);
        });

        it("should filter empty values", function() {
            const result = parseVaryHeaders("Accept,,Accept-Language,");
            result.should.deepEqual(["Accept", "Accept-Language"]);
        });
    });
});

describe("ResponseCache", function() {
    let cache;
    let clock;

    beforeEach(function() {
        cache = new ResponseCache({
            ttl: 60000,
            maxSize: 5,
            keyStrategy: "full"
        });
    });

    afterEach(function() {
        if (clock) {
            clock.restore();
            clock = null;
        }
        if (cache) {
            cache.shutdown();
        }
    });

    describe("initialization", function() {
        it("should initialize with default values", function() {
            const defaultCache = new ResponseCache();
            defaultCache.ttl.should.equal(CACHE_DEFAULTS.ttl);
            defaultCache.maxSize.should.equal(CACHE_DEFAULTS.maxSize);
            defaultCache.keyStrategy.should.equal(CACHE_DEFAULTS.keyStrategy);
            defaultCache.shutdown();
        });

        it("should accept custom configuration", function() {
            cache.ttl.should.equal(60000);
            cache.maxSize.should.equal(5);
            cache.keyStrategy.should.equal("full");
        });

        it("should use default keyStrategy for invalid type", function() {
            const invalidCache = new ResponseCache({ keyStrategy: "invalid" });
            invalidCache.keyStrategy.should.equal("full");
            invalidCache.shutdown();
        });

        it("should store varyHeaders", function() {
            const varyCache = new ResponseCache({
                varyHeaders: ["Accept", "Accept-Language"]
            });
            varyCache.varyHeaders.should.deepEqual(["Accept", "Accept-Language"]);
            varyCache.shutdown();
        });
    });

    describe("getConfig", function() {
        it("should return configuration object", function() {
            const config = cache.getConfig();
            config.should.have.property("ttl", 60000);
            config.should.have.property("maxSize", 5);
            config.should.have.property("keyStrategy", "full");
            config.should.have.property("varyHeaders");
        });
    });

    describe("set and get", function() {
        it("should store and retrieve values", function() {
            cache.set("key1", { id: 1 }, 200);
            const result = cache.get("key1");
            result.hit.should.be.true();
            result.data.should.deepEqual({ id: 1 });
            result.statusCode.should.equal(200);
        });

        it("should return etag on set", function() {
            const etag = cache.set("key1", { id: 1 });
            etag.should.startWith('W/"');
        });

        it("should return hit:false for unknown key", function() {
            const result = cache.get("unknown");
            result.hit.should.be.false();
        });

        it("should return hit:false for null key", function() {
            const result = cache.get(null);
            result.hit.should.be.false();
        });

        it("should not store null key", function() {
            const etag = cache.set(null, { id: 1 });
            should(etag).be.null();
        });

        it("should update existing entry", function() {
            cache.set("key1", { v: 1 });
            cache.set("key1", { v: 2 });
            const result = cache.get("key1");
            result.data.should.deepEqual({ v: 2 });
        });

        it("should store headers", function() {
            cache.set("key1", { id: 1 }, 200, { "X-Custom": "value" });
            const result = cache.get("key1");
            result.headers.should.deepEqual({ "X-Custom": "value" });
        });
    });

    describe("setByRequest and getByRequest", function() {
        it("should store and retrieve by request", function() {
            const req = { method: "GET", path: "/users", query: { page: "1" } };
            cache.setByRequest(req, { users: [] }, 200);
            const result = cache.getByRequest(req);
            result.hit.should.be.true();
            result.data.should.deepEqual({ users: [] });
            result.key.should.be.a.String();
        });

        it("should return key in result", function() {
            const req = { method: "GET", path: "/users" };
            const { key } = cache.setByRequest(req, { users: [] });
            key.should.equal("GET|/users");
        });
    });

    describe("TTL expiration", function() {
        it("should expire entries after TTL", function() {
            clock = sinon.useFakeTimers();

            cache.set("key1", { id: 1 });
            cache.get("key1").hit.should.be.true();

            clock.tick(61000);

            cache.get("key1").hit.should.be.false();
        });

        it("should not expire when TTL is 0", function() {
            const noExpiryCache = new ResponseCache({ ttl: 0 });
            clock = sinon.useFakeTimers();

            noExpiryCache.set("key1", { id: 1 });
            clock.tick(1000000);

            noExpiryCache.get("key1").hit.should.be.true();
            noExpiryCache.shutdown();
        });
    });

    describe("LRU eviction", function() {
        it("should evict oldest entry when at capacity", function() {
            cache.set("key1", { v: 1 });
            cache.set("key2", { v: 2 });
            cache.set("key3", { v: 3 });
            cache.set("key4", { v: 4 });
            cache.set("key5", { v: 5 });
            cache.set("key6", { v: 6 }); // Should evict key1

            cache.get("key1").hit.should.be.false();
            cache.get("key6").hit.should.be.true();
        });

        it("should update LRU order on get", function() {
            cache.set("key1", { v: 1 });
            cache.set("key2", { v: 2 });
            cache.set("key3", { v: 3 });
            cache.set("key4", { v: 4 });
            cache.set("key5", { v: 5 });

            // Access key1 to move it to end
            cache.get("key1");

            // Add new entry - should evict key2 (now oldest)
            cache.set("key6", { v: 6 });

            cache.get("key1").hit.should.be.true();
            cache.get("key2").hit.should.be.false();
        });
    });

    describe("has", function() {
        it("should return true for existing key", function() {
            cache.set("key1", { id: 1 });
            cache.has("key1").should.be.true();
        });

        it("should return false for unknown key", function() {
            cache.has("unknown").should.be.false();
        });

        it("should return false for expired key", function() {
            clock = sinon.useFakeTimers();
            cache.set("key1", { id: 1 });
            clock.tick(61000);
            cache.has("key1").should.be.false();
        });

        it("should not affect LRU order", function() {
            cache.set("key1", { v: 1 });
            cache.set("key2", { v: 2 });
            cache.set("key3", { v: 3 });
            cache.set("key4", { v: 4 });
            cache.set("key5", { v: 5 });

            // has() should not change order
            cache.has("key1");
            cache.set("key6", { v: 6 });

            // key1 should have been evicted (not moved)
            cache.has("key1").should.be.false();
        });
    });

    describe("delete", function() {
        it("should delete existing entry", function() {
            cache.set("key1", { id: 1 });
            cache.delete("key1").should.be.true();
            cache.get("key1").hit.should.be.false();
        });

        it("should return false for unknown key", function() {
            cache.delete("unknown").should.be.false();
        });
    });

    describe("deleteByRequest", function() {
        it("should delete by request", function() {
            const req = { method: "GET", path: "/users" };
            cache.setByRequest(req, { users: [] });
            cache.deleteByRequest(req).should.be.true();
            cache.getByRequest(req).hit.should.be.false();
        });
    });

    describe("clear", function() {
        it("should clear all entries", function() {
            cache.set("key1", { v: 1 });
            cache.set("key2", { v: 2 });
            cache.set("key3", { v: 3 });

            cache.clear();

            cache.get("key1").hit.should.be.false();
            cache.get("key2").hit.should.be.false();
            cache.get("key3").hit.should.be.false();
        });
    });

    describe("getStatistics", function() {
        it("should return statistics object", function() {
            const stats = cache.getStatistics();
            stats.should.have.property("config");
            stats.should.have.property("current");
            stats.should.have.property("cumulative");
        });

        it("should track hits and misses", function() {
            cache.set("key1", { id: 1 });
            cache.get("key1"); // hit
            cache.get("key1"); // hit
            cache.get("unknown"); // miss

            const stats = cache.getStatistics();
            stats.cumulative.hits.should.equal(2);
            stats.cumulative.misses.should.equal(1);
        });

        it("should track sets", function() {
            cache.set("key1", { id: 1 });
            cache.set("key2", { id: 2 });

            const stats = cache.getStatistics();
            stats.cumulative.sets.should.equal(2);
        });

        it("should track evictions", function() {
            cache.set("key1", { v: 1 });
            cache.set("key2", { v: 2 });
            cache.set("key3", { v: 3 });
            cache.set("key4", { v: 4 });
            cache.set("key5", { v: 5 });
            cache.set("key6", { v: 6 }); // eviction

            const stats = cache.getStatistics();
            stats.cumulative.evictions.should.equal(1);
        });

        it("should calculate hit rate", function() {
            cache.set("key1", { id: 1 });
            cache.get("key1"); // hit
            cache.get("key1"); // hit
            cache.get("unknown"); // miss
            cache.get("unknown"); // miss

            const stats = cache.getStatistics();
            stats.cumulative.hitRate.should.equal("50.00%");
        });

        it("should track current size", function() {
            cache.set("key1", { id: 1 });
            cache.set("key2", { id: 2 });

            const stats = cache.getStatistics();
            stats.current.size.should.equal(2);
            stats.current.maxSize.should.equal(5);
        });
    });

    describe("cleanup", function() {
        it("should remove expired entries", function() {
            clock = sinon.useFakeTimers();

            cache.set("key1", { id: 1 });
            cache.set("key2", { id: 2 });

            clock.tick(61000);
            cache._cleanup();

            const stats = cache.getStatistics();
            stats.current.size.should.equal(0);
        });
    });

    describe("shutdown", function() {
        it("should clear all data", function() {
            cache.set("key1", { id: 1 });
            cache.shutdown();

            // Create new cache to verify cleanup
            const newCache = new ResponseCache();
            newCache.get("key1").hit.should.be.false();
            newCache.shutdown();
        });

        it("should stop cleanup timer", function() {
            cache.shutdown();
            should(cache._cleanupTimer).be.null();
        });
    });
});
