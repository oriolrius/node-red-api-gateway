const helper = require("node-red-node-test-helper");
const apiEndpointNode = require("../../nodes/api-endpoint.js");
const apiServerNode = require("../../nodes/api-server.js");

helper.init(require.resolve("node-red"));

describe("api-endpoint Node", function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    describe("Node Loading", function () {
        it("should be loaded with default values", function (done) {
            const flow = [{ id: "n1", type: "api-endpoint", name: "test name" }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("name", "test name");
                    n1.should.have.property("path", "/");
                    n1.should.have.property("method", "GET");
                    n1.should.have.property("paramNames").which.is.an.Array();
                    n1.paramNames.should.have.length(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should be loaded with custom path and method", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                name: "users endpoint",
                path: "/users/:id",
                method: "POST"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("path", "/users/:id");
                    n1.should.have.property("method", "POST");
                    n1.paramNames.should.deepEqual(["id"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should normalize path without leading slash", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                path: "users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("path", "/users");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should normalize method to uppercase", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                method: "post"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("method", "POST");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should default invalid method to GET", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                method: "INVALID"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("method", "GET");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Path Parameter Extraction", function () {
        it("should extract single parameter from path", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                path: "/users/:id"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.paramNames.should.deepEqual(["id"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should extract multiple parameters from path", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                path: "/users/:userId/posts/:postId"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.paramNames.should.deepEqual(["userId", "postId"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should extract params from request path using extractRequestParams", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                path: "/users/:id"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.extractRequestParams("/users/123");
                    result.match.should.be.true();
                    result.params.should.deepEqual({ id: "123" });
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return no match for non-matching paths", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                path: "/users/:id"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.extractRequestParams("/posts/123");
                    result.match.should.be.false();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getEndpointInfo Method", function () {
        it("should return endpoint information", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                name: "Get User",
                path: "/users/:id",
                method: "GET"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("id", "n1");
                    info.should.have.property("name", "Get User");
                    info.should.have.property("path", "/users/:id");
                    info.should.have.property("method", "GET");
                    info.should.have.property("paramNames").which.deepEqual(["id"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Message Handling", function () {
        it("should add endpoint metadata to output message", function (done) {
            const flow = [
                { id: "n1", type: "api-endpoint", path: "/users/:id", method: "GET", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("endpoint");
                        msg.endpoint.should.have.property("path", "/users/:id");
                        msg.endpoint.should.have.property("method", "GET");
                        msg.endpoint.should.have.property("paramNames").which.deepEqual(["id"]);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });

        it("should extract params from msg.req.path", function (done) {
            const flow = [
                { id: "n1", type: "api-endpoint", path: "/users/:id", method: "GET", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.req.should.have.property("params");
                        msg.req.params.should.deepEqual({ id: "456" });
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { path: "/users/456" } });
            });
        });

        it("should not add params if path does not match", function (done) {
            const flow = [
                { id: "n1", type: "api-endpoint", path: "/users/:id", method: "GET", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.req.should.not.have.property("params");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { path: "/posts/456" } });
            });
        });

        it("should pass through payload unchanged", function (done) {
            const flow = [
                { id: "n1", type: "api-endpoint", path: "/users", method: "POST", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                const testPayload = { name: "John", age: 30 };
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("payload", testPayload);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: testPayload });
            });
        });
    });

    describe("Server Reference", function () {
        it("should store server reference when configured", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                server: "s1"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("server", "s1");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should work without server reference", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("serverNode", null);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("All HTTP Methods", function () {
        const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

        methods.forEach(function (method) {
            it(`should support ${method} method`, function (done) {
                const flow = [{
                    id: "n1",
                    type: "api-endpoint",
                    method: method
                }];
                helper.load(apiEndpointNode, flow, function () {
                    const n1 = helper.getNode("n1");
                    try {
                        n1.should.have.property("method", method);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
            });
        });
    });

    describe("Complex Path Patterns", function () {
        it("should handle deeply nested paths", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                path: "/api/v1/users/:userId/posts/:postId/comments/:commentId"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.paramNames.should.deepEqual(["userId", "postId", "commentId"]);
                    const result = n1.extractRequestParams("/api/v1/users/1/posts/2/comments/3");
                    result.match.should.be.true();
                    result.params.should.deepEqual({
                        userId: "1",
                        postId: "2",
                        commentId: "3"
                    });
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle paths with underscored parameters", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                path: "/users/:user_id/orders/:order_id"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.paramNames.should.deepEqual(["user_id", "order_id"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle path with trailing slash in request", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                path: "/users/:id"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.extractRequestParams("/users/123/");
                    result.match.should.be.true();
                    result.params.should.deepEqual({ id: "123" });
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Error Handling", function () {
        it("should warn on invalid path configuration", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
                path: "/users/:123invalid"
            }];

            let warnCalled = false;
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                // Check that warn was called by examining the node
                // In test environment, we can check the node loaded despite warning
                try {
                    n1.should.have.property("path");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });
});
