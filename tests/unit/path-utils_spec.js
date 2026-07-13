require("should");
const {
    HTTP_METHODS,
    isValidMethod,
    normalizeMethod,
    validatePath,
    extractParamNames,
    pathToRegex,
    extractParams,
    normalizePath,
    combinePaths,
    pathsConflict
} = require("../../lib/path-utils");

describe("path-utils", function () {

    describe("HTTP_METHODS", function () {
        it("should contain all standard HTTP methods", function () {
            HTTP_METHODS.should.containEql("GET");
            HTTP_METHODS.should.containEql("POST");
            HTTP_METHODS.should.containEql("PUT");
            HTTP_METHODS.should.containEql("DELETE");
            HTTP_METHODS.should.containEql("PATCH");
            HTTP_METHODS.should.have.length(5);
        });
    });

    describe("isValidMethod", function () {
        it("should return true for valid HTTP methods", function () {
            isValidMethod("GET").should.be.true();
            isValidMethod("POST").should.be.true();
            isValidMethod("PUT").should.be.true();
            isValidMethod("DELETE").should.be.true();
            isValidMethod("PATCH").should.be.true();
        });

        it("should return true for lowercase methods", function () {
            isValidMethod("get").should.be.true();
            isValidMethod("post").should.be.true();
        });

        it("should return true for mixed case methods", function () {
            isValidMethod("Get").should.be.true();
            isValidMethod("pOsT").should.be.true();
        });

        it("should return false for invalid methods", function () {
            isValidMethod("INVALID").should.be.false();
            isValidMethod("OPTIONS").should.be.false();
            isValidMethod("HEAD").should.be.false();
        });

        it("should return false for non-string input", function () {
            isValidMethod(null).should.be.false();
            isValidMethod(undefined).should.be.false();
            isValidMethod(123).should.be.false();
            isValidMethod({}).should.be.false();
        });
    });

    describe("normalizeMethod", function () {
        it("should normalize valid methods to uppercase", function () {
            normalizeMethod("get").should.equal("GET");
            normalizeMethod("post").should.equal("POST");
            normalizeMethod("Put").should.equal("PUT");
        });

        it("should return GET for invalid methods", function () {
            normalizeMethod("INVALID").should.equal("GET");
            normalizeMethod("OPTIONS").should.equal("GET");
        });

        it("should return GET for non-string input", function () {
            normalizeMethod(null).should.equal("GET");
            normalizeMethod(undefined).should.equal("GET");
            normalizeMethod(123).should.equal("GET");
        });
    });

    describe("validatePath", function () {
        it("should validate root path", function () {
            const result = validatePath("/");
            result.valid.should.be.true();
        });

        it("should validate simple paths", function () {
            validatePath("/users").valid.should.be.true();
            validatePath("/api/users").valid.should.be.true();
            validatePath("/api/v1/users").valid.should.be.true();
        });

        it("should validate paths with parameters", function () {
            validatePath("/users/:id").valid.should.be.true();
            validatePath("/users/:userId/posts/:postId").valid.should.be.true();
            validatePath("/:resource/:id").valid.should.be.true();
        });

        it("should validate paths with underscores and dashes", function () {
            validatePath("/user-profiles").valid.should.be.true();
            validatePath("/user_profiles").valid.should.be.true();
            validatePath("/users/:user_id").valid.should.be.true();
        });

        it("should reject paths not starting with /", function () {
            const result = validatePath("users");
            result.valid.should.be.false();
            result.error.should.containEql("must start with /");
        });

        it("should reject paths with double slashes", function () {
            const result = validatePath("/users//id");
            result.valid.should.be.false();
            result.error.should.containEql("empty segments");
        });

        it("should reject paths with empty parameter names", function () {
            const result = validatePath("/users/:");
            result.valid.should.be.false();
            result.error.should.containEql("empty");
        });

        it("should reject paths with invalid parameter names", function () {
            const result = validatePath("/users/:123id");
            result.valid.should.be.false();
            result.error.should.containEql("Invalid parameter name");
        });

        it("should reject paths with invalid segment characters", function () {
            const result = validatePath("/users/test@value");
            result.valid.should.be.false();
            result.error.should.containEql("Invalid path segment");
        });

        it("should reject non-string input", function () {
            validatePath(null).valid.should.be.false();
            validatePath(undefined).valid.should.be.false();
            validatePath(123).valid.should.be.false();
        });
    });

    describe("extractParamNames", function () {
        it("should return empty array for paths without parameters", function () {
            extractParamNames("/").should.deepEqual([]);
            extractParamNames("/users").should.deepEqual([]);
            extractParamNames("/api/users").should.deepEqual([]);
        });

        it("should extract single parameter name", function () {
            extractParamNames("/users/:id").should.deepEqual(["id"]);
            extractParamNames("/:resource").should.deepEqual(["resource"]);
        });

        it("should extract multiple parameter names", function () {
            extractParamNames("/users/:id/posts/:postId").should.deepEqual(["id", "postId"]);
            extractParamNames("/:a/:b/:c").should.deepEqual(["a", "b", "c"]);
        });

        it("should handle parameter names with underscores", function () {
            extractParamNames("/users/:user_id").should.deepEqual(["user_id"]);
            extractParamNames("/:_private").should.deepEqual(["_private"]);
        });

        it("should return empty array for non-string input", function () {
            extractParamNames(null).should.deepEqual([]);
            extractParamNames(undefined).should.deepEqual([]);
            extractParamNames(123).should.deepEqual([]);
        });
    });

    describe("pathToRegex", function () {
        it("should create regex for simple path", function () {
            const { regex, paramNames } = pathToRegex("/users");
            regex.test("/users").should.be.true();
            regex.test("/users/").should.be.true();
            regex.test("/other").should.be.false();
            paramNames.should.deepEqual([]);
        });

        it("should create regex with parameter capture", function () {
            const { regex, paramNames } = pathToRegex("/users/:id");
            regex.test("/users/123").should.be.true();
            regex.test("/users/abc").should.be.true();
            regex.test("/users/").should.be.false();
            regex.test("/users").should.be.false();
            paramNames.should.deepEqual(["id"]);
        });

        it("should create regex with multiple parameters", function () {
            const { regex, paramNames } = pathToRegex("/users/:userId/posts/:postId");
            regex.test("/users/1/posts/2").should.be.true();
            regex.test("/users/abc/posts/xyz").should.be.true();
            regex.test("/users/1/posts").should.be.false();
            paramNames.should.deepEqual(["userId", "postId"]);
        });

        it("should handle non-string input", function () {
            const { paramNames } = pathToRegex(null);
            paramNames.should.deepEqual([]);
        });
    });

    describe("extractParams", function () {
        it("should extract single parameter", function () {
            const result = extractParams("/users/:id", "/users/123");
            result.match.should.be.true();
            result.params.should.deepEqual({ id: "123" });
        });

        it("should extract multiple parameters", function () {
            const result = extractParams("/users/:userId/posts/:postId", "/users/1/posts/42");
            result.match.should.be.true();
            result.params.should.deepEqual({ userId: "1", postId: "42" });
        });

        it("should decode URL-encoded parameters", function () {
            const result = extractParams("/users/:name", "/users/John%20Doe");
            result.match.should.be.true();
            result.params.should.deepEqual({ name: "John Doe" });
        });

        it("should return no match for non-matching paths", function () {
            const result = extractParams("/users/:id", "/posts/123");
            result.match.should.be.false();
            result.params.should.deepEqual({});
        });

        it("should handle paths without parameters", function () {
            const result = extractParams("/users", "/users");
            result.match.should.be.true();
            result.params.should.deepEqual({});
        });

        it("should handle trailing slashes", function () {
            const result = extractParams("/users/:id", "/users/123/");
            result.match.should.be.true();
            result.params.should.deepEqual({ id: "123" });
        });

        it("should handle non-string input", function () {
            extractParams(null, "/users").match.should.be.false();
            extractParams("/users", null).match.should.be.false();
        });
    });

    describe("normalizePath", function () {
        it("should ensure leading slash", function () {
            normalizePath("users").should.equal("/users");
            normalizePath("api/users").should.equal("/api/users");
        });

        it("should remove trailing slashes", function () {
            normalizePath("/users/").should.equal("/users");
            normalizePath("/api/users/").should.equal("/api/users");
        });

        it("should preserve root path", function () {
            normalizePath("/").should.equal("/");
        });

        it("should trim whitespace", function () {
            normalizePath("  /users  ").should.equal("/users");
        });

        it("should handle non-string input", function () {
            normalizePath(null).should.equal("/");
            normalizePath(undefined).should.equal("/");
            normalizePath(123).should.equal("/");
        });
    });

    describe("combinePaths", function () {
        it("should combine base path and endpoint path", function () {
            combinePaths("/api", "/users").should.equal("/api/users");
            combinePaths("/api/v1", "/users/:id").should.equal("/api/v1/users/:id");
        });

        it("should handle root base path", function () {
            combinePaths("/", "/users").should.equal("/users");
        });

        it("should handle root endpoint path", function () {
            combinePaths("/api", "/").should.equal("/api");
        });

        it("should handle both root paths", function () {
            combinePaths("/", "/").should.equal("/");
        });

        it("should normalize paths before combining", function () {
            combinePaths("api/", "users/").should.equal("/api/users");
        });
    });

    describe("pathsConflict", function () {
        it("should detect identical paths as conflicting", function () {
            pathsConflict("/users", "/users").should.be.true();
            pathsConflict("/api/users", "/api/users").should.be.true();
        });

        it("should detect paths with same structure but different param names as conflicting", function () {
            pathsConflict("/users/:id", "/users/:userId").should.be.true();
            pathsConflict("/users/:a/posts/:b", "/users/:x/posts/:y").should.be.true();
        });

        it("should not detect different paths as conflicting", function () {
            pathsConflict("/users", "/posts").should.be.false();
            pathsConflict("/users/:id", "/users/:id/posts").should.be.false();
        });

        it("should handle path normalization", function () {
            pathsConflict("/users/", "/users").should.be.true();
            pathsConflict("users", "/users").should.be.true();
        });
    });
});
