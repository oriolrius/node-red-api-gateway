const helper = require("node-red-node-test-helper");
const sinon = require("sinon");
const apiEndpointNode = require("../../nodes/api-endpoint.js");

helper.init(require.resolve("node-red"));

describe("api-endpoint msg.db exposure", function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    function loadWithServer(serverNode, callback) {
        const flow = [
            { id: "n1", type: "apigw-endpoint", path: "/x", method: "GET", server: "s1", wires: [["n2"]] },
            { id: "n2", type: "helper" }
        ];
        helper.load(apiEndpointNode, flow, function () {
            const n1 = helper.getNode("n1");
            const n2 = helper.getNode("n2");
            // Endpoint resolved server via RED.nodes.getNode("s1") which returned
            // null (no config node registered). Inject a fake serverNode whose
            // configNode is whatever the test wants.
            n1.serverNode = serverNode;
            callback(n1, n2);
        });
    }

    it("attaches msg.db when configNode has dbType=mssql and executeQuery", function (done) {
        const executeQuery = sinon.stub().resolves({ recordset: [{ one: 1 }] });
        const isSqlServerReady = sinon.stub().returns(true);
        const configNode = {
            dbType: "mssql",
            executeQuery,
            isSqlServerReady,
            getLogger: () => null
        };
        loadWithServer({ configNode }, function (n1, n2) {
            n2.on("input", async function (msg) {
                try {
                    msg.should.have.property("db");
                    msg.db.should.have.property("executeQuery").which.is.a.Function();
                    msg.db.should.have.property("isReady").which.is.a.Function();
                    msg.db.isReady().should.be.true();
                    const r = await msg.db.executeQuery("SELECT 1 AS one");
                    r.recordset[0].one.should.equal(1);
                    sinon.assert.calledOnce(executeQuery);
                    sinon.assert.calledWith(executeQuery, "SELECT 1 AS one");
                    done();
                } catch (err) {
                    done(err);
                }
            });
            n1.receive({ payload: "test" });
        });
    });

    it("does not attach msg.db when no configNode is present on serverNode", function (done) {
        loadWithServer({ configNode: null }, function (n1, n2) {
            n2.on("input", function (msg) {
                try {
                    msg.should.not.have.property("db");
                    done();
                } catch (err) {
                    done(err);
                }
            });
            n1.receive({ payload: "test" });
        });
    });

    it("does not attach msg.db when dbType is not mssql", function (done) {
        const configNode = {
            dbType: "postgres",
            executeQuery: sinon.stub(),
            isSqlServerReady: () => false,
            getLogger: () => null
        };
        loadWithServer({ configNode }, function (n1, n2) {
            n2.on("input", function (msg) {
                try {
                    msg.should.not.have.property("db");
                    done();
                } catch (err) {
                    done(err);
                }
            });
            n1.receive({ payload: "test" });
        });
    });

    it("does not attach msg.db when configNode lacks executeQuery", function (done) {
        const configNode = {
            dbType: "mssql",
            // no executeQuery method
            isSqlServerReady: () => true,
            getLogger: () => null
        };
        loadWithServer({ configNode }, function (n1, n2) {
            n2.on("input", function (msg) {
                try {
                    msg.should.not.have.property("db");
                    done();
                } catch (err) {
                    done(err);
                }
            });
            n1.receive({ payload: "test" });
        });
    });

    it("msg.db.isReady reflects configNode.isSqlServerReady at call time", function (done) {
        let ready = false;
        const configNode = {
            dbType: "mssql",
            executeQuery: sinon.stub().resolves({ recordset: [] }),
            isSqlServerReady: () => ready,
            getLogger: () => null
        };
        loadWithServer({ configNode }, function (n1, n2) {
            n2.on("input", function (msg) {
                try {
                    msg.db.isReady().should.be.false();
                    ready = true;
                    msg.db.isReady().should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
            n1.receive({ payload: "test" });
        });
    });

    it("msg.db.isReady falls back to false when configNode lacks isSqlServerReady", function (done) {
        const configNode = {
            dbType: "mssql",
            executeQuery: sinon.stub().resolves({ recordset: [] }),
            // no isSqlServerReady
            getLogger: () => null
        };
        loadWithServer({ configNode }, function (n1, n2) {
            n2.on("input", function (msg) {
                try {
                    msg.should.have.property("db");
                    msg.db.isReady().should.be.false();
                    done();
                } catch (err) {
                    done(err);
                }
            });
            n1.receive({ payload: "test" });
        });
    });
});
