"use strict";

const should = require("should");
const http = require("http");
const helper = require("node-red-node-test-helper");
const apiServerNode = require("../../nodes/api-server.js");
const apiConfigNode = require("../../nodes/api-config.js");
const apiEndpointNode = require("../../nodes/api-endpoint.js");

helper.init(require.resolve("node-red"));

// Small HTTP client for hitting the running Fastify server.
function httpRequest(port, path, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: "127.0.0.1",
            port,
            path,
            method: options.method || "GET",
            headers: options.headers || {}
        }, (res) => {
            let body = "";
            res.on("data", (c) => { body += c; });
            res.on("end", () => {
                let json = null;
                try { json = JSON.parse(body); } catch (e) { /* non-json */ }
                resolve({ status: res.statusCode, body, json });
            });
        });
        req.on("error", reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function waitForStart(node, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        (function poll() {
            if (node && node.serverStarted) return resolve();
            if (Date.now() - start > timeoutMs) return reject(new Error("server did not start"));
            setTimeout(poll, 20);
        })();
    });
}

// A fetch stub standing in for OPA. `behaviour(state)` returns the decision
// response; the last request body/headers are captured for assertions.
function makeOpaFetch(behaviour) {
    const state = { lastBody: null, calls: 0, lastHeaders: null };
    const fn = async (url, opts = {}) => {
        if (String(url).endsWith("/health")) {
            return { ok: true, status: 200, json: async () => ({}) };
        }
        state.calls++;
        state.lastHeaders = opts.headers || {};
        state.lastBody = opts.body ? JSON.parse(opts.body) : null;
        return behaviour(state);
    };
    fn.state = state;
    return fn;
}

const OPA_URL = "https://opa.test.internal";
const POLICY = "v1/data/gw/decision";
let PORT = 3801;

// Node names must NOT equal any config-node id, or node-red's config-node
// dependency resolver mistakes the matching value for a self-reference.
function baseFlow(overrides = {}) {
    const cfg = Object.assign({
        id: "cfg", type: "apigw-config", name: "OPA Cfg",
        opaEnabled: true, opaUrl: OPA_URL, opaPolicyPath: POLICY, opaMode: "enforce"
    }, overrides.cfg || {});
    const srv = Object.assign({
        id: "srv", type: "apigw-server", name: "OPA Srv",
        port: PORT, host: "127.0.0.1", config: "cfg"
    }, overrides.srv || {});
    const ep = Object.assign({
        id: "ep", type: "apigw-endpoint", name: "OPA Ep",
        path: "/things", method: "GET", server: "srv", wires: [["out"]]
    }, overrides.ep || {});
    return [cfg, srv, ep, { id: "out", type: "helper" }];
}

const CREDS = { cfg: { opaToken: "gw-secret" } };

describe("api-server OPA enforcement", function() {
    this.timeout(8000);

    beforeEach(function(done) {
        PORT++; // fresh port per test to avoid bind races on teardown
        helper.startServer(done);
    });

    afterEach(function(done) {
        helper.unload();
        helper.stopServer(done);
    });

    // Make the flow output respond so an allowed request completes with 200.
    function respondFromHelper() {
        const out = helper.getNode("out");
        out.on("input", function(msg) {
            if (msg.res && typeof msg.res.status === "function") {
                msg.res.status(200).json({ ok: true, sawOpa: !!msg.opa, opaAllowed: msg.opa && msg.opa.allowed });
            }
        });
        return out;
    }

    it("enforce: a denying policy returns 403 and the endpoint never receives", function(done) {
        const opaFetch = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({ result: { allowed: false, reason: "policy_denied" } }) }));
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], baseFlow(), CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                let received = false;
                helper.getNode("out").on("input", () => { received = true; });
                await waitForStart(srv);
                const res = await httpRequest(srv.port, "/things");
                res.status.should.equal(403);
                received.should.be.false();
                opaFetch.state.calls.should.be.greaterThan(0);
                done();
            } catch (err) { done(err); }
        });
    });

    it("enforce: an allowing policy reaches the endpoint (200, msg.opa attached)", function(done) {
        const opaFetch = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({ result: { allowed: true, reason: "ok" }, decision_id: "d-1" }) }));
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], baseFlow(), CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                respondFromHelper();
                await waitForStart(srv);
                const res = await httpRequest(srv.port, "/things");
                res.status.should.equal(200);
                res.json.should.have.property("sawOpa", true);
                res.json.should.have.property("opaAllowed", true);
                done();
            } catch (err) { done(err); }
        });
    });

    it("carries the gateway bearer token to OPA and omits the user token for anonymous", function(done) {
        const opaFetch = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({ result: { allowed: true } }) }));
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], baseFlow(), CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                respondFromHelper();
                await waitForStart(srv);
                await httpRequest(srv.port, "/things");
                opaFetch.state.lastHeaders.should.have.property("Authorization", "Bearer gw-secret");
                // token is absent (not null) for an anonymous request (trap #4)
                const input = opaFetch.state.lastBody.input;
                input.should.not.have.property("token");
                ("token" in input).should.be.false();
                done();
            } catch (err) { done(err); }
        });
    });

    it("503 fail-closed on a non-decision (network error), distinct from a deny", function(done) {
        const opaFetch = makeOpaFetch(() => { throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }); });
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], baseFlow(), CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                await waitForStart(srv);
                const res = await httpRequest(srv.port, "/things");
                res.status.should.equal(503);
                res.json.details.reason.should.equal("NETWORK");
                done();
            } catch (err) { done(err); }
        });
    });

    it("fail-open turns a non-decision into a 200", function(done) {
        const opaFetch = makeOpaFetch(() => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); });
        const flow = baseFlow({ cfg: { opaFailOpen: true } });
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                respondFromHelper();
                await waitForStart(srv);
                const res = await httpRequest(srv.port, "/things");
                res.status.should.equal(200);
                done();
            } catch (err) { done(err); }
        });
    });

    it("POLICY_UNDEFINED (HTTP 200 {}) yields 503, not a silent 403", function(done) {
        const opaFetch = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({}) }));
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], baseFlow(), CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                await waitForStart(srv);
                const res = await httpRequest(srv.port, "/things");
                res.status.should.equal(503);
                res.json.details.reason.should.equal("POLICY_UNDEFINED");
                done();
            } catch (err) { done(err); }
        });
    });

    it("monitor mode never denies (200) and reports allowed=false on msg.opa", function(done) {
        const opaFetch = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({ result: { allowed: false, reason: "would_deny" } }) }));
        const flow = baseFlow({ cfg: { opaMode: "monitor" } });
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                respondFromHelper();
                await waitForStart(srv);
                const res = await httpRequest(srv.port, "/things");
                res.status.should.equal(200);
                res.json.should.have.property("opaAllowed", false);
                done();
            } catch (err) { done(err); }
        });
    });

    it("single authority: OPA allow returns 200 even though the token lacks the declared scope", function(done) {
        const opaFetch = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({ result: { allowed: true } }) }));
        // Endpoint declares requiredScopes; OPA is active, so the gateway does
        // NOT re-check scopes — the policy decides (decision-001 D6).
        const flow = baseFlow({ ep: { requiredScopes: "write:things", scopeOperator: "AND" } });
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                respondFromHelper();
                await waitForStart(srv);
                const res = await httpRequest(srv.port, "/things");
                res.status.should.equal(200);
                // requiredScopes travels to OPA as declarative context
                const input = opaFetch.state.lastBody.input;
                input.endpoint.requiredScopes.should.containEql("write:things");
                done();
            } catch (err) { done(err); }
        });
    });
});

describe("api-server OPA client lifecycle", function() {
    this.timeout(8000);

    beforeEach(function(done) { PORT++; helper.startServer(done); });
    afterEach(function(done) { helper.unload(); helper.stopServer(done); });

    it("maps opaCacheTTL seconds to ms and enables the cache", function(done) {
        const flow = baseFlow({ cfg: { opaCacheTTL: 30 } });
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, CREDS, function() {
            const srv = helper.getNode("srv");
            try {
                const client = srv.opaClientsByPath.get(POLICY);
                should.exist(client);
                client.config.cacheTtl.should.equal(30000);
                client.config.cacheEnabled.should.be.true();
                done();
            } catch (err) { done(err); }
        });
    });

    it("treats opaCacheTTL 0 as cache disabled", function(done) {
        const flow = baseFlow({ cfg: { opaCacheTTL: 0 } });
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, CREDS, function() {
            const srv = helper.getNode("srv");
            try {
                const client = srv.opaClientsByPath.get(POLICY);
                client.config.cacheEnabled.should.be.false();
                client.config.cacheTtl.should.equal(0);
                done();
            } catch (err) { done(err); }
        });
    });

    it("creates one client per distinct resolved policy path", function(done) {
        const flow = [
            { id: "cfg", type: "apigw-config", name: "OPA Cfg", opaEnabled: true, opaUrl: OPA_URL, opaPolicyPath: POLICY, opaMode: "enforce" },
            { id: "srv", type: "apigw-server", name: "OPA Srv", port: PORT, host: "127.0.0.1", config: "cfg" },
            { id: "ep", type: "apigw-endpoint", name: "OPA Ep A", path: "/a", method: "GET", server: "srv", wires: [["out"]] },
            { id: "ep2", type: "apigw-endpoint", name: "OPA Ep B", path: "/b", method: "GET", server: "srv", opaPolicyPath: "v1/data/gw/other", wires: [["out"]] },
            { id: "out", type: "helper" }
        ];
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, CREDS, async function() {
            const srv = helper.getNode("srv");
            try {
                srv._opaFetchFn = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({ result: { allowed: true } }) }));
                helper.getNode("out").on("input", function(msg) {
                    if (msg.res && typeof msg.res.status === "function") msg.res.status(200).json({ ok: true });
                });
                await waitForStart(srv);
                await httpRequest(srv.port, "/a");
                await httpRequest(srv.port, "/b");
                srv.opaClientsByPath.has(POLICY).should.be.true();
                srv.opaClientsByPath.has("v1/data/gw/other").should.be.true();
                done();
            } catch (err) { done(err); }
        });
    });

    it("invalid opaUrl forces OPA inactive (config invalid), not localhost fallback", function(done) {
        const flow = baseFlow({ cfg: { opaUrl: "not a url" } });
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, CREDS, function() {
            const srv = helper.getNode("srv");
            try {
                srv._opaConfigInvalid.should.be.true();
                srv.opaClientsByPath.size.should.equal(0);
                done();
            } catch (err) { done(err); }
        });
    });

    it("a set-but-missing config node refuses to enforce (config invalid)", function(done) {
        // Server references a config id that is not present in the flow.
        const flow = [
            { id: "srv", type: "apigw-server", name: "OPA Srv", port: PORT, host: "127.0.0.1", config: "ghost" },
            { id: "ep", type: "apigw-endpoint", name: "OPA Ep", path: "/x", method: "GET", server: "srv", wires: [[]] }
        ];
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, function() {
            const srv = helper.getNode("srv");
            try {
                srv._opaConfigInvalid.should.be.true();
                done();
            } catch (err) { done(err); }
        });
    });
});

describe("api-server OPA per-endpoint overrides (task-084)", function() {
    this.timeout(8000);

    beforeEach(function(done) { PORT++; helper.startServer(done); });
    afterEach(function(done) { helper.unload(); helper.stopServer(done); });

    function respond() {
        helper.getNode("out").on("input", function(msg) {
            if (msg.res && typeof msg.res.status === "function") {
                msg.res.status(200).json({ ok: true, opaAllowed: msg.opa && msg.opa.allowed });
            }
        });
    }

    it("endpoint opaMode monitor overrides a config default of enforce (never denies)", function(done) {
        const opaFetch = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({ result: { allowed: false, reason: "no" } }) }));
        const flow = baseFlow({ ep: { opaMode: "monitor" } }); // config default is enforce
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                respond();
                await waitForStart(srv);
                const res = await httpRequest(srv.port, "/things");
                res.status.should.equal(200);
                res.json.should.have.property("opaAllowed", false);
                done();
            } catch (err) { done(err); }
        });
    });

    it("endpoint opaMode off disables OPA for that endpoint (policy never consulted)", function(done) {
        const opaFetch = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({ result: { allowed: false } }) }));
        const flow = baseFlow({ ep: { opaMode: "off" } });
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                respond();
                await waitForStart(srv);
                const res = await httpRequest(srv.port, "/things");
                res.status.should.equal(200);
                opaFetch.state.calls.should.equal(0); // OPA never consulted
                done();
            } catch (err) { done(err); }
        });
    });

    it("opaIncludeBody adds the request body to the OPA input on a POST", function(done) {
        const opaFetch = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({ result: { allowed: true } }) }));
        const flow = baseFlow({ ep: { path: "/things", method: "POST", opaIncludeBody: true } });
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = opaFetch;
                respond();
                await waitForStart(srv);
                await httpRequest(srv.port, "/things", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ name: "widget" })
                });
                opaFetch.state.lastBody.input.should.have.property("body");
                opaFetch.state.lastBody.input.body.should.have.property("name", "widget");
                done();
            } catch (err) { done(err); }
        });
    });

    it("exports the resolved OPA policy as an x-opa-policy OpenAPI extension", function(done) {
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], baseFlow(), CREDS, async function() {
            try {
                const srv = helper.getNode("srv");
                srv._opaFetchFn = makeOpaFetch(() => ({ ok: true, status: 200, json: async () => ({ result: { allowed: true } }) }));
                await waitForStart(srv);
                const spec = srv.getOpenApiSpec();
                const op = spec.paths["/things"].get;
                op.should.have.property("x-opa-policy");
                op["x-opa-policy"].should.have.property("policyPath", POLICY);
                op["x-opa-policy"].should.have.property("mode", "enforce");
                done();
            } catch (err) { done(err); }
        });
    });
});
