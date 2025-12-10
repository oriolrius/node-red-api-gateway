const should = require("should");
const {
    createAjv,
    getAjv,
    ValidationResult,
    SchemaValidator,
    validateBody,
    validateQuery,
    validateParams,
    validateResponse,
    createParamSchema,
    mapParamType,
    validateSchema,
    parseSchema,
    parseResponseSchemas
} = require("../../lib/schema-validator");

describe("schema-validator", function () {

    describe("createAjv", function () {
        it("should create an AJV instance", function () {
            const ajv = createAjv();
            ajv.should.be.an.Object();
            ajv.should.have.property("compile");
        });

        it("should accept custom options", function () {
            const ajv = createAjv({ coerceTypes: true });
            ajv.should.be.an.Object();
        });
    });

    describe("getAjv", function () {
        it("should return a shared AJV instance", function () {
            const ajv1 = getAjv();
            const ajv2 = getAjv();
            ajv1.should.equal(ajv2);
        });
    });

    describe("ValidationResult", function () {
        it("should create successful result with success()", function () {
            const result = ValidationResult.success({ name: "test" });
            result.valid.should.be.true();
            result.errors.should.have.length(0);
            result.data.should.deepEqual({ name: "test" });
        });

        it("should create failed result with failure()", function () {
            const errors = [{ message: "error1" }, { message: "error2" }];
            const result = ValidationResult.failure(errors);
            result.valid.should.be.false();
            result.errors.should.have.length(2);
            should(result.data).be.null();
        });

        it("should convert to HTTP error format", function () {
            const errors = [{
                instancePath: "/name",
                message: "must be string",
                keyword: "type",
                params: { type: "string" }
            }];
            const result = ValidationResult.failure(errors);
            const httpError = result.toHttpError();

            httpError.should.have.property("statusCode", 400);
            httpError.should.have.property("error", "Bad Request");
            httpError.should.have.property("message", "Validation failed");
            httpError.should.have.property("details").which.is.an.Array();
            httpError.details[0].should.have.property("path", "/name");
            httpError.details[0].should.have.property("message", "must be string");
        });
    });

    describe("SchemaValidator", function () {
        let validator;

        beforeEach(function () {
            validator = new SchemaValidator();
        });

        describe("compile", function () {
            it("should compile a valid schema", function () {
                const schema = { type: "object", properties: { name: { type: "string" } } };
                const compiled = validator.compile("test", schema);
                compiled.should.be.a.Function();
            });

            it("should store compiled schema for reuse", function () {
                const schema = { type: "string" };
                validator.compile("mySchema", schema);
                const retrieved = validator.getCompiled("mySchema");
                retrieved.should.be.a.Function();
            });

            it("should throw error for invalid schema", function () {
                const invalidSchema = { type: "invalid_type" };
                should.throws(function () {
                    validator.compile("bad", invalidSchema);
                }, /Failed to compile schema/);
            });

            it("should throw error for non-object schema", function () {
                should.throws(function () {
                    validator.compile("bad", null);
                }, /Schema must be an object/);
            });
        });

        describe("validate", function () {
            it("should validate data against schema object", function () {
                const schema = {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        age: { type: "integer" }
                    },
                    required: ["name"]
                };
                const data = { name: "John", age: 30 };
                const result = validator.validate(data, schema);

                result.valid.should.be.true();
                result.data.should.deepEqual(data);
            });

            it("should return errors for invalid data", function () {
                const schema = {
                    type: "object",
                    properties: {
                        name: { type: "string" }
                    },
                    required: ["name"]
                };
                const data = { name: 123 };
                const result = validator.validate(data, schema);

                result.valid.should.be.false();
                result.errors.length.should.be.above(0);
            });

            it("should validate against compiled schema key", function () {
                const schema = { type: "string" };
                validator.compile("stringSchema", schema);

                const result = validator.validate("hello", "stringSchema");
                result.valid.should.be.true();
            });

            it("should return error for non-existent schema key", function () {
                const result = validator.validate("test", "nonExistent");
                result.valid.should.be.false();
                result.errors[0].message.should.containEql("Schema not found");
            });

            it("should handle defaults in schema", function () {
                const schema = {
                    type: "object",
                    properties: {
                        name: { type: "string", default: "Unknown" }
                    }
                };
                const data = {};
                const result = validator.validate(data, schema);

                result.valid.should.be.true();
                result.data.should.have.property("name", "Unknown");
            });
        });

        describe("clear", function () {
            it("should clear all compiled schemas", function () {
                validator.compile("test1", { type: "string" });
                validator.compile("test2", { type: "number" });
                validator.clear();

                should(validator.getCompiled("test1")).be.null();
                should(validator.getCompiled("test2")).be.null();
            });
        });
    });

    describe("validateBody", function () {
        it("should pass when no schema provided", function () {
            const result = validateBody({ any: "data" }, null);
            result.valid.should.be.true();
        });

        it("should validate body against schema", function () {
            const schema = {
                type: "object",
                properties: {
                    name: { type: "string" },
                    email: { type: "string", format: "email" }
                },
                required: ["name", "email"]
            };
            const body = { name: "John", email: "john@example.com" };
            const result = validateBody(body, schema);

            result.valid.should.be.true();
        });

        it("should fail for invalid email format", function () {
            const schema = {
                type: "object",
                properties: {
                    email: { type: "string", format: "email" }
                }
            };
            const body = { email: "not-an-email" };
            const result = validateBody(body, schema);

            result.valid.should.be.false();
        });

        it("should fail for missing required field", function () {
            const schema = {
                type: "object",
                properties: {
                    name: { type: "string" }
                },
                required: ["name"]
            };
            const result = validateBody({}, schema);

            result.valid.should.be.false();
            result.errors.some(e => e.keyword === "required").should.be.true();
        });
    });

    describe("validateQuery", function () {
        it("should pass when no schema provided", function () {
            const result = validateQuery({ page: "1" }, null);
            result.valid.should.be.true();
        });

        it("should coerce string types to numbers", function () {
            const schema = {
                type: "object",
                properties: {
                    page: { type: "integer" },
                    limit: { type: "integer" }
                }
            };
            const query = { page: "1", limit: "10" };
            const result = validateQuery(query, schema);

            result.valid.should.be.true();
            result.data.page.should.equal(1);
            result.data.limit.should.equal(10);
        });

        it("should validate query parameter constraints", function () {
            const schema = {
                type: "object",
                properties: {
                    page: { type: "integer", minimum: 1 },
                    limit: { type: "integer", maximum: 100 }
                }
            };
            const query = { page: "0", limit: "10" };
            const result = validateQuery(query, schema);

            result.valid.should.be.false();
        });

        it("should handle empty query", function () {
            const schema = {
                type: "object",
                properties: {
                    page: { type: "integer" }
                }
            };
            const result = validateQuery(null, schema);
            result.valid.should.be.true();
        });
    });

    describe("validateParams", function () {
        it("should pass when no schema provided", function () {
            const result = validateParams({ id: "123" }, null);
            result.valid.should.be.true();
        });

        it("should coerce string params to integers", function () {
            const schema = {
                type: "object",
                properties: {
                    id: { type: "integer" }
                },
                required: ["id"]
            };
            const params = { id: "123" };
            const result = validateParams(params, schema);

            result.valid.should.be.true();
            result.data.id.should.equal(123);
        });

        it("should fail for invalid param type", function () {
            const schema = {
                type: "object",
                properties: {
                    id: { type: "integer" }
                }
            };
            const params = { id: "not-a-number" };
            const result = validateParams(params, schema);

            result.valid.should.be.false();
        });

        it("should handle empty params", function () {
            const schema = {
                type: "object",
                properties: {
                    id: { type: "integer" }
                }
            };
            const result = validateParams(null, schema);
            result.valid.should.be.true();
        });
    });

    describe("createParamSchema", function () {
        it("should create schema from type mapping", function () {
            const schema = createParamSchema({
                id: "integer",
                name: "string"
            });

            schema.should.have.property("type", "object");
            schema.should.have.property("properties");
            schema.properties.id.should.deepEqual({ type: "integer" });
            schema.properties.name.should.deepEqual({ type: "string" });
            schema.required.should.containDeep(["id", "name"]);
        });

        it("should return null for invalid input", function () {
            should(createParamSchema(null)).be.null();
            should(createParamSchema("string")).be.null();
        });

        it("should accept schema objects as values", function () {
            const schema = createParamSchema({
                id: { type: "integer", minimum: 1 }
            });

            schema.properties.id.should.deepEqual({ type: "integer", minimum: 1 });
        });
    });

    describe("mapParamType", function () {
        it("should map common type names", function () {
            mapParamType("string").should.equal("string");
            mapParamType("str").should.equal("string");
            mapParamType("integer").should.equal("integer");
            mapParamType("int").should.equal("integer");
            mapParamType("number").should.equal("number");
            mapParamType("num").should.equal("number");
            mapParamType("boolean").should.equal("boolean");
            mapParamType("bool").should.equal("boolean");
        });

        it("should be case-insensitive", function () {
            mapParamType("STRING").should.equal("string");
            mapParamType("Integer").should.equal("integer");
        });

        it("should default to string for unknown types", function () {
            mapParamType("unknown").should.equal("string");
        });
    });

    describe("validateSchema", function () {
        it("should validate correct schema", function () {
            const schema = {
                type: "object",
                properties: {
                    name: { type: "string" }
                }
            };
            const result = validateSchema(schema);
            result.valid.should.be.true();
        });

        it("should reject non-object schema", function () {
            validateSchema(null).valid.should.be.false();
            validateSchema("string").valid.should.be.false();
        });

        it("should reject invalid schema syntax", function () {
            const badSchema = { type: "invalid_type_name" };
            const result = validateSchema(badSchema);
            result.valid.should.be.false();
            result.should.have.property("error");
        });
    });

    describe("parseSchema", function () {
        it("should parse valid JSON schema string", function () {
            const schemaStr = '{"type": "object", "properties": {"name": {"type": "string"}}}';
            const result = parseSchema(schemaStr);

            should(result.error).be.undefined();
            result.schema.should.deepEqual({
                type: "object",
                properties: { name: { type: "string" } }
            });
        });

        it("should return error for invalid JSON", function () {
            const result = parseSchema("{invalid json}");
            result.should.have.property("error");
            should(result.schema).be.null();
        });

        it("should return error for empty string", function () {
            const result = parseSchema("");
            result.should.have.property("error");
        });

        it("should return error for non-string input", function () {
            const result = parseSchema(null);
            result.should.have.property("error");
        });

        it("should validate schema after parsing", function () {
            const schemaStr = '{"type": "invalid_type"}';
            const result = parseSchema(schemaStr);
            result.should.have.property("error");
            should(result.schema).be.null();
        });
    });

    describe("Format validation", function () {
        let validator;

        beforeEach(function () {
            validator = new SchemaValidator();
        });

        it("should validate email format", function () {
            const schema = { type: "string", format: "email" };
            validator.validate("test@example.com", schema).valid.should.be.true();
            validator.validate("not-an-email", schema).valid.should.be.false();
        });

        it("should validate uri format", function () {
            const schema = { type: "string", format: "uri" };
            validator.validate("https://example.com", schema).valid.should.be.true();
            validator.validate("not-a-uri", schema).valid.should.be.false();
        });

        it("should validate date-time format", function () {
            const schema = { type: "string", format: "date-time" };
            validator.validate("2024-01-15T10:30:00Z", schema).valid.should.be.true();
            validator.validate("not-a-date", schema).valid.should.be.false();
        });

        it("should validate uuid format", function () {
            const schema = { type: "string", format: "uuid" };
            validator.validate("550e8400-e29b-41d4-a716-446655440000", schema).valid.should.be.true();
            validator.validate("not-a-uuid", schema).valid.should.be.false();
        });
    });

    describe("Complex schema validation", function () {
        let validator;

        beforeEach(function () {
            validator = new SchemaValidator();
        });

        it("should validate nested objects", function () {
            const schema = {
                type: "object",
                properties: {
                    user: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            address: {
                                type: "object",
                                properties: {
                                    city: { type: "string" },
                                    zip: { type: "string" }
                                }
                            }
                        }
                    }
                }
            };
            const data = {
                user: {
                    name: "John",
                    address: { city: "NYC", zip: "10001" }
                }
            };
            const result = validator.validate(data, schema);
            result.valid.should.be.true();
        });

        it("should validate arrays", function () {
            const schema = {
                type: "array",
                items: { type: "integer" },
                minItems: 1,
                maxItems: 5
            };
            validator.validate([1, 2, 3], schema).valid.should.be.true();
            validator.validate([], schema).valid.should.be.false();
            validator.validate([1, 2, 3, 4, 5, 6], schema).valid.should.be.false();
        });

        it("should validate with additionalProperties", function () {
            const schema = {
                type: "object",
                properties: {
                    name: { type: "string" }
                },
                additionalProperties: false
            };
            validator.validate({ name: "John" }, schema).valid.should.be.true();
            validator.validate({ name: "John", extra: "field" }, schema).valid.should.be.false();
        });

        it("should validate enum values", function () {
            const schema = {
                type: "string",
                enum: ["pending", "active", "completed"]
            };
            validator.validate("active", schema).valid.should.be.true();
            validator.validate("invalid", schema).valid.should.be.false();
        });

        it("should validate pattern matching", function () {
            const schema = {
                type: "string",
                pattern: "^[A-Z]{2}[0-9]{4}$"
            };
            validator.validate("AB1234", schema).valid.should.be.true();
            validator.validate("ab1234", schema).valid.should.be.false();
        });
    });

    describe("validateResponse", function () {
        it("should pass when no schema provided", function () {
            const result = validateResponse({ data: "any" }, null);
            result.valid.should.be.true();
        });

        it("should validate response against schema", function () {
            const schema = {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string" }
                },
                required: ["id", "name"]
            };
            const result = validateResponse({ id: 1, name: "John" }, schema);
            result.valid.should.be.true();
        });

        it("should fail for invalid response", function () {
            const schema = {
                type: "object",
                properties: {
                    id: { type: "integer" }
                },
                required: ["id"]
            };
            const result = validateResponse({ name: "John" }, schema);
            result.valid.should.be.false();
            result.errors.length.should.be.above(0);
        });

        it("should validate response arrays", function () {
            const schema = {
                type: "array",
                items: {
                    type: "object",
                    properties: { id: { type: "integer" } }
                }
            };
            const result = validateResponse([{ id: 1 }, { id: 2 }], schema);
            result.valid.should.be.true();
        });
    });

    describe("parseResponseSchemas", function () {
        it("should return empty object for null input", function () {
            const result = parseResponseSchemas(null);
            result.schemas.should.deepEqual({});
            should(result.error).be.null();
        });

        it("should return empty object for empty string", function () {
            const result = parseResponseSchemas("");
            result.schemas.should.deepEqual({});
            should(result.error).be.null();
        });

        it("should parse valid response schemas", function () {
            const schemasStr = JSON.stringify({
                "200": { type: "object", properties: { id: { type: "integer" } } },
                "404": { type: "object", properties: { error: { type: "string" } } }
            });
            const result = parseResponseSchemas(schemasStr);
            result.schemas.should.have.property("200");
            result.schemas.should.have.property("404");
            result.schemas["200"].properties.should.have.property("id");
        });

        it("should accept default schema", function () {
            const schemasStr = JSON.stringify({
                "200": { type: "object" },
                "default": { type: "object", properties: { error: { type: "string" } } }
            });
            const result = parseResponseSchemas(schemasStr);
            result.schemas.should.have.property("200");
            result.schemas.should.have.property("default");
        });

        it("should reject invalid status codes", function () {
            const schemasStr = JSON.stringify({
                "999": { type: "object" }
            });
            const result = parseResponseSchemas(schemasStr);
            should(result.schemas).be.null();
            result.error.should.containEql("Invalid status code");
        });

        it("should reject non-numeric status codes", function () {
            const schemasStr = JSON.stringify({
                "abc": { type: "object" }
            });
            const result = parseResponseSchemas(schemasStr);
            should(result.schemas).be.null();
            result.error.should.containEql("Invalid status code");
        });

        it("should reject non-object schemas", function () {
            const schemasStr = JSON.stringify({
                "200": "not an object"
            });
            const result = parseResponseSchemas(schemasStr);
            should(result.schemas).be.null();
            result.error.should.containEql("must be an object");
        });

        it("should reject invalid JSON", function () {
            const result = parseResponseSchemas("not valid json");
            should(result.schemas).be.null();
            result.error.should.containEql("Invalid JSON");
        });

        it("should reject array input", function () {
            const result = parseResponseSchemas("[]");
            should(result.schemas).be.null();
            result.error.should.containEql("must be an object");
        });

        it("should validate each schema syntax", function () {
            const schemasStr = JSON.stringify({
                "200": { type: "invalid-type" }
            });
            const result = parseResponseSchemas(schemasStr);
            should(result.schemas).be.null();
            result.error.should.containEql("Invalid schema for status 200");
        });

        it("should parse all valid 1xx-5xx status codes", function () {
            const schemasStr = JSON.stringify({
                "100": { type: "object" },
                "201": { type: "object" },
                "301": { type: "object" },
                "400": { type: "object" },
                "500": { type: "object" }
            });
            const result = parseResponseSchemas(schemasStr);
            Object.keys(result.schemas).should.have.length(5);
        });
    });
});
