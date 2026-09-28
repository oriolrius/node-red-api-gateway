"use strict";

// Gateway hardening e2e (tasks 091-093, GitHub issues #4, #5, #6).
//
// Drives the real nodes (apigw-config + apigw-server + apigw-endpoint) through
// node-red-node-test-helper and talks to them over real HTTP sockets:
//
//  - #6 request bodies: bodyLimit, raw/binary uploads reaching the flow as a Buffer.
//  - #5 /metrics access: opt-in, none/bearer/basic/oauth2 modes and the IP
//       allowlist. OAuth2 uses REAL RS256 JWTs validated by the gateway's
//       KeycloakClient against a local JWKS server (a stand-in for Keycloak's
//       certs endpoint), not a stubbed validator.
//  - #4 auto-CRUD database errors: a REAL SQL Server 2022 container provokes
//       PK, NOT NULL, conversion, FK and CHECK violations; responses must map to
//       409/400 without leaking schema details.
//
// Run: npm run test:e2e-hardening
// The SQL Server suite starts a throwaway container and is skipped when Docker
// is unavailable. Set E2E_MSSQL_HOST/E2E_MSSQL_PORT/E2E_MSSQL_PASSWORD to reuse
// an existing server (sa login) instead.

require("should");
const http = require("http");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const helper = require("node-red-node-test-helper");
const apiServerNode = require("../../nodes/api-server.js");
const apiConfigNode = require("../../nodes/api-config.js");
const apiEndpointNode = require("../../nodes/api-endpoint.js");

helper.init(require.resolve("node-red"));

const MiB = 1024 * 1024;
let PORT = 19400;

function httpRequest(port, reqPath, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: "127.0.0.1", port, path: reqPath,
            method: options.method || "GET",
            headers: options.headers || {}
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                const raw = Buffer.concat(chunks);
                const body = raw.toString("utf8");
                let json = null;
                try { json = JSON.parse(body); } catch (e) { /* non-json */ }
                resolve({ status: res.statusCode, headers: res.headers, raw, body, json });
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
            Promise.resolve().then(fn).then((ok) => {
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

/**
 * Deploy config + server + endpoints. Endpoints wired to "out" are answered by
 * `onFlowMessage(msg)` — the flow side of the gateway.
 */
function deploy({ cfg = {}, srv = {}, srvCreds, cfgCreds, endpoints = [], onFlowMessage }) {
    PORT++;
    const flow = [
        Object.assign({ id: "cfg", type: "apigw-config", name: "E2E Cfg" }, cfg),
        Object.assign({ id: "srv", type: "apigw-server", name: "E2E Srv", port: PORT, host: "127.0.0.1", config: "cfg" }, srv),
        ...endpoints.map((ep, i) => Object.assign({
            id: `ep${i}`, type: "apigw-endpoint", name: `E2E Ep ${i}`, server: "srv", wires: [["out"]]
        }, ep)),
        { id: "out", type: "helper" }
    ];
    const creds = {};
    if (srvCreds) creds.srv = srvCreds;
    if (cfgCreds) creds.cfg = cfgCreds;
    return new Promise((resolve, reject) => {
        helper.load([apiServerNode, apiConfigNode, apiEndpointNode], flow, creds, function() {
            const server = helper.getNode("srv");
            if (onFlowMessage) {
                helper.getNode("out").on("input", (msg) => onFlowMessage(msg));
            }
            waitFor(() => server.serverStarted && server.fastify && server.fastify.server.listening, 5000, 20)
                .then(() => resolve(server), reject);
        }).catch(reject);
    });
}

// ---------------------------------------------------------------------------
// Issue #6 — request body limit and raw (binary) bodies
// ---------------------------------------------------------------------------
describe("E2E #6: request body limit and raw uploads", function() {
    this.timeout(30000);

    beforeEach(function(done) { helper.startServer(done); });
    afterEach(function(done) { helper.unload(); helper.stopServer(done); });

    // The flow inspects what the gateway delivered and answers with a summary,
    // or echoes the bytes back for the download check.
    function uploadFlow(msg) {
        const body = msg.req.body;
        if (msg.req.query && msg.req.query.echo === "1" && Buffer.isBuffer(body)) {
            msg.res.set("Content-Type", "application/octet-stream").send(body);
            return;
        }
        msg.res.status(200).json({
            isBuffer: Buffer.isBuffer(body),
            length: Buffer.isBuffer(body) ? body.length : JSON.stringify(body).length,
            sha256: Buffer.isBuffer(body) ? crypto.createHash("sha256").update(body).digest("hex") : null,
            json: Buffer.isBuffer(body) ? null : body
        });
    }

    const uploadEndpoint = { path: "/upload", method: "POST", useFlowOutput: true };

    it("defaults are unchanged: raw image -> 415 and JSON over 1 MiB -> 413", async function() {
        const srv = await deploy({ endpoints: [uploadEndpoint], onFlowMessage: uploadFlow });
        const img = await httpRequest(srv.port, "/upload", {
            method: "POST", headers: { "content-type": "image/png" }, body: crypto.randomBytes(1024)
        });
        img.status.should.equal(415);
        const big = JSON.stringify({ d: "x".repeat(1.2 * MiB) });
        const json = await httpRequest(srv.port, "/upload", {
            method: "POST", headers: { "content-type": "application/json" }, body: big
        });
        json.status.should.equal(413);
    });

    it("a 5 MiB image arrives in the flow as a Buffer with its bytes intact", async function() {
        const srv = await deploy({
            srv: { bodyLimit: 10 * MiB, binaryBodyEnabled: true },
            endpoints: [uploadEndpoint], onFlowMessage: uploadFlow
        });
        const img = crypto.randomBytes(5 * MiB);
        const res = await httpRequest(srv.port, "/upload", {
            method: "POST", headers: { "content-type": "image/jpeg" }, body: img
        });
        res.status.should.equal(200);
        res.json.isBuffer.should.be.true();
        res.json.length.should.equal(img.length);
        res.json.sha256.should.equal(crypto.createHash("sha256").update(img).digest("hex"));
    });

    it("round-trips binary: upload as octet-stream, flow sends the same bytes back", async function() {
        const srv = await deploy({
            srv: { binaryBodyEnabled: true },
            endpoints: [uploadEndpoint], onFlowMessage: uploadFlow
        });
        const blob = crypto.randomBytes(300 * 1024);
        const res = await httpRequest(srv.port, "/upload?echo=1", {
            method: "POST", headers: { "content-type": "application/octet-stream" }, body: blob
        });
        res.status.should.equal(200);
        res.headers["content-type"].should.match(/application\/octet-stream/);
        Buffer.compare(res.raw, blob).should.equal(0);
    });

    it("only listed raw types are accepted; others still get 415", async function() {
        const srv = await deploy({
            srv: { binaryBodyEnabled: true, binaryContentTypes: "application/pdf" },
            endpoints: [uploadEndpoint], onFlowMessage: uploadFlow
        });
        const pdf = await httpRequest(srv.port, "/upload", {
            method: "POST", headers: { "content-type": "application/pdf" }, body: Buffer.from("%PDF-1.7")
        });
        pdf.status.should.equal(200);
        pdf.json.isBuffer.should.be.true();
        const png = await httpRequest(srv.port, "/upload", {
            method: "POST", headers: { "content-type": "image/png" }, body: Buffer.from("png")
        });
        png.status.should.equal(415);
    });

    it("raw bodies over bodyLimit get 413; JSON above 1 MiB passes with a larger limit", async function() {
        const srv = await deploy({
            srv: { bodyLimit: 2 * MiB, binaryBodyEnabled: true },
            endpoints: [uploadEndpoint], onFlowMessage: uploadFlow
        });
        const tooBig = await httpRequest(srv.port, "/upload", {
            method: "POST", headers: { "content-type": "image/png" }, body: Buffer.alloc(2 * MiB + 1)
        });
        tooBig.status.should.equal(413);
        const doc = { d: "y".repeat(1.5 * MiB) };
        const json = await httpRequest(srv.port, "/upload", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc)
        });
        json.status.should.equal(200);
        json.json.isBuffer.should.be.false();
        json.json.json.d.length.should.equal(doc.d.length);
    });
});

// ---------------------------------------------------------------------------
// Issue #5 — /metrics access control
// ---------------------------------------------------------------------------

/** Minimal Keycloak stand-in: serves a JWKS and signs RS256 access tokens. */
function startFakeKeycloak(realm) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const kid = "e2e-key";
    const jwk = Object.assign(publicKey.export({ format: "jwk" }), { kid, alg: "RS256", use: "sig" });
    const server = http.createServer((req, res) => {
        if (req.url === `/realms/${realm}/protocol/openid-connect/certs`) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ keys: [jwk] }));
            return;
        }
        res.writeHead(404);
        res.end();
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const url = `http://127.0.0.1:${server.address().port}`;
            const issuer = `${url}/realms/${realm}`;
            const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
            const sign = (claims, opts = {}) => {
                const now = Math.floor(Date.now() / 1000);
                const payload = Object.assign({ iss: issuer, sub: "prometheus", iat: now, exp: now + 300 }, claims);
                const input = `${b64({ alg: "RS256", typ: "JWT", kid })}.${b64(payload)}`;
                const key = opts.key || privateKey;
                const sig = crypto.sign("RSA-SHA256", Buffer.from(input), key).toString("base64url");
                return `${input}.${sig}`;
            };
            resolve({ url, issuer, sign, close: () => new Promise((r) => server.close(r)) });
        });
    });
}

describe("E2E #5: /metrics access control", function() {
    this.timeout(30000);
    const REALM = "e2e";
    let kc;

    before(async function() { kc = await startFakeKeycloak(REALM); });
    after(async function() { if (kc) await kc.close(); });

    beforeEach(function(done) { helper.startServer(done); });
    afterEach(function(done) { helper.unload(); helper.stopServer(done); });

    const apiEndpoint = { path: "/ping", method: "GET", useFlowOutput: true };
    const pong = (msg) => msg.res.status(200).json({ pong: true });
    const bearer = (t) => ({ authorization: `Bearer ${t}` });
    const basic = (u, p) => ({ authorization: "Basic " + Buffer.from(`${u}:${p}`).toString("base64") });

    it("is opt-in: a server without metricsEnabled exposes no /metrics", async function() {
        const srv = await deploy({ endpoints: [apiEndpoint], onFlowMessage: pong });
        (await httpRequest(srv.port, "/metrics")).status.should.equal(404);
        (await httpRequest(srv.port, "/ping")).status.should.equal(200);
    });

    it("none: explicitly public metrics, no credentials needed", async function() {
        const srv = await deploy({
            srv: { metricsEnabled: true, metricsAuth: "none" },
            endpoints: [apiEndpoint], onFlowMessage: pong
        });
        await httpRequest(srv.port, "/ping");
        const res = await httpRequest(srv.port, "/metrics");
        res.status.should.equal(200);
        res.body.should.match(/api_gateway_http_requests_total/);
    });

    it("bearer: static token required; 401 with a challenge otherwise", async function() {
        const srv = await deploy({
            srv: { metricsEnabled: true, metricsAuth: "bearer" },
            srvCreds: { metricsToken: "scrape-token-123" },
            endpoints: [apiEndpoint], onFlowMessage: pong
        });
        const none = await httpRequest(srv.port, "/metrics");
        none.status.should.equal(401);
        none.headers["www-authenticate"].should.match(/^Bearer realm="metrics"/);
        none.body.should.not.match(/api_gateway_/);
        (await httpRequest(srv.port, "/metrics", { headers: bearer("wrong") })).status.should.equal(401);
        const ok = await httpRequest(srv.port, "/metrics", { headers: bearer("scrape-token-123") });
        ok.status.should.equal(200);
        ok.body.should.match(/api_gateway_/);
        // API endpoints are unaffected by the metrics credentials
        (await httpRequest(srv.port, "/ping")).status.should.equal(200);
    });

    it("basic: username and password required", async function() {
        const srv = await deploy({
            srv: { metricsEnabled: true, metricsAuth: "basic", metricsPath: "/internal/metrics" },
            srvCreds: { metricsUsername: "prometheus", metricsPassword: "p@ss:word" }
        });
        const none = await httpRequest(srv.port, "/internal/metrics");
        none.status.should.equal(401);
        none.headers["www-authenticate"].should.match(/^Basic realm="metrics"/);
        (await httpRequest(srv.port, "/internal/metrics", { headers: basic("prometheus", "nope") })).status.should.equal(401);
        (await httpRequest(srv.port, "/internal/metrics", { headers: basic("prometheus", "p@ss:word") })).status.should.equal(200);
    });

    it("oauth2: real JWT validated against the JWKS, with required scopes", async function() {
        const srv = await deploy({
            cfg: { oauth2Enabled: true, keycloakUrl: kc.url, keycloakRealm: REALM, keycloakClientId: "gateway", jwtAlgorithms: "RS256" },
            srv: { metricsEnabled: true, metricsAuth: "oauth2", metricsRequiredScopes: "metrics:read" }
        });
        (await httpRequest(srv.port, "/metrics")).status.should.equal(401);

        const good = kc.sign({ scope: "openid metrics:read" });
        const ok = await httpRequest(srv.port, "/metrics", { headers: bearer(good) });
        ok.status.should.equal(200);
        ok.body.should.match(/api_gateway_/);

        // Valid signature, but without the required scope
        const noScope = kc.sign({ scope: "openid" });
        (await httpRequest(srv.port, "/metrics", { headers: bearer(noScope) })).status.should.equal(403);

        // A realm role satisfies the scope check too (same rules as endpoints)
        const role = kc.sign({ scope: "openid", realm_access: { roles: ["metrics:read"] } });
        (await httpRequest(srv.port, "/metrics", { headers: bearer(role) })).status.should.equal(200);

        // Signed by a different key / expired -> 401
        const { privateKey: rogue } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
        const forged = kc.sign({ scope: "metrics:read" }, { key: rogue });
        (await httpRequest(srv.port, "/metrics", { headers: bearer(forged) })).status.should.equal(401);
        const expired = kc.sign({ scope: "metrics:read", exp: Math.floor(Date.now() / 1000) - 3600 });
        (await httpRequest(srv.port, "/metrics", { headers: bearer(expired) })).status.should.equal(401);
    });

    it("oauth2 without OAuth2 on the config node fails closed with 503", async function() {
        const srv = await deploy({ srv: { metricsEnabled: true, metricsAuth: "oauth2" } });
        (await httpRequest(srv.port, "/metrics", { headers: bearer("anything") })).status.should.equal(503);
    });

    it("a mode without its credentials fails closed with 503", async function() {
        const srv = await deploy({ srv: { metricsEnabled: true, metricsAuth: "bearer" } });
        (await httpRequest(srv.port, "/metrics")).status.should.equal(503);
    });

    it("IP allowlist: other sources get 403; allowed sources still need the credential", async function() {
        let srv = await deploy({
            srv: { metricsEnabled: true, metricsAuth: "none", metricsAllowedIps: "10.200.0.0/16, fd00::/8" }
        });
        (await httpRequest(srv.port, "/metrics")).status.should.equal(403);
        helper.unload();

        srv = await deploy({
            srv: { metricsEnabled: true, metricsAuth: "bearer", metricsAllowedIps: "127.0.0.0/8" },
            srvCreds: { metricsToken: "t0k" }
        });
        (await httpRequest(srv.port, "/metrics")).status.should.equal(401);
        (await httpRequest(srv.port, "/metrics", { headers: bearer("t0k") })).status.should.equal(200);
    });
});

// ---------------------------------------------------------------------------
// Issue #4 — auto-CRUD database errors against a real SQL Server
// ---------------------------------------------------------------------------

const MSSQL_IMAGE = "mcr.microsoft.com/mssql/server:2022-latest";
const MSSQL_CONTAINER = `apigw-e2e-mssql-${process.pid}`;
const external = !!process.env.E2E_MSSQL_HOST;
const MSSQL = {
    host: process.env.E2E_MSSQL_HOST || "127.0.0.1",
    port: parseInt(process.env.E2E_MSSQL_PORT, 10) || 14339,
    password: process.env.E2E_MSSQL_PASSWORD || "E2e_Str0ng!Passw0rd"
};

function dockerAvailable() {
    try {
        return spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" }).status === 0;
    } catch (e) {
        return false;
    }
}

const sqlRunner = (external || dockerAvailable()) ? describe : describe.skip;

sqlRunner("E2E #4: auto-CRUD database errors (real SQL Server)", function() {
    this.timeout(240000);
    const sql = require("mssql");
    const DB = "apigw_e2e";
    const LEAK = /PK__|FK__|CK__|dbo\.|PRIMARY KEY|FOREIGN KEY|CHECK constraint|parents|children|Cannot insert|Conversion failed/i;

    const baseCfg = {
        dbType: "mssql", dbHost: MSSQL.host, dbPort: MSSQL.port, dbName: DB,
        dbEncrypt: false, dbTrustServerCertificate: true
    };
    const cfgCreds = { dbUser: "sa", dbPassword: MSSQL.password };

    async function adminQuery(query, database) {
        const pool = await new sql.ConnectionPool({
            server: MSSQL.host, port: MSSQL.port, user: "sa", password: MSSQL.password,
            database: database || "master",
            options: { encrypt: false, trustServerCertificate: true }
        }).connect();
        try {
            return await pool.request().query(query);
        } finally {
            await pool.close();
        }
    }

    before(async function() {
        if (!external) {
            spawnSync("docker", ["rm", "-f", MSSQL_CONTAINER], { stdio: "ignore" });
            const run = spawnSync("docker", [
                "run", "-d", "--rm", "--name", MSSQL_CONTAINER,
                "-e", "ACCEPT_EULA=Y", "-e", `MSSQL_SA_PASSWORD=${MSSQL.password}`,
                "-p", `127.0.0.1:${MSSQL.port}:1433`, MSSQL_IMAGE
            ], { encoding: "utf8" });
            if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
        }
        await waitFor(() => adminQuery("SELECT 1 AS ok").then(() => true, () => false), 180000, 2000);
        await adminQuery(`IF DB_ID('${DB}') IS NOT NULL BEGIN ALTER DATABASE ${DB} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${DB}; END; CREATE DATABASE ${DB};`);
        await adminQuery(`
            CREATE TABLE parents (id INT PRIMARY KEY, name NVARCHAR(20) NOT NULL);
            CREATE TABLE children (
                id INT PRIMARY KEY,
                parent_id INT NOT NULL REFERENCES parents(id),
                qty INT NOT NULL CHECK (qty >= 0)
            );`, DB);
    });

    after(function() {
        if (!external) spawnSync("docker", ["rm", "-f", MSSQL_CONTAINER], { stdio: "ignore" });
    });

    beforeEach(function(done) { helper.startServer(done); });
    afterEach(function(done) { helper.unload(); helper.stopServer(done); });

    const crud = (path, method, table, op, extra) => Object.assign({
        path, method, tableName: table, primaryKey: "id", crudOperation: op,
        autoGenerateSql: true, useFlowOutput: false
    }, extra || {});

    async function deployCrud(opts = {}) {
        const srv = await deploy({
            cfg: Object.assign({}, baseCfg, opts.cfg || {}),
            cfgCreds,
            endpoints: opts.endpoints || [
                crud("/parents", "POST", "parents", "create"),
                crud("/parents/:id", "GET", "parents", "get"),
                crud("/parents/:id", "DELETE", "parents", "delete"),
                crud("/children", "POST", "children", "create")
            ]
        });
        const cfg = helper.getNode("cfg");
        await waitFor(() => cfg.isSqlServerReady(), 30000, 100);
        return srv;
    }

    const post = (srv, path, body, headers) => httpRequest(srv.port, path, {
        method: "POST", headers: Object.assign({ "content-type": "application/json" }, headers || {}),
        body: JSON.stringify(body)
    });

    function assertSafeProblem(res, status) {
        res.status.should.equal(status, res.body);
        res.json.status.should.equal(status);
        res.json.should.have.property("type");
        res.json.should.have.property("title");
        res.json.should.have.property("requestId");
        res.body.should.not.match(LEAK);
    }

    it("creates a row normally (201)", async function() {
        const srv = await deployCrud();
        const res = await post(srv, "/parents", { id: 1, name: "alpha" });
        res.status.should.equal(201, res.body);
        const child = await post(srv, "/children", { id: 10, parent_id: 1, qty: 3 });
        child.status.should.equal(201, child.body);
    });

    it("duplicate primary key -> 409 Conflict without schema details", async function() {
        const srv = await deployCrud();
        const res = await post(srv, "/parents", { id: 1, name: "dup" }, { "x-request-id": "e2e-dup-1" });
        assertSafeProblem(res, 409);
        res.json.type.should.equal("https://api.example.com/errors/conflict");
        res.json.requestId.should.equal("e2e-dup-1");
        res.headers["x-request-id"].should.equal("e2e-dup-1");
    });

    it("NULL into NOT NULL, bad type and truncation -> 400 without schema details", async function() {
        const srv = await deployCrud();
        assertSafeProblem(await post(srv, "/parents", { id: 2 }), 400);
        assertSafeProblem(await post(srv, "/parents", { id: "not-a-number", name: "x" }), 400);
        assertSafeProblem(await post(srv, "/parents", { id: 3, name: "n".repeat(50) }), 400);
    });

    it("FOREIGN KEY / CHECK violations on insert -> 400", async function() {
        const srv = await deployCrud();
        assertSafeProblem(await post(srv, "/children", { id: 20, parent_id: 999, qty: 1 }), 400);
        assertSafeProblem(await post(srv, "/children", { id: 21, parent_id: 1, qty: -5 }), 400);
    });

    it("deleting a still-referenced row -> 409", async function() {
        const srv = await deployCrud();
        const res = await httpRequest(srv.port, "/parents/1", { method: "DELETE" });
        assertSafeProblem(res, 409);
    });

    it("exposeDbErrors returns the raw database message (dev mode)", async function() {
        const srv = await deployCrud({
            endpoints: [crud("/parents", "POST", "parents", "create", { exposeDbErrors: true })]
        });
        const res = await post(srv, "/parents", { id: 1, name: "dup" });
        res.status.should.equal(409);
        res.json.detail.should.match(/PRIMARY KEY/);
    });

    it("problemTypeBaseUri on the config node sets the problem type", async function() {
        const srv = await deployCrud({ cfg: { problemTypeBaseUri: "urn:problem:" } });
        const dup = await post(srv, "/parents", { id: 1, name: "dup" });
        dup.json.type.should.equal("urn:problem:conflict");
        const missing = await httpRequest(srv.port, "/parents/424242");
        missing.status.should.equal(404);
        missing.json.type.should.equal("urn:problem:not-found");
    });
});
