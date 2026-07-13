require("should");

// Regression tests for the confirmed findings from the multi-agent code review
// (0.8.2). Grouped by module; each test names the defect it guards against.
describe("Review fixes (0.8.2)", function () {

    describe("response-cache: cache key collision resistance", function () {
        const { generateCacheKey } = require("../../lib/response-cache");

        it("does not collide when a query value contains the query separators", function () {
            const a = generateCacheKey({ method: "GET", path: "/items", query: { a: "1", b: "2" } }, "full");
            const b = generateCacheKey({ method: "GET", path: "/items", query: { a: "1&b=2" } }, "full");
            a.should.not.equal(b);
        });

        it("does not let a query value impersonate a vary-header partition", function () {
            const victim = generateCacheKey(
                { method: "GET", path: "/x", query: {}, headers: { "x-tenant": "t1" } },
                "full", null, ["x-tenant"]
            );
            const attacker = generateCacheKey(
                { method: "GET", path: "/x", query: { q: "1|x-tenant:t1" }, headers: {} },
                "full", null, ["x-tenant"]
            );
            attacker.should.not.equal(victim);
        });

        it("preserves the readable format for simple values", function () {
            const key = generateCacheKey({ method: "GET", path: "/users", query: { limit: "10", page: "1" } }, "full");
            key.should.equal("GET|/users|limit=10&page=1");
        });
    });

    describe("request-response-transform: applyFieldMapping swap/chain", function () {
        const { applyFieldMapping } = require("../../lib/request-response-transform");

        it("swaps two fields without losing data", function () {
            const r = applyFieldMapping({ a: 1, b: 2 }, { a: "b", b: "a" });
            r.data.should.deepEqual({ a: 2, b: 1 });
        });

        it("handles a rename chain without clobbering", function () {
            const r = applyFieldMapping({ user_id: 5, id: 99 }, { user_id: "id", id: "legacy_id" });
            r.data.should.deepEqual({ id: 5, legacy_id: 99 });
        });

        it("leaves unmapped fields intact", function () {
            const r = applyFieldMapping({ a: 1, c: 3 }, { a: "b" });
            r.data.should.deepEqual({ b: 1, c: 3 });
        });
    });

    describe("schema-validator: duplicate $id across (re)deploys", function () {
        const { parseSchema } = require("../../lib/schema-validator");

        it("compiles the same $id twice without disabling validation", function () {
            const s = JSON.stringify({
                $id: "https://api.local/schemas/body.json",
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" } }
            });
            const first = parseSchema(s);
            const second = parseSchema(s);
            (first.schema === null).should.be.false();
            (second.schema === null).should.be.false();
            (second.error === undefined).should.be.true();
        });
    });

    describe("openapi-parser: circular $ref", function () {
        const { openApiSchemaToJsonSchema } = require("../../lib/openapi-parser");

        it("does not infinitely recurse on a self-referential schema", function () {
            const components = {
                schemas: {
                    Node: {
                        type: "object",
                        properties: {
                            children: { type: "array", items: { $ref: "#/components/schemas/Node" } }
                        }
                    }
                }
            };
            let out;
            (function () {
                out = openApiSchemaToJsonSchema({ $ref: "#/components/schemas/Node" }, components);
            }).should.not.throw();
            out.should.be.an.Object();
        });
    });

    describe("keycloak-client: JWT claim validation", function () {
        const { KeycloakClient } = require("../../lib/keycloak-client");

        it("enforces expiry even when clockTolerance arrives as a string", function () {
            const client = new KeycloakClient({ clockTolerance: "30" });
            const now = Math.floor(Date.now() / 1000);
            const result = client._validateClaims({ exp: now - 100 });
            result.valid.should.be.false();
            result.error.should.equal("Token expired");
        });

        it("coerces clockTolerance to a number", function () {
            const client = new KeycloakClient({ clockTolerance: "30" });
            client.config.clockTolerance.should.equal(30);
        });

        it("falls back to the default algorithm allow-list when none supplied", function () {
            const client = new KeycloakClient({});
            client.config.algorithms.should.containEql("RS256");
        });

        it("keeps a custom algorithm allow-list (e.g. ES256)", function () {
            const client = new KeycloakClient({ algorithms: ["ES256"] });
            client.config.algorithms.should.deepEqual(["ES256"]);
        });

        it("honours an explicit issuer override", function () {
            const client = new KeycloakClient({
                keycloakUrl: "http://keycloak-internal:8080",
                realm: "prod",
                issuer: "https://auth.example.com/realms/prod"
            });
            client.getExpectedIssuer().should.equal("https://auth.example.com/realms/prod");
        });

        it("derives the issuer from url+realm when no override is set", function () {
            const client = new KeycloakClient({ keycloakUrl: "http://kc:8080", realm: "prod" });
            client.getExpectedIssuer().should.equal("http://kc:8080/realms/prod");
        });
    });

    describe("rate-limiter: bucket cap", function () {
        const { RateLimiter } = require("../../lib/rate-limiter");

        it("caps the bucket map under a flood of distinct keys", function () {
            const limiter = new RateLimiter({ requests: 2, windowMs: 60000, maxBuckets: 10 });
            for (let i = 0; i < 100; i++) {
                limiter.check(`key-${i}`);
            }
            limiter._buckets.size.should.be.belowOrEqual(10);
            limiter.shutdown();
        });
    });
});
