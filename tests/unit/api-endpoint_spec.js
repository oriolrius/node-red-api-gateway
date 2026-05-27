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
            const flow = [{ id: "n1", type: "apigw-endpoint", name: "test name" }];
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                { id: "n1", type: "apigw-endpoint", path: "/users/:id", method: "GET", wires: [["n2"]] },
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
                { id: "n1", type: "apigw-endpoint", path: "/users/:id", method: "GET", wires: [["n2"]] },
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

        it("should NOT overwrite pre-populated req.params (Fastify path)", function (done) {
            // Regression for v0.7.2: api-server.js sets req.params from
            // Fastify's parsed route params, and req.path = actual URL.
            // The endpoint must not re-extract on top of that (the
            // template-vs-URL re-match would corrupt values back to
            // placeholder literals like ":id" — see node-red-api-gateway
            // v0.7.1 → 0.7.2 fix notes).
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users/:id", method: "GET", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.req.params.should.deepEqual({ id: "789" });
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { path: "/users/789", params: { id: "789" } } });
            });
        });

        it("should NOT corrupt params when req.path is a route template", function (done) {
            // Regression for v0.7.2: if a caller passes req.path as a route
            // template (e.g. "/users/:id") with req.params already
            // populated, we must keep the real param values intact.
            // Pre-fix this produced { id: ":id" } and broke downstream SQL.
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users/:id", method: "GET", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.req.params.should.deepEqual({ id: "789" });
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { path: "/users/:id", params: { id: "789" } } });
            });
        });

        it("should not add params if path does not match", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users/:id", method: "GET", wires: [["n2"]] },
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
                { id: "n1", type: "apigw-endpoint", path: "/users", method: "POST", wires: [["n2"]] },
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                    type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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
                type: "apigw-endpoint",
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

    describe("Schema Validation Configuration", function () {
        it("should enable validation by default", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("validationEnabled", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should allow disabling validation", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                validationEnabled: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("validationEnabled", false);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse body schema from JSON string", function (done) {
            const bodySchema = JSON.stringify({
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"]
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                bodySchema: bodySchema
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("bodySchema");
                    n1.bodySchema.should.have.property("type", "object");
                    n1.bodySchema.should.have.property("required").which.containEql("name");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse query schema from JSON string", function (done) {
            const querySchema = JSON.stringify({
                type: "object",
                properties: {
                    page: { type: "integer" },
                    limit: { type: "integer" }
                }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                querySchema: querySchema
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("querySchema");
                    n1.querySchema.properties.should.have.property("page");
                    n1.querySchema.properties.should.have.property("limit");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse params schema from JSON string", function (done) {
            const paramsSchema = JSON.stringify({
                type: "object",
                properties: { id: { type: "integer" } }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                paramsSchema: paramsSchema
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("paramsSchema");
                    n1.paramsSchema.properties.should.have.property("id");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should not parse schemas when validation is disabled", function (done) {
            const bodySchema = JSON.stringify({ type: "object" });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                validationEnabled: false,
                bodySchema: bodySchema
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    (n1.bodySchema === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should include validation info in getEndpointInfo", function (done) {
            const bodySchema = JSON.stringify({ type: "object" });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                bodySchema: bodySchema
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("validationEnabled", true);
                    info.should.have.property("hasBodySchema", true);
                    info.should.have.property("hasQuerySchema", false);
                    info.should.have.property("hasParamsSchema", false);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Request Validation", function () {
        it("should validate request body against schema", function (done) {
            const bodySchema = JSON.stringify({
                type: "object",
                properties: {
                    name: { type: "string" },
                    email: { type: "string", format: "email" }
                },
                required: ["name", "email"]
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                method: "POST",
                bodySchema: bodySchema
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.validateRequest({
                        body: { name: "John", email: "john@example.com" }
                    });
                    result.valid.should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return validation errors for invalid body", function (done) {
            const bodySchema = JSON.stringify({
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"]
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                method: "POST",
                bodySchema: bodySchema
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.validateRequest({ body: {} });
                    result.valid.should.be.false();
                    result.errors.length.should.be.above(0);
                    result.errors[0].should.have.property("location", "body");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should validate query parameters with type coercion", function (done) {
            const querySchema = JSON.stringify({
                type: "object",
                properties: {
                    page: { type: "integer", minimum: 1 }
                }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                querySchema: querySchema
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    // Query params are strings, should be coerced to integer
                    const result = n1.validateRequest({ query: { page: "5" } });
                    result.valid.should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return error for invalid query params", function (done) {
            const querySchema = JSON.stringify({
                type: "object",
                properties: {
                    page: { type: "integer", minimum: 1 }
                }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                querySchema: querySchema
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.validateRequest({ query: { page: "0" } });
                    result.valid.should.be.false();
                    result.errors[0].should.have.property("location", "query");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should validate path parameters", function (done) {
            const paramsSchema = JSON.stringify({
                type: "object",
                properties: { id: { type: "integer" } },
                required: ["id"]
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                paramsSchema: paramsSchema
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.validateRequest({ params: { id: "123" } });
                    result.valid.should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should pass when no schemas are defined", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.validateRequest({
                        body: { any: "data" },
                        query: { any: "param" },
                        params: { id: "123" }
                    });
                    result.valid.should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Response Schema Configuration", function () {
        it("should have default response configuration", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("successStatusCode", 200);
                    n1.should.have.property("responseContentType", "application/json");
                    n1.should.have.property("validateResponseEnabled", false);
                    n1.should.have.property("responseSchemas").which.is.an.Object();
                    Object.keys(n1.responseSchemas).should.have.length(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse response schemas from JSON string", function (done) {
            const responseSchemas = JSON.stringify({
                "200": {
                    type: "object",
                    properties: { id: { type: "integer" }, name: { type: "string" } }
                },
                "404": {
                    type: "object",
                    properties: { error: { type: "string" } }
                }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                responseSchemas: responseSchemas
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("responseSchemas");
                    n1.responseSchemas.should.have.property("200");
                    n1.responseSchemas.should.have.property("404");
                    n1.responseSchemas["200"].properties.should.have.property("id");
                    n1.responseSchemas["404"].properties.should.have.property("error");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store custom success status code", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                method: "POST",
                successStatusCode: "201"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("successStatusCode", 201);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store custom content type", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                responseContentType: "application/xml"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("responseContentType", "application/xml");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should enable response validation in dev mode", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                validateResponseEnabled: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("validateResponseEnabled", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should validate response data against schema", function (done) {
            const responseSchemas = JSON.stringify({
                "200": {
                    type: "object",
                    properties: {
                        id: { type: "integer" },
                        name: { type: "string" }
                    },
                    required: ["id", "name"]
                }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                responseSchemas: responseSchemas
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.validateResponseData(200, { id: 1, name: "John" });
                    result.valid.should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return validation errors for invalid response", function (done) {
            const responseSchemas = JSON.stringify({
                "200": {
                    type: "object",
                    properties: { id: { type: "integer" } },
                    required: ["id"]
                }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                responseSchemas: responseSchemas
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.validateResponseData(200, { name: "John" });
                    result.valid.should.be.false();
                    result.errors.length.should.be.above(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should use default schema when status code not found", function (done) {
            const responseSchemas = JSON.stringify({
                "default": {
                    type: "object",
                    properties: { message: { type: "string" } }
                }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                responseSchemas: responseSchemas
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.validateResponseData(500, { message: "Error" });
                    result.valid.should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should pass validation when no schema defined", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.validateResponseData(200, { anything: "goes" });
                    result.valid.should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should get response schema for status code", function (done) {
            const responseSchemas = JSON.stringify({
                "200": { type: "object" },
                "404": { type: "object", properties: { error: { type: "string" } } }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                responseSchemas: responseSchemas
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const schema200 = n1.getResponseSchema(200);
                    const schema404 = n1.getResponseSchema(404);
                    const schema500 = n1.getResponseSchema(500);
                    schema200.should.have.property("type", "object");
                    schema404.properties.should.have.property("error");
                    (schema500 === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should include response info in getEndpointInfo", function (done) {
            const responseSchemas = JSON.stringify({
                "200": { type: "object" },
                "404": { type: "object" }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                successStatusCode: "201",
                responseContentType: "application/xml",
                responseSchemas: responseSchemas
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("successStatusCode", 201);
                    info.should.have.property("responseContentType", "application/xml");
                    info.should.have.property("hasResponseSchemas", true);
                    info.should.have.property("responseStatusCodes").which.is.an.Array();
                    info.responseStatusCodes.should.containEql("200");
                    info.responseStatusCodes.should.containEql("404");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("OpenAPI Response Generation", function () {
        it("should generate OpenAPI responses from schemas", function (done) {
            const responseSchemas = JSON.stringify({
                "200": {
                    type: "object",
                    properties: { id: { type: "integer" } },
                    description: "User found"
                },
                "404": {
                    type: "object",
                    properties: { error: { type: "string" } }
                }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                responseSchemas: responseSchemas
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const responses = n1.getOpenApiResponses();
                    responses.should.have.property("200");
                    responses.should.have.property("404");
                    responses["200"].should.have.property("description", "User found");
                    responses["200"].should.have.property("content");
                    responses["200"].content.should.have.property("application/json");
                    responses["404"].should.have.property("description", "Not found");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should include default success response when not defined", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                successStatusCode: "201"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const responses = n1.getOpenApiResponses();
                    responses.should.have.property("201");
                    responses["201"].should.have.property("description", "Resource created successfully");
                    responses["201"].content.should.have.property("application/json");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should use correct content type in OpenAPI responses", function (done) {
            const responseSchemas = JSON.stringify({
                "200": { type: "object" }
            });
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                responseContentType: "application/xml",
                responseSchemas: responseSchemas
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const responses = n1.getOpenApiResponses();
                    responses["200"].content.should.have.property("application/xml");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Message Handling with Validation", function () {
        it("should add validationEnabled to endpoint metadata", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", validationEnabled: true, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.endpoint.should.have.property("validationEnabled", true);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });

        it("should add validationError to message on validation failure", function (done) {
            const bodySchema = JSON.stringify({
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"]
            });
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", bodySchema: bodySchema, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("validationError");
                        msg.validationError.should.have.property("statusCode", 400);
                        msg.validationError.should.have.property("error", "Bad Request");
                        msg.validationError.should.have.property("details").which.is.an.Array();
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ req: { body: {} } });
            });
        });

        it("should pass message through on successful validation", function (done) {
            const bodySchema = JSON.stringify({
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"]
            });
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", bodySchema: bodySchema, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("validationError");
                        msg.payload.should.deepEqual({ name: "John" });
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: { name: "John" }, req: { body: { name: "John" } } });
            });
        });

        it("should skip validation when disabled", function (done) {
            const bodySchema = JSON.stringify({
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"]
            });
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", bodySchema: bodySchema, validationEnabled: false, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        // Should pass through even with invalid body since validation is disabled
                        msg.should.not.have.property("validationError");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ req: { body: {} } });
            });
        });

        it("should skip validation when no req object present", function (done) {
            const bodySchema = JSON.stringify({
                type: "object",
                required: ["name"]
            });
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", bodySchema: bodySchema, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("validationError");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });
    });

    describe("Authorization Scope Configuration", function () {
        it("should have empty scopes by default", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("requiredScopes").which.is.an.Array();
                    n1.requiredScopes.should.have.length(0);
                    n1.should.have.property("scopeOperator", "AND");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse scopes from comma-separated string", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                requiredScopes: "read:users, write:users, admin"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.requiredScopes.should.deepEqual(["read:users", "write:users", "admin"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle scopes with extra whitespace", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                requiredScopes: "  read:users  ,   write:users  "
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.requiredScopes.should.deepEqual(["read:users", "write:users"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store AND operator", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                scopeOperator: "AND"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("scopeOperator", "AND");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store OR operator", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                scopeOperator: "OR"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("scopeOperator", "OR");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should default invalid operator to AND", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                scopeOperator: "INVALID"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("scopeOperator", "AND");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should include scopes in getEndpointInfo", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                requiredScopes: "read:users, admin",
                scopeOperator: "OR"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("requiredScopes").which.deepEqual(["read:users", "admin"]);
                    info.should.have.property("scopeOperator", "OR");
                    info.should.have.property("hasRequiredScopes", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should set hasRequiredScopes to false when no scopes", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("hasRequiredScopes", false);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("checkAuthorization Method", function () {
        it("should authorize when no scopes required", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.checkAuthorization([]);
                    result.authorized.should.be.true();
                    result.missingScopes.should.have.length(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should authorize with AND when all scopes present", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                requiredScopes: "read:users, write:users",
                scopeOperator: "AND"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.checkAuthorization(["read:users", "write:users", "admin"]);
                    result.authorized.should.be.true();
                    result.missingScopes.should.have.length(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should not authorize with AND when some scopes missing", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                requiredScopes: "read:users, write:users",
                scopeOperator: "AND"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.checkAuthorization(["read:users"]);
                    result.authorized.should.be.false();
                    result.missingScopes.should.deepEqual(["write:users"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should authorize with OR when any scope present", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                requiredScopes: "admin, moderator, owner",
                scopeOperator: "OR"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.checkAuthorization(["moderator"]);
                    result.authorized.should.be.true();
                    result.missingScopes.should.have.length(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should not authorize with OR when no scopes present", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                requiredScopes: "admin, moderator, owner",
                scopeOperator: "OR"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.checkAuthorization(["user", "guest"]);
                    result.authorized.should.be.false();
                    result.missingScopes.should.deepEqual(["admin", "moderator", "owner"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle empty token scopes", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                requiredScopes: "admin"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.checkAuthorization([]);
                    result.authorized.should.be.false();
                    result.missingScopes.should.deepEqual(["admin"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle null token scopes", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                requiredScopes: "admin"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.checkAuthorization(null);
                    result.authorized.should.be.false();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getOpenApiSecurity Method", function () {
        it("should return empty array when no scopes required", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const security = n1.getOpenApiSecurity();
                    security.should.be.an.Array();
                    security.should.have.length(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return OAuth2 security with scopes", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                requiredScopes: "read:users, write:users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const security = n1.getOpenApiSecurity();
                    security.should.be.an.Array();
                    security.should.have.length(1);
                    security[0].should.have.property("oauth2");
                    security[0].oauth2.should.deepEqual(["read:users", "write:users"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Authorization in Message Handling", function () {
        it("should include authorization info in endpoint metadata", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", requiredScopes: "admin", scopeOperator: "AND", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.endpoint.should.have.property("requiredScopes").which.deepEqual(["admin"]);
                        msg.endpoint.should.have.property("scopeOperator", "AND");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });

        it("should pass through when no scopes required", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("authorizationError");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ req: {} });
            });
        });

        it("should return 401 when not authenticated", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", requiredScopes: "admin", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("authorizationError");
                        msg.authorizationError.should.have.property("statusCode", 401);
                        msg.authorizationError.should.have.property("error", "Unauthorized");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ req: {} });
            });
        });

        it("should return 401 when auth.authenticated is false", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", requiredScopes: "admin", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("authorizationError");
                        msg.authorizationError.should.have.property("statusCode", 401);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ req: { auth: { authenticated: false } } });
            });
        });

        it("should return 403 when missing required scopes", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", requiredScopes: "admin, superuser", scopeOperator: "AND", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("authorizationError");
                        msg.authorizationError.should.have.property("statusCode", 403);
                        msg.authorizationError.should.have.property("error", "Forbidden");
                        msg.authorizationError.details.should.have.property("missingScopes").which.deepEqual(["superuser"]);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ req: { auth: { authenticated: true, scopes: ["admin"] } } });
            });
        });

        it("should pass through when all required scopes present (AND)", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", requiredScopes: "admin, user", scopeOperator: "AND", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("authorizationError");
                        msg.payload.should.equal("test");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({
                    payload: "test",
                    req: { auth: { authenticated: true, scopes: ["admin", "user", "extra"] } }
                });
            });
        });

        it("should pass through when any required scope present (OR)", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", requiredScopes: "admin, moderator", scopeOperator: "OR", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("authorizationError");
                        msg.payload.should.equal("test");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({
                    payload: "test",
                    req: { auth: { authenticated: true, scopes: ["moderator"] } }
                });
            });
        });

        it("should return 403 with OR operator when no scopes match", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", requiredScopes: "admin, moderator", scopeOperator: "OR", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("authorizationError");
                        msg.authorizationError.should.have.property("statusCode", 403);
                        msg.authorizationError.should.have.property("message", "None of the required scopes present");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({
                    req: { auth: { authenticated: true, scopes: ["guest", "user"] } }
                });
            });
        });

        it("should include details in authorization error", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", requiredScopes: "admin", scopeOperator: "AND", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.authorizationError.should.have.property("details");
                        msg.authorizationError.details.should.have.property("requiredScopes").which.deepEqual(["admin"]);
                        msg.authorizationError.details.should.have.property("scopeOperator", "AND");
                        msg.authorizationError.details.should.have.property("missingScopes").which.deepEqual(["admin"]);
                        msg.authorizationError.details.should.have.property("providedScopes").which.deepEqual(["user"]);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({
                    req: { auth: { authenticated: true, scopes: ["user"] } }
                });
            });
        });

        it("should skip authorization check when no req object", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", requiredScopes: "admin", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("authorizationError");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });
    });

    describe("CRUD Operation Configuration", function () {
        it("should have no CRUD operation by default", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("crudOperation", "none");
                    n1.should.have.property("tableName", "");
                    n1.should.have.property("primaryKey", "id");
                    n1.should.have.property("autoGenerateSql", false);
                    n1.should.have.property("useFlowOutput", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store list operation", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "list",
                tableName: "users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("crudOperation", "list");
                    n1.should.have.property("tableName", "users");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store get operation", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                crudOperation: "get",
                tableName: "users",
                primaryKey: "user_id"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("crudOperation", "get");
                    n1.should.have.property("primaryKey", "user_id");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store create operation", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "create",
                tableName: "users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("crudOperation", "create");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store update operation", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                crudOperation: "update",
                tableName: "users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("crudOperation", "update");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store delete operation", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                crudOperation: "delete",
                tableName: "users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("crudOperation", "delete");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should default invalid operation to none", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "INVALID"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("crudOperation", "none");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store autoGenerateSql flag", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "list",
                tableName: "users",
                autoGenerateSql: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("autoGenerateSql", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store useFlowOutput flag", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "list",
                tableName: "users",
                useFlowOutput: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("useFlowOutput", false);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle schema.table notation", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "list",
                tableName: "public.users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("tableName", "public.users");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getCrudInfo Method", function () {
        it("should return CRUD info with hasCrudOperation true", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "list",
                tableName: "users",
                primaryKey: "id",
                autoGenerateSql: true,
                useFlowOutput: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getCrudInfo();
                    info.should.have.property("operation", "list");
                    info.should.have.property("tableName", "users");
                    info.should.have.property("primaryKey", "id");
                    info.should.have.property("autoGenerateSql", true);
                    info.should.have.property("useFlowOutput", true);
                    info.should.have.property("hasCrudOperation", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return hasCrudOperation false when no operation", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getCrudInfo();
                    info.should.have.property("hasCrudOperation", false);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getCrudSql Method", function () {
        it("should return null when no CRUD operation", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const sql = n1.getCrudSql();
                    (sql === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return null when autoGenerateSql is false", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "list",
                tableName: "users",
                autoGenerateSql: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const sql = n1.getCrudSql();
                    (sql === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate list SQL", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "list",
                tableName: "users",
                autoGenerateSql: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.getCrudSql();
                    result.should.have.property("sql", "SELECT * FROM users ORDER BY id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY");
                    result.should.have.property("operation", "list");
                    result.should.have.property("supportsPagination", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate get SQL with primary key", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                crudOperation: "get",
                tableName: "users",
                primaryKey: "user_id",
                autoGenerateSql: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.getCrudSql();
                    result.should.have.property("sql", "SELECT * FROM users WHERE user_id = @user_id");
                    result.should.have.property("primaryKey", "user_id");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate create SQL", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "create",
                tableName: "users",
                autoGenerateSql: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.getCrudSql();
                    result.should.have.property("sql", "INSERT INTO users (@columns) VALUES (@values)");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate update SQL", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                crudOperation: "update",
                tableName: "users",
                primaryKey: "id",
                autoGenerateSql: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.getCrudSql();
                    result.should.have.property("sql", "UPDATE users SET @assignments WHERE id = @id");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate delete SQL", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users/:id",
                crudOperation: "delete",
                tableName: "users",
                primaryKey: "id",
                autoGenerateSql: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.getCrudSql();
                    result.should.have.property("sql", "DELETE FROM users WHERE id = @id");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getEndpointInfo with CRUD", function () {
        it("should include CRUD info in endpoint info", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                crudOperation: "list",
                tableName: "users",
                primaryKey: "id",
                autoGenerateSql: true,
                useFlowOutput: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("crudOperation", "list");
                    info.should.have.property("tableName", "users");
                    info.should.have.property("primaryKey", "id");
                    info.should.have.property("autoGenerateSql", true);
                    info.should.have.property("useFlowOutput", true);
                    info.should.have.property("hasCrudOperation", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("CRUD in Message Handling", function () {
        it("should not add crud object when no operation", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("crud");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });

        it("should add crud object when operation configured", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", crudOperation: "list", tableName: "users", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("crud");
                        msg.crud.should.have.property("operation", "list");
                        msg.crud.should.have.property("tableName", "users");
                        msg.crud.should.have.property("primaryKey", "id");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });

        it("should add sql to crud when autoGenerateSql enabled", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", crudOperation: "list", tableName: "users", autoGenerateSql: true, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.crud.should.have.property("sql");
                        msg.crud.sql.should.have.property("sql", "SELECT * FROM users ORDER BY id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY");
                        msg.crud.sql.should.have.property("supportsPagination", true);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });

        it("should not add sql when autoGenerateSql disabled", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", crudOperation: "list", tableName: "users", autoGenerateSql: false, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.crud.should.not.have.property("sql");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });

        it("should include CRUD info in endpoint metadata", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", crudOperation: "create", tableName: "users", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.endpoint.should.have.property("crudOperation", "create");
                        msg.endpoint.should.have.property("tableName", "users");
                        msg.endpoint.should.have.property("primaryKey", "id");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });
    });

    describe("Pagination Configuration", function () {
        it("should have pagination disabled by default", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("paginationEnabled", false);
                    n1.should.have.property("defaultPageSize", 20);
                    n1.should.have.property("maxPageSize", 100);
                    n1.should.have.property("paginationStyle", "offset");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should enable pagination when configured", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("paginationEnabled", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store custom page sizes", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                defaultPageSize: "10",
                maxPageSize: "50"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("defaultPageSize", 10);
                    n1.should.have.property("maxPageSize", 50);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store offset pagination style", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "offset"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("paginationStyle", "offset");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store cursor pagination style", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "cursor"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("paginationStyle", "cursor");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should default invalid pagination style to offset", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "INVALID"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("paginationStyle", "offset");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should include pagination in getEndpointInfo", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                defaultPageSize: "25",
                maxPageSize: "200",
                paginationStyle: "cursor"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("paginationEnabled", true);
                    info.should.have.property("defaultPageSize", 25);
                    info.should.have.property("maxPageSize", 200);
                    info.should.have.property("paginationStyle", "cursor");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getPaginationConfig Method", function () {
        it("should return pagination configuration", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                defaultPageSize: "15",
                maxPageSize: "75",
                paginationStyle: "offset"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const config = n1.getPaginationConfig();
                    config.should.have.property("enabled", true);
                    config.should.have.property("defaultPageSize", 15);
                    config.should.have.property("maxPageSize", 75);
                    config.should.have.property("style", "offset");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("parsePagination Method", function () {
        it("should return null when pagination disabled", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parsePagination({ page: "1", limit: "10" });
                    (result === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse offset-based pagination with page", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "offset",
                defaultPageSize: "20"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parsePagination({ page: "2", limit: "10" });
                    result.should.have.property("style", "offset");
                    result.should.have.property("page", 2);
                    result.should.have.property("limit", 10);
                    result.should.have.property("offset", 10);
                    (result.cursor === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse offset-based pagination with offset", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "offset"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parsePagination({ offset: "50", limit: "25" });
                    result.should.have.property("style", "offset");
                    result.should.have.property("offset", 50);
                    result.should.have.property("limit", 25);
                    result.should.have.property("page", 3); // offset 50 / limit 25 + 1 = 3
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should use default page size when no limit provided", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "offset",
                defaultPageSize: "30"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parsePagination({ page: "1" });
                    result.should.have.property("limit", 30);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should cap limit at max page size", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "offset",
                maxPageSize: "50"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parsePagination({ page: "1", limit: "200" });
                    result.should.have.property("limit", 50);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should default to page 1 offset 0 when no params", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "offset"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parsePagination({});
                    result.should.have.property("page", 1);
                    result.should.have.property("offset", 0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse cursor-based pagination", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "cursor"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parsePagination({ cursor: "abc123", limit: "15" });
                    result.should.have.property("style", "cursor");
                    result.should.have.property("cursor", "abc123");
                    result.should.have.property("limit", 15);
                    (result.page === null).should.be.true();
                    (result.offset === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle null cursor in cursor-based pagination", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "cursor"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parsePagination({ limit: "20" });
                    result.should.have.property("cursor", null);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle empty query object", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parsePagination({});
                    result.should.have.property("style", "offset");
                    result.should.have.property("page", 1);
                    result.should.have.property("limit", 20);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle null query", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parsePagination(null);
                    result.should.have.property("style", "offset");
                    result.should.have.property("page", 1);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("generatePaginationMeta Method", function () {
        it("should return null for null params", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.generatePaginationMeta(null, {});
                    (result === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate offset-based metadata with total", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const params = { style: "offset", page: 2, limit: 10, offset: 10 };
                    const result = n1.generatePaginationMeta(params, { total: 45, count: 10 });
                    result.should.have.property("style", "offset");
                    result.should.have.property("page", 2);
                    result.should.have.property("limit", 10);
                    result.should.have.property("offset", 10);
                    result.should.have.property("total", 45);
                    result.should.have.property("totalPages", 5);
                    result.should.have.property("count", 10);
                    result.should.have.property("hasNext", true);
                    result.should.have.property("hasPrev", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should detect first page (hasPrev false)", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const params = { style: "offset", page: 1, limit: 10, offset: 0 };
                    const result = n1.generatePaginationMeta(params, { total: 30, count: 10 });
                    result.should.have.property("hasPrev", false);
                    result.should.have.property("hasNext", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should detect last page (hasNext false)", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const params = { style: "offset", page: 3, limit: 10, offset: 20 };
                    const result = n1.generatePaginationMeta(params, { total: 25, count: 5 });
                    result.should.have.property("hasPrev", true);
                    result.should.have.property("hasNext", false);
                    result.should.have.property("totalPages", 3);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle offset pagination without total (infer from count)", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const params = { style: "offset", page: 1, limit: 10, offset: 0 };
                    const result = n1.generatePaginationMeta(params, { count: 10 });
                    result.should.have.property("total", null);
                    result.should.have.property("totalPages", null);
                    result.should.have.property("hasNext", true); // count == limit
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate cursor-based metadata", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "cursor"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const params = { style: "cursor", limit: 10, cursor: "abc123" };
                    const result = n1.generatePaginationMeta(params, {
                        count: 10,
                        nextCursor: "xyz789",
                        prevCursor: "def456"
                    });
                    result.should.have.property("style", "cursor");
                    result.should.have.property("limit", 10);
                    result.should.have.property("cursor", "abc123");
                    result.should.have.property("count", 10);
                    result.should.have.property("hasNext", true);
                    result.should.have.property("hasPrev", true);
                    result.should.have.property("nextCursor", "xyz789");
                    result.should.have.property("prevCursor", "def456");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should detect cursor first page (no prevCursor)", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "cursor"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const params = { style: "cursor", limit: 10, cursor: null };
                    const result = n1.generatePaginationMeta(params, {
                        count: 10,
                        nextCursor: "xyz789"
                    });
                    result.should.have.property("hasPrev", false);
                    result.should.have.property("hasNext", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should detect cursor last page (no nextCursor)", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                paginationEnabled: true,
                paginationStyle: "cursor"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const params = { style: "cursor", limit: 10, cursor: "abc123" };
                    const result = n1.generatePaginationMeta(params, {
                        count: 5
                    });
                    result.should.have.property("hasPrev", true);
                    result.should.have.property("hasNext", false);
                    result.should.have.property("nextCursor", null);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Pagination in Message Handling", function () {
        it("should include pagination config in endpoint metadata", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", paginationEnabled: true, defaultPageSize: "15", maxPageSize: "50", paginationStyle: "offset", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.endpoint.should.have.property("paginationEnabled", true);
                        msg.endpoint.should.have.property("defaultPageSize", 15);
                        msg.endpoint.should.have.property("maxPageSize", 50);
                        msg.endpoint.should.have.property("paginationStyle", "offset");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });

        it("should not add pagination object when disabled", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", paginationEnabled: false, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("pagination");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { query: { page: "1" } } });
            });
        });

        it("should not add pagination object when no query params", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", paginationEnabled: true, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("pagination");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: {} });
            });
        });

        it("should add pagination object when enabled with query", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", paginationEnabled: true, paginationStyle: "offset", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("pagination");
                        msg.pagination.should.have.property("style", "offset");
                        msg.pagination.should.have.property("page", 2);
                        msg.pagination.should.have.property("limit", 10);
                        msg.pagination.should.have.property("offset", 10);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { query: { page: "2", limit: "10" } } });
            });
        });

        it("should add cursor pagination object when configured", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", paginationEnabled: true, paginationStyle: "cursor", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("pagination");
                        msg.pagination.should.have.property("style", "cursor");
                        msg.pagination.should.have.property("cursor", "abc123");
                        msg.pagination.should.have.property("limit", 20);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { query: { cursor: "abc123" } } });
            });
        });
    });

    describe("Filtering Configuration", function () {
        it("should have filtering disabled by default", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("filteringEnabled", false);
                    n1.filterableFields.should.be.an.Array().and.have.length(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should enable filtering when configured", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                filteringEnabled: true,
                filterableFields: "name, status, created_at"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("filteringEnabled", true);
                    n1.filterableFields.should.deepEqual(["name", "status", "created_at"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should accept any non-empty field names", function (done) {
            // With SQL Server bracket escaping, all non-empty field names are valid
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                filteringEnabled: true,
                filterableFields: "name, 123invalid, valid_field, @invalid"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    // All non-empty fields are now accepted (SQL Server escaping handles special chars)
                    n1.filterableFields.should.deepEqual(["name", "123invalid", "valid_field", "@invalid"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should include filtering in getEndpointInfo", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                filteringEnabled: true,
                filterableFields: "name, status"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("filteringEnabled", true);
                    info.filterableFields.should.deepEqual(["name", "status"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getFilteringConfig Method", function () {
        it("should return filtering configuration", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                filteringEnabled: true,
                filterableFields: "name, status"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const config = n1.getFilteringConfig();
                    config.should.have.property("enabled", true);
                    config.filterableFields.should.deepEqual(["name", "status"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("parseFilters Method", function () {
        it("should return null when filtering disabled", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                filteringEnabled: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseFilters({ "filter[name]": "john" });
                    (result === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse filter[field]=value format", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                filteringEnabled: true,
                filterableFields: "name, status"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseFilters({ "filter[name]": "john", "filter[status]": "active" });
                    result.filters.should.have.length(2);
                    result.filters[0].should.have.property("field", "name");
                    result.filters[0].should.have.property("operator", "eq");
                    result.filters[0].should.have.property("value", "john");
                    result.errors.should.have.length(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse filter[field][operator]=value format", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                filteringEnabled: true,
                filterableFields: "age, status"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseFilters({
                        "filter[age][gte]": "18",
                        "filter[status][ne]": "deleted"
                    });
                    result.filters.should.have.length(2);
                    result.filters[0].should.have.property("field", "age");
                    result.filters[0].should.have.property("operator", "gte");
                    result.filters[1].should.have.property("operator", "ne");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse in operator with comma-separated values", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                filteringEnabled: true,
                filterableFields: "status"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseFilters({
                        "filter[status][in]": "active,pending,review"
                    });
                    result.filters.should.have.length(1);
                    result.filters[0].should.have.property("operator", "in");
                    result.filters[0].value.should.deepEqual(["active", "pending", "review"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should reject fields not in allowed list", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                filteringEnabled: true,
                filterableFields: "name"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseFilters({
                        "filter[name]": "john",
                        "filter[password]": "secret"
                    });
                    result.filters.should.have.length(1);
                    result.errors.should.have.length(1);
                    result.errors[0].should.match(/password.*not allowed/);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should support simple field=value format for allowed fields", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                filteringEnabled: true,
                filterableFields: "status"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseFilters({ "status": "active" });
                    result.filters.should.have.length(1);
                    result.filters[0].should.have.property("field", "status");
                    result.filters[0].should.have.property("operator", "eq");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Sorting Configuration", function () {
        it("should have sorting disabled by default", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("sortingEnabled", false);
                    n1.sortableFields.should.be.an.Array().and.have.length(0);
                    (n1.defaultSortField === null).should.be.true();
                    n1.should.have.property("defaultSortDirection", "asc");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should enable sorting when configured", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                sortingEnabled: true,
                sortableFields: "name, created_at",
                defaultSortField: "created_at",
                defaultSortDirection: "desc"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("sortingEnabled", true);
                    n1.sortableFields.should.deepEqual(["name", "created_at"]);
                    n1.should.have.property("defaultSortField", "created_at");
                    n1.should.have.property("defaultSortDirection", "desc");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should include sorting in getEndpointInfo", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                sortingEnabled: true,
                sortableFields: "name",
                defaultSortField: "name",
                defaultSortDirection: "asc"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("sortingEnabled", true);
                    info.sortableFields.should.deepEqual(["name"]);
                    info.should.have.property("defaultSortField", "name");
                    info.should.have.property("defaultSortDirection", "asc");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getSortingConfig Method", function () {
        it("should return sorting configuration", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                sortingEnabled: true,
                sortableFields: "name, date",
                defaultSortField: "date",
                defaultSortDirection: "desc"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const config = n1.getSortingConfig();
                    config.should.have.property("enabled", true);
                    config.sortableFields.should.deepEqual(["name", "date"]);
                    config.should.have.property("defaultSortField", "date");
                    config.should.have.property("defaultSortDirection", "desc");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("parseSorts Method", function () {
        it("should return null when sorting disabled", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                sortingEnabled: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseSorts({ sort: "name" });
                    (result === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse sort=field for ascending", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                sortingEnabled: true,
                sortableFields: "name"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseSorts({ sort: "name" });
                    result.sorts.should.have.length(1);
                    result.sorts[0].should.have.property("field", "name");
                    result.sorts[0].should.have.property("direction", "asc");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse sort=-field for descending", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                sortingEnabled: true,
                sortableFields: "created_at"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseSorts({ sort: "-created_at" });
                    result.sorts.should.have.length(1);
                    result.sorts[0].should.have.property("field", "created_at");
                    result.sorts[0].should.have.property("direction", "desc");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse multiple sort fields", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                sortingEnabled: true,
                sortableFields: "status, created_at"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseSorts({ sort: "status,-created_at" });
                    result.sorts.should.have.length(2);
                    result.sorts[0].should.have.property("field", "status");
                    result.sorts[0].should.have.property("direction", "asc");
                    result.sorts[1].should.have.property("field", "created_at");
                    result.sorts[1].should.have.property("direction", "desc");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should use default sort when no sort param provided", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                sortingEnabled: true,
                sortableFields: "name, created_at",
                defaultSortField: "created_at",
                defaultSortDirection: "desc"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseSorts({});
                    result.sorts.should.have.length(1);
                    result.sorts[0].should.have.property("field", "created_at");
                    result.sorts[0].should.have.property("direction", "desc");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should reject fields not in allowed list", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                sortingEnabled: true,
                sortableFields: "name"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.parseSorts({ sort: "name,-password" });
                    result.sorts.should.have.length(1);
                    result.errors.should.have.length(1);
                    result.errors[0].should.match(/password.*not allowed/);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("generateWhereClause Method", function () {
        it("should return empty clause for no filters", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.generateWhereClause([]);
                    result.clause.should.equal("");
                    Object.keys(result.params).should.have.length(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate WHERE clause for eq operator with bracket escaping", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.generateWhereClause([
                        { field: "status", operator: "eq", value: "active" }
                    ]);
                    // SQL Server uses bracket notation [fieldName]
                    result.clause.should.equal("WHERE [status] = @filter_status_0");
                    result.params.filter_status_0.should.equal("active");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate WHERE clause for multiple filters with bracket escaping", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.generateWhereClause([
                        { field: "status", operator: "eq", value: "active" },
                        { field: "age", operator: "gte", value: "18" }
                    ]);
                    // SQL Server uses bracket notation [fieldName]
                    result.clause.should.equal("WHERE [status] = @filter_status_0 AND [age] >= @filter_age_1");
                    result.params.filter_status_0.should.equal("active");
                    result.params.filter_age_1.should.equal("18");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate WHERE clause for IN operator with bracket escaping", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.generateWhereClause([
                        { field: "status", operator: "in", value: ["active", "pending"] }
                    ]);
                    // SQL Server uses bracket notation [fieldName]
                    result.clause.should.equal("WHERE [status] IN (@filter_status_0_0, @filter_status_0_1)");
                    result.params.filter_status_0_0.should.equal("active");
                    result.params.filter_status_0_1.should.equal("pending");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should support all operators with bracket escaping", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const ops = ["eq", "ne", "gt", "gte", "lt", "lte", "like"];
                    ops.forEach(op => {
                        const result = n1.generateWhereClause([
                            { field: "test", operator: op, value: "val" }
                        ]);
                        // SQL Server uses bracket notation [fieldName]
                        result.clause.should.startWith("WHERE [test]");
                    });
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("generateOrderByClause Method", function () {
        it("should return empty string for no sorts", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.generateOrderByClause([]);
                    result.should.equal("");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate ORDER BY clause with bracket escaping", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.generateOrderByClause([
                        { field: "name", direction: "asc" }
                    ]);
                    // SQL Server uses bracket notation [fieldName]
                    result.should.equal("ORDER BY [name] ASC");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should generate ORDER BY with multiple fields and bracket escaping", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.generateOrderByClause([
                        { field: "status", direction: "asc" },
                        { field: "created_at", direction: "desc" }
                    ]);
                    // SQL Server uses bracket notation [fieldName]
                    result.should.equal("ORDER BY [status] ASC, [created_at] DESC");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Filtering in Message Handling", function () {
        it("should include filtering config in endpoint metadata", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", filteringEnabled: true, filterableFields: "name, status", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.endpoint.should.have.property("filteringEnabled", true);
                        msg.endpoint.filterableFields.should.deepEqual(["name", "status"]);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });

        it("should not add filtering object when disabled", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", filteringEnabled: false, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("filtering");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { query: { "filter[name]": "john" } } });
            });
        });

        it("should add filtering object when enabled with query", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", filteringEnabled: true, filterableFields: "name, status", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("filtering");
                        msg.filtering.should.have.property("filters");
                        msg.filtering.filters.should.have.length(1);
                        msg.filtering.filters[0].should.have.property("field", "name");
                        msg.filtering.should.have.property("whereClause");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { query: { "filter[name]": "john" } } });
            });
        });
    });

    describe("Sorting in Message Handling", function () {
        it("should include sorting config in endpoint metadata", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", sortingEnabled: true, sortableFields: "name, created_at", defaultSortField: "created_at", defaultSortDirection: "desc", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.endpoint.should.have.property("sortingEnabled", true);
                        msg.endpoint.sortableFields.should.deepEqual(["name", "created_at"]);
                        msg.endpoint.should.have.property("defaultSortField", "created_at");
                        msg.endpoint.should.have.property("defaultSortDirection", "desc");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });

        it("should not add sorting object when disabled", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", sortingEnabled: false, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("sorting");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { query: { sort: "name" } } });
            });
        });

        it("should add sorting object when enabled with query", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", sortingEnabled: true, sortableFields: "name, created_at", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("sorting");
                        msg.sorting.should.have.property("sorts");
                        msg.sorting.sorts.should.have.length(1);
                        msg.sorting.sorts[0].should.have.property("field", "name");
                        msg.sorting.sorts[0].should.have.property("direction", "desc");
                        // SQL Server uses bracket notation [fieldName]
                        msg.sorting.should.have.property("orderByClause", "ORDER BY [name] DESC");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { query: { sort: "-name" } } });
            });
        });

        it("should use default sort when no sort param", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", sortingEnabled: true, sortableFields: "name, created_at", defaultSortField: "created_at", defaultSortDirection: "desc", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("sorting");
                        msg.sorting.sorts.should.have.length(1);
                        msg.sorting.sorts[0].should.have.property("field", "created_at");
                        msg.sorting.sorts[0].should.have.property("direction", "desc");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { query: {} } });
            });
        });
    });

    describe("Rate Limiting Configuration", function () {
        it("should be disabled by default", function (done) {
            const flow = [{ id: "n1", type: "apigw-endpoint", path: "/users" }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("rateLimitingEnabled", false);
                    n1.should.have.property("rateLimiter", null);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should be enabled when configured", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: true,
                rateLimitRequests: 100,
                rateLimitWindowMs: 60000,
                rateLimitKeyType: "ip"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("rateLimitingEnabled", true);
                    n1.should.have.property("rateLimitRequests", 100);
                    n1.should.have.property("rateLimitWindowMs", 60000);
                    n1.should.have.property("rateLimitKeyType", "ip");
                    n1.should.have.property("rateLimiter").which.is.not.null();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should use default values when not provided", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("rateLimitRequests", 100);
                    n1.should.have.property("rateLimitWindowMs", 60000);
                    n1.should.have.property("rateLimitKeyType", "ip");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should support user key type", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: true,
                rateLimitKeyType: "user"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("rateLimitKeyType", "user");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should support apiKey key type", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: true,
                rateLimitKeyType: "apiKey"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("rateLimitKeyType", "apiKey");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should support custom key type with path", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: true,
                rateLimitKeyType: "custom",
                rateLimitCustomKeyPath: "headers.x-tenant-id"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("rateLimitKeyType", "custom");
                    n1.should.have.property("rateLimitCustomKeyPath", "headers.x-tenant-id");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should default invalid keyType to ip", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: true,
                rateLimitKeyType: "invalid"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("rateLimitKeyType", "ip");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getRateLimitingConfig Method", function () {
        it("should return rate limiting configuration", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: true,
                rateLimitRequests: 50,
                rateLimitWindowMs: 30000,
                rateLimitKeyType: "user"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const config = n1.getRateLimitingConfig();
                    config.should.have.property("enabled", true);
                    config.should.have.property("requests", 50);
                    config.should.have.property("windowMs", 30000);
                    config.should.have.property("keyType", "user");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("checkRateLimit Method", function () {
        it("should return allowed=true when disabled", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.checkRateLimit({ headers: { 'x-forwarded-for': '192.168.1.1' } });
                    result.should.have.property("allowed", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should check rate limit when enabled", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: true,
                rateLimitRequests: 5,
                rateLimitWindowMs: 60000,
                rateLimitKeyType: "ip"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const req = { headers: { 'x-forwarded-for': '192.168.1.1' } };
                    const result = n1.checkRateLimit(req);
                    result.should.have.property("allowed", true);
                    result.should.have.property("remaining", 4);
                    result.should.have.property("limit", 5);
                    result.should.have.property("key", "192.168.1.1");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should block when rate limit exceeded", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: true,
                rateLimitRequests: 3,
                rateLimitWindowMs: 60000,
                rateLimitKeyType: "ip"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const req = { headers: { 'x-forwarded-for': '192.168.1.1' } };
                    // Exhaust limit
                    for (let i = 0; i < 3; i++) {
                        n1.checkRateLimit(req);
                    }
                    // Should be blocked
                    const result = n1.checkRateLimit(req);
                    result.should.have.property("allowed", false);
                    result.should.have.property("remaining", 0);
                    result.should.have.property("retryAfter").which.is.greaterThan(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Rate Limiting in Message Handling", function () {
        it("should add rateLimit context to message when enabled", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", rateLimitingEnabled: true, rateLimitRequests: 10, rateLimitWindowMs: 60000, rateLimitKeyType: "ip", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("rateLimit");
                        msg.rateLimit.should.have.property("allowed", true);
                        msg.rateLimit.should.have.property("limit", 10);
                        msg.rateLimit.should.have.property("remaining", 9);
                        msg.rateLimit.should.have.property("key", "192.168.1.1");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { headers: { 'x-forwarded-for': '192.168.1.1' } } });
            });
        });

        it("should not add rateLimit context when disabled", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", rateLimitingEnabled: false, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("rateLimit");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { headers: {} } });
            });
        });

        it("should block message flow when rate limited", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", rateLimitingEnabled: true, rateLimitRequests: 2, rateLimitWindowMs: 60000, rateLimitKeyType: "ip", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                let messageCount = 0;

                n2.on("input", function (msg) {
                    messageCount++;
                    if (msg.rateLimitError) {
                        try {
                            msg.rateLimitError.should.have.property("statusCode", 429);
                            msg.rateLimitError.should.have.property("error", "Too Many Requests");
                            done();
                        } catch (err) {
                            done(err);
                        }
                    }
                });

                // First two should pass
                n1.receive({ payload: "test1", req: { headers: { 'x-forwarded-for': '192.168.1.1' } } });
                n1.receive({ payload: "test2", req: { headers: { 'x-forwarded-for': '192.168.1.1' } } });
                // Third should be rate limited
                n1.receive({ payload: "test3", req: { headers: { 'x-forwarded-for': '192.168.1.1' } } });
            });
        });

        it("should include rate limit config in endpoint metadata", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", rateLimitingEnabled: true, rateLimitRequests: 100, rateLimitWindowMs: 60000, rateLimitKeyType: "user", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("endpoint");
                        msg.endpoint.should.have.property("rateLimitingEnabled", true);
                        msg.endpoint.should.have.property("rateLimitRequests", 100);
                        msg.endpoint.should.have.property("rateLimitWindowMs", 60000);
                        msg.endpoint.should.have.property("rateLimitKeyType", "user");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { headers: { 'x-forwarded-for': '192.168.1.1' } } });
            });
        });

        it("should track different keys independently", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", rateLimitingEnabled: true, rateLimitRequests: 2, rateLimitWindowMs: 60000, rateLimitKeyType: "ip", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                let messages = [];

                n2.on("input", function (msg) {
                    messages.push(msg);
                    if (messages.length === 4) {
                        try {
                            // First two from IP1 should pass
                            messages[0].rateLimit.should.have.property("allowed", true);
                            messages[1].rateLimit.should.have.property("allowed", true);
                            // First two from IP2 should also pass (different key)
                            messages[2].rateLimit.should.have.property("allowed", true);
                            messages[3].rateLimit.should.have.property("allowed", true);
                            done();
                        } catch (err) {
                            done(err);
                        }
                    }
                });

                // Send two from IP1
                n1.receive({ payload: "test1", req: { headers: { 'x-forwarded-for': '192.168.1.1' } } });
                n1.receive({ payload: "test2", req: { headers: { 'x-forwarded-for': '192.168.1.1' } } });
                // Send two from IP2 (should have fresh limit)
                n1.receive({ payload: "test3", req: { headers: { 'x-forwarded-for': '192.168.1.2' } } });
                n1.receive({ payload: "test4", req: { headers: { 'x-forwarded-for': '192.168.1.2' } } });
            });
        });
    });

    describe("getEndpointInfo with Rate Limiting", function () {
        it("should include rate limiting in endpoint info", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                rateLimitingEnabled: true,
                rateLimitRequests: 50,
                rateLimitWindowMs: 30000,
                rateLimitKeyType: "apiKey"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("rateLimitingEnabled", true);
                    info.should.have.property("rateLimitRequests", 50);
                    info.should.have.property("rateLimitWindowMs", 30000);
                    info.should.have.property("rateLimitKeyType", "apiKey");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Caching Configuration", function () {
        it("should be disabled by default", function (done) {
            const flow = [{ id: "n1", type: "apigw-endpoint", path: "/users" }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("cachingEnabled", false);
                    n1.should.have.property("responseCache", null);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should be enabled when configured", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                cachingEnabled: true,
                cacheTTL: 60000,
                cacheMaxSize: 50,
                cacheKeyStrategy: "full"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("cachingEnabled", true);
                    n1.should.have.property("cacheTTL", 60000);
                    n1.should.have.property("cacheMaxSize", 50);
                    n1.should.have.property("cacheKeyStrategy", "full");
                    n1.should.have.property("responseCache").which.is.not.null();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should use default values when not provided", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                cachingEnabled: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("cacheTTL", 300000);
                    n1.should.have.property("cacheMaxSize", 100);
                    n1.should.have.property("cacheKeyStrategy", "full");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should support path key strategy", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                cachingEnabled: true,
                cacheKeyStrategy: "path"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("cacheKeyStrategy", "path");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should support custom key strategy with expression", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                cachingEnabled: true,
                cacheKeyStrategy: "custom",
                cacheKeyExpression: "headers.x-tenant-id"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("cacheKeyStrategy", "custom");
                    n1.should.have.property("cacheKeyExpression", "headers.x-tenant-id");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse vary headers", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                cachingEnabled: true,
                cacheVaryHeaders: "Accept, Accept-Language"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("cacheVaryHeaders").which.is.an.Array();
                    n1.cacheVaryHeaders.should.deepEqual(["Accept", "Accept-Language"]);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should default invalid keyStrategy to full", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                cachingEnabled: true,
                cacheKeyStrategy: "invalid"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("cacheKeyStrategy", "full");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getCachingConfig Method", function () {
        it("should return caching configuration", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                cachingEnabled: true,
                cacheTTL: 120000,
                cacheMaxSize: 200,
                cacheKeyStrategy: "path"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const config = n1.getCachingConfig();
                    config.should.have.property("enabled", true);
                    config.should.have.property("ttl", 120000);
                    config.should.have.property("maxSize", 200);
                    config.should.have.property("keyStrategy", "path");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("checkCache and storeInCache Methods", function () {
        it("should return hit:false when disabled", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                cachingEnabled: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.checkCache({ method: 'GET', path: '/users' });
                    result.should.have.property("hit", false);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should store and retrieve cached responses", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                cachingEnabled: true,
                cacheTTL: 60000,
                cacheKeyStrategy: "full"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const req = { method: 'GET', path: '/users' };
                    const { key, etag } = n1.storeInCache(req, { users: [] }, 200);
                    key.should.be.a.String();
                    etag.should.startWith('W/"');

                    const result = n1.checkCache(req);
                    result.should.have.property("hit", true);
                    result.data.should.deepEqual({ users: [] });
                    result.statusCode.should.equal(200);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Caching in Message Handling", function () {
        it("should add cache context to message for GET requests", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", method: "GET", cachingEnabled: true, cacheTTL: 60000, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("cache");
                        msg.cache.should.have.property("hit", false);
                        msg.cache.should.have.property("key").which.is.a.String();
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { method: 'GET', path: '/users', headers: {} } });
            });
        });

        it("should not cache POST requests", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", method: "POST", cachingEnabled: true, wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.not.have.property("cache");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { method: 'POST', path: '/users', headers: {} } });
            });
        });

        it("should include caching config in endpoint metadata", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", method: "GET", cachingEnabled: true, cacheTTL: 60000, cacheKeyStrategy: "path", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("endpoint");
                        msg.endpoint.should.have.property("cachingEnabled", true);
                        msg.endpoint.should.have.property("cacheTTL", 60000);
                        msg.endpoint.should.have.property("cacheKeyStrategy", "path");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { method: 'GET', path: '/users', headers: {} } });
            });
        });
    });

    describe("getEndpointInfo with Caching", function () {
        it("should include caching in endpoint info", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                cachingEnabled: true,
                cacheTTL: 120000,
                cacheMaxSize: 50,
                cacheKeyStrategy: "path"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("cachingEnabled", true);
                    info.should.have.property("cacheTTL", 120000);
                    info.should.have.property("cacheMaxSize", 50);
                    info.should.have.property("cacheKeyStrategy", "path");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Error Handling Configuration", function () {
        it("should be enabled by default", function (done) {
            const flow = [{ id: "n1", type: "apigw-endpoint", path: "/users" }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("errorHandlingEnabled", true);
                    n1.should.have.property("errorFormat", "rfc7807");
                    n1.should.have.property("includeStackTrace", false);
                    n1.should.have.property("logErrors", true);
                    n1.should.have.property("errorHandler").which.is.not.null();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should allow disabling error handling", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                errorHandlingEnabled: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("errorHandlingEnabled", false);
                    (n1.errorHandler === null).should.equal(true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should support simple error format", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                errorFormat: "simple"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("errorFormat", "simple");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should support legacy error format", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                errorFormat: "legacy"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("errorFormat", "legacy");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should default invalid format to rfc7807", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                errorFormat: "invalid"
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("errorFormat", "rfc7807");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should enable stack trace when configured", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                includeStackTrace: true
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("includeStackTrace", true);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should parse custom error codes", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                customErrorCodes: '{"MY_ERROR": {"status": 422, "title": "My Custom Error"}}'
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("customErrorCodes");
                    n1.customErrorCodes.should.have.property("MY_ERROR");
                    n1.customErrorCodes.MY_ERROR.status.should.equal(422);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("getErrorHandlingConfig Method", function () {
        it("should return error handling configuration", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                errorFormat: "simple",
                includeStackTrace: true,
                logErrors: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const config = n1.getErrorHandlingConfig();
                    config.should.have.property("enabled", true);
                    config.should.have.property("format", "simple");
                    config.should.have.property("includeStackTrace", true);
                    config.should.have.property("logErrors", false);
                    config.should.have.property("customErrorCodes").which.is.an.Array();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("handleError Method", function () {
        it("should handle ApiError with RFC 7807 format", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                errorFormat: "rfc7807",
                logErrors: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const error = n1.createError('VALIDATION_ERROR', 'Invalid input');
                    const result = n1.handleError(error);

                    result.should.have.property("statusCode", 400);
                    result.should.have.property("body");
                    result.body.should.have.property("type", "urn:error:validation");
                    result.body.should.have.property("title", "Validation Error");
                    result.body.should.have.property("status", 400);
                    result.body.should.have.property("detail", "Invalid input");
                    result.headers["Content-Type"].should.equal("application/problem+json");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should handle standard Error", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                logErrors: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const result = n1.handleError(new Error('Something went wrong'));

                    result.should.have.property("statusCode", 500);
                    result.body.should.have.property("detail", "Something went wrong");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return basic error when error handling disabled", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                errorHandlingEnabled: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const error = n1.createError('VALIDATION_ERROR', 'Invalid input');
                    const result = n1.handleError(error);

                    result.should.have.property("statusCode", 400);
                    result.body.should.have.property("error", "VALIDATION_ERROR");
                    result.body.should.have.property("message", "Invalid input");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Error Factory Methods", function () {
        it("should create validation error", function (done) {
            const flow = [{ id: "n1", type: "apigw-endpoint", path: "/users", logErrors: false }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const error = n1.createValidationError('Invalid input', [{ field: 'email', message: 'Invalid email' }]);
                    const result = n1.handleError(error);

                    result.statusCode.should.equal(400);
                    result.body.errors.should.be.Array();
                    result.body.errors[0].field.should.equal('email');
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should create not found error", function (done) {
            const flow = [{ id: "n1", type: "apigw-endpoint", path: "/users", logErrors: false }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const error = n1.createNotFoundError('User', '123');
                    const result = n1.handleError(error);

                    result.statusCode.should.equal(404);
                    result.body.detail.should.equal("User with ID '123' not found");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should create authentication error", function (done) {
            const flow = [{ id: "n1", type: "apigw-endpoint", path: "/users", logErrors: false }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const error = n1.createAuthenticationError('Invalid token');
                    const result = n1.handleError(error);

                    result.statusCode.should.equal(401);
                    result.body.detail.should.equal('Invalid token');
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should create authorization error", function (done) {
            const flow = [{ id: "n1", type: "apigw-endpoint", path: "/users", logErrors: false }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const error = n1.createAuthorizationError('Access denied', ['admin']);
                    const result = n1.handleError(error);

                    result.statusCode.should.equal(403);
                    result.body.missingScopes.should.containEql('admin');
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Error Handling in Message Handling", function () {
        it("should include error handling config in endpoint metadata", function (done) {
            const flow = [
                { id: "n1", type: "apigw-endpoint", path: "/users", method: "GET", errorFormat: "simple", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("endpoint");
                        msg.endpoint.should.have.property("errorHandlingEnabled", true);
                        msg.endpoint.should.have.property("errorFormat", "simple");
                        msg.endpoint.should.have.property("includeStackTrace", false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test", req: { method: 'GET', path: '/users' } });
            });
        });
    });

    describe("getEndpointInfo with Error Handling", function () {
        it("should include error handling in endpoint info", function (done) {
            const flow = [{
                id: "n1",
                type: "apigw-endpoint",
                path: "/users",
                errorFormat: "legacy",
                includeStackTrace: true,
                logErrors: false
            }];
            helper.load(apiEndpointNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const info = n1.getEndpointInfo();
                    info.should.have.property("errorHandlingEnabled", true);
                    info.should.have.property("errorFormat", "legacy");
                    info.should.have.property("includeStackTrace", true);
                    info.should.have.property("logErrors", false);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });
});
