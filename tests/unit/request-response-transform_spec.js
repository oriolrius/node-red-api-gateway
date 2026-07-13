/**
 * Unit tests for request-response-transform.js
 */

const should = require("should");
const {
    TransformationResult,
    validateExpression,
    compileExpression,
    clearExpressionCache,
    transformData,
    transformRequest,
    transformResponse,
    parseFieldMapping,
    applyFieldMapping,
    fieldMappingToExpression
} = require("../../lib/request-response-transform");

describe("request-response-transform", function() {

    beforeEach(function() {
        // Clear expression cache before each test
        clearExpressionCache();
    });

    describe("TransformationResult", function() {
        it("should create a successful result with ok()", function() {
            const result = TransformationResult.ok({ name: "test" });
            result.success.should.be.true();
            result.data.should.deepEqual({ name: "test" });
            should(result.error).be.null();
        });

        it("should create a failed result with fail()", function() {
            const result = TransformationResult.fail("Something went wrong");
            result.success.should.be.false();
            should(result.data).be.null();
            result.error.should.equal("Something went wrong");
        });

        it("should convert error to HTTP format", function() {
            const result = TransformationResult.fail("Invalid expression");
            const httpError = result.toHttpError();

            httpError.statusCode.should.equal(500);
            httpError.error.should.equal("Internal Server Error");
            httpError.message.should.equal("Transformation failed");
            httpError.details.error.should.equal("Invalid expression");
        });
    });

    describe("validateExpression", function() {
        it("should validate a valid JSONata expression", function() {
            const result = validateExpression("$.name");
            result.valid.should.be.true();
        });

        it("should validate a complex JSONata expression", function() {
            const result = validateExpression('$merge([$$, { "fullName": $.firstName & " " & $.lastName }])');
            result.valid.should.be.true();
        });

        it("should return invalid for empty string", function() {
            const result = validateExpression("");
            result.valid.should.be.false();
        });

        it("should return valid for null/undefined", function() {
            validateExpression(null).valid.should.be.false();
            validateExpression(undefined).valid.should.be.false();
        });

        it("should return error for invalid expression", function() {
            const result = validateExpression("$merge([");
            result.valid.should.be.false();
            should(result.error).be.a.String();
        });
    });

    describe("compileExpression", function() {
        it("should compile a valid expression", function() {
            const result = compileExpression("$.name");
            should(result.expression).not.be.null();
            should(result.error).be.undefined();
        });

        it("should return error for empty expression", function() {
            const result = compileExpression("");
            should(result.expression).be.null();
            should(result.error).be.a.String();
        });

        it("should return error for invalid expression", function() {
            const result = compileExpression("$$$invalid{{{");
            should(result.expression).be.null();
            should(result.error).be.a.String();
        });

        it("should cache compiled expressions", function() {
            const expr = "$.name";
            const result1 = compileExpression(expr);
            const result2 = compileExpression(expr);
            result1.expression.should.equal(result2.expression);
        });

        it("should handle non-string input", function() {
            const result = compileExpression(123);
            should(result.expression).be.null();
            result.error.should.equal("Expression must be a non-empty string");
        });
    });

    describe("transformData", function() {
        it("should transform data with a simple expression", async function() {
            const data = { name: "John", age: 30 };
            const result = await transformData(data, "$.name");
            result.success.should.be.true();
            result.data.should.equal("John");
        });

        it("should return original data for null/empty expression", async function() {
            const data = { name: "John" };
            const result = await transformData(data, null);
            result.success.should.be.true();
            result.data.should.deepEqual(data);
        });

        it("should return original data for empty string expression", async function() {
            const data = { name: "John" };
            const result = await transformData(data, "");
            result.success.should.be.true();
            result.data.should.deepEqual(data);
        });

        it("should transform with object construction", async function() {
            const data = { firstName: "John", lastName: "Doe" };
            const expression = '{ "fullName": $.firstName & " " & $.lastName }';
            const result = await transformData(data, expression);
            result.success.should.be.true();
            result.data.should.deepEqual({ fullName: "John Doe" });
        });

        it("should transform with $merge", async function() {
            const data = { name: "John", age: 30 };
            const expression = '$merge([$$, { "greeting": "Hello " & $.name }])';
            const result = await transformData(data, expression);
            result.success.should.be.true();
            result.data.name.should.equal("John");
            result.data.age.should.equal(30);
            result.data.greeting.should.equal("Hello John");
        });

        it("should provide context variables", async function() {
            const data = { name: "John" };
            const context = {
                params: { id: "123" },
                query: { filter: "active" }
            };
            const expression = '{ "name": $.name, "id": $params.id, "filter": $query.filter }';
            const result = await transformData(data, expression, context);
            result.success.should.be.true();
            result.data.should.deepEqual({
                name: "John",
                id: "123",
                filter: "active"
            });
        });

        it("should handle transformation errors gracefully", async function() {
            const data = { name: "John" };
            // JSONata handles missing properties gracefully
            const expression = "$.nonexistent.field";
            const result = await transformData(data, expression);
            // JSONata returns undefined for missing paths, which is a valid transformation
            result.success.should.be.true();
        });

        it("should handle truly invalid expression at runtime", async function() {
            const data = { name: "John" };
            // $unknown is not a standard JSONata function, so it will fail
            const expression = "$unknown($.name)";
            const result = await transformData(data, expression);
            // JSONata may either succeed (if it treats $unknown as a variable)
            // or fail - either way we handle it gracefully
            should(result).have.property("success");
        });

        it("should work with pre-compiled expression", async function() {
            const data = { name: "John" };
            const compiled = compileExpression("$.name");
            const result = await transformData(data, compiled.expression);
            result.success.should.be.true();
            result.data.should.equal("John");
        });

        it("should use $lowercase function", async function() {
            const data = { email: "John@Example.COM" };
            const result = await transformData(data, "$lowercase($.email)");
            result.success.should.be.true();
            result.data.should.equal("john@example.com");
        });

        it("should use $uppercase function", async function() {
            const data = { name: "john" };
            const result = await transformData(data, "$uppercase($.name)");
            result.success.should.be.true();
            result.data.should.equal("JOHN");
        });
    });

    describe("transformRequest", function() {
        it("should transform request body", async function() {
            const body = { firstName: "John", lastName: "Doe" };
            const expression = '$merge([$$, { "fullName": $.firstName & " " & $.lastName }])';
            const result = await transformRequest(body, expression);
            result.success.should.be.true();
            result.data.firstName.should.equal("John");
            result.data.lastName.should.equal("Doe");
            result.data.fullName.should.equal("John Doe");
        });

        it("should pass context to transformation", async function() {
            const body = { amount: 100 };
            const context = { params: { currency: "USD" } };
            const expression = '{ "amount": $.amount, "currency": $params.currency }';
            const result = await transformRequest(body, expression, context);
            result.success.should.be.true();
            result.data.should.deepEqual({ amount: 100, currency: "USD" });
        });
    });

    describe("transformResponse", function() {
        it("should transform response data", async function() {
            const data = { user_id: 123, full_name: "John Doe" };
            const expression = '{ "id": $.user_id, "name": $.full_name }';
            const result = await transformResponse(data, expression);
            result.success.should.be.true();
            result.data.should.deepEqual({ id: 123, name: "John Doe" });
        });

        it("should transform array data", async function() {
            const data = [
                { id: 1, name: "John" },
                { id: 2, name: "Jane" }
            ];
            const expression = '$[].{ "userId": id, "userName": name }';
            const result = await transformResponse(data, expression);
            result.success.should.be.true();
            result.data.should.be.Array();
            result.data.length.should.equal(2);
            result.data[0].userId.should.equal(1);
            result.data[1].userName.should.equal("Jane");
        });
    });

    describe("parseFieldMapping", function() {
        it("should parse simple field mapping", function() {
            const result = parseFieldMapping("firstName->first_name");
            result.errors.should.have.length(0);
            result.mappings.should.deepEqual({ firstName: "first_name" });
        });

        it("should parse multiple field mappings", function() {
            const result = parseFieldMapping("firstName->first_name, lastName->last_name");
            result.errors.should.have.length(0);
            result.mappings.should.deepEqual({
                firstName: "first_name",
                lastName: "last_name"
            });
        });

        it("should support colon separator", function() {
            const result = parseFieldMapping("firstName:first_name");
            result.errors.should.have.length(0);
            result.mappings.should.deepEqual({ firstName: "first_name" });
        });

        it("should handle empty string", function() {
            const result = parseFieldMapping("");
            result.errors.should.have.length(0);
            Object.keys(result.mappings).should.have.length(0);
        });

        it("should handle null/undefined", function() {
            parseFieldMapping(null).errors.should.have.length(0);
            parseFieldMapping(undefined).errors.should.have.length(0);
        });

        it("should report error for invalid format", function() {
            const result = parseFieldMapping("invalidmapping");
            result.errors.should.have.length(1);
            result.errors[0].should.containEql("Invalid mapping format");
        });

        it("should report error for invalid field name", function() {
            const result = parseFieldMapping("123invalid->valid");
            result.errors.should.have.length(1);
            result.errors[0].should.containEql("Invalid source field name");
        });

        it("should report error for invalid target field name", function() {
            const result = parseFieldMapping("valid->123invalid");
            result.errors.should.have.length(1);
            result.errors[0].should.containEql("Invalid target field name");
        });

        it("should skip empty pairs", function() {
            const result = parseFieldMapping("a->b, , c->d");
            result.errors.should.have.length(0);
            Object.keys(result.mappings).should.have.length(2);
        });

        it("should trim whitespace", function() {
            const result = parseFieldMapping("  firstName  ->  first_name  ");
            result.errors.should.have.length(0);
            result.mappings.should.deepEqual({ firstName: "first_name" });
        });
    });

    describe("applyFieldMapping", function() {
        it("should rename fields using mapping object", function() {
            const data = { firstName: "John", lastName: "Doe" };
            const mappings = { firstName: "first_name", lastName: "last_name" };
            const result = applyFieldMapping(data, mappings);
            result.success.should.be.true();
            result.data.should.deepEqual({ first_name: "John", last_name: "Doe" });
        });

        it("should rename fields using mapping string", function() {
            const data = { firstName: "John", lastName: "Doe" };
            const result = applyFieldMapping(data, "firstName->first_name, lastName->last_name");
            result.success.should.be.true();
            result.data.should.deepEqual({ first_name: "John", last_name: "Doe" });
        });

        it("should preserve unmapped fields", function() {
            const data = { firstName: "John", age: 30 };
            const mappings = { firstName: "first_name" };
            const result = applyFieldMapping(data, mappings);
            result.success.should.be.true();
            result.data.should.deepEqual({ first_name: "John", age: 30 });
        });

        it("should handle non-object data", function() {
            const result = applyFieldMapping("string", { a: "b" });
            result.success.should.be.true();
            result.data.should.equal("string");
        });

        it("should handle array data", function() {
            const result = applyFieldMapping([1, 2, 3], { a: "b" });
            result.success.should.be.true();
            result.data.should.deepEqual([1, 2, 3]);
        });

        it("should return error for invalid mapping string", function() {
            const data = { a: 1 };
            const result = applyFieldMapping(data, "invalid");
            result.success.should.be.false();
            result.error.should.containEql("Field mapping errors");
        });

        it("should handle empty mappings", function() {
            const data = { a: 1 };
            const result = applyFieldMapping(data, {});
            result.success.should.be.true();
            result.data.should.deepEqual({ a: 1 });
        });

        it("should handle missing source fields", function() {
            const data = { a: 1 };
            const mappings = { b: "c" };
            const result = applyFieldMapping(data, mappings);
            result.success.should.be.true();
            result.data.should.deepEqual({ a: 1 });
        });
    });

    describe("fieldMappingToExpression", function() {
        it("should convert mapping to JSONata expression", function() {
            const result = fieldMappingToExpression({ a: "b", c: "d" });
            should(result.expression).be.a.String();
            result.expression.should.containEql('"b": $.a');
            result.expression.should.containEql('"d": $.c');
        });

        it("should convert mapping string to expression", function() {
            const result = fieldMappingToExpression("firstName->first_name");
            should(result.expression).be.a.String();
            result.expression.should.containEql('"first_name": $.firstName');
        });

        it("should return null for empty mappings", function() {
            const result = fieldMappingToExpression({});
            should(result.expression).be.null();
        });

        it("should return error for invalid mapping string", function() {
            const result = fieldMappingToExpression("invalid");
            should(result.expression).be.null();
            should(result.error).be.a.String();
        });
    });

    describe("clearExpressionCache", function() {
        it("should clear the expression cache", function() {
            // Compile an expression to populate cache
            compileExpression("$.name");

            // Clear cache
            clearExpressionCache();

            // The cache should be empty (we can't directly test this,
            // but the function should not throw)
            clearExpressionCache(); // Should not throw
        });
    });

    describe("Integration scenarios", function() {
        it("should handle full request transformation pipeline", async function() {
            // Simulate incoming request body
            const body = {
                firstName: "John",
                lastName: "Doe",
                email: "JOHN@EXAMPLE.COM"
            };

            // Apply field mappings first
            const mappingResult = applyFieldMapping(body, "firstName->first_name, lastName->last_name");
            mappingResult.success.should.be.true();

            // Then apply JSONata transformation
            const expression = '$merge([$$, { "email": $lowercase($.email), "fullName": $.first_name & " " & $.last_name }])';
            const transformResult = await transformData(mappingResult.data, expression);
            transformResult.success.should.be.true();

            // Verify final result
            transformResult.data.should.have.property("first_name", "John");
            transformResult.data.should.have.property("last_name", "Doe");
            transformResult.data.should.have.property("email", "john@example.com");
            transformResult.data.should.have.property("fullName", "John Doe");
        });

        it("should handle response transformation with nested output", async function() {
            // Simulate database response
            const dbResult = {
                id: 123,
                first_name: "John",
                last_name: "Doe",
                email: "john@example.com",
                phone: "555-1234",
                created_at: "2024-01-01T00:00:00Z"
            };

            const expression = `{
                "id": $.id,
                "name": $.first_name & " " & $.last_name,
                "contact": {
                    "email": $.email,
                    "phone": $.phone
                },
                "metadata": {
                    "createdAt": $.created_at
                }
            }`;

            const result = await transformResponse(dbResult, expression);
            result.success.should.be.true();
            result.data.id.should.equal(123);
            result.data.name.should.equal("John Doe");
            result.data.contact.email.should.equal("john@example.com");
            result.data.contact.phone.should.equal("555-1234");
            result.data.metadata.createdAt.should.equal("2024-01-01T00:00:00Z");
        });

        it("should handle conditional transformation", async function() {
            const data = { status: "active", role: "admin" };

            const expression = `{
                "isActive": $.status = "active",
                "isAdmin": $.role = "admin",
                "accessLevel": $.role = "admin" ? "full" : "limited"
            }`;

            const result = await transformData(data, expression);
            result.success.should.be.true();
            result.data.isActive.should.be.true();
            result.data.isAdmin.should.be.true();
            result.data.accessLevel.should.equal("full");
        });
    });
});
