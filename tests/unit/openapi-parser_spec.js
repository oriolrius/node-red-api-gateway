const should = require("should");
const {
    OpenApiParser,
    parseOpenApi,
    parseOpenApiSpec,
    parseFromJson,
    convertPathToExpress,
    extractParamNames,
    openApiSchemaToJsonSchema,
    resolveRef,
    buildQuerySchema,
    buildParamsSchema,
    buildBodySchema,
    buildResponseSchemas,
    extractSuccessStatusCode,
    extractResponseContentType,
    extractSecurityScopes,
    detectCrudOperation,
    extractTableName,
    parseOperation,
    filterEndpointsByPath,
    filterEndpointsByTags,
    filterEndpointsByMethods
} = require("../../lib/openapi-parser");

describe("OpenAPI Parser", function () {

    describe("Utility Functions", function () {

        describe("convertPathToExpress", function () {
            it("should convert OpenAPI-style params to Express format", function () {
                convertPathToExpress("/users/{id}").should.equal("/users/:id");
                convertPathToExpress("/users/{userId}/posts/{postId}").should.equal("/users/:userId/posts/:postId");
            });

            it("should handle paths without params", function () {
                convertPathToExpress("/users").should.equal("/users");
                convertPathToExpress("/").should.equal("/");
            });

            it("should handle mixed content", function () {
                convertPathToExpress("/api/v1/users/{id}").should.equal("/api/v1/users/:id");
            });
        });

        describe("extractParamNames", function () {
            it("should extract parameter names from Express-style path", function () {
                extractParamNames("/users/:id").should.deepEqual(["id"]);
                extractParamNames("/users/:userId/posts/:postId").should.deepEqual(["userId", "postId"]);
            });

            it("should return empty array for paths without params", function () {
                extractParamNames("/users").should.deepEqual([]);
                extractParamNames("/").should.deepEqual([]);
            });
        });

        describe("openApiSchemaToJsonSchema", function () {
            it("should handle null/undefined values", function () {
                should(openApiSchemaToJsonSchema(null)).be.null();
                should(openApiSchemaToJsonSchema(undefined)).be.undefined();
            });

            it("should convert simple schemas", function () {
                const schema = { type: "string", description: "A string" };
                const result = openApiSchemaToJsonSchema(schema);
                result.should.have.property("type", "string");
                result.should.have.property("description", "A string");
            });

            it("should pass through type arrays containing null", function () {
                const schema = { type: ["string", "null"] };
                const result = openApiSchemaToJsonSchema(schema);
                result.type.should.deepEqual(["string", "null"]);
            });

            it("should strip OpenAPI-only schema decorations and keep valid 3.1 annotations", function () {
                const schema = {
                    type: "object",
                    discriminator: { propertyName: "type" },
                    xml: { name: "user" },
                    externalDocs: { url: "http://example.com" },
                    deprecated: true
                };
                const result = openApiSchemaToJsonSchema(schema);
                should(result.discriminator).be.undefined();
                should(result.xml).be.undefined();
                // 3.1 keeps externalDocs and deprecated as valid Schema annotations
                result.externalDocs.should.deepEqual({ url: "http://example.com" });
                result.deprecated.should.equal(true);
            });

            it("should recurse through nested properties", function () {
                const schema = {
                    type: "object",
                    properties: {
                        user: {
                            type: ["object", "null"],
                            properties: {
                                name: { type: "string" }
                            }
                        }
                    }
                };
                const result = openApiSchemaToJsonSchema(schema);
                result.properties.user.type.should.deepEqual(["object", "null"]);
                result.properties.user.properties.name.type.should.equal("string");
            });

            it("should recurse through array items", function () {
                const schema = {
                    type: "array",
                    items: { type: ["string", "null"] }
                };
                const result = openApiSchemaToJsonSchema(schema);
                result.items.type.should.deepEqual(["string", "null"]);
            });

            it("should recurse through allOf/anyOf/oneOf", function () {
                const schema = {
                    allOf: [
                        { type: ["object", "null"] },
                        { type: "object" }
                    ]
                };
                const result = openApiSchemaToJsonSchema(schema);
                result.allOf[0].type.should.deepEqual(["object", "null"]);
            });

            it("should recurse through 2020-12 containers ($defs, prefixItems, propertyNames, if/then/else)", function () {
                const schema = {
                    $defs: { inner: { type: "string", xml: { name: "x" } } },
                    prefixItems: [{ type: "string", xml: { name: "x" } }],
                    propertyNames: { type: "string", xml: { name: "x" } },
                    if: { type: "object", xml: { name: "x" } },
                    then: { type: "object", xml: { name: "x" } },
                    else: { type: "object", xml: { name: "x" } }
                };
                const result = openApiSchemaToJsonSchema(schema);
                should(result.$defs.inner.xml).be.undefined();
                should(result.prefixItems[0].xml).be.undefined();
                should(result.propertyNames.xml).be.undefined();
                should(result.if.xml).be.undefined();
                should(result.then.xml).be.undefined();
                should(result.else.xml).be.undefined();
            });
        });

        describe("resolveRef", function () {
            const components = {
                schemas: {
                    User: { type: "object", properties: { name: { type: "string" } } },
                    Error: { type: "object", properties: { message: { type: "string" } } }
                },
                responses: {
                    NotFound: { description: "Not found" }
                }
            };

            it("should resolve $ref to schema", function () {
                const result = resolveRef("#/components/schemas/User", components);
                result.should.have.property("type", "object");
                result.properties.should.have.property("name");
            });

            it("should resolve $ref to response", function () {
                const result = resolveRef("#/components/responses/NotFound", components);
                result.should.have.property("description", "Not found");
            });

            it("should return null for invalid refs", function () {
                should(resolveRef(null, components)).be.null();
                should(resolveRef("invalid", components)).be.null();
                // Unresolvable refs return undefined (which is falsy)
                should(resolveRef("#/components/schemas/Unknown", components)).not.be.ok();
            });
        });

        describe("buildQuerySchema", function () {
            it("should return null for no query parameters", function () {
                should(buildQuerySchema([])).be.null();
                should(buildQuerySchema([{ name: "id", in: "path" }])).be.null();
            });

            it("should build schema from query parameters", function () {
                const params = [
                    { name: "page", in: "query", schema: { type: "integer" }, required: true },
                    { name: "limit", in: "query", schema: { type: "integer" }, description: "Page size" }
                ];
                const result = buildQuerySchema(params);

                result.should.have.property("type", "object");
                result.properties.should.have.property("page");
                result.properties.page.should.have.property("type", "integer");
                result.properties.limit.should.have.property("description", "Page size");
                result.required.should.containEql("page");
                result.required.should.not.containEql("limit");
            });

            it("should use string as default type", function () {
                const params = [{ name: "filter", in: "query" }];
                const result = buildQuerySchema(params);
                result.properties.filter.should.have.property("type", "string");
            });
        });

        describe("buildParamsSchema", function () {
            it("should return null for no path parameters", function () {
                should(buildParamsSchema([])).be.null();
                should(buildParamsSchema([{ name: "page", in: "query" }])).be.null();
            });

            it("should build schema from path parameters", function () {
                const params = [
                    { name: "id", in: "path", schema: { type: "integer" }, description: "User ID" },
                    { name: "postId", in: "path", schema: { type: "string" } }
                ];
                const result = buildParamsSchema(params);

                result.should.have.property("type", "object");
                result.properties.should.have.property("id");
                result.properties.id.should.have.property("type", "integer");
                result.properties.id.should.have.property("description", "User ID");
                result.required.should.containEql("id");
                result.required.should.containEql("postId");
            });
        });

        describe("buildBodySchema", function () {
            it("should return null for no request body", function () {
                should(buildBodySchema(null)).be.null();
                should(buildBodySchema({})).be.null();
                should(buildBodySchema({ required: true })).be.null();
            });

            it("should extract schema from application/json content", function () {
                const requestBody = {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { type: "object", properties: { name: { type: "string" } } }
                        }
                    }
                };
                const result = buildBodySchema(requestBody);
                result.should.have.property("type", "object");
                result.properties.should.have.property("name");
            });

            it("should prefer application/json over other types", function () {
                const requestBody = {
                    content: {
                        "text/plain": { schema: { type: "string" } },
                        "application/json": { schema: { type: "object" } }
                    }
                };
                const result = buildBodySchema(requestBody);
                result.should.have.property("type", "object");
            });

            it("should fall back to first available content type", function () {
                const requestBody = {
                    content: {
                        "text/xml": { schema: { type: "string" } }
                    }
                };
                const result = buildBodySchema(requestBody);
                result.should.have.property("type", "string");
            });
        });

        describe("buildResponseSchemas", function () {
            it("should return null for no responses", function () {
                should(buildResponseSchemas(null)).be.null();
                should(buildResponseSchemas({})).be.null();
            });

            it("should extract schemas from responses", function () {
                const responses = {
                    "200": {
                        description: "Success",
                        content: {
                            "application/json": {
                                schema: { type: "object", properties: { id: { type: "integer" } } }
                            }
                        }
                    },
                    "404": {
                        description: "Not found",
                        content: {
                            "application/json": {
                                schema: { type: "object", properties: { error: { type: "string" } } }
                            }
                        }
                    }
                };
                const result = buildResponseSchemas(responses);

                result.should.have.property("200");
                result["200"].should.have.property("description", "Success");
                result["200"].properties.should.have.property("id");
                result.should.have.property("404");
            });

            it("should return null for responses without content", function () {
                const responses = {
                    "204": { description: "No content" }
                };
                const result = buildResponseSchemas(responses);
                should(result).be.null();
            });
        });

        describe("extractSuccessStatusCode", function () {
            it("should return 200 by default", function () {
                extractSuccessStatusCode(null).should.equal("200");
                extractSuccessStatusCode({}).should.equal("200");
            });

            it("should prefer 200 over other success codes", function () {
                extractSuccessStatusCode({ "200": {}, "201": {} }).should.equal("200");
            });

            it("should find first 2xx code", function () {
                extractSuccessStatusCode({ "201": {} }).should.equal("201");
                extractSuccessStatusCode({ "204": {} }).should.equal("204");
                extractSuccessStatusCode({ "202": {} }).should.equal("202");
            });

            it("should find any 2xx code if standard codes missing", function () {
                extractSuccessStatusCode({ "299": {}, "400": {} }).should.equal("299");
            });
        });

        describe("extractResponseContentType", function () {
            it("should return application/json by default", function () {
                extractResponseContentType(null).should.equal("application/json");
                extractResponseContentType({}).should.equal("application/json");
            });

            it("should extract content type from success response", function () {
                const responses = {
                    "200": {
                        content: {
                            "text/xml": { schema: {} }
                        }
                    }
                };
                extractResponseContentType(responses).should.equal("text/xml");
            });
        });

        describe("extractSecurityScopes", function () {
            it("should return empty scopes for no security", function () {
                const result = extractSecurityScopes(null);
                result.scopes.should.deepEqual([]);
                result.operator.should.equal("AND");
            });

            it("should extract OAuth2 scopes", function () {
                const security = [{ oauth2: ["read:users", "write:users"] }];
                const securitySchemes = {
                    oauth2: { type: "oauth2", flows: {} }
                };
                const result = extractSecurityScopes(security, securitySchemes);
                result.scopes.should.containEql("read:users");
                result.scopes.should.containEql("write:users");
            });

            it("should handle multiple security requirements (OR)", function () {
                const security = [
                    { oauth2: ["read"] },
                    { apiKey: [] }
                ];
                const securitySchemes = {
                    oauth2: { type: "oauth2" },
                    apiKey: { type: "apiKey" }
                };
                const result = extractSecurityScopes(security, securitySchemes);
                result.operator.should.equal("OR");
            });

            it("should handle single security requirement (AND)", function () {
                const security = [{ oauth2: ["read", "write"] }];
                const securitySchemes = { oauth2: { type: "oauth2" } };
                const result = extractSecurityScopes(security, securitySchemes);
                result.operator.should.equal("AND");
            });
        });

        describe("detectCrudOperation", function () {
            it("should detect list operation", function () {
                detectCrudOperation("GET", "/users").should.equal("list");
            });

            it("should detect read operation", function () {
                detectCrudOperation("GET", "/users/:id").should.equal("read");
            });

            it("should detect create operation", function () {
                detectCrudOperation("POST", "/users").should.equal("create");
            });

            it("should detect update operation", function () {
                detectCrudOperation("PUT", "/users/:id").should.equal("update");
                detectCrudOperation("PATCH", "/users/:id").should.equal("update");
            });

            it("should detect delete operation", function () {
                detectCrudOperation("DELETE", "/users/:id").should.equal("delete");
            });

            it("should return none for unknown methods", function () {
                detectCrudOperation("OPTIONS", "/users").should.equal("none");
            });
        });

        describe("extractTableName", function () {
            it("should extract table name from path", function () {
                extractTableName("/users").should.equal("users");
                extractTableName("/api/posts").should.equal("api");
            });

            it("should handle paths with parameters", function () {
                extractTableName("/users/:id").should.equal("users");
            });

            it("should convert to lowercase", function () {
                extractTableName("/Users").should.equal("users");
            });
        });
    });

    describe("parseOperation", function () {
        it("should parse a simple GET operation", function () {
            const operation = {
                operationId: "getUsers",
                summary: "Get all users",
                responses: {
                    "200": {
                        description: "Success",
                        content: {
                            "application/json": {
                                schema: { type: "array", items: { type: "object" } }
                            }
                        }
                    }
                }
            };

            const result = parseOperation("/users", "GET", operation, [], {});

            result.should.have.property("name", "Get all users");
            result.should.have.property("path", "/users");
            result.should.have.property("method", "GET");
            result.should.have.property("successStatusCode", "200");
            result._metadata.should.have.property("operationId", "getUsers");
        });

        it("should parse operation with path parameters", function () {
            const operation = {
                summary: "Get user",
                parameters: [
                    { name: "id", in: "path", schema: { type: "integer" }, required: true }
                ],
                responses: { "200": { description: "Success" } }
            };

            const result = parseOperation("/users/{id}", "GET", operation, [], {});

            result.path.should.equal("/users/:id");
            result.paramsSchema.should.not.be.empty();
            const paramsSchema = JSON.parse(result.paramsSchema);
            paramsSchema.properties.should.have.property("id");
        });

        it("should parse operation with request body", function () {
            const operation = {
                summary: "Create user",
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    name: { type: "string" },
                                    email: { type: "string" }
                                },
                                required: ["name", "email"]
                            }
                        }
                    }
                },
                responses: { "201": { description: "Created" } }
            };

            const result = parseOperation("/users", "POST", operation, [], {});

            result.bodySchema.should.not.be.empty();
            const bodySchema = JSON.parse(result.bodySchema);
            bodySchema.properties.should.have.property("name");
            bodySchema.properties.should.have.property("email");
        });

        it("should merge path-level and operation-level parameters", function () {
            const pathParams = [
                { name: "userId", in: "path", schema: { type: "string" } }
            ];
            const operation = {
                summary: "Get user posts",
                parameters: [
                    { name: "page", in: "query", schema: { type: "integer" } }
                ],
                responses: { "200": { description: "Success" } }
            };

            const result = parseOperation("/users/{userId}/posts", "GET", operation, pathParams, {});

            result.paramsSchema.should.not.be.empty();
            result.querySchema.should.not.be.empty();
        });

        it("should detect CRUD operations when enabled", function () {
            const operation = {
                summary: "Get user",
                responses: { "200": { description: "Success" } }
            };

            const result = parseOperation("/users/{id}", "GET", operation, [], {}, { detectCrud: true });
            result.crudOperation.should.equal("read");

            const listResult = parseOperation("/users", "GET", operation, [], {}, { detectCrud: true });
            listResult.crudOperation.should.equal("list");
            listResult.paginationEnabled.should.equal(true);
        });

        it("should extract security scopes", function () {
            const operation = {
                summary: "Get protected resource",
                security: [{ oauth2: ["read:data", "write:data"] }],
                responses: { "200": { description: "Success" } }
            };
            const components = {
                securitySchemes: {
                    oauth2: { type: "oauth2", flows: {} }
                }
            };

            const result = parseOperation("/protected", "GET", operation, [], components, { globalSecurity: [] });

            result.requiredScopes.should.containEql("read:data");
            result.requiredScopes.should.containEql("write:data");
        });
    });

    describe("parseOpenApiSpec", function () {
        const minimalSpec = {
            openapi: "3.1.0",
            info: { title: "Test API", version: "1.0.0" },
            paths: {
                "/users": {
                    get: {
                        summary: "List users",
                        responses: { "200": { description: "Success" } }
                    },
                    post: {
                        summary: "Create user",
                        responses: { "201": { description: "Created" } }
                    }
                },
                "/users/{id}": {
                    get: {
                        summary: "Get user",
                        parameters: [
                            { name: "id", in: "path", schema: { type: "integer" }, required: true }
                        ],
                        responses: { "200": { description: "Success" } }
                    }
                }
            }
        };

        it("should parse a minimal OpenAPI spec", function () {
            const result = parseOpenApiSpec(minimalSpec);

            result.should.have.property("apiInfo");
            result.apiInfo.title.should.equal("Test API");
            result.apiInfo.version.should.equal("1.0.0");

            result.should.have.property("endpoints");
            result.endpoints.should.have.length(3);

            result.should.have.property("summary");
            result.summary.totalEndpoints.should.equal(3);
            result.summary.byMethod.should.have.property("GET", 2);
            result.summary.byMethod.should.have.property("POST", 1);
        });

        it("should throw for invalid spec", function () {
            should.throws(() => parseOpenApiSpec(null), /Invalid OpenAPI specification/);
            should.throws(() => parseOpenApiSpec({}), /Unsupported OpenAPI version/);
            should.throws(() => parseOpenApiSpec({ openapi: "2.0" }), /Unsupported OpenAPI version/);
        });

        it("should reject OpenAPI 3.0.x specs (3.1-only)", function () {
            should.throws(() => parseOpenApiSpec({ openapi: "3.0.3", info: { title: "x", version: "1" }, paths: {} }), /Only OpenAPI 3\.1\.x is supported/);
            should.throws(() => parseOpenApiSpec({ openapi: "3.0.0", info: { title: "x", version: "1" }, paths: {} }), /Only OpenAPI 3\.1\.x is supported/);
        });

        it("should accept a 3.1 spec with webhooks and no paths", function () {
            const spec = {
                openapi: "3.1.0",
                info: { title: "Webhook-only", version: "1.0.0" },
                webhooks: {
                    newPet: {
                        post: {
                            responses: { "200": { description: "ok" } }
                        }
                    }
                }
            };
            const result = parseOpenApiSpec(spec);
            result.endpoints.should.have.length(0);
            result.apiInfo.title.should.equal("Webhook-only");
        });

        it("should extract tags", function () {
            const specWithTags = {
                ...minimalSpec,
                paths: {
                    "/users": {
                        get: {
                            tags: ["users", "public"],
                            summary: "List users",
                            responses: { "200": { description: "Success" } }
                        }
                    }
                }
            };

            const result = parseOpenApiSpec(specWithTags);
            result.tags.should.containEql("users");
            result.tags.should.containEql("public");
        });

        it("should extract security schemes", function () {
            const specWithSecurity = {
                ...minimalSpec,
                components: {
                    securitySchemes: {
                        oauth2: {
                            type: "oauth2",
                            flows: {
                                authorizationCode: {
                                    authorizationUrl: "https://auth.example.com/authorize",
                                    tokenUrl: "https://auth.example.com/token",
                                    scopes: {
                                        "read:users": "Read users",
                                        "write:users": "Write users"
                                    }
                                }
                            }
                        }
                    }
                }
            };

            const result = parseOpenApiSpec(specWithSecurity);
            result.securitySchemes.should.have.property("oauth2");
            result.summary.hasOAuth2.should.equal(true);
        });

        it("should resolve $ref in schemas", function () {
            const specWithRefs = {
                openapi: "3.1.0",
                info: { title: "Test API", version: "1.0.0" },
                paths: {
                    "/users": {
                        post: {
                            summary: "Create user",
                            requestBody: {
                                content: {
                                    "application/json": {
                                        schema: { $ref: "#/components/schemas/User" }
                                    }
                                }
                            },
                            responses: { "201": { description: "Created" } }
                        }
                    }
                },
                components: {
                    schemas: {
                        User: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                email: { type: "string" }
                            }
                        }
                    }
                }
            };

            const result = parseOpenApiSpec(specWithRefs);
            result.endpoints.should.have.length(1);
            const endpoint = result.endpoints[0];
            endpoint.bodySchema.should.not.be.empty();
            const bodySchema = JSON.parse(endpoint.bodySchema);
            bodySchema.properties.should.have.property("name");
        });
    });

    describe("Filter Functions", function () {
        const endpoints = [
            { path: "/users", method: "GET", _metadata: { originalPath: "/users", tags: ["users"] } },
            { path: "/users/:id", method: "GET", _metadata: { originalPath: "/users/{id}", tags: ["users"] } },
            { path: "/users", method: "POST", _metadata: { originalPath: "/users", tags: ["users"] } },
            { path: "/posts", method: "GET", _metadata: { originalPath: "/posts", tags: ["posts"] } },
            { path: "/posts/:id", method: "DELETE", _metadata: { originalPath: "/posts/{id}", tags: ["posts"] } }
        ];

        describe("filterEndpointsByPath", function () {
            it("should return all endpoints when no patterns", function () {
                filterEndpointsByPath(endpoints, []).should.deepEqual(endpoints);
                filterEndpointsByPath(endpoints, null).should.deepEqual(endpoints);
            });

            it("should filter by exact path", function () {
                const result = filterEndpointsByPath(endpoints, ["/users"]);
                result.should.have.length(3);
            });

            it("should filter by wildcard pattern", function () {
                const result = filterEndpointsByPath(endpoints, ["/users/*"]);
                result.should.have.length(1);
                result[0].path.should.equal("/users/:id");
            });

            it("should support multiple patterns", function () {
                const result = filterEndpointsByPath(endpoints, ["/users", "/posts"]);
                result.should.have.length(5);
            });
        });

        describe("filterEndpointsByTags", function () {
            it("should return all endpoints when no tags", function () {
                filterEndpointsByTags(endpoints, []).should.deepEqual(endpoints);
                filterEndpointsByTags(endpoints, null).should.deepEqual(endpoints);
            });

            it("should filter by single tag", function () {
                const result = filterEndpointsByTags(endpoints, ["users"]);
                result.should.have.length(3);
            });

            it("should filter by multiple tags (OR)", function () {
                const result = filterEndpointsByTags(endpoints, ["users", "posts"]);
                result.should.have.length(5);
            });
        });

        describe("filterEndpointsByMethods", function () {
            it("should return all endpoints when no methods", function () {
                filterEndpointsByMethods(endpoints, []).should.deepEqual(endpoints);
                filterEndpointsByMethods(endpoints, null).should.deepEqual(endpoints);
            });

            it("should filter by single method", function () {
                const result = filterEndpointsByMethods(endpoints, ["GET"]);
                result.should.have.length(3);
            });

            it("should filter by multiple methods", function () {
                const result = filterEndpointsByMethods(endpoints, ["GET", "POST"]);
                result.should.have.length(4);
            });

            it("should be case-insensitive", function () {
                const result = filterEndpointsByMethods(endpoints, ["get", "post"]);
                result.should.have.length(4);
            });
        });
    });

    describe("parseOpenApi (format detection)", function () {
        it("should throw for empty content", function () {
            should.throws(() => parseOpenApi(""), /Content must be a non-empty string/);
            should.throws(() => parseOpenApi(null), /Content must be a non-empty string/);
        });

        it("should parse JSON when content starts with {", function () {
            const json = JSON.stringify({
                openapi: "3.1.0",
                info: { title: "Test", version: "1.0.0" },
                paths: {}
            });

            const result = parseOpenApi(json);
            result.apiInfo.title.should.equal("Test");
        });

        it("should throw for invalid JSON", function () {
            should.throws(() => parseOpenApi("{ invalid json }"), /Invalid JSON/);
        });
    });

    describe("parseFromJson", function () {
        it("should parse valid JSON string", function () {
            const json = JSON.stringify({
                openapi: "3.1.0",
                info: { title: "JSON API", version: "2.0.0" },
                paths: {}
            });

            const result = parseFromJson(json);
            result.apiInfo.title.should.equal("JSON API");
            result.apiInfo.version.should.equal("2.0.0");
        });

        it("should throw for invalid JSON", function () {
            should.throws(() => parseFromJson("not json"), /Invalid JSON/);
        });
    });

    describe("OpenApiParser Class", function () {
        const testSpec = JSON.stringify({
            openapi: "3.1.0",
            info: { title: "Parser Test API", version: "1.0.0", description: "Test description" },
            paths: {
                "/items": {
                    get: {
                        tags: ["items"],
                        summary: "List items",
                        responses: { "200": { description: "Success" } }
                    },
                    post: {
                        tags: ["items"],
                        summary: "Create item",
                        responses: { "201": { description: "Created" } }
                    }
                },
                "/items/{id}": {
                    get: {
                        tags: ["items"],
                        summary: "Get item",
                        responses: { "200": { description: "Success" } }
                    }
                }
            }
        });

        it("should create parser with default options", function () {
            const parser = new OpenApiParser();
            should.exist(parser);
            parser.options.detectCrud.should.equal(true);
        });

        it("should create parser with custom options", function () {
            const parser = new OpenApiParser({ detectCrud: false });
            parser.options.detectCrud.should.equal(false);
        });

        it("should parse and store result", function () {
            const parser = new OpenApiParser();
            const result = parser.parse(testSpec);

            result.endpoints.should.have.length(3);
            parser.lastResult.should.equal(result);
        });

        it("should provide summary", function () {
            const parser = new OpenApiParser();
            parser.parse(testSpec);

            const summary = parser.getSummary();
            summary.totalEndpoints.should.equal(3);
            summary.byMethod.GET.should.equal(2);
            summary.byMethod.POST.should.equal(1);
        });

        it("should provide API info", function () {
            const parser = new OpenApiParser();
            parser.parse(testSpec);

            const apiInfo = parser.getApiInfo();
            apiInfo.title.should.equal("Parser Test API");
            apiInfo.description.should.equal("Test description");
        });

        it("should provide tags", function () {
            const parser = new OpenApiParser();
            parser.parse(testSpec);

            const tags = parser.getTags();
            tags.should.containEql("items");
        });

        it("should filter endpoints", function () {
            const parser = new OpenApiParser();
            parser.parse(testSpec);

            const filtered = parser.getFilteredEndpoints({ methods: ["GET"] });
            filtered.should.have.length(2);
        });

        it("should throw when getting filtered endpoints without parsing first", function () {
            const parser = new OpenApiParser();
            should.throws(() => parser.getFilteredEndpoints({}), /No parsed result available/);
        });
    });

    describe("Complex OpenAPI Spec", function () {
        const complexSpec = {
            openapi: "3.1.0",
            info: {
                title: "Complex API",
                version: "1.0.0",
                description: "A complex API for testing",
                contact: { name: "Support", email: "support@example.com" },
                license: { name: "MIT" }
            },
            servers: [
                { url: "https://api.example.com", description: "Production" },
                { url: "https://staging-api.example.com", description: "Staging" }
            ],
            security: [{ oauth2: ["read"] }],
            paths: {
                "/users": {
                    parameters: [
                        { name: "X-Request-ID", in: "header", schema: { type: "string" } }
                    ],
                    get: {
                        tags: ["users"],
                        summary: "List users",
                        parameters: [
                            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
                            { name: "limit", in: "query", schema: { type: "integer", default: 20 } }
                        ],
                        responses: {
                            "200": {
                                description: "Success",
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object",
                                            properties: {
                                                data: {
                                                    type: "array",
                                                    items: { $ref: "#/components/schemas/User" }
                                                },
                                                meta: { $ref: "#/components/schemas/Pagination" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    post: {
                        tags: ["users"],
                        summary: "Create user",
                        security: [{ oauth2: ["write:users"] }],
                        requestBody: {
                            required: true,
                            content: {
                                "application/json": {
                                    schema: { $ref: "#/components/schemas/CreateUser" }
                                }
                            }
                        },
                        responses: {
                            "201": {
                                description: "Created",
                                content: {
                                    "application/json": {
                                        schema: { $ref: "#/components/schemas/User" }
                                    }
                                }
                            },
                            "400": { $ref: "#/components/responses/BadRequest" }
                        }
                    }
                }
            },
            components: {
                schemas: {
                    User: {
                        type: "object",
                        properties: {
                            id: { type: "integer" },
                            name: { type: "string" },
                            email: { type: "string", format: "email" }
                        },
                        required: ["id", "name", "email"]
                    },
                    CreateUser: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            email: { type: "string", format: "email" }
                        },
                        required: ["name", "email"]
                    },
                    Pagination: {
                        type: "object",
                        properties: {
                            page: { type: "integer" },
                            limit: { type: "integer" },
                            total: { type: "integer" }
                        }
                    }
                },
                responses: {
                    BadRequest: {
                        description: "Bad request",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        error: { type: "string" }
                                    }
                                }
                            }
                        }
                    }
                },
                securitySchemes: {
                    oauth2: {
                        type: "oauth2",
                        flows: {
                            authorizationCode: {
                                authorizationUrl: "https://auth.example.com/authorize",
                                tokenUrl: "https://auth.example.com/token",
                                scopes: {
                                    read: "Read access",
                                    "write:users": "Write users"
                                }
                            }
                        }
                    }
                }
            }
        };

        it("should parse complex spec with components", function () {
            const result = parseOpenApiSpec(complexSpec);

            result.apiInfo.title.should.equal("Complex API");
            result.endpoints.should.have.length(2);
            result.servers.should.have.length(2);
            result.summary.hasOAuth2.should.equal(true);
        });

        it("should resolve schema references in request body", function () {
            const result = parseOpenApiSpec(complexSpec);
            const postEndpoint = result.endpoints.find(e => e.method === "POST");

            postEndpoint.bodySchema.should.not.be.empty();
            const bodySchema = JSON.parse(postEndpoint.bodySchema);
            bodySchema.properties.should.have.property("name");
            bodySchema.properties.should.have.property("email");
        });

        it("should resolve schema references in responses", function () {
            const result = parseOpenApiSpec(complexSpec);
            const getEndpoint = result.endpoints.find(e => e.method === "GET");

            getEndpoint.responseSchemas.should.not.be.empty();
            const responseSchemas = JSON.parse(getEndpoint.responseSchemas);
            responseSchemas.should.have.property("200");
        });

        it("should extract operation-specific security", function () {
            const result = parseOpenApiSpec(complexSpec);
            const postEndpoint = result.endpoints.find(e => e.method === "POST");

            postEndpoint.requiredScopes.should.containEql("write:users");
        });

        it("should inherit global security", function () {
            const result = parseOpenApiSpec(complexSpec);
            const getEndpoint = result.endpoints.find(e => e.method === "GET");

            getEndpoint.requiredScopes.should.containEql("read");
        });
    });
});
