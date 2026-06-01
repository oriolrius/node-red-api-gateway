const should = require("should");
const {
    OpenApiGenerator,
    jsonSchemaToOpenApi,
    generateOperationId,
    convertPathToOpenApi,
    buildPathParameters,
    buildQueryParameters,
    buildRequestBody,
    buildResponses,
    buildSecurityRequirement,
    buildOAuth2SecurityScheme,
    collectScopes,
    buildOperation,
    getStatusDescription,
    DEFAULT_INFO
} = require("../../lib/openapi-generator");

describe("OpenAPI Generator", function () {

    describe("Utility Functions", function () {

        describe("jsonSchemaToOpenApi", function () {
            it("should return null/undefined values as-is", function () {
                should(jsonSchemaToOpenApi(null)).be.null();
                should(jsonSchemaToOpenApi(undefined)).be.undefined();
            });

            it("should preserve $id (valid in JSON Schema 2020-12)", function () {
                const schema = {
                    $id: "User",
                    type: "object",
                    properties: {
                        name: { type: "string" }
                    }
                };
                const result = jsonSchemaToOpenApi(schema);
                result.$id.should.equal("User");
                result.should.have.property("type", "object");
            });

            it("should recurse through nested properties and keep $id", function () {
                const schema = {
                    type: "object",
                    properties: {
                        user: {
                            $id: "NestedUser",
                            type: "object",
                            xml: { name: "user" },
                            properties: {
                                name: { type: "string" }
                            }
                        }
                    }
                };
                const result = jsonSchemaToOpenApi(schema);
                result.properties.user.$id.should.equal("NestedUser");
                should(result.properties.user.xml).be.undefined();
            });

            it("should recurse through array items and strip OAS-only decorations", function () {
                const schema = {
                    type: "array",
                    items: {
                        $id: "Item",
                        type: "object",
                        xml: { name: "i" }
                    }
                };
                const result = jsonSchemaToOpenApi(schema);
                result.items.$id.should.equal("Item");
                should(result.items.xml).be.undefined();
            });

            it("should recurse through allOf/anyOf/oneOf", function () {
                const schema = {
                    allOf: [
                        { $id: "Schema1", type: "object", xml: { name: "s1" } },
                        { $id: "Schema2", type: "object" }
                    ]
                };
                const result = jsonSchemaToOpenApi(schema);
                result.allOf[0].$id.should.equal("Schema1");
                should(result.allOf[0].xml).be.undefined();
                result.allOf[1].$id.should.equal("Schema2");
            });

            it("should defensively rewrite stray `nullable: true` to type-null array", function () {
                const schema = { type: "string", nullable: true };
                const result = jsonSchemaToOpenApi(schema);
                should(result.nullable).be.undefined();
                result.type.should.deepEqual(["string", "null"]);
            });

            it("should defensively rewrite boolean exclusiveMinimum/Maximum to numeric form", function () {
                const schema = {
                    type: "number",
                    minimum: 0,
                    exclusiveMinimum: true,
                    maximum: 10,
                    exclusiveMaximum: true
                };
                const result = jsonSchemaToOpenApi(schema);
                result.exclusiveMinimum.should.equal(0);
                result.exclusiveMaximum.should.equal(10);
                should(result.minimum).be.undefined();
                should(result.maximum).be.undefined();
            });

            it("should recurse through 2020-12 containers ($defs, prefixItems, if/then/else)", function () {
                const schema = {
                    $defs: { inner: { type: "string", xml: { name: "x" } } },
                    prefixItems: [{ type: "string", xml: { name: "x" } }],
                    if: { type: "object", xml: { name: "x" } },
                    then: { type: "object", xml: { name: "x" } },
                    else: { type: "object", xml: { name: "x" } }
                };
                const result = jsonSchemaToOpenApi(schema);
                should(result.$defs.inner.xml).be.undefined();
                should(result.prefixItems[0].xml).be.undefined();
                should(result.if.xml).be.undefined();
                should(result.then.xml).be.undefined();
                should(result.else.xml).be.undefined();
            });
        });

        describe("generateOperationId", function () {
            it("should generate operationId from method and path", function () {
                generateOperationId("GET", "/users").should.equal("getUsers");
                generateOperationId("POST", "/users").should.equal("postUsers");
            });

            it("should handle path parameters", function () {
                generateOperationId("GET", "/users/:id").should.equal("getUsers_id");
                generateOperationId("GET", "/users/:userId/posts/:postId").should.equal("getUsers_userId_posts_postId");
            });

            it("should handle root path", function () {
                generateOperationId("GET", "/").should.equal("getRoot");
            });

            it("should handle hyphens in path", function () {
                generateOperationId("GET", "/user-profiles").should.equal("getUser_profiles");
            });
        });

        describe("convertPathToOpenApi", function () {
            it("should convert Express-style params to OpenAPI format", function () {
                convertPathToOpenApi("/users/:id").should.equal("/users/{id}");
                convertPathToOpenApi("/users/:userId/posts/:postId").should.equal("/users/{userId}/posts/{postId}");
            });

            it("should handle paths without params", function () {
                convertPathToOpenApi("/users").should.equal("/users");
            });
        });

        describe("buildPathParameters", function () {
            it("should return empty array for no params", function () {
                buildPathParameters([]).should.deepEqual([]);
                buildPathParameters(null).should.deepEqual([]);
            });

            it("should build path parameters with default schema", function () {
                const params = buildPathParameters(["id"]);
                params.should.have.length(1);
                params[0].should.have.property("name", "id");
                params[0].should.have.property("in", "path");
                params[0].should.have.property("required", true);
                params[0].schema.should.have.property("type", "string");
            });

            it("should use schema from paramsSchema if provided", function () {
                const paramsSchema = {
                    properties: {
                        id: {
                            type: "integer",
                            description: "User ID"
                        }
                    }
                };
                const params = buildPathParameters(["id"], paramsSchema);
                params[0].schema.should.have.property("type", "integer");
                params[0].should.have.property("description", "User ID");
            });
        });

        describe("buildQueryParameters", function () {
            it("should return empty array for no schema", function () {
                buildQueryParameters(null).should.deepEqual([]);
                buildQueryParameters({}).should.deepEqual([]);
            });

            it("should build query parameters from schema", function () {
                const schema = {
                    type: "object",
                    properties: {
                        page: { type: "integer" },
                        limit: { type: "integer" }
                    },
                    required: ["page"]
                };
                const params = buildQueryParameters(schema);
                params.should.have.length(2);

                const pageParam = params.find(p => p.name === "page");
                pageParam.should.have.property("in", "query");
                pageParam.should.have.property("required", true);

                const limitParam = params.find(p => p.name === "limit");
                limitParam.should.have.property("required", false);
            });
        });

        describe("buildRequestBody", function () {
            it("should return null for no schema", function () {
                should(buildRequestBody(null)).be.null();
            });

            it("should build request body with default content type", function () {
                const schema = { type: "object" };
                const result = buildRequestBody(schema);
                result.should.have.property("required", true);
                result.content.should.have.property("application/json");
            });

            it("should use custom content type", function () {
                const schema = { type: "object" };
                const result = buildRequestBody(schema, "application/xml");
                result.content.should.have.property("application/xml");
            });
        });

        describe("buildResponses", function () {
            it("should build default responses", function () {
                const responses = buildResponses({}, 200);
                responses.should.have.property("200");
                responses.should.have.property("400");
                responses.should.have.property("500");
            });

            it("should include response schemas", function () {
                const responseSchemas = {
                    "200": {
                        type: "object",
                        properties: { id: { type: "string" } },
                        description: "Success"
                    }
                };
                const responses = buildResponses(responseSchemas, 200);
                responses["200"].should.have.property("description", "Success");
            });

            it("should use successStatusCode for default success response", function () {
                const responses = buildResponses({}, 201);
                responses.should.have.property("201");
            });
        });

        describe("buildSecurityRequirement", function () {
            it("should return empty array for no scopes", function () {
                buildSecurityRequirement([]).should.deepEqual([]);
                buildSecurityRequirement(null).should.deepEqual([]);
            });

            it("should build OAuth2 security requirement", function () {
                const result = buildSecurityRequirement(["read:users", "write:users"]);
                result.should.have.length(1);
                result[0].should.have.property("oauth2");
                result[0].oauth2.should.deepEqual(["read:users", "write:users"]);
            });
        });

        describe("buildOAuth2SecurityScheme", function () {
            it("should return null if OAuth2 not enabled", function () {
                should(buildOAuth2SecurityScheme(null)).be.null();
                should(buildOAuth2SecurityScheme({ oauth2Enabled: false })).be.null();
            });

            it("should build OAuth2 scheme from Keycloak config", function () {
                const config = {
                    oauth2Enabled: true,
                    keycloakUrl: "https://auth.example.com",
                    keycloakRealm: "myrealm"
                };
                const result = buildOAuth2SecurityScheme(config);
                result.should.have.property("type", "oauth2");
                result.flows.clientCredentials.tokenUrl.should.containEql("myrealm");
            });
        });

        describe("collectScopes", function () {
            it("should collect unique scopes from endpoints", function () {
                const endpoints = [
                    { requiredScopes: ["read:users", "write:users"] },
                    { requiredScopes: ["read:users", "delete:users"] },
                    { requiredScopes: [] }
                ];
                const scopes = collectScopes(endpoints);
                Object.keys(scopes).should.have.length(3);
                scopes.should.have.property("read:users");
                scopes.should.have.property("write:users");
                scopes.should.have.property("delete:users");
            });
        });

        describe("getStatusDescription", function () {
            it("should return correct descriptions for known codes", function () {
                getStatusDescription(200).should.equal("Successful response");
                getStatusDescription(201).should.equal("Resource created successfully");
                getStatusDescription(400).should.equal("Bad request");
                getStatusDescription(404).should.equal("Not found");
            });

            it("should return generic description for unknown codes", function () {
                getStatusDescription(418).should.containEql("418");
            });
        });
    });

    describe("buildOperation", function () {
        it("should build basic operation from endpoint info", function () {
            const endpointInfo = {
                method: "GET",
                path: "/users",
                name: "List Users",
                successStatusCode: 200,
                responseContentType: "application/json",
                paramNames: []
            };
            const operation = buildOperation(endpointInfo, null);
            operation.should.have.property("operationId", "getUsers");
            operation.should.have.property("summary", "List Users");
            operation.should.have.property("responses");
            operation.responses.should.have.property("200");
        });

        it("should include security requirement for scopes", function () {
            const endpointInfo = {
                method: "DELETE",
                path: "/users/:id",
                name: "Delete User",
                hasRequiredScopes: true,
                requiredScopes: ["delete:users"],
                scopeOperator: "AND",
                paramNames: ["id"]
            };
            const operation = buildOperation(endpointInfo, null);
            operation.should.have.property("security");
            operation.security[0].oauth2.should.deepEqual(["delete:users"]);
        });

        it("should include rate limit extension", function () {
            const endpointInfo = {
                method: "GET",
                path: "/api",
                rateLimitingEnabled: true,
                rateLimitRequests: 100,
                rateLimitWindowMs: 60000,
                paramNames: []
            };
            const operation = buildOperation(endpointInfo, null);
            operation.should.have.property("x-rate-limit");
            operation["x-rate-limit"].requests.should.equal(100);
        });

        it("should include cache extension", function () {
            const endpointInfo = {
                method: "GET",
                path: "/api",
                cachingEnabled: true,
                cacheTTL: 300,
                cachePrivate: false,
                paramNames: []
            };
            const operation = buildOperation(endpointInfo, null);
            operation.should.have.property("x-cache");
            operation["x-cache"].ttl.should.equal(300);
        });
    });

    describe("OpenApiGenerator Class", function () {
        let generator;

        beforeEach(function () {
            generator = new OpenApiGenerator({
                info: {
                    title: "Test API",
                    version: "1.0.0",
                    description: "Test description"
                },
                basePath: "/api/v1"
            });
        });

        describe("constructor", function () {
            it("should use default info if not provided", function () {
                const gen = new OpenApiGenerator();
                const spec = gen.generate();
                spec.info.should.have.property("title", DEFAULT_INFO.title);
            });

            it("should merge provided info with defaults", function () {
                const spec = generator.generate();
                spec.info.should.have.property("title", "Test API");
                spec.info.should.have.property("description", "Test description");
            });
        });

        describe("registerEndpoint", function () {
            it("should register an endpoint", function () {
                const endpoint = {
                    id: "ep1",
                    getEndpointInfo: function () {
                        return {
                            id: "ep1",
                            name: "Test",
                            path: "/test",
                            method: "GET",
                            paramNames: []
                        };
                    }
                };
                generator.registerEndpoint(endpoint);
                generator.getEndpointCount().should.equal(1);
            });

            it("should ignore null endpoints", function () {
                generator.registerEndpoint(null);
                generator.getEndpointCount().should.equal(0);
            });
        });

        describe("unregisterEndpoint", function () {
            it("should remove a registered endpoint", function () {
                const endpoint = {
                    id: "ep1",
                    getEndpointInfo: () => ({ id: "ep1", path: "/test", method: "GET", paramNames: [] })
                };
                generator.registerEndpoint(endpoint);
                generator.getEndpointCount().should.equal(1);
                generator.unregisterEndpoint("ep1");
                generator.getEndpointCount().should.equal(0);
            });
        });

        describe("clearEndpoints", function () {
            it("should clear all endpoints", function () {
                generator.registerEndpoint({
                    id: "ep1",
                    getEndpointInfo: () => ({ id: "ep1", path: "/test1", method: "GET", paramNames: [] })
                });
                generator.registerEndpoint({
                    id: "ep2",
                    getEndpointInfo: () => ({ id: "ep2", path: "/test2", method: "POST", paramNames: [] })
                });
                generator.getEndpointCount().should.equal(2);
                generator.clearEndpoints();
                generator.getEndpointCount().should.equal(0);
            });
        });

        describe("generate", function () {
            it("should generate valid OpenAPI 3.1 structure", function () {
                const spec = generator.generate();
                spec.should.have.property("openapi", "3.1.0");
                spec.should.have.property(
                    "jsonSchemaDialect",
                    "https://json-schema.org/draft/2020-12/schema"
                );
                spec.should.have.property("info");
                spec.should.have.property("paths");
            });

            it("should never emit `nullable` anywhere in the generated spec", function () {
                generator.registerEndpoint({
                    id: "epNullable",
                    getEndpointInfo: () => ({
                        id: "epNullable",
                        name: "Nullable test",
                        path: "/with-nullable",
                        method: "GET",
                        paramNames: [],
                        successStatusCode: 200,
                        responseSchemas: {
                            "200": {
                                type: "object",
                                properties: {
                                    name: { type: "string", nullable: true }
                                }
                            }
                        }
                    })
                });
                const serialized = JSON.stringify(generator.generate());
                serialized.should.not.match(/"nullable"\s*:/);
            });

            it("should include registered endpoints as paths", function () {
                generator.registerEndpoint({
                    id: "ep1",
                    getEndpointInfo: () => ({
                        id: "ep1",
                        name: "List Users",
                        path: "/users",
                        method: "GET",
                        paramNames: [],
                        successStatusCode: 200
                    })
                });

                const spec = generator.generate();
                spec.paths.should.have.property("/api/v1/users");
                spec.paths["/api/v1/users"].should.have.property("get");
            });

            it("should convert path parameters to OpenAPI format", function () {
                generator.registerEndpoint({
                    id: "ep1",
                    getEndpointInfo: () => ({
                        id: "ep1",
                        path: "/users/:id",
                        method: "GET",
                        paramNames: ["id"]
                    })
                });

                const spec = generator.generate();
                spec.paths.should.have.property("/api/v1/users/{id}");
            });

            it("should generate tags from path segments", function () {
                generator.registerEndpoint({
                    id: "ep1",
                    getEndpointInfo: () => ({
                        id: "ep1",
                        path: "/users",
                        method: "GET",
                        paramNames: []
                    })
                });
                generator.registerEndpoint({
                    id: "ep2",
                    getEndpointInfo: () => ({
                        id: "ep2",
                        path: "/products",
                        method: "GET",
                        paramNames: []
                    })
                });

                const spec = generator.generate();
                spec.should.have.property("tags");
                const tagNames = spec.tags.map(t => t.name);
                tagNames.should.containEql("users");
                tagNames.should.containEql("products");
            });

            it("should include OAuth2 security scheme when config has OAuth2 enabled", function () {
                const genWithOAuth = new OpenApiGenerator({
                    config: {
                        oauth2Enabled: true,
                        keycloakUrl: "https://auth.example.com",
                        keycloakRealm: "test"
                    }
                });

                genWithOAuth.registerEndpoint({
                    id: "ep1",
                    getEndpointInfo: () => ({
                        id: "ep1",
                        path: "/protected",
                        method: "GET",
                        paramNames: [],
                        hasRequiredScopes: true,
                        requiredScopes: ["read:data"]
                    })
                });

                const spec = genWithOAuth.generate();
                spec.components.should.have.property("securitySchemes");
                spec.components.securitySchemes.should.have.property("oauth2");
            });
        });

        describe("toJSON", function () {
            it("should return valid JSON string", function () {
                const json = generator.toJSON();
                const parsed = JSON.parse(json);
                parsed.should.have.property("openapi");
            });
        });

        describe("toYAML", function () {
            it("should return YAML-like string (fallback to JSON if js-yaml not available)", function () {
                const yaml = generator.toYAML();
                yaml.should.be.a.String();
                yaml.length.should.be.greaterThan(0);
            });
        });

        describe("updateConfig", function () {
            it("should update info", function () {
                generator.updateConfig({
                    info: { title: "Updated API" }
                });
                const spec = generator.generate();
                spec.info.should.have.property("title", "Updated API");
            });

            it("should update basePath", function () {
                generator.updateConfig({ basePath: "/api/v2" });
                generator.registerEndpoint({
                    id: "ep1",
                    getEndpointInfo: () => ({
                        id: "ep1",
                        path: "/test",
                        method: "GET",
                        paramNames: []
                    })
                });
                const spec = generator.generate();
                spec.paths.should.have.property("/api/v2/test");
            });
        });

        describe("getEndpointIds", function () {
            it("should return array of endpoint IDs", function () {
                generator.registerEndpoint({
                    id: "ep1",
                    getEndpointInfo: () => ({ id: "ep1", path: "/a", method: "GET", paramNames: [] })
                });
                generator.registerEndpoint({
                    id: "ep2",
                    getEndpointInfo: () => ({ id: "ep2", path: "/b", method: "GET", paramNames: [] })
                });
                const ids = generator.getEndpointIds();
                ids.should.containEql("ep1");
                ids.should.containEql("ep2");
            });
        });
    });

    describe("Integration: Full API Spec Generation", function () {
        it("should generate complete spec for a typical REST API", function () {
            const generator = new OpenApiGenerator({
                info: {
                    title: "Users API",
                    description: "API for managing users",
                    version: "1.0.0"
                },
                basePath: "/api/v1",
                config: {
                    oauth2Enabled: true,
                    keycloakUrl: "https://auth.example.com",
                    keycloakRealm: "myrealm"
                }
            });

            // Mock endpoint nodes
            const listUsersEndpoint = {
                id: "list-users",
                querySchema: {
                    type: "object",
                    properties: {
                        page: { type: "integer", minimum: 1 },
                        limit: { type: "integer", minimum: 1, maximum: 100 }
                    }
                },
                responseSchemas: {
                    "200": {
                        type: "object",
                        properties: {
                            data: { type: "array", items: { type: "object" } },
                            total: { type: "integer" }
                        }
                    }
                },
                getEndpointInfo: function () {
                    return {
                        id: "list-users",
                        name: "List Users",
                        path: "/users",
                        method: "GET",
                        paramNames: [],
                        successStatusCode: 200,
                        responseContentType: "application/json",
                        hasRequiredScopes: true,
                        requiredScopes: ["read:users"],
                        scopeOperator: "AND"
                    };
                }
            };

            const getUserEndpoint = {
                id: "get-user",
                paramsSchema: {
                    properties: {
                        id: { type: "string", format: "uuid" }
                    }
                },
                responseSchemas: {
                    "200": {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            email: { type: "string" }
                        }
                    },
                    "404": {
                        type: "object",
                        properties: {
                            error: { type: "string" }
                        }
                    }
                },
                getEndpointInfo: function () {
                    return {
                        id: "get-user",
                        name: "Get User",
                        path: "/users/:id",
                        method: "GET",
                        paramNames: ["id"],
                        successStatusCode: 200,
                        responseContentType: "application/json",
                        hasRequiredScopes: true,
                        requiredScopes: ["read:users"],
                        scopeOperator: "AND"
                    };
                }
            };

            const createUserEndpoint = {
                id: "create-user",
                bodySchema: {
                    type: "object",
                    required: ["name", "email"],
                    properties: {
                        name: { type: "string", minLength: 1 },
                        email: { type: "string", format: "email" }
                    }
                },
                responseSchemas: {
                    "201": {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            email: { type: "string" }
                        }
                    }
                },
                getEndpointInfo: function () {
                    return {
                        id: "create-user",
                        name: "Create User",
                        path: "/users",
                        method: "POST",
                        paramNames: [],
                        successStatusCode: 201,
                        responseContentType: "application/json",
                        hasRequiredScopes: true,
                        requiredScopes: ["write:users"],
                        scopeOperator: "AND"
                    };
                }
            };

            generator.registerEndpoint(listUsersEndpoint);
            generator.registerEndpoint(getUserEndpoint);
            generator.registerEndpoint(createUserEndpoint);

            const spec = generator.generate();

            // Verify structure
            spec.openapi.should.equal("3.1.0");
            spec.info.title.should.equal("Users API");

            // Verify paths
            spec.paths.should.have.property("/api/v1/users");
            spec.paths.should.have.property("/api/v1/users/{id}");

            // Verify GET /users
            spec.paths["/api/v1/users"].get.should.have.property("operationId");
            spec.paths["/api/v1/users"].get.should.have.property("parameters");
            spec.paths["/api/v1/users"].get.should.have.property("security");

            // Verify POST /users
            spec.paths["/api/v1/users"].post.should.have.property("requestBody");
            spec.paths["/api/v1/users"].post.requestBody.content["application/json"].schema.should.have.property("required");

            // Verify GET /users/{id}
            spec.paths["/api/v1/users/{id}"].get.should.have.property("parameters");
            const pathParams = spec.paths["/api/v1/users/{id}"].get.parameters.filter(p => p.in === "path");
            pathParams.should.have.length(1);
            pathParams[0].name.should.equal("id");

            // Verify security schemes
            spec.components.securitySchemes.oauth2.flows.clientCredentials.scopes.should.have.property("read:users");
            spec.components.securitySchemes.oauth2.flows.clientCredentials.scopes.should.have.property("write:users");

            // Verify tags
            spec.tags.should.containDeep([{ name: "users" }]);
        });
    });
});
