require("should");
const fastify = require("fastify");
const {
    normalizeIp,
    parseAllowedIps,
    isIpAllowed,
    parseMetricsAccess,
    createMetricsGuard
} = require("../../lib/metrics-access");

function basic(user, pass) {
    return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

/** Fastify app with the guard on /metrics, the same wiring as apigw-server. */
async function buildApp(config, credentials, deps) {
    const settings = parseMetricsAccess(config, credentials);
    const app = fastify({ logger: false });
    app.get("/metrics", { preHandler: createMetricsGuard(settings, deps) }, async () => "metric_total 1\n");
    await app.ready();
    return app;
}

describe("metrics-access", function () {
    describe("IP allowlist", function () {
        it("normalises IPv4-mapped IPv6 addresses", function () {
            normalizeIp("::ffff:10.1.2.3").should.equal("10.1.2.3");
            normalizeIp("::1").should.equal("::1");
        });

        it("allows any address when the list is empty", function () {
            const { blockList } = parseAllowedIps("");
            (blockList === null).should.be.true();
            isIpAllowed(blockList, "203.0.113.9").should.be.true();
        });

        it("matches single IPs and IPv4/IPv6 CIDRs", function () {
            const { blockList, invalid } = parseAllowedIps("10.0.0.5, 192.168.1.0/24, fd00::/8");
            invalid.should.eql([]);
            isIpAllowed(blockList, "10.0.0.5").should.be.true();
            isIpAllowed(blockList, "::ffff:192.168.1.77").should.be.true();
            isIpAllowed(blockList, "fd12::1").should.be.true();
            isIpAllowed(blockList, "10.0.0.6").should.be.false();
            isIpAllowed(blockList, "192.168.2.1").should.be.false();
        });

        it("reports invalid entries", function () {
            parseAllowedIps("nope, 10.0.0.0/40, 1.2.3.4").invalid.should.eql(["nope", "10.0.0.0/40"]);
        });
    });

    describe("parseMetricsAccess", function () {
        it("defaults to no authentication", function () {
            const s = parseMetricsAccess({});
            s.auth.should.equal("none");
            s.errors.should.eql([]);
        });

        it("flags a mode without its credentials", function () {
            parseMetricsAccess({ metricsAuth: "bearer" }, {}).errors.length.should.equal(1);
            parseMetricsAccess({ metricsAuth: "basic" }, { metricsUsername: "u" }).errors.length.should.equal(1);
            parseMetricsAccess({ metricsAuth: "bearer" }, { metricsToken: "t" }).errors.should.eql([]);
        });

        it("falls back to none for unknown modes", function () {
            parseMetricsAccess({ metricsAuth: "magic" }).auth.should.equal("none");
        });
    });

    describe("guard on a real Fastify route", function () {
        let app;
        afterEach(async function () { if (app) await app.close(); app = null; });

        it("none: serves metrics without credentials", async function () {
            app = await buildApp({ metricsAuth: "none" });
            (await app.inject({ url: "/metrics" })).statusCode.should.equal(200);
        });

        it("bearer: 401 without or with a wrong token, 200 with the right one", async function () {
            app = await buildApp({ metricsAuth: "bearer" }, { metricsToken: "s3cret" });
            const missing = await app.inject({ url: "/metrics" });
            missing.statusCode.should.equal(401);
            missing.headers["www-authenticate"].should.match(/^Bearer/);
            (await app.inject({ url: "/metrics", headers: { authorization: "Bearer nope" } })).statusCode.should.equal(401);
            (await app.inject({ url: "/metrics", headers: { authorization: "Bearer s3cret" } })).statusCode.should.equal(200);
        });

        it("basic: checks username and password", async function () {
            app = await buildApp({ metricsAuth: "basic" }, { metricsUsername: "prom", metricsPassword: "pw:with:colons" });
            const missing = await app.inject({ url: "/metrics" });
            missing.statusCode.should.equal(401);
            missing.headers["www-authenticate"].should.match(/^Basic/);
            (await app.inject({ url: "/metrics", headers: { authorization: basic("prom", "bad") } })).statusCode.should.equal(401);
            (await app.inject({ url: "/metrics", headers: { authorization: basic("other", "pw:with:colons") } })).statusCode.should.equal(401);
            (await app.inject({ url: "/metrics", headers: { authorization: basic("prom", "pw:with:colons") } })).statusCode.should.equal(200);
        });

        it("oauth2: validates the token and the required scopes", async function () {
            const validateToken = async (t) => {
                if (t === "good-with-scope") return { valid: true, scopes: ["metrics:read"] };
                if (t === "good-no-scope") return { valid: true, scopes: ["user"] };
                return { valid: false, error: "Invalid token" };
            };
            app = await buildApp({ metricsAuth: "oauth2", metricsRequiredScopes: "metrics:read" }, {}, { validateToken });
            (await app.inject({ url: "/metrics" })).statusCode.should.equal(401);
            (await app.inject({ url: "/metrics", headers: { authorization: "Bearer bad" } })).statusCode.should.equal(401);
            (await app.inject({ url: "/metrics", headers: { authorization: "Bearer good-no-scope" } })).statusCode.should.equal(403);
            (await app.inject({ url: "/metrics", headers: { authorization: "Bearer good-with-scope" } })).statusCode.should.equal(200);
        });

        it("oauth2: 503 when OAuth2 is not configured", async function () {
            app = await buildApp({ metricsAuth: "oauth2" }, {}, { validateToken: async () => null });
            (await app.inject({ url: "/metrics", headers: { authorization: "Bearer x" } })).statusCode.should.equal(503);
        });

        it("misconfigured mode fails closed with 503", async function () {
            app = await buildApp({ metricsAuth: "bearer" }, {});
            (await app.inject({ url: "/metrics" })).statusCode.should.equal(503);
        });

        it("IP allowlist: 403 for other sources, combined with auth", async function () {
            app = await buildApp({ metricsAuth: "bearer", metricsAllowedIps: "10.9.9.9" }, { metricsToken: "t" });
            // inject() connects from 127.0.0.1
            (await app.inject({ url: "/metrics", headers: { authorization: "Bearer t" } })).statusCode.should.equal(403);
            await app.close();
            app = await buildApp({ metricsAuth: "bearer", metricsAllowedIps: "127.0.0.0/8" }, { metricsToken: "t" });
            (await app.inject({ url: "/metrics" })).statusCode.should.equal(401);
            (await app.inject({ url: "/metrics", headers: { authorization: "Bearer t" } })).statusCode.should.equal(200);
        });
    });
});
