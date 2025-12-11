const should = require("should");
const {
    PAGINATION_STYLES,
    PAGINATION_DEFAULTS,
    validatePaginationConfig,
    parsePaginationParams,
    generatePaginationMetadata
} = require("../../lib/pagination");

describe("Pagination", function() {

    describe("PAGINATION_STYLES", function() {
        it("should include offset and cursor", function() {
            PAGINATION_STYLES.should.containEql("offset");
            PAGINATION_STYLES.should.containEql("cursor");
        });
    });

    describe("PAGINATION_DEFAULTS", function() {
        it("should have default values", function() {
            PAGINATION_DEFAULTS.defaultPageSize.should.equal(20);
            PAGINATION_DEFAULTS.maxPageSize.should.equal(100);
            PAGINATION_DEFAULTS.style.should.equal("offset");
        });
    });

    describe("validatePaginationConfig", function() {
        it("should accept valid configuration", function() {
            const result = validatePaginationConfig({
                defaultPageSize: 10,
                maxPageSize: 50,
                paginationStyle: "offset"
            });
            result.valid.should.be.true();
            result.errors.should.have.length(0);
        });

        it("should reject negative defaultPageSize", function() {
            const result = validatePaginationConfig({ defaultPageSize: -1 });
            result.valid.should.be.false();
            result.errors.should.containEql("Default page size must be a positive integer");
        });

        it("should reject non-numeric defaultPageSize", function() {
            const result = validatePaginationConfig({ defaultPageSize: "abc" });
            result.valid.should.be.false();
        });

        it("should reject negative maxPageSize", function() {
            const result = validatePaginationConfig({ maxPageSize: 0 });
            result.valid.should.be.false();
            result.errors.should.containEql("Maximum page size must be a positive integer");
        });

        it("should reject defaultPageSize greater than maxPageSize", function() {
            const result = validatePaginationConfig({
                defaultPageSize: 100,
                maxPageSize: 50
            });
            result.valid.should.be.false();
            result.errors.should.containEql("Default page size cannot exceed maximum page size");
        });

        it("should reject invalid pagination style", function() {
            const result = validatePaginationConfig({ paginationStyle: "invalid" });
            result.valid.should.be.false();
        });
    });

    describe("parsePaginationParams", function() {
        describe("offset-based", function() {
            const config = {
                paginationStyle: "offset",
                defaultPageSize: 20,
                maxPageSize: 100
            };

            it("should use defaults when no params provided", function() {
                const result = parsePaginationParams({}, config);
                result.style.should.equal("offset");
                result.page.should.equal(1);
                result.limit.should.equal(20);
                result.offset.should.equal(0);
                should(result.cursor).be.null();
            });

            it("should parse page parameter", function() {
                const result = parsePaginationParams({ page: "3" }, config);
                result.page.should.equal(3);
                result.offset.should.equal(40);
            });

            it("should parse limit parameter", function() {
                const result = parsePaginationParams({ limit: "50" }, config);
                result.limit.should.equal(50);
            });

            it("should cap limit at maxPageSize", function() {
                const result = parsePaginationParams({ limit: "200" }, config);
                result.limit.should.equal(100);
            });

            it("should parse offset directly", function() {
                const result = parsePaginationParams({ offset: "40" }, config);
                result.offset.should.equal(40);
                result.page.should.equal(3);
            });

            it("should handle invalid page values", function() {
                const result = parsePaginationParams({ page: "abc" }, config);
                result.page.should.equal(1);
            });
        });

        describe("cursor-based", function() {
            const config = {
                paginationStyle: "cursor",
                defaultPageSize: 20,
                maxPageSize: 100
            };

            it("should return cursor style", function() {
                const result = parsePaginationParams({}, config);
                result.style.should.equal("cursor");
                should(result.cursor).be.null();
                should(result.page).be.null();
                should(result.offset).be.null();
            });

            it("should parse cursor parameter", function() {
                const result = parsePaginationParams({ cursor: "abc123" }, config);
                result.cursor.should.equal("abc123");
            });
        });
    });

    describe("generatePaginationMetadata", function() {
        describe("offset-based", function() {
            it("should generate metadata for first page", function() {
                const params = { style: "offset", page: 1, limit: 20, offset: 0 };
                const result = generatePaginationMetadata(params, { total: 100, count: 20 });

                result.style.should.equal("offset");
                result.page.should.equal(1);
                result.limit.should.equal(20);
                result.total.should.equal(100);
                result.totalPages.should.equal(5);
                result.hasNext.should.be.true();
                result.hasPrev.should.be.false();
            });

            it("should generate metadata for middle page", function() {
                const params = { style: "offset", page: 3, limit: 20, offset: 40 };
                const result = generatePaginationMetadata(params, { total: 100, count: 20 });

                result.hasNext.should.be.true();
                result.hasPrev.should.be.true();
            });

            it("should generate metadata for last page", function() {
                const params = { style: "offset", page: 5, limit: 20, offset: 80 };
                const result = generatePaginationMetadata(params, { total: 100, count: 20 });

                result.hasNext.should.be.false();
                result.hasPrev.should.be.true();
            });

            it("should handle unknown total", function() {
                const params = { style: "offset", page: 1, limit: 20, offset: 0 };
                const result = generatePaginationMetadata(params, { count: 20 });

                should(result.total).be.null();
                should(result.totalPages).be.null();
                result.hasNext.should.be.true(); // count === limit suggests more
            });
        });

        describe("cursor-based", function() {
            it("should generate metadata with cursor", function() {
                const params = { style: "cursor", limit: 20, cursor: "abc123" };
                const result = generatePaginationMetadata(params, {
                    count: 20,
                    nextCursor: "def456",
                    prevCursor: "xyz789"
                });

                result.style.should.equal("cursor");
                result.cursor.should.equal("abc123");
                result.nextCursor.should.equal("def456");
                result.prevCursor.should.equal("xyz789");
                result.hasNext.should.be.true();
                result.hasPrev.should.be.true();
            });

            it("should handle no cursors", function() {
                const params = { style: "cursor", limit: 20, cursor: null };
                const result = generatePaginationMetadata(params, { count: 10 });

                result.hasNext.should.be.false();
                result.hasPrev.should.be.false();
            });
        });
    });
});
