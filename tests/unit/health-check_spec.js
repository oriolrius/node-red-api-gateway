require("should");
const sinon = require("sinon");
const {
    HealthStatus,
    HealthCheckResult,
    HealthCheckManager,
    DEFAULT_HEALTH_CONFIG,
    createDatabaseHealthCheck,
    createKeycloakHealthCheck,
    createOpaHealthCheck
} = require("../../lib/health-check");

describe("HealthStatus", function() {
    it("should have correct status values", function() {
        HealthStatus.HEALTHY.should.equal("healthy");
        HealthStatus.DEGRADED.should.equal("degraded");
        HealthStatus.UNHEALTHY.should.equal("unhealthy");
        HealthStatus.UNKNOWN.should.equal("unknown");
    });
});

describe("DEFAULT_HEALTH_CONFIG", function() {
    it("should have expected default values", function() {
        DEFAULT_HEALTH_CONFIG.should.have.property("checkInterval", 30000);
        DEFAULT_HEALTH_CONFIG.should.have.property("timeout", 5000);
        DEFAULT_HEALTH_CONFIG.should.have.property("unhealthyThreshold", 3);
        DEFAULT_HEALTH_CONFIG.should.have.property("healthyThreshold", 1);
    });
});

describe("HealthCheckResult", function() {
    it("should create result with all properties", function() {
        const result = new HealthCheckResult(
            "test-service",
            HealthStatus.HEALTHY,
            100,
            "Service OK",
            { version: "1.0" }
        );

        result.should.have.property("service", "test-service");
        result.should.have.property("status", HealthStatus.HEALTHY);
        result.should.have.property("responseTime", 100);
        result.should.have.property("message", "Service OK");
        result.should.have.property("details");
        result.details.should.have.property("version", "1.0");
        result.should.have.property("timestamp");
    });

    it("should correctly report isHealthy", function() {
        const healthy = new HealthCheckResult("svc", HealthStatus.HEALTHY, 50);
        const unhealthy = new HealthCheckResult("svc", HealthStatus.UNHEALTHY, 50);

        healthy.isHealthy.should.be.true();
        unhealthy.isHealthy.should.be.false();
    });

    it("should convert to JSON correctly", function() {
        const result = new HealthCheckResult("svc", HealthStatus.HEALTHY, 100, "OK");
        const json = result.toJSON();

        json.should.have.property("service", "svc");
        json.should.have.property("status", "healthy");
        json.should.have.property("responseTime", 100);
        json.should.have.property("message", "OK");
        json.should.have.property("timestamp");
    });
});

describe("HealthCheckManager", function() {
    let manager;
    let clock;

    beforeEach(function() {
        manager = new HealthCheckManager();
    });

    afterEach(function() {
        if (manager) {
            manager.shutdown();
        }
        if (clock) {
            clock.restore();
            clock = null;
        }
    });

    describe("initialization", function() {
        it("should use default config when no options provided", function() {
            manager.config.should.have.property("checkInterval", DEFAULT_HEALTH_CONFIG.checkInterval);
            manager.config.should.have.property("timeout", DEFAULT_HEALTH_CONFIG.timeout);
        });

        it("should allow custom config options", function() {
            const customManager = new HealthCheckManager({
                checkInterval: 10000,
                timeout: 3000
            });
            customManager.config.should.have.property("checkInterval", 10000);
            customManager.config.should.have.property("timeout", 3000);
            customManager.shutdown();
        });
    });

    describe("health check registration", function() {
        it("should register a health check", function() {
            const checkFn = async () => ({ healthy: true });
            manager.registerCheck("test-service", checkFn);

            manager._healthChecks.has("test-service").should.be.true();
        });

        it("should unregister a health check", function() {
            const checkFn = async () => ({ healthy: true });
            manager.registerCheck("test-service", checkFn);
            manager.unregisterCheck("test-service");

            manager._healthChecks.has("test-service").should.be.false();
        });

        it("should initialize with unknown status", function() {
            const checkFn = async () => ({ healthy: true });
            manager.registerCheck("test-service", checkFn);

            const result = manager.getResult("test-service");
            result.status.should.equal(HealthStatus.UNKNOWN);
        });
    });

    describe("single service health check", function() {
        it("should return healthy result for successful check", async function() {
            const checkFn = async () => ({ healthy: true, message: "All good" });
            manager.registerCheck("test-service", checkFn);

            const result = await manager.checkService("test-service");

            result.status.should.equal(HealthStatus.HEALTHY);
            result.message.should.equal("All good");
        });

        it("should return unhealthy result for failed check", async function() {
            const checkFn = async () => ({ healthy: false, message: "Service down" });
            manager.registerCheck("test-service", checkFn);

            // Need 3 failures for unhealthy (default threshold)
            await manager.checkService("test-service");
            await manager.checkService("test-service");
            const result = await manager.checkService("test-service");

            result.status.should.equal(HealthStatus.UNHEALTHY);
        });

        it("should return degraded on first failure", async function() {
            const checkFn = async () => ({ healthy: false, message: "Temporary issue" });
            manager.registerCheck("test-service", checkFn);

            const result = await manager.checkService("test-service");

            result.status.should.equal(HealthStatus.DEGRADED);
        });

        it("should handle check exceptions", async function() {
            const checkFn = async () => { throw new Error("Connection refused"); };
            manager.registerCheck("test-service", checkFn);

            const result = await manager.checkService("test-service");

            result.status.should.equal(HealthStatus.DEGRADED);
            result.message.should.equal("Connection refused");
        });

        it("should return unknown for unregistered service", async function() {
            const result = await manager.checkService("unknown-service");

            result.status.should.equal(HealthStatus.UNKNOWN);
        });

        it("should handle timeout", async function() {
            const slowCheck = async () => {
                await new Promise(resolve => setTimeout(resolve, 10000));
                return { healthy: true };
            };

            const customManager = new HealthCheckManager({ timeout: 100 });
            customManager.registerCheck("slow-service", slowCheck);

            const result = await customManager.checkService("slow-service");

            result.status.should.equal(HealthStatus.DEGRADED);
            result.message.should.equal("Health check timeout");
            customManager.shutdown();
        });

        it("should reset failure count on success", async function() {
            let shouldFail = true;
            const checkFn = async () => ({
                healthy: !shouldFail,
                message: shouldFail ? "Down" : "Up"
            });
            manager.registerCheck("test-service", checkFn);

            // Fail twice
            await manager.checkService("test-service");
            await manager.checkService("test-service");
            manager._failureCounts.get("test-service").should.equal(2);

            // Now succeed
            shouldFail = false;
            await manager.checkService("test-service");
            manager._failureCounts.get("test-service").should.equal(0);
        });
    });

    describe("check all services", function() {
        it("should check all registered services", async function() {
            manager.registerCheck("svc1", async () => ({ healthy: true }));
            manager.registerCheck("svc2", async () => ({ healthy: true }));

            const results = await manager.checkAll();

            results.size.should.equal(2);
            results.has("svc1").should.be.true();
            results.has("svc2").should.be.true();
        });

        it("should emit checkComplete event", async function() {
            manager.registerCheck("svc1", async () => ({ healthy: true }));

            let eventData = null;
            manager.on("checkComplete", data => { eventData = data; });

            await manager.checkAll();

            eventData.should.not.be.null();
            eventData.should.have.property("results");
            eventData.should.have.property("aggregatedStatus");
        });
    });

    describe("aggregated status", function() {
        it("should return unknown when no services registered", function() {
            manager.getAggregatedStatus().should.equal(HealthStatus.UNKNOWN);
        });

        it("should return healthy when all services healthy", async function() {
            manager.registerCheck("svc1", async () => ({ healthy: true }));
            manager.registerCheck("svc2", async () => ({ healthy: true }));

            await manager.checkAll();

            manager.getAggregatedStatus().should.equal(HealthStatus.HEALTHY);
        });

        it("should return degraded when one service is degraded", async function() {
            manager.registerCheck("svc1", async () => ({ healthy: true }));
            manager.registerCheck("svc2", async () => ({ healthy: false }));

            await manager.checkAll();

            manager.getAggregatedStatus().should.equal(HealthStatus.DEGRADED);
        });

        it("should return unhealthy when one service is unhealthy", async function() {
            manager.registerCheck("svc1", async () => ({ healthy: true }));
            manager.registerCheck("svc2", async () => ({ healthy: false }));

            // Run multiple times to hit unhealthy threshold
            await manager.checkAll();
            await manager.checkAll();
            await manager.checkAll();

            manager.getAggregatedStatus().should.equal(HealthStatus.UNHEALTHY);
        });

        it("should return degraded when any service is unknown", async function() {
            manager.registerCheck("svc1", async () => ({ healthy: true }));
            manager.registerCheck("svc2", async () => ({ healthy: true }));

            // Only check svc1, leave svc2 as unknown
            await manager.checkService("svc1");

            manager.getAggregatedStatus().should.equal(HealthStatus.DEGRADED);
        });
    });

    describe("health report", function() {
        it("should return complete health report", async function() {
            manager.registerCheck("svc1", async () => ({ healthy: true }));
            await manager.checkAll();

            const report = manager.getHealthReport();

            report.should.have.property("status", HealthStatus.HEALTHY);
            report.should.have.property("timestamp");
            report.should.have.property("services");
            report.should.have.property("config");
            report.services.should.have.property("svc1");
        });
    });

    describe("periodic health checks", function() {
        beforeEach(function() {
            clock = sinon.useFakeTimers();
        });

        it("should run initial check on start", async function() {
            let checkCount = 0;
            manager.registerCheck("svc", async () => {
                checkCount++;
                return { healthy: true };
            });

            manager.start();
            await Promise.resolve(); // Let async run

            checkCount.should.be.greaterThan(0);
        });

        it("should run periodic checks", async function() {
            let checkCount = 0;
            manager.registerCheck("svc", async () => {
                checkCount++;
                return { healthy: true };
            });

            manager.start();
            await Promise.resolve();
            const initialCount = checkCount;

            clock.tick(30001);
            await Promise.resolve();

            checkCount.should.be.greaterThan(initialCount);
        });

        it("should stop periodic checks on stop", async function() {
            let checkCount = 0;
            manager.registerCheck("svc", async () => {
                checkCount++;
                return { healthy: true };
            });

            manager.start();
            await Promise.resolve();
            manager.stop();
            const countAfterStop = checkCount;

            clock.tick(60000);
            await Promise.resolve();

            checkCount.should.equal(countAfterStop);
        });
    });

    describe("shutdown", function() {
        it("should clear all state on shutdown", function() {
            manager.registerCheck("svc", async () => ({ healthy: true }));
            manager.shutdown();

            manager._healthChecks.size.should.equal(0);
            manager._results.size.should.equal(0);
            manager._isShuttingDown.should.be.true();
        });

        it("should emit shutdown event", function(done) {
            manager.on("shutdown", () => done());
            manager.shutdown();
        });
    });
});

describe("Health Check Factories", function() {
    describe("createDatabaseHealthCheck", function() {
        it("should return unhealthy when not configured", async function() {
            const check = createDatabaseHealthCheck({ dbType: "none" });
            const result = await check();

            result.healthy.should.be.false();
            result.message.should.containEql("not configured");
        });

        it("should return healthy when properly configured", async function() {
            const check = createDatabaseHealthCheck({
                dbType: "postgres",
                dbHost: "localhost",
                dbPort: 5432,
                dbName: "testdb"
            });
            const result = await check();

            result.healthy.should.be.true();
            result.details.should.have.property("type", "postgres");
        });

        it("should use custom ping function when provided", async function() {
            const pingFn = sinon.stub().resolves();
            const check = createDatabaseHealthCheck({ dbType: "postgres" }, pingFn);
            const result = await check();

            pingFn.calledOnce.should.be.true();
            result.healthy.should.be.true();
        });

        it("should handle ping function errors", async function() {
            const pingFn = sinon.stub().rejects(new Error("Connection refused"));
            const check = createDatabaseHealthCheck({ dbType: "postgres" }, pingFn);
            const result = await check();

            result.healthy.should.be.false();
            result.message.should.equal("Connection refused");
        });
    });

    describe("createKeycloakHealthCheck", function() {
        it("should return unhealthy when URL not configured", async function() {
            const check = createKeycloakHealthCheck({});
            const result = await check();

            result.healthy.should.be.false();
            result.message.should.containEql("not configured");
        });

        it("should check health endpoint", async function() {
            const mockFetch = sinon.stub().resolves({
                ok: true,
                status: 200
            });

            const check = createKeycloakHealthCheck({
                keycloakUrl: "https://keycloak.example.com",
                keycloakRealm: "myrealm"
            }, mockFetch);

            const result = await check();

            mockFetch.calledOnce.should.be.true();
            mockFetch.firstCall.args[0].should.containEql("/health/ready");
            result.healthy.should.be.true();
        });

        it("should handle fetch errors", async function() {
            const mockFetch = sinon.stub().rejects(new Error("Network error"));

            const check = createKeycloakHealthCheck({
                keycloakUrl: "https://keycloak.example.com"
            }, mockFetch);

            const result = await check();

            result.healthy.should.be.false();
            result.message.should.equal("Network error");
        });

        it("should handle non-OK response", async function() {
            const mockFetch = sinon.stub().resolves({
                ok: false,
                status: 503
            });

            const check = createKeycloakHealthCheck({
                keycloakUrl: "https://keycloak.example.com"
            }, mockFetch);

            const result = await check();

            result.healthy.should.be.false();
            result.message.should.containEql("503");
        });
    });

    describe("createOpaHealthCheck", function() {
        it("should return unhealthy when URL not configured", async function() {
            const check = createOpaHealthCheck({});
            const result = await check();

            result.healthy.should.be.false();
            result.message.should.containEql("not configured");
        });

        it("should check health endpoint", async function() {
            const mockFetch = sinon.stub().resolves({
                ok: true,
                status: 200
            });

            const check = createOpaHealthCheck({
                opaUrl: "http://localhost:8181",
                opaPolicyPath: "v1/data/authz"
            }, mockFetch);

            const result = await check();

            mockFetch.calledOnce.should.be.true();
            mockFetch.firstCall.args[0].should.containEql("/health");
            result.healthy.should.be.true();
            result.details.should.have.property("policyPath", "v1/data/authz");
        });

        it("should handle fetch errors", async function() {
            const mockFetch = sinon.stub().rejects(new Error("Connection refused"));

            const check = createOpaHealthCheck({
                opaUrl: "http://localhost:8181"
            }, mockFetch);

            const result = await check();

            result.healthy.should.be.false();
            result.message.should.equal("Connection refused");
        });
    });
});
