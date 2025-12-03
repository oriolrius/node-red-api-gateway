const helper = require("node-red-node-test-helper");
const lowerCaseNode = require("../nodes/lower-case.js");

helper.init(require.resolve("node-red"));

describe("lower-case Node", function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it("should be loaded", function (done) {
        const flow = [{ id: "n1", type: "lower-case", name: "test name" }];
        helper.load(lowerCaseNode, flow, function () {
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
            { id: "n1", type: "lower-case", name: "test name", wires: [["n2"]] },
            { id: "n2", type: "helper" }
        ];
        helper.load(lowerCaseNode, flow, function () {
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
            { id: "n1", type: "lower-case", name: "test name", wires: [["n2"]] },
            { id: "n2", type: "helper" }
        ];
        helper.load(lowerCaseNode, flow, function () {
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
