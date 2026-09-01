"use strict";

// Real OPA enforcement e2e (task-088).
//
// Unlike the full docker-compose fixture, this test needs no Keycloak or
// Node-RED container. It starts a REAL OPA process serving the shipped-style
// gateway policy (so policy is evaluated by OPA, NOT simulated in a JS function
// node) and drives the real gateway (api-server preHandler) against it, then
// asserts real 200/403 outcomes and the D1/D7 non-decision paths.
//
// Run: OPA_BIN=/path/to/opa npx mocha tests/e2e/opa-enforcement.test.js
// The suite is skipped when an `opa` binary is not available.

require("should");
const http = require("http");
const path = require("path");
const { spawnSync, spawn } = require("child_process");
const helper = require("node-red-node-test-helper");
const apiServerNode = require("../../nodes/api-server.js");
const apiConfigNode = require("../../nodes/api-config.js");
const apiEndpointNode = require("../../nodes/api-endpoint.js");

const OPA_BIN = process.env.OPA_BIN || "opa";
const POLICY_FILE = path.join(__dirname, "policies", "authz.rego");
const POLICY_PATH = "v1/data/gateway/decision";
const OPA_PORT = 18181;
const OPA_URL = `http://127.0.0.1:${OPA_PORT}`;

function opaAvailable() {
    try {
        const r = spawnSync(OPA_BIN, ["version"], { stdio: "ignore" });
        return r.status === 0;
    } catch (e) {
        return false;
    }
}

function httpRequest(port, reqPath, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: "127.0.0.1", port, path: reqPath,
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

function waitFor(fn, timeoutMs, intervalMs) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        (function poll() {
            Promise.resolve(fn()).then((ok) => {
                if (ok) return resolve();
                if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
                setTimeout(poll, intervalMs || 50);
            }).catch(() => {
                if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
                setTimeout(poll, intervalMs || 50);
            });
        })();
    });
}

const runner = opaAvailable() ? describe : describe.skip;

runner("OPA real enforcement e2e", function() {
    this.timeout(30000);
    let opaProc;
    let PORT = 19200;

    before(function(done) {
        opaProc = spawn(OPA_BIN, [
            "run", "--server", "--disable-telemetry",
            "--addr", `127.0.0.1:${OPA_PORT}`, "--log-level", "error", POLICY_FILE
        ], { stdio: "ignore" });
        opaProc.on("error", done);
        waitFor(async () => {
            try {
                const r = await httpRequest(OPA_PORT, "/health");
                return r.status === 200;
            } catch (e) { return false; }
        }, 15000, 100).then(() => done(), done);
    });

    after(function(done) {
        if (opaProc) { opaProc.kill("SIGKILL"); }
        setTimeout(done, 100);
    });

    beforeEach(function(done) { PORT++; helper.startServer(done); });
    afterEach(function(done) { helper.unload(); helper.stopServer(done); });

    // Load a config+server+endpoint flow pointed at the REAL OPA, and stub the
    // token validator so we can present authenticated requests (auth is not the
    // subject — the OPA policy decision is).
    function loadGateway(opts, cb) {
        opts = opts || {};
        const cfg = Object.assign({
            id: "cfg", type: "apigw-config", name: "E2E Cfg",
            opaEnabled: true, opaUrl: OPA_URL, opaPolicyPath: POLICY_PATH, opaMode: "enforce"
        }, opts.cfg || {});
        const ep = Object.assign({
            id: "ep", type: "apigw-endpoint", name: "E2E Ep",
            path: "/things", method: "GET", server: "srv", requiredScopes: "user",
            scopeOperator: "AND", wires: [["out"]]
        }, opts.ep || {});
        const flow = [
            cfg,
            { id: "srv", type: "apigw-server", name: "E2E Srv", port: PORT, host: "127.0.0.1", config: "cfg" },
            ep,
            { id: "out", type: "helper" }
        ];
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, { cfg: { opaToken: "e2e-token" } }, function() {
            const srv = helper.getNode("srv");
            helper.getNode("out").on("input", function(msg) {
                if (msg.res && typeof msg.res.status === "function") {
                    msg.res.status(200).json({ ok: true });
                }
            });
            cb(srv);
        }).catch(cb);
    }

    function stubToken(srv, payload) {
        srv.keycloakClient = {
            validateToken: async () => (payload ? { valid: true, payload } : { valid: false, error: "invalid" }),
            shutdown: function() {}
        };
    }

    it("allows (200) a request whose token holds the required scope — decided by real OPA", function(done) {
        loadGateway({}, async function(srv) {
            try {
                stubToken(srv, { sub: "u1", scope: "openid user", realm_access: { roles: ["user"] } });
                await waitFor(() => srv.serverStarted, 3000, 20);
                const res = await httpRequest(srv.port, "/things", { headers: { authorization: "Bearer x" } });
                res.status.should.equal(200);
                done();
            } catch (e) { done(e); }
        });
    });

    it("denies (403) a request whose token lacks the required scope", function(done) {
        loadGateway({}, async function(srv) {
            try {
                stubToken(srv, { sub: "u1", scope: "openid", realm_access: { roles: ["user"] } });
                await waitFor(() => srv.serverStarted, 3000, 20);
                const res = await httpRequest(srv.port, "/things", { headers: { authorization: "Bearer x" } });
                res.status.should.equal(403);
                done();
            } catch (e) { done(e); }
        });
    });

    it("denies an anonymous request with 401 (token omitted, policy reason missing_token)", function(done) {
        // The gateway maps a missing_token denial on an unauthenticated request
        // to 401 (authenticate first), not 403 — decided by the gateway's own
        // state, never a policy string alone.
        loadGateway({}, async function(srv) {
            try {
                await waitFor(() => srv.serverStarted, 3000, 20);
                const res = await httpRequest(srv.port, "/things");
                res.status.should.equal(401);
                done();
            } catch (e) { done(e); }
        });
    });

    it("denies (403) a write without the admin role (policy reason requires_admin)", function(done) {
        loadGateway({ ep: { method: "POST", path: "/things" } }, async function(srv) {
            try {
                stubToken(srv, { sub: "u1", scope: "openid user", realm_access: { roles: ["user"] } });
                await waitFor(() => srv.serverStarted, 3000, 20);
                const res = await httpRequest(srv.port, "/things", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: "{}" });
                res.status.should.equal(403);
                done();
            } catch (e) { done(e); }
        });
    });

    // ---- D1/D7 non-decision paths (only exist against a remote service) ----

    it("503 (NETWORK) when OPA is unreachable", function(done) {
        // Point at a port with nothing listening.
        loadGateway({ cfg: { opaUrl: "http://127.0.0.1:1" } }, async function(srv) {
            try {
                stubToken(srv, { sub: "u1", scope: "openid user" });
                await waitFor(() => srv.serverStarted, 3000, 20);
                const res = await httpRequest(srv.port, "/things", { headers: { authorization: "Bearer x" } });
                res.status.should.equal(503);
                res.json.details.reason.should.equal("NETWORK");
                done();
            } catch (e) { done(e); }
        });
    });

    it("503 (OPA_HTTP_401) when the gateway service token is rejected", function(done) {
        // A stand-in OPA that answers 401 to the decision POST.
        const stub = http.createServer((req, res) => {
            if (req.url.indexOf("/health") !== -1) { res.writeHead(200); res.end("{}"); return; }
            res.writeHead(401); res.end("unauthorized");
        });
        stub.listen(0, "127.0.0.1", function() {
            const stubPort = stub.address().port;
            loadGateway({ cfg: { opaUrl: `http://127.0.0.1:${stubPort}` } }, async function(srv) {
                try {
                    stubToken(srv, { sub: "u1", scope: "openid user" });
                    await waitFor(() => srv.serverStarted, 3000, 20);
                    const res = await httpRequest(srv.port, "/things", { headers: { authorization: "Bearer x" } });
                    res.status.should.equal(503);
                    res.json.details.reason.should.equal("OPA_HTTP_401");
                    stub.close(); done();
                } catch (e) { stub.close(); done(e); }
            });
        });
    });

    it("503 (NETWORK) on a TLS/handshake failure (https to a plaintext port)", function(done) {
        const stub = http.createServer((req, res) => { res.writeHead(200); res.end("{}"); });
        stub.listen(0, "127.0.0.1", function() {
            const stubPort = stub.address().port;
            loadGateway({ cfg: { opaUrl: `https://127.0.0.1:${stubPort}` } }, async function(srv) {
                try {
                    stubToken(srv, { sub: "u1", scope: "openid user" });
                    await waitFor(() => srv.serverStarted, 3000, 20);
                    const res = await httpRequest(srv.port, "/things", { headers: { authorization: "Bearer x" } });
                    res.status.should.equal(503);
                    res.json.details.reason.should.equal("NETWORK");
                    stub.close(); done();
                } catch (e) { stub.close(); done(e); }
            });
        });
    });

    it("opens the circuit after repeated failures, then recovers", function(done) {
        // A flippable stand-in: 503 while failing, an allow decision once healthy.
        const state = { fail: true };
        const stub = http.createServer((req, res) => {
            if (req.url.indexOf("/health") !== -1) { res.writeHead(200); res.end("{}"); return; }
            if (state.fail) { res.writeHead(503); res.end("busy"); return; }
            res.writeHead(200); res.end(JSON.stringify({ result: { allowed: true, reason: "allow" } }));
        });
        stub.listen(0, "127.0.0.1", function() {
            const stubPort = stub.address().port;
            loadGateway({
                cfg: {
                    opaUrl: `http://127.0.0.1:${stubPort}`,
                    opaCircuitBreakerThreshold: 3,
                    opaCircuitBreakerTimeout: 400,
                    opaRetryAttempts: 0
                }
            }, async function(srv) {
                try {
                    stubToken(srv, { sub: "u1", scope: "openid user" });
                    await waitFor(() => srv.serverStarted, 3000, 20);
                    const client = srv.opaClientsByPath.get(POLICY_PATH);
                    // 3 failing evaluations open the breaker.
                    for (let i = 0; i < 3; i++) {
                        await httpRequest(srv.port, "/things", { headers: { authorization: "Bearer x" } });
                    }
                    client.circuitState.should.equal("open");
                    // Recover: heal the backend and wait past the breaker timeout.
                    state.fail = false;
                    await new Promise((r) => setTimeout(r, 500));
                    const res = await httpRequest(srv.port, "/things", { headers: { authorization: "Bearer x" } });
                    res.status.should.equal(200);
                    stub.close(); done();
                } catch (e) { stub.close(); done(e); }
            });
        });
    });
});
