"use strict";

const should = require("should");
const {
    MetricsCollector,
    getMetricsCollector,
    resetSharedInstance,
    validateMetricsConfig,
    normalizePath,
    DEFAULT_METRICS_CONFIG,
    DEFAULT_LATENCY_BUCKETS
} = require("../../../lib/metrics-collector");

describe("metrics-collector", function() {

    describe("validateMetricsConfig", function() {
        it("should validate valid config", function() {
            const result = validateMetricsConfig({
                prefix: "test_",
                defaultLabels: { env: "test" },
                buckets: [10, 50, 100]
            });
            result.valid.should.be.true();
            result.errors.should.have.length(0);
        });

        it("should reject non-string prefix", function() {
            const result = validateMetricsConfig({ prefix: 123 });
            result.valid.should.be.false();
            result.errors.should.containEql("prefix must be a string");
        });

        it("should reject non-object defaultLabels", function() {
            const result = validateMetricsConfig({ defaultLabels: "invalid" });
            result.valid.should.be.false();
            result.errors.should.containEql("defaultLabels must be an object");
        });

        it("should reject non-array buckets", function() {
            const result = validateMetricsConfig({ buckets: "invalid" });
            result.valid.should.be.false();
            result.errors.should.containEql("buckets must be an array");
        });

        it("should reject buckets with non-positive numbers", function() {
            const result = validateMetricsConfig({ buckets: [10, -5, 100] });
            result.valid.should.be.false();
            result.errors.should.containEql("buckets must contain positive numbers");
        });

        it("should validate empty config", function() {
            const result = validateMetricsConfig({});
            result.valid.should.be.true();
        });
    });

    describe("normalizePath", function() {
        it("should return / for null or undefined", function() {
            normalizePath(null).should.equal("/");
            normalizePath(undefined).should.equal("/");
        });

        it("should return / for non-string input", function() {
            normalizePath(123).should.equal("/");
        });

        it("should replace UUIDs with :uuid", function() {
            const path = "/users/550e8400-e29b-41d4-a716-446655440000/profile";
            normalizePath(path).should.equal("/users/:uuid/profile");
        });

        it("should replace numeric IDs with :id", function() {
            const path = "/users/12345/posts/678";
            normalizePath(path).should.equal("/users/:id/posts/:id");
        });

        it("should replace MongoDB ObjectIds with :objectId", function() {
            const path = "/items/507f1f77bcf86cd799439011";
            normalizePath(path).should.equal("/items/:objectId");
        });

        it("should remove query strings", function() {
            const path = "/search?q=test&page=1";
            normalizePath(path).should.equal("/search");
        });

        it("should normalize trailing slashes", function() {
            const path = "/users/";
            normalizePath(path).should.equal("/users");
        });

        it("should handle complex paths", function() {
            const path = "/api/v1/users/123/orders/550e8400-e29b-41d4-a716-446655440000?status=active";
            normalizePath(path).should.equal("/api/v1/users/:id/orders/:uuid");
        });

        it("should handle path without dynamic segments", function() {
            const path = "/api/health";
            normalizePath(path).should.equal("/api/health");
        });
    });

    describe("MetricsCollector", function() {
        let collector;

        beforeEach(function() {
            collector = new MetricsCollector({
                prefix: "test_",
                collectDefaultMetrics: false // Disable for faster tests
            });
        });

        afterEach(function() {
            if (collector) {
                collector.shutdown();
            }
        });

        describe("constructor", function() {
            it("should create collector with default config", function() {
                const defaultCollector = new MetricsCollector({ collectDefaultMetrics: false });
                defaultCollector.config.prefix.should.equal("api_gateway_");
                defaultCollector.config.buckets.should.deepEqual(DEFAULT_LATENCY_BUCKETS);
                defaultCollector.shutdown();
            });

            it("should create collector with custom config", function() {
                collector.config.prefix.should.equal("test_");
            });

            it("should create registry", function() {
                should.exist(collector.registry);
            });

            it("should set default labels if provided", function() {
                const labeledCollector = new MetricsCollector({
                    defaultLabels: { env: "test" },
                    collectDefaultMetrics: false
                });
                should.exist(labeledCollector.registry);
                labeledCollector.shutdown();
            });
        });

        describe("recordHttpRequest", function() {
            it("should record HTTP request metrics", async function() {
                collector.recordHttpRequest({
                    method: "GET",
                    path: "/api/users",
                    statusCode: 200,
                    duration: 50
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_http_requests_total");
                metrics.should.containEql("test_http_request_duration_ms");
                metrics.should.containEql('method="GET"');
                metrics.should.containEql('path="/api/users"');
                metrics.should.containEql('status_code="200"');
            });

            it("should record error metrics for 4xx responses", async function() {
                collector.recordHttpRequest({
                    method: "POST",
                    path: "/api/users",
                    statusCode: 400,
                    duration: 10
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_http_errors_total");
                metrics.should.containEql('error_type="client_error"');
            });

            it("should record error metrics for 5xx responses", async function() {
                collector.recordHttpRequest({
                    method: "GET",
                    path: "/api/error",
                    statusCode: 500,
                    duration: 100
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_http_errors_total");
                metrics.should.containEql('error_type="server_error"');
            });

            it("should record status code distribution", async function() {
                collector.recordHttpRequest({
                    method: "GET",
                    path: "/api/test",
                    statusCode: 201,
                    duration: 20
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_http_status_codes_total");
                metrics.should.containEql('status_class="2xx"');
            });

            it("should normalize paths in metrics", async function() {
                collector.recordHttpRequest({
                    method: "GET",
                    path: "/users/12345",
                    statusCode: 200,
                    duration: 30
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql('path="/users/:id"');
            });

            it("should not record after shutdown", async function() {
                collector.shutdown();
                collector.recordHttpRequest({
                    method: "GET",
                    path: "/test",
                    statusCode: 200,
                    duration: 10
                });
                // Should not throw
            });
        });

        describe("active requests tracking", function() {
            it("should increment active requests", async function() {
                collector.incrementActiveRequests();
                collector.incrementActiveRequests();

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_active_requests 2");
            });

            it("should decrement active requests", async function() {
                collector.incrementActiveRequests();
                collector.incrementActiveRequests();
                collector.decrementActiveRequests();

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_active_requests 1");
            });
        });

        describe("Keycloak metrics", function() {
            it("should record Keycloak validation duration", async function() {
                collector.recordKeycloakValidation({
                    duration: 25,
                    success: true,
                    validationType: "jwt"
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_keycloak_validation_duration_ms");
                metrics.should.containEql('result="success"');
                metrics.should.containEql('validation_type="jwt"');
            });

            it("should record failed Keycloak validation", async function() {
                collector.recordKeycloakValidation({
                    duration: 5,
                    success: false
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_keycloak_operations_total");
                metrics.should.containEql('result="failure"');
            });

            it("should record Keycloak cache hits and misses", async function() {
                collector.recordKeycloakCache(true);
                collector.recordKeycloakCache(true);
                collector.recordKeycloakCache(false);

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_keycloak_cache_hits_total 2");
                metrics.should.containEql("test_keycloak_cache_misses_total 1");
            });

            it("should set Keycloak circuit breaker state", async function() {
                collector.setKeycloakCircuitState("closed");
                let metrics = await collector.getMetrics();
                metrics.should.containEql("test_keycloak_circuit_breaker_state 0");

                collector.setKeycloakCircuitState("half-open");
                metrics = await collector.getMetrics();
                metrics.should.containEql("test_keycloak_circuit_breaker_state 1");

                collector.setKeycloakCircuitState("open");
                metrics = await collector.getMetrics();
                metrics.should.containEql("test_keycloak_circuit_breaker_state 2");
            });
        });

        describe("OPA metrics", function() {
            it("should record OPA evaluation duration", async function() {
                collector.recordOpaEvaluation({
                    duration: 15,
                    allowed: true,
                    policy: "authz"
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_opa_policy_duration_ms");
                metrics.should.containEql('result="allow"');
                metrics.should.containEql('policy="authz"');
            });

            it("should record OPA deny decisions", async function() {
                collector.recordOpaEvaluation({
                    duration: 10,
                    allowed: false
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_opa_operations_total");
                metrics.should.containEql('result="deny"');
            });

            it("should record OPA cache hits and misses", async function() {
                collector.recordOpaCache(true);
                collector.recordOpaCache(false);
                collector.recordOpaCache(false);

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_opa_cache_hits_total 1");
                metrics.should.containEql("test_opa_cache_misses_total 2");
            });

            it("should set OPA circuit breaker state", async function() {
                collector.setOpaCircuitState("open");
                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_opa_circuit_breaker_state 2");
            });
        });

        describe("rate limiter metrics", function() {
            it("should record rate limited requests", async function() {
                collector.recordRateLimited("/api/users", "per_minute");

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_rate_limited_requests_total");
                metrics.should.containEql('path="/api/users"');
                metrics.should.containEql('limit_type="per_minute"');
            });

            it("should normalize rate limited paths", async function() {
                collector.recordRateLimited("/users/123", "default");

                const metrics = await collector.getMetrics();
                metrics.should.containEql('path="/users/:id"');
            });
        });

        describe("response cache metrics", function() {
            it("should record cache hits", async function() {
                collector.recordResponseCache("/api/data", true);

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_response_cache_hits_total");
            });

            it("should record cache misses", async function() {
                collector.recordResponseCache("/api/data", false);

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_response_cache_misses_total");
            });
        });

        describe("connection pool metrics", function() {
            it("should update connection pool metrics", async function() {
                collector.updateConnectionPool("database", {
                    active: 5,
                    idle: 3,
                    waiting: 2
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_connection_pool_size");
                metrics.should.containEql('pool="database"');
                metrics.should.containEql('state="active"');
            });
        });

        describe("sync methods", function() {
            it("should sync Keycloak stats", async function() {
                collector.syncKeycloakStats({
                    current: { circuitState: "half-open" }
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_keycloak_circuit_breaker_state 1");
            });

            it("should sync OPA stats", async function() {
                collector.syncOpaStats({
                    current: { circuitState: "open" }
                });

                const metrics = await collector.getMetrics();
                metrics.should.containEql("test_opa_circuit_breaker_state 2");
            });

            it("should handle null stats gracefully", function() {
                collector.syncKeycloakStats(null);
                collector.syncOpaStats(null);
                // Should not throw
            });
        });

        describe("getMetrics", function() {
            it("should return Prometheus formatted metrics", async function() {
                const metrics = await collector.getMetrics();
                metrics.should.be.String();
                metrics.should.containEql("# HELP");
                metrics.should.containEql("# TYPE");
            });
        });

        describe("getContentType", function() {
            it("should return Prometheus content type", function() {
                const contentType = collector.getContentType();
                contentType.should.containEql("text/plain");
            });
        });

        describe("reset", function() {
            it("should reset all metrics", async function() {
                collector.recordHttpRequest({
                    method: "GET",
                    path: "/test",
                    statusCode: 200,
                    duration: 10
                });

                // Verify metrics were recorded
                let metrics = await collector.getMetrics();
                metrics.should.containEql("test_http_requests_total{");

                collector.reset();

                metrics = await collector.getMetrics();
                // After reset, the counter with labels should not appear or be reset
                // Prometheus counters with labels don't show "0" when reset, they just disappear
                // Verify the specific labeled metric is gone
                metrics.should.not.containEql('method="GET",path="/test"');
            });
        });

        describe("shutdown", function() {
            it("should prevent further metric recording", function() {
                collector.shutdown();
                collector._shutdown.should.be.true();
            });
        });
    });

    describe("getMetricsCollector (singleton)", function() {
        afterEach(function() {
            resetSharedInstance();
        });

        it("should return the same instance on multiple calls", function() {
            const first = getMetricsCollector({ collectDefaultMetrics: false });
            const second = getMetricsCollector();
            first.should.equal(second);
        });

        it("should use config from first call", function() {
            const collector = getMetricsCollector({
                prefix: "custom_",
                collectDefaultMetrics: false
            });
            collector.config.prefix.should.equal("custom_");
        });
    });

    describe("resetSharedInstance", function() {
        it("should reset the shared instance", function() {
            const first = getMetricsCollector({ collectDefaultMetrics: false });
            resetSharedInstance();
            const second = getMetricsCollector({ collectDefaultMetrics: false });
            first.should.not.equal(second);
        });

        it("should handle reset when no instance exists", function() {
            resetSharedInstance(); // Should not throw
        });
    });

    describe("DEFAULT_METRICS_CONFIG", function() {
        it("should have expected defaults", function() {
            DEFAULT_METRICS_CONFIG.prefix.should.equal("api_gateway_");
            DEFAULT_METRICS_CONFIG.collectDefaultMetrics.should.be.true();
            DEFAULT_METRICS_CONFIG.defaultMetricsPrefix.should.equal("nodejs_");
            DEFAULT_METRICS_CONFIG.defaultLabels.should.deepEqual({});
        });
    });

    describe("DEFAULT_LATENCY_BUCKETS", function() {
        it("should have sensible bucket boundaries", function() {
            DEFAULT_LATENCY_BUCKETS.should.be.Array();
            DEFAULT_LATENCY_BUCKETS.length.should.be.above(5);
            // Should be sorted ascending
            for (let i = 1; i < DEFAULT_LATENCY_BUCKETS.length; i++) {
                DEFAULT_LATENCY_BUCKETS[i].should.be.above(DEFAULT_LATENCY_BUCKETS[i - 1]);
            }
        });
    });
});
