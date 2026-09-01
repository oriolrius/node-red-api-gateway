"use strict";

require("should");
const crypto = require("crypto");
const {
    buildOpaInput,
    parseOpaMappings,
    validateOpaMappings,
    isValidSource,
    isValidTarget,
    stripQuery
} = require("../../../lib/opa-input");

function md5(input) {
    return crypto.createHash("md5").update(JSON.stringify(input)).digest("hex");
}

const authedCtx = () => ({
    method: "get",
    path: "/api/v1/documents/doc-123?page=1",
    route: "/api/v1/documents/:id",
    params: { id: "doc-123" },
    query: { page: "1" },
    headers: { "x-request-id": "abc" },
    auth: {
        authenticated: true,
        token: {
            sub: "user-1",
            exp: 1735689600,
            scope: "openid profile read:documents",
            realm_access: { roles: ["user"] }
        }
    },
    endpoint: { requiredScopes: ["read:docs"], operator: "AND" }
});

describe("opa-input", function() {
    describe("stripQuery", function() {
        it("removes the query string", function() {
            stripQuery("/a/b?x=1&y=2").should.equal("/a/b");
        });
        it("removes a fragment", function() {
            stripQuery("/a/b#frag").should.equal("/a/b");
        });
        it("passes a clean path through", function() {
            stripQuery("/a/b").should.equal("/a/b");
        });
        it("handles null/undefined", function() {
            stripQuery(undefined).should.equal("");
            stripQuery(null).should.equal("");
        });
    });

    describe("buildOpaInput — core keys (AC#2, AC#3)", function() {
        it("uppercases method and strips the query from path", function() {
            const input = buildOpaInput(authedCtx());
            input.method.should.equal("GET");
            input.path.should.equal("/api/v1/documents/doc-123");
            input.path.indexOf("?").should.equal(-1);
        });

        it("keeps route as the route template", function() {
            const input = buildOpaInput(authedCtx());
            input.route.should.equal("/api/v1/documents/:id");
        });

        it("defaults route to the cleaned path when none is provided", function() {
            const input = buildOpaInput({ method: "GET", path: "/health?x=1" });
            input.route.should.equal("/health");
        });

        it("emits params as {} for a static route (documented exception)", function() {
            const input = buildOpaInput({ method: "GET", path: "/status" });
            input.should.have.property("params");
            input.params.should.eql({});
        });

        it("omits body for GET even when includeBody is set", function() {
            const input = buildOpaInput({ method: "GET", path: "/x", body: { a: 1 }, includeBody: true });
            input.should.not.have.property("body");
        });

        it("omits body when includeBody is false on a POST", function() {
            const input = buildOpaInput({ method: "POST", path: "/x", body: { a: 1 }, includeBody: false });
            input.should.not.have.property("body");
        });

        it("includes body on a POST when includeBody is set and a body is present", function() {
            const input = buildOpaInput({ method: "POST", path: "/x", body: { a: 1 }, includeBody: true });
            input.should.have.property("body");
            input.body.should.eql({ a: 1 });
        });

        it("omits body when the content was not parsed (body undefined)", function() {
            const input = buildOpaInput({ method: "POST", path: "/x", includeBody: true });
            input.should.not.have.property("body");
        });
    });

    describe("buildOpaInput — token presence (AC#1)", function() {
        it("includes token for an authenticated request", function() {
            const input = buildOpaInput(authedCtx());
            input.should.have.property("token");
            input.token.should.have.property("sub", "user-1");
        });

        it("omits token entirely for an anonymous request (not null, not {})", function() {
            const ctx = authedCtx();
            ctx.auth = { authenticated: false };
            const input = buildOpaInput(ctx);
            input.should.not.have.property("token");
            ("token" in input).should.be.false();
        });

        it("omits token when auth is absent", function() {
            const input = buildOpaInput({ method: "GET", path: "/x" });
            input.should.not.have.property("token");
        });

        it("omits token when tokenMode is 'none' even if authenticated", function() {
            const ctx = authedCtx();
            ctx.tokenMode = "none";
            const input = buildOpaInput(ctx);
            input.should.not.have.property("token");
        });

        it("includes only the selected claims when tokenMode is 'claims'", function() {
            const ctx = authedCtx();
            ctx.tokenMode = "claims";
            ctx.tokenClaims = ["sub", "scope", "email"]; // email absent from token
            const input = buildOpaInput(ctx);
            input.token.should.have.property("sub", "user-1");
            input.token.should.have.property("scope");
            input.token.should.not.have.property("email"); // absent claim omitted (AC#3)
            input.token.should.not.have.property("realm_access");
        });

        it("omits token when a 'claims' selection resolves to nothing", function() {
            const ctx = authedCtx();
            ctx.tokenMode = "claims";
            ctx.tokenClaims = ["does_not_exist"];
            const input = buildOpaInput(ctx);
            input.should.not.have.property("token");
        });
    });

    describe("buildOpaInput — scope verbatim (AC#4)", function() {
        it("preserves scope as the exact space-delimited string", function() {
            const input = buildOpaInput(authedCtx());
            input.token.scope.should.equal("openid profile read:documents");
            input.token.scope.should.be.a.String();
        });
    });

    describe("buildOpaInput — endpoint declarative context (AC#5)", function() {
        it("includes endpoint.requiredScopes as context", function() {
            const input = buildOpaInput(authedCtx());
            input.should.have.property("endpoint");
            input.endpoint.requiredScopes.should.eql(["read:docs"]);
            input.endpoint.operator.should.equal("AND");
        });

        it("omits endpoint when no requiredScopes are declared", function() {
            const ctx = authedCtx();
            delete ctx.endpoint;
            const input = buildOpaInput(ctx);
            input.should.not.have.property("endpoint");
        });

        it("carries an OR operator through when set", function() {
            const ctx = authedCtx();
            ctx.endpoint = { requiredScopes: ["a", "b"], operator: "OR" };
            const input = buildOpaInput(ctx);
            input.endpoint.operator.should.equal("OR");
        });

        it("does not itself grant or deny based on requiredScopes", function() {
            // The builder only carries requiredScopes as data; a token lacking
            // them still yields a token block and an endpoint block, unchanged.
            const ctx = authedCtx();
            ctx.endpoint = { requiredScopes: ["write:everything"] };
            const input = buildOpaInput(ctx);
            input.should.have.property("token");
            input.endpoint.requiredScopes.should.eql(["write:everything"]);
        });
    });

    describe("mapping whitelist (AC#6)", function() {
        it("parses target->source pairs", function() {
            const parsed = parseOpaMappings("resource.id -> params.id, resource.type -> 'document'");
            parsed.should.have.length(2);
            parsed[0].should.have.property("target", "resource.id");
            parsed[0].should.have.property("source", "params.id");
            parsed[1].should.have.property("source", "'document'");
        });

        it("accepts writable targets and known sources", function() {
            isValidTarget("resource.id").should.be.true();
            isValidTarget("environment.ip_address").should.be.true();
            isValidTarget("extra.foo").should.be.true();
            isValidTarget("request_id").should.be.true();
            isValidTarget("source_ip").should.be.true();
            isValidSource("params.id").should.be.true();
            isValidSource("query.page").should.be.true();
            isValidSource("headers.x-request-id").should.be.true();
            isValidSource("body.name").should.be.true();
            isValidSource("auth.token.sub").should.be.true();
            isValidSource("method").should.be.true();
            isValidSource("'document'").should.be.true();
        });

        it("rejects token.*, user.*, method, path and route as targets", function() {
            isValidTarget("token.sub").should.be.false();
            isValidTarget("user.id").should.be.false();
            isValidTarget("method").should.be.false();
            isValidTarget("path").should.be.false();
            isValidTarget("route").should.be.false();
        });

        it("rejects unknown source prefixes", function() {
            isValidSource("secrets.apikey").should.be.false();
            isValidSource("token.sub").should.be.false();
            isValidSource("env.HOME").should.be.false();
        });

        it("validateOpaMappings reports errors for forbidden targets and sources", function() {
            const parsed = parseOpaMappings("token.sub -> params.id, resource.id -> secrets.key");
            const res = validateOpaMappings(parsed);
            res.valid.should.be.false();
            res.errors.should.have.length(2);
        });

        it("buildOpaInput throws CONFIG_INVALID on a forbidden mapping", function() {
            const ctx = authedCtx();
            ctx.mappings = parseOpaMappings("token.sub -> params.id");
            (function() {
                buildOpaInput(ctx);
            }).should.throw(/Invalid OPA input mapping/);
        });

        it("applies valid mappings into resource.* verbatim, omitting absent sources", function() {
            const ctx = authedCtx();
            ctx.mappings = parseOpaMappings("resource.id -> params.id, resource.type -> 'document', resource.missing -> query.nope");
            const input = buildOpaInput(ctx);
            input.resource.should.have.property("id", "doc-123");
            input.resource.should.have.property("type", "document");
            input.resource.should.not.have.property("missing"); // absent source omitted
        });

        it("cannot forge identity from request data (token stays gateway-verified)", function() {
            const ctx = authedCtx();
            // A caller-controlled header must not be able to reach token.*
            ctx.headers = { "x-sub": "attacker" };
            ctx.mappings = parseOpaMappings("extra.claimed_sub -> headers.x-sub");
            const input = buildOpaInput(ctx);
            input.token.sub.should.equal("user-1");        // untouched
            input.extra.claimed_sub.should.equal("attacker"); // isolated in extra.*
        });
    });

    describe("deterministic key order (AC#7)", function() {
        it("hashes logically identical inputs to a single cache key despite source key order", function() {
            const a = {
                method: "GET",
                path: "/api/v1/documents/doc-1",
                route: "/api/v1/documents/:id",
                params: { id: "doc-1" },
                query: { b: "2", a: "1" },
                auth: { authenticated: true, token: { scope: "read", sub: "u1" } }
            };
            const b = {
                method: "GET",
                path: "/api/v1/documents/doc-1",
                route: "/api/v1/documents/:id",
                params: { id: "doc-1" },
                query: { a: "1", b: "2" }, // different insertion order
                auth: { authenticated: true, token: { sub: "u1", scope: "read" } } // different order
            };
            md5(buildOpaInput(a)).should.equal(md5(buildOpaInput(b)));
        });

        it("produces a stable top-level key sequence", function() {
            const ctx = authedCtx();
            ctx.mappings = parseOpaMappings("resource.id -> params.id, environment.ip_address -> ip, extra.k -> 'v'");
            ctx.ip = "10.0.0.1";
            const input = buildOpaInput(ctx);
            Object.keys(input).should.eql([
                "method", "path", "route", "params", "query",
                "endpoint", "token", "resource", "environment", "extra"
            ]);
        });

        it("keeps audit keys top-level and body/extra last, in order", function() {
            const ctx = {
                method: "POST",
                path: "/api/v1/things",
                route: "/api/v1/things",
                body: { name: "x" },
                includeBody: true,
                includeAuditFields: true,
                requestId: "req-1",
                sourceIp: "10.0.0.2",
                mappings: parseOpaMappings("extra.k -> 'v'")
            };
            const input = buildOpaInput(ctx);
            Object.keys(input).should.eql([
                "method", "path", "route", "params", "query",
                "request_id", "source_ip", "body", "extra"
            ]);
        });
    });
});
