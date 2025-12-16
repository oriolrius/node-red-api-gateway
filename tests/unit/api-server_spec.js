const helper = require("node-red-node-test-helper");
const apiServerNode = require("../../nodes/api-server.js");
const apiConfigNode = require("../../nodes/api-config.js");
const apiEndpointNode = require("../../nodes/api-endpoint.js");

helper.init(require.resolve("node-red"));

describe("api-server Node", function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    describe("Node Loading", function () {
        it("should be loaded with default values", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test name" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("name", "test name");
                    n1.should.have.property("port", 3000);
                    n1.should.have.property("host", "0.0.0.0");
                    n1.should.have.property("openapiEnabled", true);
                    n1.should.have.property("openapiPath", "/openapi.json");
                    n1.should.have.property("swaggerUiEnabled", false);
                    n1.should.have.property("swaggerUiPath", "/docs");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should be loaded with custom configuration", function (done) {
            const flow = [{
                id: "n1",
                type: "api-server",
                name: "custom server",
                port: 8080,
                host: "127.0.0.1",
                openapiEnabled: true,
                openapiPath: "/api-spec.json",
                swaggerUiEnabled: true,
                swaggerUiPath: "/documentation"
            }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("port", 8080);
                    n1.should.have.property("host", "127.0.0.1");
                    n1.should.have.property("openapiPath", "/api-spec.json");
                    n1.should.have.property("swaggerUiEnabled", true);
                    n1.should.have.property("swaggerUiPath", "/documentation");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("OpenAPI Generator", function () {
        it("should have OpenAPI generator initialized", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("openapiGenerator");
                    n1.openapiGenerator.should.not.be.null();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should have getOpenApiSpec method", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("getOpenApiSpec");
                    const spec = n1.getOpenApiSpec();
                    spec.should.have.property("openapi", "3.0.3");
                    spec.should.have.property("info");
                    spec.should.have.property("paths");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should have getOpenApiJSON method", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const json = n1.getOpenApiJSON();
                    json.should.be.a.String();
                    const parsed = JSON.parse(json);
                    parsed.should.have.property("openapi");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should have getOpenApiYAML method", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const yaml = n1.getOpenApiYAML();
                    yaml.should.be.a.String();
                    yaml.length.should.be.greaterThan(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Endpoint Registration", function () {
        it("should have registerEndpoint method", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("registerEndpoint");
                    (typeof n1.registerEndpoint).should.equal("function");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should have unregisterEndpoint method", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("unregisterEndpoint");
                    (typeof n1.unregisterEndpoint).should.equal("function");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should track endpoint count", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.getEndpointCount().should.equal(0);

                    // Mock endpoint
                    const mockEndpoint = {
                        id: "ep1",
                        path: "/users",
                        method: "GET",
                        getEndpointInfo: function () {
                            return {
                                id: "ep1",
                                name: "List Users",
                                path: "/users",
                                method: "GET",
                                paramNames: []
                            };
                        }
                    };

                    n1.registerEndpoint(mockEndpoint);
                    n1.getEndpointCount().should.equal(1);

                    n1.unregisterEndpoint(mockEndpoint);
                    n1.getEndpointCount().should.equal(0);

                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should include registered endpoints in OpenAPI spec", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    // Mock endpoint
                    const mockEndpoint = {
                        id: "ep1",
                        path: "/users",
                        method: "GET",
                        getEndpointInfo: function () {
                            return {
                                id: "ep1",
                                name: "List Users",
                                path: "/users",
                                method: "GET",
                                paramNames: [],
                                successStatusCode: 200
                            };
                        }
                    };

                    n1.registerEndpoint(mockEndpoint);

                    const spec = n1.getOpenApiSpec();
                    spec.paths.should.have.property("/users");
                    spec.paths["/users"].should.have.property("get");

                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should return endpoints info", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    const mockEndpoint = {
                        id: "ep1",
                        path: "/users",
                        method: "GET",
                        getEndpointInfo: function () {
                            return {
                                id: "ep1",
                                name: "List Users",
                                path: "/users",
                                method: "GET"
                            };
                        }
                    };

                    n1.registerEndpoint(mockEndpoint);
                    const endpointsInfo = n1.getEndpointsInfo();

                    endpointsInfo.should.be.an.Array();
                    endpointsInfo.should.have.length(1);
                    endpointsInfo[0].should.have.property("id", "ep1");
                    endpointsInfo[0].should.have.property("path", "/users");

                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Config Node Integration", function () {
        it("should use settings from config node", function (done) {
            const flow = [
                {
                    id: "c1",
                    type: "api-config",
                    name: "Test Config",
                    apiVersion: "v1",
                    apiBasePath: "/api",
                    apiVersionInPath: true,
                    openapiTitle: "My API",
                    openapiDescription: "My API Description"
                },
                {
                    id: "n1",
                    type: "api-server",
                    name: "test",
                    config: "c1"
                }
            ];
            helper.load([apiServerNode, apiConfigNode], flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("configNode");
                    n1.configNode.should.not.be.null();

                    const spec = n1.getOpenApiSpec();
                    spec.info.should.have.property("title", "My API");
                    spec.info.should.have.property("description", "My API Description");

                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should include basePath from config node in paths", function (done) {
            const flow = [
                {
                    id: "c1",
                    type: "api-config",
                    name: "Test Config",
                    apiVersion: "v1",
                    apiBasePath: "/api",
                    apiVersionInPath: true
                },
                {
                    id: "n1",
                    type: "api-server",
                    name: "test",
                    config: "c1"
                }
            ];
            helper.load([apiServerNode, apiConfigNode], flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    // Mock endpoint
                    const mockEndpoint = {
                        id: "ep1",
                        getEndpointInfo: function () {
                            return {
                                id: "ep1",
                                name: "List Users",
                                path: "/users",
                                method: "GET",
                                paramNames: []
                            };
                        }
                    };

                    n1.registerEndpoint(mockEndpoint);

                    const spec = n1.getOpenApiSpec();
                    spec.paths.should.have.property("/api/v1/users");

                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Message Handling", function () {
        it("should pass through payload unchanged", function (done) {
            const flow = [
                { id: "n1", type: "api-server", name: "test", wires: [["n2"]] },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("payload", "test message");
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test message" });
            });
        });

        it("should add server info to message", function (done) {
            const flow = [
                {
                    id: "n1",
                    type: "api-server",
                    name: "test",
                    port: 8080,
                    host: "localhost",
                    wires: [["n2"]]
                },
                { id: "n2", type: "helper" }
            ];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                const n2 = helper.getNode("n2");
                n2.on("input", function (msg) {
                    try {
                        msg.should.have.property("server");
                        msg.server.should.have.property("host", "localhost");
                        msg.server.should.have.property("port", 8080);
                        msg.server.should.have.property("endpointCount", 0);
                        msg.server.should.have.property("openapiEnabled", true);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                n1.receive({ payload: "test" });
            });
        });
    });

    describe("Cleanup", function () {
        it("should clear endpoints when cleared manually", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    // Register an endpoint
                    n1.registerEndpoint({
                        id: "ep1",
                        getEndpointInfo: () => ({ id: "ep1", path: "/test", method: "GET", paramNames: [] })
                    });

                    n1.getEndpointCount().should.equal(1);

                    // Clear the endpoints map directly (simulates what close does)
                    n1.endpoints.clear();
                    n1.getEndpointCount().should.equal(0);

                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Route Registration", function () {
        it("should have registeredRoutes map", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("registeredRoutes");
                    n1.registeredRoutes.should.be.instanceof(Map);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should have pendingEndpoints array", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    n1.should.have.property("pendingEndpoints");
                    n1.pendingEndpoints.should.be.instanceof(Array);
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should queue endpoints when server not started", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    // Immediately check pending (before server starts)
                    // Force serverStarted to false to simulate pre-start
                    n1.serverStarted = false;
                    n1.fastify = null;

                    const mockEndpoint = {
                        id: "ep1",
                        path: "/users",
                        method: "GET",
                        requiredScopes: [],
                        getEndpointInfo: function () {
                            return {
                                id: "ep1",
                                name: "List Users",
                                path: "/users",
                                method: "GET",
                                paramNames: []
                            };
                        }
                    };

                    n1.registerEndpoint(mockEndpoint);

                    // Should be queued since server not started
                    n1.pendingEndpoints.should.have.length(1);
                    n1.pendingEndpoints[0].should.equal(mockEndpoint);

                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should remove from pendingEndpoints on unregister", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    // Force serverStarted to false
                    n1.serverStarted = false;
                    n1.fastify = null;

                    const mockEndpoint = {
                        id: "ep1",
                        path: "/users",
                        method: "GET",
                        requiredScopes: [],
                        getEndpointInfo: function () {
                            return {
                                id: "ep1",
                                path: "/users",
                                method: "GET",
                                paramNames: []
                            };
                        }
                    };

                    n1.registerEndpoint(mockEndpoint);
                    n1.pendingEndpoints.should.have.length(1);

                    n1.unregisterEndpoint(mockEndpoint);
                    n1.pendingEndpoints.should.have.length(0);

                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should not have keycloak client when OAuth2 disabled", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    // No config node, so no OAuth2
                    (n1.keycloakClient === null).should.be.true();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe("Route Tracking", function () {
        it("should track routes by method and path", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    // Manually add route tracking
                    n1.registeredRoutes.set("GET:/users", "ep1");
                    n1.registeredRoutes.set("POST:/users", "ep2");
                    n1.registeredRoutes.set("GET:/users/:id", "ep3");

                    n1.registeredRoutes.size.should.equal(3);
                    n1.registeredRoutes.get("GET:/users").should.equal("ep1");
                    n1.registeredRoutes.get("POST:/users").should.equal("ep2");
                    n1.registeredRoutes.get("GET:/users/:id").should.equal("ep3");

                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should clear registeredRoutes on unregister", function (done) {
            const flow = [{ id: "n1", type: "api-server", name: "test" }];
            helper.load(apiServerNode, flow, function () {
                const n1 = helper.getNode("n1");
                try {
                    // Force serverStarted to false
                    n1.serverStarted = false;
                    n1.fastify = null;

                    const mockEndpoint = {
                        id: "ep1",
                        path: "/users",
                        method: "GET",
                        requiredScopes: [],
                        getEndpointInfo: function () {
                            return {
                                id: "ep1",
                                path: "/users",
                                method: "GET",
                                paramNames: []
                            };
                        }
                    };

                    // Manually add route to simulate it was registered
                    n1.registeredRoutes.set("GET:/users", "ep1");
                    n1.endpoints.set("ep1", mockEndpoint);

                    n1.unregisterEndpoint(mockEndpoint);

                    n1.registeredRoutes.has("GET:/users").should.be.false();

                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });
});
