const should = require("should");
const {
    parseScopes,
    checkScopes
} = require("../../lib/authorization");

describe("Authorization", function() {

    describe("parseScopes", function() {
        it("should return empty array for null/undefined", function() {
            parseScopes(null).should.deepEqual([]);
            parseScopes(undefined).should.deepEqual([]);
        });

        it("should return empty array for empty string", function() {
            parseScopes("").should.deepEqual([]);
        });

        it("should parse comma-separated string", function() {
            parseScopes("read,write,admin").should.deepEqual(["read", "write", "admin"]);
        });

        it("should trim whitespace", function() {
            parseScopes(" read , write , admin ").should.deepEqual(["read", "write", "admin"]);
        });

        it("should filter empty values", function() {
            parseScopes("read,,write,,,admin").should.deepEqual(["read", "write", "admin"]);
        });

        it("should handle array input", function() {
            parseScopes(["read", "write"]).should.deepEqual(["read", "write"]);
        });

        it("should handle array with non-string values", function() {
            // null gets converted to "null" by String(), so it's kept
            parseScopes([123, "read", null, "write"]).should.deepEqual(["123", "read", "null", "write"]);
        });

        it("should return empty array for non-string/array input", function() {
            parseScopes({}).should.deepEqual([]);
            parseScopes(123).should.deepEqual([]);
        });
    });

    describe("checkScopes", function() {
        describe("with empty required scopes", function() {
            it("should authorize when no scopes required", function() {
                const result = checkScopes([], [], "AND");
                result.authorized.should.be.true();
                result.missingScopes.should.deepEqual([]);
            });

            it("should authorize when required is null", function() {
                const result = checkScopes(["read"], null, "AND");
                result.authorized.should.be.true();
            });
        });

        describe("with AND operator", function() {
            it("should authorize when all scopes present", function() {
                const result = checkScopes(
                    ["read", "write", "admin"],
                    ["read", "write"],
                    "AND"
                );
                result.authorized.should.be.true();
                result.missingScopes.should.deepEqual([]);
            });

            it("should deny when some scopes missing", function() {
                const result = checkScopes(
                    ["read"],
                    ["read", "write"],
                    "AND"
                );
                result.authorized.should.be.false();
                result.missingScopes.should.deepEqual(["write"]);
            });

            it("should deny when all scopes missing", function() {
                const result = checkScopes(
                    [],
                    ["read", "write"],
                    "AND"
                );
                result.authorized.should.be.false();
                result.missingScopes.should.deepEqual(["read", "write"]);
            });
        });

        describe("with OR operator", function() {
            it("should authorize when at least one scope present", function() {
                const result = checkScopes(
                    ["read"],
                    ["read", "write"],
                    "OR"
                );
                result.authorized.should.be.true();
                result.missingScopes.should.deepEqual([]);
            });

            it("should authorize when all scopes present", function() {
                const result = checkScopes(
                    ["read", "write"],
                    ["read", "write"],
                    "OR"
                );
                result.authorized.should.be.true();
                result.missingScopes.should.deepEqual([]);
            });

            it("should deny when no scopes present", function() {
                const result = checkScopes(
                    ["admin"],
                    ["read", "write"],
                    "OR"
                );
                result.authorized.should.be.false();
                result.missingScopes.should.deepEqual(["read", "write"]);
            });
        });

        describe("with null token scopes", function() {
            it("should handle null token scopes", function() {
                const result = checkScopes(
                    null,
                    ["read"],
                    "AND"
                );
                result.authorized.should.be.false();
                result.missingScopes.should.deepEqual(["read"]);
            });
        });
    });
});
