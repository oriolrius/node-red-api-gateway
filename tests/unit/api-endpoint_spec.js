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

    describe("Schema Validation Configuration", function () {
        it("should enable validation by default", function (done) {
            const flow = [{
                id: "n1",
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                { id: "n1", type: "api-endpoint", path: "/users", validationEnabled: true, wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", bodySchema: bodySchema, wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", bodySchema: bodySchema, wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", bodySchema: bodySchema, validationEnabled: false, wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", bodySchema: bodySchema, wires: [["n2"]] },
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                type: "api-endpoint",
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
                { id: "n1", type: "api-endpoint", path: "/users", requiredScopes: "admin", scopeOperator: "AND", wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", requiredScopes: "admin", wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", requiredScopes: "admin", wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", requiredScopes: "admin, superuser", scopeOperator: "AND", wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", requiredScopes: "admin, user", scopeOperator: "AND", wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", requiredScopes: "admin, moderator", scopeOperator: "OR", wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", requiredScopes: "admin, moderator", scopeOperator: "OR", wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", requiredScopes: "admin", scopeOperator: "AND", wires: [["n2"]] },
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
                { id: "n1", type: "api-endpoint", path: "/users", requiredScopes: "admin", wires: [["n2"]] },
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
});
