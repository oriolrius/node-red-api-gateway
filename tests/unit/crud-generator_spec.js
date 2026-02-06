const should = require("should");
const {
    CRUD_OPERATIONS,
    CRUD_METHOD_MAPPING,
    validateCrudOperation,
    validateTableName,
    validateColumnName,
    generateCrudSql,
    getDefaultStatusDescription
} = require("../../lib/crud-generator");

describe("CRUD Generator", function() {

    describe("CRUD_OPERATIONS", function() {
        it("should include all CRUD operations", function() {
            CRUD_OPERATIONS.should.containEql("none");
            CRUD_OPERATIONS.should.containEql("list");
            CRUD_OPERATIONS.should.containEql("get");
            CRUD_OPERATIONS.should.containEql("create");
            CRUD_OPERATIONS.should.containEql("update");
            CRUD_OPERATIONS.should.containEql("delete");
        });
    });

    describe("CRUD_METHOD_MAPPING", function() {
        it("should map operations to HTTP methods", function() {
            CRUD_METHOD_MAPPING.list.should.equal("GET");
            CRUD_METHOD_MAPPING.get.should.equal("GET");
            CRUD_METHOD_MAPPING.create.should.equal("POST");
            CRUD_METHOD_MAPPING.update.should.equal("PUT");
            CRUD_METHOD_MAPPING.delete.should.equal("DELETE");
        });
    });

    describe("validateCrudOperation", function() {
        it("should accept valid operations", function() {
            validateCrudOperation("list").should.equal("list");
            validateCrudOperation("get").should.equal("get");
            validateCrudOperation("create").should.equal("create");
        });

        it("should normalize to lowercase", function() {
            validateCrudOperation("LIST").should.equal("list");
            validateCrudOperation("Create").should.equal("create");
        });

        it("should return 'none' for invalid operations", function() {
            validateCrudOperation("invalid").should.equal("none");
            validateCrudOperation(null).should.equal("none");
            validateCrudOperation(undefined).should.equal("none");
            validateCrudOperation(123).should.equal("none");
        });
    });

    describe("validateTableName", function() {
        it("should accept valid table names", function() {
            validateTableName("users").valid.should.be.true();
            validateTableName("user_profiles").valid.should.be.true();
            validateTableName("UserProfiles").valid.should.be.true();
            validateTableName("dbo.users").valid.should.be.true();
        });

        it("should reject invalid table names", function() {
            validateTableName("123users").valid.should.be.false();
            validateTableName("user-profiles").valid.should.be.false();
            validateTableName("user profiles").valid.should.be.false();
            validateTableName("").valid.should.be.false();
            validateTableName(null).valid.should.be.false();
        });

        it("should reject multiple dots", function() {
            validateTableName("db.schema.table").valid.should.be.false();
        });
    });

    describe("validateColumnName", function() {
        it("should accept valid column names", function() {
            validateColumnName("id").valid.should.be.true();
            validateColumnName("user_id").valid.should.be.true();
            validateColumnName("firstName").valid.should.be.true();
            validateColumnName("_private").valid.should.be.true();
        });

        it("should reject invalid column names", function() {
            validateColumnName("123col").valid.should.be.false();
            validateColumnName("col-name").valid.should.be.false();
            validateColumnName("").valid.should.be.false();
            validateColumnName(null).valid.should.be.false();
        });
    });

    describe("generateCrudSql", function() {
        describe("list operation", function() {
            it("should generate SELECT * query with pagination", function() {
                const result = generateCrudSql("list", "users", "id");
                result.sql.should.equal("SELECT * FROM users ORDER BY id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY");
                result.operation.should.equal("list");
                result.tableName.should.equal("users");
                result.supportsPagination.should.be.true();
                result.paramMapping.offset.should.equal("query.offset");
                result.paramMapping.limit.should.equal("query.limit");
            });
        });

        describe("get operation", function() {
            it("should generate SELECT with WHERE clause", function() {
                const result = generateCrudSql("get", "users", "id");
                result.sql.should.equal("SELECT * FROM users WHERE id = @id");
                result.paramMapping.id.should.equal("params.id");
            });

            it("should use custom primary key", function() {
                const result = generateCrudSql("get", "users", "user_id");
                result.sql.should.containEql("user_id = @user_id");
            });
        });

        describe("create operation", function() {
            it("should generate INSERT template", function() {
                const result = generateCrudSql("create", "users", "id");
                result.sql.should.containEql("INSERT INTO users");
                result.paramMapping.columns.should.equal("body.*");
            });
        });

        describe("update operation", function() {
            it("should generate UPDATE template", function() {
                const result = generateCrudSql("update", "users", "id");
                result.sql.should.containEql("UPDATE users SET");
                result.sql.should.containEql("WHERE id = @id");
                result.paramMapping.id.should.equal("params.id");
                result.paramMapping.assignments.should.equal("body.*");
            });
        });

        describe("delete operation", function() {
            it("should generate DELETE query", function() {
                const result = generateCrudSql("delete", "users", "id");
                result.sql.should.equal("DELETE FROM users WHERE id = @id");
            });
        });

        describe("none operation", function() {
            it("should return empty sql", function() {
                const result = generateCrudSql("none", "users", "id");
                result.sql.should.equal("");
            });
        });

        describe("invalid operation", function() {
            it("should return empty sql for unknown operation", function() {
                const result = generateCrudSql("unknown", "users", "id");
                result.sql.should.equal("");
            });
        });
    });

    describe("getDefaultStatusDescription", function() {
        it("should return descriptions for common status codes", function() {
            getDefaultStatusDescription("200").should.equal("Successful response");
            getDefaultStatusDescription("201").should.equal("Resource created successfully");
            getDefaultStatusDescription("204").should.equal("No content");
            getDefaultStatusDescription("400").should.equal("Bad request");
            getDefaultStatusDescription("401").should.equal("Unauthorized");
            getDefaultStatusDescription("403").should.equal("Forbidden");
            getDefaultStatusDescription("404").should.equal("Not found");
            getDefaultStatusDescription("500").should.equal("Internal server error");
        });

        it("should handle numeric input", function() {
            getDefaultStatusDescription(200).should.equal("Successful response");
        });

        it("should return generic description for unknown codes", function() {
            getDefaultStatusDescription("418").should.equal("Response for status 418");
        });

        it("should handle 'default' key", function() {
            getDefaultStatusDescription("default").should.equal("Default response");
        });
    });
});
