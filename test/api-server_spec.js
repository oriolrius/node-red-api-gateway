const helper = require("node-red-node-test-helper");
const apiServerNode = require("../nodes/api-server.js");

helper.init(require.resolve("node-red"));

describe("api-server Node", function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it("should be loaded", function (done) {
        const flow = [{ id: "n1", type: "api-server", name: "test name" }];
        helper.load(apiServerNode, flow, function () {
            const n1 = helper.getNode("n1");
            try {
                n1.should.have.property("name", "test name");
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it("should convert payload to lower case", function (done) {
        const flow = [
            { id: "n1", type: "api-server", name: "test name", wires: [["n2"]] },
            { id: "n2", type: "helper" }
        ];
        helper.load(apiServerNode, flow, function () {
            const n1 = helper.getNode("n1");
            const n2 = helper.getNode("n2");
            n2.on("input", function (msg) {
                try {
                    msg.should.have.property("payload", "hello world");
                    done();
                } catch (err) {
                    done(err);
                }
            });
            n1.receive({ payload: "HELLO WORLD" });
        });
    });

    it("should pass through non-string payload unchanged", function (done) {
        const flow = [
            { id: "n1", type: "api-server", name: "test name", wires: [["n2"]] },
            { id: "n2", type: "helper" }
        ];
        helper.load(apiServerNode, flow, function () {
            const n1 = helper.getNode("n1");
            const n2 = helper.getNode("n2");
            n2.on("input", function (msg) {
                try {
                    msg.should.have.property("payload", 123);
                    done();
                } catch (err) {
                    done(err);
                }
            });
            n1.receive({ payload: 123 });
        });
    });
});
