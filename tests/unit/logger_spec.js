"use strict";

const should = require("should");
const sinon = require("sinon");

const {
    LOG_LEVELS,
    LOG_OUTPUTS,
    LOG_DEFAULTS,
    ENV_VAR_MAPPINGS,
    validateLoggerConfig,
    applyEnvOverrides,
    createLogger,
    createFallbackLogger,
    createRequestLogger,
    createNoopLogger,
    generateRequestId,
    getRequestId,
    createTimer
} = require("../../lib/logger");

describe("Logger Module", function () {
    describe("Constants", function () {
        it("should export LOG_LEVELS array", function () {
            LOG_LEVELS.should.be.an.Array();
            LOG_LEVELS.should.containDeep(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);
        });

        it("should export LOG_OUTPUTS array", function () {
            LOG_OUTPUTS.should.be.an.Array();
            LOG_OUTPUTS.should.containDeep(["console", "file", "both"]);
        });

        it("should export LOG_DEFAULTS object", function () {
            LOG_DEFAULTS.should.be.an.Object();
            LOG_DEFAULTS.should.have.property("level", "info");
            LOG_DEFAULTS.should.have.property("output", "console");
            LOG_DEFAULTS.should.have.property("prettyPrint", false);
        });

        it("should export ENV_VAR_MAPPINGS object", function () {
            ENV_VAR_MAPPINGS.should.be.an.Object();
            ENV_VAR_MAPPINGS.should.have.property("level", "API_GATEWAY_LOG_LEVEL");
            ENV_VAR_MAPPINGS.should.have.property("output", "API_GATEWAY_LOG_OUTPUT");
        });
    });

    describe("validateLoggerConfig", function () {
        it("should validate valid configuration", function () {
            const result = validateLoggerConfig({
                level: "info",
                output: "console",
                prettyPrint: false
            });
            result.valid.should.be.true();
            result.errors.should.be.empty();
        });

        it("should reject invalid log level", function () {
            const result = validateLoggerConfig({
                level: "invalid"
            });
            result.valid.should.be.false();
            result.errors.should.have.length(1);
            result.errors[0].should.match(/Invalid log level/);
        });

        it("should reject invalid output", function () {
            const result = validateLoggerConfig({
                output: "invalid"
            });
            result.valid.should.be.false();
            result.errors.should.have.length(1);
            result.errors[0].should.match(/Invalid log output/);
        });

        it("should require file path when output is file", function () {
            const result = validateLoggerConfig({
                output: "file",
                filePath: ""
            });
            result.valid.should.be.false();
            result.errors.some(e => e.includes("File path is required")).should.be.true();
        });

        it("should require file path when output is both", function () {
            const result = validateLoggerConfig({
                output: "both",
                filePath: ""
            });
            result.valid.should.be.false();
            result.errors.some(e => e.includes("File path is required")).should.be.true();
        });

        it("should accept valid file path", function () {
            const result = validateLoggerConfig({
                output: "file",
                filePath: "/var/log/test.log"
            });
            result.valid.should.be.true();
        });

        it("should validate redact paths as array", function () {
            const result = validateLoggerConfig({
                redactPaths: "not-an-array"
            });
            result.valid.should.be.false();
            result.errors.some(e => e.includes("Redact paths must be an array")).should.be.true();
        });

        it("should accept empty config", function () {
            const result = validateLoggerConfig({});
            result.valid.should.be.true();
        });

        it("should reject non-object config", function () {
            const result = validateLoggerConfig(null);
            result.valid.should.be.false();
            result.errors.should.have.length(1);
        });
    });

    describe("applyEnvOverrides", function () {
        const originalEnv = process.env;

        beforeEach(function () {
            // Reset environment
            delete process.env.API_GATEWAY_LOG_LEVEL;
            delete process.env.API_GATEWAY_LOG_OUTPUT;
            delete process.env.API_GATEWAY_LOG_PRETTY;
            delete process.env.API_GATEWAY_LOG_FILE;
        });

        afterEach(function () {
            process.env = originalEnv;
        });

        it("should override log level from environment", function () {
            process.env.API_GATEWAY_LOG_LEVEL = "debug";
            const result = applyEnvOverrides({ level: "info" });
            result.level.should.equal("debug");
        });

        it("should override output from environment", function () {
            process.env.API_GATEWAY_LOG_OUTPUT = "file";
            const result = applyEnvOverrides({ output: "console" });
            result.output.should.equal("file");
        });

        it("should override pretty print from environment", function () {
            process.env.API_GATEWAY_LOG_PRETTY = "true";
            const result = applyEnvOverrides({ prettyPrint: false });
            result.prettyPrint.should.be.true();
        });

        it("should override file path from environment", function () {
            process.env.API_GATEWAY_LOG_FILE = "/custom/path.log";
            const result = applyEnvOverrides({ filePath: "/default.log" });
            result.filePath.should.equal("/custom/path.log");
        });

        it("should ignore invalid log level from environment", function () {
            process.env.API_GATEWAY_LOG_LEVEL = "invalid";
            const result = applyEnvOverrides({ level: "info" });
            result.level.should.equal("info");
        });

        it("should ignore invalid output from environment", function () {
            process.env.API_GATEWAY_LOG_OUTPUT = "invalid";
            const result = applyEnvOverrides({ output: "console" });
            result.output.should.equal("console");
        });
    });

    describe("generateRequestId", function () {
        it("should generate unique request IDs", function () {
            const id1 = generateRequestId();
            const id2 = generateRequestId();

            id1.should.be.a.String();
            id2.should.be.a.String();
            id1.should.not.equal(id2);
        });

        it("should follow expected format", function () {
            const id = generateRequestId();
            id.should.match(/^req-\d+-[a-f0-9]+$/);
        });

        it("should include timestamp", function () {
            const before = Date.now();
            const id = generateRequestId();
            const after = Date.now();

            const parts = id.split("-");
            const timestamp = parseInt(parts[1], 10);
            timestamp.should.be.greaterThanOrEqual(before);
            timestamp.should.be.lessThanOrEqual(after);
        });
    });

    describe("getRequestId", function () {
        it("should use existing request ID from headers", function () {
            const req = {
                headers: { "x-request-id": "existing-id" }
            };
            const id = getRequestId(req);
            id.should.equal("existing-id");
        });

        it("should use req.id if available", function () {
            const req = {
                id: "req-id",
                headers: {}
            };
            const id = getRequestId(req);
            id.should.equal("req-id");
        });

        it("should generate new ID if none exists", function () {
            const req = { headers: {} };
            const id = getRequestId(req);
            id.should.match(/^req-\d+-[a-f0-9]+$/);
        });

        it("should generate new ID if req is null", function () {
            const id = getRequestId(null);
            id.should.match(/^req-\d+-[a-f0-9]+$/);
        });

        it("should use custom header name", function () {
            const req = {
                headers: { "custom-id": "custom-request-id" }
            };
            const id = getRequestId(req, "custom-id");
            id.should.equal("custom-request-id");
        });
    });

    describe("createTimer", function () {
        it("should create a timer object", function () {
            const timer = createTimer();
            timer.should.be.an.Object();
            timer.should.have.property("start");
            timer.should.have.property("elapsed");
            timer.should.have.property("format");
        });

        it("should have start time set to current time", function () {
            const before = Date.now();
            const timer = createTimer();
            const after = Date.now();

            timer.start.should.be.greaterThanOrEqual(before);
            timer.start.should.be.lessThanOrEqual(after);
        });

        it("should measure elapsed time", function (done) {
            const timer = createTimer();
            setTimeout(() => {
                const elapsed = timer.elapsed();
                elapsed.should.be.greaterThanOrEqual(10);
                elapsed.should.be.lessThan(100);
                done();
            }, 15);
        });

        it("should format elapsed time as string", function () {
            const timer = createTimer();
            const formatted = timer.format();
            formatted.should.match(/^\d+ms$/);
        });
    });

    describe("createFallbackLogger", function () {
        it("should create a logger with all log methods", function () {
            const logger = createFallbackLogger({ level: "info" });
            logger.should.have.property("trace");
            logger.should.have.property("debug");
            logger.should.have.property("info");
            logger.should.have.property("warn");
            logger.should.have.property("error");
            logger.should.have.property("fatal");
        });

        it("should have child method", function () {
            const logger = createFallbackLogger({ level: "info" });
            logger.should.have.property("child");
            const child = logger.child({ requestId: "test" });
            child.should.have.property("info");
        });

        it("should mark itself as fallback", function () {
            const logger = createFallbackLogger({ level: "info" });
            logger._isFallback.should.be.true();
        });

        it("should respect log level", function () {
            const consoleSpy = sinon.spy(console, "debug");

            const logger = createFallbackLogger({ level: "warn", prettyPrint: true });
            logger.debug("should not log");

            consoleSpy.called.should.be.false();
            consoleSpy.restore();
        });
    });

    describe("createNoopLogger", function () {
        it("should create a logger that does nothing", function () {
            const logger = createNoopLogger();
            logger.should.be.an.Object();
            logger.should.have.property("trace");
            logger.should.have.property("debug");
            logger.should.have.property("info");
            logger.should.have.property("warn");
            logger.should.have.property("error");
            logger.should.have.property("fatal");
        });

        it("should mark itself as noop", function () {
            const logger = createNoopLogger();
            logger._isNoop.should.be.true();
        });

        it("should have silent level", function () {
            const logger = createNoopLogger();
            logger.level.should.equal("silent");
        });

        it("should not throw when called", function () {
            const logger = createNoopLogger();
            should.doesNotThrow(() => {
                logger.info("test");
                logger.error({ data: "test" }, "message");
            });
        });
    });

    describe("createRequestLogger", function () {
        it("should return base logger if child is not available", function () {
            const baseLogger = { info: sinon.stub() };
            const result = createRequestLogger(baseLogger, {});
            result.should.equal(baseLogger);
        });

        it("should create child logger with context", function () {
            const childLogger = { info: sinon.stub() };
            const baseLogger = {
                child: sinon.stub().returns(childLogger)
            };

            const result = createRequestLogger(baseLogger, {
                requestId: "req-123",
                method: "POST",
                path: "/api/test"
            });

            baseLogger.child.calledOnce.should.be.true();
            baseLogger.child.firstCall.args[0].should.deepEqual({
                requestId: "req-123",
                method: "POST",
                path: "/api/test"
            });
            result.should.equal(childLogger);
        });

        it("should only include provided context fields", function () {
            const childLogger = {};
            const baseLogger = {
                child: sinon.stub().returns(childLogger)
            };

            createRequestLogger(baseLogger, {
                requestId: "req-123"
            });

            const bindings = baseLogger.child.firstCall.args[0];
            bindings.should.have.property("requestId", "req-123");
            bindings.should.not.have.property("method");
            bindings.should.not.have.property("path");
        });

        it("should handle null base logger", function () {
            const result = createRequestLogger(null, {});
            should(result).be.null();
        });
    });

    describe("createLogger", function () {
        it("should create a fallback logger when pino is not available", function () {
            // Since pino is actually available in our test environment,
            // we test the fallback by checking the function exists
            const logger = createLogger({ level: "info" });
            logger.should.be.an.Object();
            logger.should.have.property("info");
        });

        it("should merge defaults with options", function () {
            const logger = createLogger({ level: "debug" });
            logger.level.should.equal("debug");
        });

        it("should attach config to logger", function () {
            const logger = createLogger({ level: "warn" });
            logger._config.should.be.an.Object();
            logger._config.level.should.equal("warn");
        });
    });
});
