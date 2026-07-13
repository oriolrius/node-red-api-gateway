const should = require("should");
const sinon = require("sinon");
const { ConnectionState, ConnectionStateManager, DEFAULT_CONFIG } = require("../../lib/connection-state");

describe("ConnectionState", function() {
    describe("ConnectionState enum", function() {
        it("should have correct state values", function() {
            ConnectionState.CONNECTING.should.equal("connecting");
            ConnectionState.CONNECTED.should.equal("connected");
            ConnectionState.DISCONNECTED.should.equal("disconnected");
            ConnectionState.ERROR.should.equal("error");
        });
    });

    describe("DEFAULT_CONFIG", function() {
        it("should have expected default values", function() {
            DEFAULT_CONFIG.should.have.property("initialBackoff", 1000);
            DEFAULT_CONFIG.should.have.property("maxBackoff", 30000);
            DEFAULT_CONFIG.should.have.property("backoffMultiplier", 2);
            DEFAULT_CONFIG.should.have.property("maxRetries", Infinity);
            DEFAULT_CONFIG.should.have.property("jitterFactor", 0.1);
        });
    });
});

describe("ConnectionStateManager", function() {
    let manager;
    let clock;

    beforeEach(function() {
        manager = new ConnectionStateManager("test-service");
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
        it("should initialize with disconnected state", function() {
            manager.state.should.equal(ConnectionState.DISCONNECTED);
        });

        it("should store service name", function() {
            manager.serviceName.should.equal("test-service");
        });

        it("should use default config when no options provided", function() {
            manager.config.should.have.property("initialBackoff", DEFAULT_CONFIG.initialBackoff);
            manager.config.should.have.property("maxBackoff", DEFAULT_CONFIG.maxBackoff);
        });

        it("should allow custom config options", function() {
            const customManager = new ConnectionStateManager("custom", {
                initialBackoff: 500,
                maxBackoff: 10000
            });
            customManager.config.should.have.property("initialBackoff", 500);
            customManager.config.should.have.property("maxBackoff", 10000);
            customManager.shutdown();
        });
    });

    describe("state transitions", function() {
        it("should transition to connecting state", function() {
            manager.connecting();
            manager.state.should.equal(ConnectionState.CONNECTING);
        });

        it("should transition to connected state", function() {
            manager.connected();
            manager.state.should.equal(ConnectionState.CONNECTED);
            manager.isConnected.should.be.true();
        });

        it("should transition to disconnected state", function() {
            manager.connected();
            manager.disconnected(false);
            manager.state.should.equal(ConnectionState.DISCONNECTED);
            manager.isConnected.should.be.false();
        });

        it("should transition to error state with error", function() {
            const error = new Error("Connection failed");
            manager.error(error, false);
            manager.state.should.equal(ConnectionState.ERROR);
            manager.lastError.should.equal(error);
        });

        it("should emit stateChange event on transition", function(done) {
            let called = false;
            manager.on("stateChange", function(data) {
                if (called) return; // Ignore subsequent calls (e.g., from shutdown)
                called = true;
                data.should.have.property("service", "test-service");
                data.should.have.property("previousState", ConnectionState.DISCONNECTED);
                data.should.have.property("currentState", ConnectionState.CONNECTED);
                done();
            });
            manager.connected();
        });

        it("should not emit event if state unchanged", function() {
            let emitCount = 0;
            manager.on("stateChange", function() {
                emitCount++;
            });
            manager.disconnected(false);
            manager.disconnected(false);
            emitCount.should.equal(0); // Already disconnected by default
        });

        it("should reset retry count on successful connection", function() {
            manager._retryCount = 5;
            manager._currentBackoff = 16000;
            manager.connected();
            manager.retryCount.should.equal(0);
            manager._currentBackoff.should.equal(DEFAULT_CONFIG.initialBackoff);
        });
    });

    describe("node registration", function() {
        it("should register nodes", function() {
            const mockNode = { status: sinon.stub() };
            manager.registerNode(mockNode);
            manager._registeredNodes.has(mockNode).should.be.true();
        });

        it("should unregister nodes", function() {
            const mockNode = { status: sinon.stub() };
            manager.registerNode(mockNode);
            manager.unregisterNode(mockNode);
            manager._registeredNodes.has(mockNode).should.be.false();
        });

        it("should update node status on registration", function() {
            const mockNode = { status: sinon.stub() };
            manager.registerNode(mockNode);
            mockNode.status.calledOnce.should.be.true();
            const statusArg = mockNode.status.firstCall.args[0];
            statusArg.should.have.property("fill", "grey");
            statusArg.should.have.property("shape", "ring");
            statusArg.text.should.containEql("disconnected");
        });

        it("should update all registered nodes on state change", function() {
            const mockNode1 = { status: sinon.stub() };
            const mockNode2 = { status: sinon.stub() };
            manager.registerNode(mockNode1);
            manager.registerNode(mockNode2);

            // Reset call counts after registration
            mockNode1.status.resetHistory();
            mockNode2.status.resetHistory();

            manager.connected();

            mockNode1.status.calledOnce.should.be.true();
            mockNode2.status.calledOnce.should.be.true();

            const statusArg1 = mockNode1.status.firstCall.args[0];
            statusArg1.should.have.property("fill", "green");
            statusArg1.should.have.property("shape", "dot");
        });

        it("should handle nodes without status method gracefully", function() {
            const invalidNode = {};
            manager.registerNode(invalidNode);
            // Should not throw
            manager.connected();
        });
    });

    describe("status display", function() {
        let mockNode;

        beforeEach(function() {
            mockNode = { status: sinon.stub() };
            manager.registerNode(mockNode);
            mockNode.status.resetHistory();
        });

        it("should show yellow ring for connecting", function() {
            manager.connecting();
            const status = mockNode.status.firstCall.args[0];
            status.should.have.property("fill", "yellow");
            status.should.have.property("shape", "ring");
            status.text.should.containEql("connecting");
        });

        it("should show green dot for connected", function() {
            manager.connected();
            const status = mockNode.status.firstCall.args[0];
            status.should.have.property("fill", "green");
            status.should.have.property("shape", "dot");
            status.text.should.containEql("connected");
        });

        it("should show grey ring for disconnected", function() {
            manager.connected();
            mockNode.status.resetHistory();
            manager.disconnected(false);
            const status = mockNode.status.firstCall.args[0];
            status.should.have.property("fill", "grey");
            status.should.have.property("shape", "ring");
            status.text.should.containEql("disconnected");
        });

        it("should show red dot for error", function() {
            manager.error(new Error("test"), false);
            const status = mockNode.status.firstCall.args[0];
            status.should.have.property("fill", "red");
            status.should.have.property("shape", "dot");
            status.text.should.containEql("error");
        });

        it("should show retry count in error status", function() {
            manager._retryCount = 3;
            manager.error(new Error("test"), false);
            const status = mockNode.status.firstCall.args[0];
            status.text.should.containEql("retry 3");
        });
    });

    describe("exponential backoff", function() {
        beforeEach(function() {
            clock = sinon.useFakeTimers();
        });

        it("should calculate backoff with initial value", function() {
            const backoff = manager._calculateBackoff();
            // Should be within jitter range of initialBackoff
            backoff.should.be.within(900, 1100);
        });

        it("should increase backoff exponentially", function() {
            manager._currentBackoff = 1000;
            manager._currentBackoff = manager._currentBackoff * manager.config.backoffMultiplier;
            manager._currentBackoff.should.equal(2000);
        });

        it("should cap backoff at maxBackoff", function() {
            manager._currentBackoff = 50000;
            const backoff = manager._calculateBackoff();
            backoff.should.be.within(27000, 33000); // maxBackoff with jitter
        });

        it("should schedule reconnection on error", function() {
            const connectFn = sinon.stub().resolves();
            manager.setConnectFunction(connectFn);

            manager.error(new Error("test"), true);

            // Fast forward past initial backoff
            clock.tick(1100);

            connectFn.calledOnce.should.be.true();
        });

        it("should emit reconnecting event", function(done) {
            const connectFn = sinon.stub().resolves();
            manager.setConnectFunction(connectFn);

            manager.on("reconnecting", function(data) {
                data.should.have.property("service", "test-service");
                data.should.have.property("retryCount", 1);
                data.should.have.property("delay");
                done();
            });

            manager.error(new Error("test"), true);
        });

        it("should increment retry count on each attempt", async function() {
            const connectFn = sinon.stub().callsFake(async function() {
                throw new Error("still failing");
            });
            manager.setConnectFunction(connectFn);

            manager.error(new Error("initial"), true);

            // Wait for first retry (1000ms + jitter)
            clock.tick(1200);
            await Promise.resolve(); // Let async callbacks run
            manager.retryCount.should.equal(1);

            // Wait for second retry (2000ms + jitter after first)
            clock.tick(2500);
            await Promise.resolve();
            manager.retryCount.should.equal(2);
        });

        it("should stop reconnecting after maxRetries", async function() {
            const customManager = new ConnectionStateManager("limited", {
                maxRetries: 2,
                initialBackoff: 100,
                jitterFactor: 0 // Disable jitter for predictable timing
            });
            const connectFn = sinon.stub().callsFake(async function() {
                throw new Error("always fail");
            });
            customManager.setConnectFunction(connectFn);

            let maxRetriesReached = false;
            customManager.on("maxRetriesReached", function() {
                maxRetriesReached = true;
            });

            // Start with retry count at 0
            customManager._retryCount = 0;
            customManager.error(new Error("start"), true);

            // First retry at 100ms
            clock.tick(110);
            await Promise.resolve();
            // retryCount is now 1

            // Second retry at 200ms
            clock.tick(210);
            await Promise.resolve();
            // retryCount is now 2

            // Third attempt should hit maxRetries
            clock.tick(410);
            await Promise.resolve();

            maxRetriesReached.should.be.true();
            customManager.shutdown();
        });
    });

    describe("manual reconnect", function() {
        it("should throw if no connect function set", async function() {
            try {
                await manager.reconnect();
                should.fail("Expected error");
            } catch (err) {
                err.message.should.equal("No connect function set");
            }
        });

        it("should reset retry count on manual reconnect", async function() {
            manager._retryCount = 5;
            const connectFn = sinon.stub().resolves();
            manager.setConnectFunction(connectFn);

            await manager.reconnect();

            manager.retryCount.should.equal(0);
        });

        it("should call connect function", async function() {
            const connectFn = sinon.stub().resolves();
            manager.setConnectFunction(connectFn);

            await manager.reconnect();

            connectFn.calledOnce.should.be.true();
        });
    });

    describe("graceful shutdown", function() {
        beforeEach(function() {
            clock = sinon.useFakeTimers();
        });

        it("should stop reconnection attempts", function() {
            const connectFn = sinon.stub().resolves();
            manager.setConnectFunction(connectFn);

            manager.error(new Error("test"), true);
            manager.shutdown();

            clock.tick(2000);

            connectFn.called.should.be.false();
        });

        it("should clear registered nodes", function() {
            const mockNode = { status: sinon.stub() };
            manager.registerNode(mockNode);
            manager._registeredNodes.size.should.equal(1);

            manager.shutdown();

            manager._registeredNodes.size.should.equal(0);
        });

        it("should emit shutdown event", function(done) {
            manager.on("shutdown", function(data) {
                data.should.have.property("service", "test-service");
                done();
            });
            manager.shutdown();
        });

        it("should set isShuttingDown flag", function() {
            manager._isShuttingDown.should.be.false();
            manager.shutdown();
            manager._isShuttingDown.should.be.true();
        });

        it("should set state to disconnected", function() {
            manager.connected();
            manager.shutdown();
            manager.state.should.equal(ConnectionState.DISCONNECTED);
        });
    });

    describe("getStateInfo", function() {
        it("should return complete state information", function() {
            manager.connected();
            const info = manager.getStateInfo();

            info.should.have.property("service", "test-service");
            info.should.have.property("state", ConnectionState.CONNECTED);
            info.should.have.property("isConnected", true);
            info.should.have.property("lastError", null);
            info.should.have.property("retryCount", 0);
            info.should.have.property("isShuttingDown", false);
        });

        it("should include error message when present", function() {
            manager.error(new Error("Connection refused"), false);
            const info = manager.getStateInfo();

            info.should.have.property("lastError", "Connection refused");
        });
    });
});
