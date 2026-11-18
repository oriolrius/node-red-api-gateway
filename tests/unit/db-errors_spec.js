require("should");
const {
    DEFAULT_PROBLEM_TYPE,
    SQL_NON_UNIQUE_KEY,
    getSqlErrorNumber,
    isPoolAcquireTimeout,
    classifyDbError,
    problemTypeUri,
    buildDbErrorResponse
} = require("../../lib/db-errors");

function sqlError(number, message) {
    const err = new Error(message || `SQL error ${number}`);
    err.number = number;
    err.code = "EREQUEST";
    return err;
}

describe("db-errors", function () {
    describe("getSqlErrorNumber", function () {
        it("reads the number from the error or its originalError", function () {
            getSqlErrorNumber(sqlError(2627)).should.equal(2627);
            const wrapped = new Error("x");
            wrapped.originalError = { info: { number: 515 } };
            getSqlErrorNumber(wrapped).should.equal(515);
            (getSqlErrorNumber(new Error("plain")) === null).should.be.true();
        });
    });

    describe("classifyDbError", function () {
        it("maps PK/unique violations to 409", function () {
            classifyDbError(sqlError(2627), "create").status.should.equal(409);
            classifyDbError(sqlError(2601), "update").status.should.equal(409);
        });

        it("maps NOT NULL, conversion and truncation errors to 400", function () {
            for (const n of [515, 245, 8114, 8152, 2628, 242]) {
                classifyDbError(sqlError(n), "create").status.should.equal(400, `number ${n}`);
            }
        });

        it("maps FK/CHECK conflicts to 400 on write and 409 on delete", function () {
            classifyDbError(sqlError(547), "create").status.should.equal(400);
            classifyDbError(sqlError(547), "update").status.should.equal(400);
            classifyDbError(sqlError(547), "delete").status.should.equal(409);
        });

        it("maps connection failures to 503 and unknown errors to 500", function () {
            const conn = new Error("socket hang up");
            conn.code = "ESOCKET";
            classifyDbError(conn).status.should.equal(503);
            classifyDbError(sqlError(208)).status.should.equal(500);
            classifyDbError(new Error("boom")).status.should.equal(500);
        });
    });

    describe("problemTypeUri", function () {
        // GH-8: never default to a third-party domain.
        it("uses about:blank when no base is configured", function () {
            DEFAULT_PROBLEM_TYPE.should.equal("about:blank");
            problemTypeUri("", "not-found").should.equal("about:blank");
            problemTypeUri(undefined, "conflict").should.equal("about:blank");
            problemTypeUri("   ", "conflict").should.equal("about:blank");
        });

        it("joins custom bases with or without a trailing separator", function () {
            problemTypeUri("https://errors.acme.io/", "conflict").should.equal("https://errors.acme.io/conflict");
            problemTypeUri("https://errors.acme.io", "conflict").should.equal("https://errors.acme.io/conflict");
            problemTypeUri("urn:problem:", "conflict").should.equal("urn:problem:conflict");
        });
    });

    describe("buildDbErrorResponse", function () {
        const leaky = sqlError(2627, "Violation of PRIMARY KEY constraint 'PK_items'. Cannot insert duplicate key in object 'dbo.items'.");

        it("hides the raw driver message by default and adds the requestId", function () {
            const r = buildDbErrorResponse(leaky, { operation: "create", requestId: "req-1" });
            r.status.should.equal(409);
            r.body.status.should.equal(409);
            r.body.title.should.equal("Conflict");
            r.body.requestId.should.equal("req-1");
            r.body.detail.should.not.match(/PK_items|dbo\.items|PRIMARY KEY/);
            JSON.stringify(r.body).should.not.match(/PK_items|dbo\.items/);
        });

        it("returns the raw message only when expose is set", function () {
            const r = buildDbErrorResponse(leaky, { operation: "create", expose: true });
            r.body.detail.should.equal(leaky.message);
        });

        it("uses the HTTP status phrase as title for about:blank", function () {
            const r = buildDbErrorResponse(sqlError(208));
            r.body.type.should.equal("about:blank");
            r.body.title.should.equal("Internal Server Error");
        });

        // GH-8 section 6: the write guard THROWs 50409 when the key is not unique.
        it("maps the non-unique key guard to 409 with a generic detail", function () {
            const r = buildDbErrorResponse(sqlError(SQL_NON_UNIQUE_KEY, "primary key matched 3 rows"), { operation: "delete", typeBase: "urn:problem:" });
            r.status.should.equal(409);
            r.body.type.should.equal("urn:problem:non-unique-key");
            r.body.detail.should.not.match(/primary key matched/);
        });

        it("builds the type from the configured base", function () {
            const r = buildDbErrorResponse(sqlError(208), { typeBase: "urn:problem:" });
            r.status.should.equal(500);
            r.body.type.should.equal("urn:problem:database-error");
            r.body.detail.should.equal("Database error");
        });
    });

    // GH-7: tarn's TimeoutError (pool saturated) reaches us unwrapped.
    describe("pool acquire timeout", function () {
        class TimeoutError extends Error {}
        // tarn is mssql's pool library; resolve it from there, not as a direct dep.
        const { TimeoutError: TarnTimeoutError } = require(require.resolve("tarn", { paths: [require("path").dirname(require.resolve("mssql"))] }));

        it("detects tarn's TimeoutError by constructor name", function () {
            isPoolAcquireTimeout(new TimeoutError("operation timed out")).should.be.true();
            isPoolAcquireTimeout(new TarnTimeoutError()).should.be.true();
        });

        it("does not treat other errors as an acquire timeout", function () {
            isPoolAcquireTimeout(new Error("boom")).should.be.false();
            isPoolAcquireTimeout(null).should.be.false();
            const requestTimeout = Object.assign(new TimeoutError("Timeout: Request failed"), { code: "ETIMEOUT" });
            isPoolAcquireTimeout(requestTimeout).should.be.false();
        });

        it("maps an acquire timeout to 503 busy with Retry-After", function () {
            const r = buildDbErrorResponse(new TarnTimeoutError(), { operation: "create" });
            r.status.should.equal(503);
            r.body.type.should.equal("about:blank");
            r.body.title.should.equal("Service Unavailable");
            r.headers.should.eql({ "Retry-After": "1" });
            classifyDbError(new TarnTimeoutError()).slug.should.equal("service-busy");
        });

        it("adds Retry-After to every 503 and honours a custom value", function () {
            const down = Object.assign(new Error("socket hang up"), { code: "ESOCKET" });
            buildDbErrorResponse(down, { retryAfter: 5 }).headers.should.eql({ "Retry-After": "5" });
        });

        it("sends no Retry-After for non-503 answers", function () {
            buildDbErrorResponse(sqlError(2627), { operation: "create" }).headers.should.eql({});
        });
    });
});
