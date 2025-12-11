const should = require("should");
const {
    SORT_DIRECTIONS,
    FILTER_SORT_DEFAULTS,
    parseFieldList,
    validateFieldName,
    parseFilterParams,
    parseSortParams,
    generateWhereClause,
    generateOrderByClause
} = require("../../lib/filtering-sorting");

describe("Filtering and Sorting", function() {

    describe("parseFieldList", function() {
        it("should return empty array for null/undefined", function() {
            parseFieldList(null).should.deepEqual([]);
            parseFieldList(undefined).should.deepEqual([]);
        });

        it("should parse comma-separated string", function() {
            parseFieldList("name,email,status").should.deepEqual(["name", "email", "status"]);
        });

        it("should trim whitespace", function() {
            parseFieldList(" name , email ").should.deepEqual(["name", "email"]);
        });

        it("should filter invalid field names", function() {
            parseFieldList("name,123invalid,email,with-dash").should.deepEqual(["name", "email"]);
        });

        it("should handle array input", function() {
            parseFieldList(["name", "email"]).should.deepEqual(["name", "email"]);
        });

        it("should handle underscores", function() {
            parseFieldList("first_name,last_name").should.deepEqual(["first_name", "last_name"]);
        });
    });

    describe("validateFieldName", function() {
        it("should accept valid field names", function() {
            validateFieldName("name", []).valid.should.be.true();
            validateFieldName("firstName", []).valid.should.be.true();
            validateFieldName("_private", []).valid.should.be.true();
            validateFieldName("field123", []).valid.should.be.true();
        });

        it("should reject invalid field names", function() {
            validateFieldName("123invalid", []).valid.should.be.false();
            validateFieldName("with-dash", []).valid.should.be.false();
            validateFieldName("", []).valid.should.be.false();
            validateFieldName(null, []).valid.should.be.false();
        });

        it("should check against allowed fields", function() {
            validateFieldName("name", ["name", "email"]).valid.should.be.true();
            validateFieldName("status", ["name", "email"]).valid.should.be.false();
        });

        it("should allow any field when allowed list is empty", function() {
            validateFieldName("anyField", []).valid.should.be.true();
        });
    });

    describe("parseFilterParams", function() {
        it("should return empty for no query", function() {
            const result = parseFilterParams(null, []);
            result.filters.should.have.length(0);
            result.errors.should.have.length(0);
        });

        it("should parse filter[field]=value format", function() {
            const result = parseFilterParams({
                "filter[name]": "John"
            }, ["name"]);
            result.filters.should.have.length(1);
            result.filters[0].field.should.equal("name");
            result.filters[0].operator.should.equal("eq");
            result.filters[0].value.should.equal("John");
        });

        it("should parse filter[field][operator]=value format", function() {
            const result = parseFilterParams({
                "filter[age][gt]": "18"
            }, ["age"]);
            result.filters.should.have.length(1);
            result.filters[0].operator.should.equal("gt");
        });

        it("should support all operators", function() {
            const operators = ["eq", "ne", "gt", "gte", "lt", "lte", "like", "in"];
            for (const op of operators) {
                const result = parseFilterParams({
                    [`filter[field][${op}]`]: "value"
                }, ["field"]);
                result.filters[0].operator.should.equal(op);
            }
        });

        it("should parse 'in' operator as array", function() {
            const result = parseFilterParams({
                "filter[status][in]": "active,pending,done"
            }, ["status"]);
            result.filters[0].value.should.deepEqual(["active", "pending", "done"]);
        });

        it("should report errors for disallowed fields", function() {
            const result = parseFilterParams({
                "filter[secret]": "value"
            }, ["name", "email"]);
            result.filters.should.have.length(0);
            result.errors.should.have.length(1);
        });

        it("should parse direct field=value when field is allowed", function() {
            const result = parseFilterParams({
                "name": "John"
            }, ["name"]);
            result.filters.should.have.length(1);
            result.filters[0].field.should.equal("name");
        });

        it("should ignore pagination params", function() {
            const result = parseFilterParams({
                "page": "1",
                "limit": "10",
                "sort": "name"
            }, ["page", "limit", "sort"]);
            result.filters.should.have.length(0);
        });
    });

    describe("parseSortParams", function() {
        it("should use default when no sort param", function() {
            const result = parseSortParams({}, ["name"], "name", "asc");
            result.sorts.should.have.length(1);
            result.sorts[0].field.should.equal("name");
            result.sorts[0].direction.should.equal("asc");
        });

        it("should parse ascending sort", function() {
            const result = parseSortParams({ sort: "name" }, ["name"], null, "asc");
            result.sorts[0].field.should.equal("name");
            result.sorts[0].direction.should.equal("asc");
        });

        it("should parse descending sort with minus prefix", function() {
            const result = parseSortParams({ sort: "-name" }, ["name"], null, "asc");
            result.sorts[0].field.should.equal("name");
            result.sorts[0].direction.should.equal("desc");
        });

        it("should parse ascending sort with plus prefix", function() {
            const result = parseSortParams({ sort: "+name" }, ["name"], null, "asc");
            result.sorts[0].direction.should.equal("asc");
        });

        it("should parse multiple sort fields", function() {
            const result = parseSortParams(
                { sort: "name,-createdAt" },
                ["name", "createdAt"],
                null,
                "asc"
            );
            result.sorts.should.have.length(2);
            result.sorts[0].should.deepEqual({ field: "name", direction: "asc" });
            result.sorts[1].should.deepEqual({ field: "createdAt", direction: "desc" });
        });

        it("should report errors for disallowed fields", function() {
            const result = parseSortParams(
                { sort: "secret" },
                ["name", "email"],
                null,
                "asc"
            );
            result.errors.should.have.length(1);
        });

        it("should fall back to default on invalid sort", function() {
            const result = parseSortParams(
                { sort: "secret" },
                ["name"],
                "name",
                "asc"
            );
            result.sorts.should.have.length(1);
            result.sorts[0].field.should.equal("name");
        });
    });

    describe("generateWhereClause", function() {
        it("should return empty for no filters", function() {
            const result = generateWhereClause([]);
            result.clause.should.equal("");
            result.params.should.deepEqual({});
        });

        it("should generate equality condition", function() {
            const result = generateWhereClause([
                { field: "name", operator: "eq", value: "John" }
            ]);
            result.clause.should.containEql("name = @filter_name_0");
            result.params.filter_name_0.should.equal("John");
        });

        it("should generate comparison conditions", function() {
            const operators = {
                "gt": ">",
                "gte": ">=",
                "lt": "<",
                "lte": "<=",
                "ne": "!="
            };

            for (const [op, sql] of Object.entries(operators)) {
                const result = generateWhereClause([
                    { field: "age", operator: op, value: 18 }
                ]);
                result.clause.should.containEql(`age ${sql}`);
            }
        });

        it("should generate LIKE condition", function() {
            const result = generateWhereClause([
                { field: "name", operator: "like", value: "%John%" }
            ]);
            result.clause.should.containEql("name LIKE");
        });

        it("should generate IN condition", function() {
            const result = generateWhereClause([
                { field: "status", operator: "in", value: ["active", "pending"] }
            ]);
            result.clause.should.containEql("status IN");
            result.clause.should.containEql("filter_status_0_0");
            result.clause.should.containEql("filter_status_0_1");
        });

        it("should join multiple conditions with AND", function() {
            const result = generateWhereClause([
                { field: "name", operator: "eq", value: "John" },
                { field: "age", operator: "gt", value: 18 }
            ]);
            result.clause.should.startWith("WHERE");
            result.clause.should.containEql(" AND ");
        });

        it("should use custom parameter prefix", function() {
            const result = generateWhereClause(
                [{ field: "id", operator: "eq", value: 1 }],
                ":"
            );
            result.clause.should.containEql(":filter_id_0");
        });
    });

    describe("generateOrderByClause", function() {
        it("should return empty for no sorts", function() {
            generateOrderByClause([]).should.equal("");
            generateOrderByClause(null).should.equal("");
        });

        it("should generate single sort", function() {
            const result = generateOrderByClause([
                { field: "name", direction: "asc" }
            ]);
            result.should.equal("ORDER BY name ASC");
        });

        it("should generate multiple sorts", function() {
            const result = generateOrderByClause([
                { field: "name", direction: "asc" },
                { field: "createdAt", direction: "desc" }
            ]);
            result.should.equal("ORDER BY name ASC, createdAt DESC");
        });
    });
});
