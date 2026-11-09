const helper = require("node-red-node-test-helper");
const path = require("path");
const sinon = require("sinon");
const apiEndpointNode = require("../../nodes/api-endpoint.js");

// tarn is mssql's pool library; resolve it from there, not as a direct dep.
const { TimeoutError } = require(require.resolve("tarn", { paths: [path.dirname(require.resolve("mssql"))] }));

helper.init(require.resolve("node-red"));

// GH-7: a saturated mssql pool (acquire timeout) is a capacity problem.
// Auto-CRUD must answer 503 + Retry-After, not a generic 500.
describe("api-endpoint auto-CRUD pool acquire timeout", function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    function mockRes(onJson) {
        const res = { headers: {}, statusCode: null };
        res.set = (name, value) => { res.headers[name] = value; return res; };
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (body) => { onJson(res, body); return res; };
        return res;
    }

    it("answers 503 service-busy with Retry-After", function (done) {
        const flow = [{
            id: "n1",
            type: "apigw-endpoint",
            path: "/items",
            method: "POST",
            server: "s1",
            crudOperation: "create",
            tableName: "items",
            autoGenerateSql: true,
            useFlowOutput: false
        }];
        helper.load(apiEndpointNode, flow, function () {
            const n1 = helper.getNode("n1");
            const executeCrudOperation = sinon.stub().rejects(new TimeoutError());
            n1.serverNode = {
                configNode: {
                    dbType: "mssql",
                    isSqlServerReady: () => true,
                    executeQuery: sinon.stub(),
                    executeCrudOperation,
                    getLogger: () => null
                }
            };
            const res = mockRes(function (r, body) {
                try {
                    sinon.assert.calledOnce(executeCrudOperation);
                    r.statusCode.should.equal(503);
                    r.headers.should.have.property("Retry-After", "1");
                    body.status.should.equal(503);
                    body.type.should.match(/service-busy$/);
                    done();
                } catch (err) {
                    done(err);
                }
            });
            n1.receive({
                payload: { name: "a" },
                req: { method: "POST", headers: {}, body: { name: "a" }, params: {}, query: {} },
                res
            });
        });
    });
});
