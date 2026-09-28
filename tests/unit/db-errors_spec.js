require("should");
const {
    DEFAULT_PROBLEM_TYPE_BASE,
    getSqlErrorNumber,
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
        it("uses the historical default when no base is configured", function () {
            problemTypeUri("", "not-found").should.equal(`${DEFAULT_PROBLEM_TYPE_BASE}not-found`);
            problemTypeUri(undefined, "conflict").should.equal("https://api.example.com/errors/conflict");
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

        it("builds the type from the configured base", function () {
            const r = buildDbErrorResponse(sqlError(208), { typeBase: "urn:problem:" });
            r.status.should.equal(500);
            r.body.type.should.equal("urn:problem:database-error");
            r.body.detail.should.equal("Database error");
        });
    });
});
