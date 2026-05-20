#!/usr/bin/env node
/**
 * E2E test for msg.db exposure on apigw-endpoint output.
 *
 * Verifies that a function node downstream of an apigw-endpoint can run
 * a parameterized SQL query via msg.db.executeQuery() WITHOUT importing
 * `mssql` or instantiating its own ConnectionPool. The query result must
 * reach the HTTP response correctly.
 *
 * Bootstrap:
 *   - Saves and replaces tests/e2e/.nodered/flows.json + flows_cred.json
 *   - docker compose up -d --profile sqlserver --profile nodered
 *   - Waits for SQL Server + Node-RED to be healthy
 *   - HTTP GET http://localhost:3200/db-probe
 *   - Restores flows.json + flows_cred.json
 *   - docker compose down -v (unless SKIP_DOCKER_TEARDOWN=1)
 *
 * Env:
 *   SKIP_DOCKER_SETUP=1     reuse an already-running stack
 *   SKIP_DOCKER_TEARDOWN=1  keep stack running after the test
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawnSync } = require('child_process');

const E2E_DIR = __dirname;
const COMPOSE_FILE = path.join(E2E_DIR, 'docker-compose.yml');
const COMPOSE_OVERRIDE = path.join(E2E_DIR, 'docker-compose.msgdb.override.yml');
const NODERED_DIR = path.join(E2E_DIR, '.nodered');
const FLOWS_PATH = path.join(NODERED_DIR, 'flows.json');
const CREDS_PATH = path.join(NODERED_DIR, 'flows_cred.json');
const SRC_FLOW = path.join(E2E_DIR, 'msgdb-test-flow.json');

const API_BASE = 'http://localhost:3200';
const NODERED_BASE = 'http://localhost:1880';
const SA_PASSWORD = 'DevPassword123!';

const STARTUP_TIMEOUT_MS = 180000;
const POLL_INTERVAL_MS = 2000;

function log(msg) { process.stdout.write(`[msgdb-e2e] ${msg}\n`); }
function fail(msg) { process.stderr.write(`[msgdb-e2e][FAIL] ${msg}\n`); }

function compose(args, opts = {}) {
    const r = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, '-f', COMPOSE_OVERRIDE, ...args], {
        stdio: opts.silent ? 'pipe' : 'inherit',
        encoding: 'utf8'
    });
    if (r.status !== 0 && !opts.allowFail) {
        throw new Error(`docker compose ${args.join(' ')} exited ${r.status}\n${r.stderr || ''}`);
    }
    return r;
}

function get(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', (c) => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
    });
}

async function waitFor(name, fn) {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            if (await fn()) { log(`${name} ready`); return; }
        } catch (_e) { /* keep waiting */ }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`timeout waiting for ${name}`);
}

async function waitForSqlServer() {
    return waitFor('sql server', () => {
        const r = spawnSync('docker', ['exec', 'api-gateway-sqlserver',
            '/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', 'sa',
            '-P', SA_PASSWORD, '-C', '-Q', 'SELECT 1'], { encoding: 'utf8' });
        return r.status === 0 && /\b1\b/.test(r.stdout || '');
    });
}

async function waitForNodeRed() {
    return waitFor('node-red', async () => {
        const r = await get(`${NODERED_BASE}/`);
        return r.status === 200;
    });
}

function saveBackup() {
    const saved = {};
    for (const p of [FLOWS_PATH, CREDS_PATH]) {
        if (fs.existsSync(p)) saved[p] = fs.readFileSync(p);
    }
    return saved;
}

function restoreBackup(saved) {
    for (const [p, buf] of Object.entries(saved)) fs.writeFileSync(p, buf);
}

function installFlow() {
    const flow = fs.readFileSync(SRC_FLOW);
    fs.writeFileSync(FLOWS_PATH, flow);
    // Credentials: dbUser/dbPassword for the apigw-config node.
    fs.writeFileSync(CREDS_PATH, JSON.stringify({
        'msgdb-api-config': { dbUser: 'sa', dbPassword: SA_PASSWORD }
    }, null, 2));
}

async function runTest() {
    log('GET /db-probe ...');
    const r = await get(`${API_BASE}/db-probe`, 15000);
    if (r.status !== 200) {
        throw new Error(`expected 200, got ${r.status}: ${r.body}`);
    }
    let parsed;
    try { parsed = JSON.parse(r.body); }
    catch (e) { throw new Error(`response not JSON: ${r.body}`); }
    if (!parsed || !parsed.row || parsed.row.answer !== 42 || parsed.row.label !== 'msg-db-works') {
        throw new Error(`unexpected payload: ${r.body}`);
    }
    if (parsed.rowCount !== 1) {
        throw new Error(`expected rowCount=1, got ${parsed.rowCount}`);
    }
    log(`OK — answer=${parsed.row.answer}, label=${parsed.row.label}`);
}

async function main() {
    if (!fs.existsSync(SRC_FLOW)) throw new Error(`missing ${SRC_FLOW}`);

    const saved = saveBackup();
    let stackStarted = false;
    try {
        installFlow();

        if (!process.env.SKIP_DOCKER_SETUP) {
            log('docker compose down -v (clean slate)');
            compose(['down', '-v'], { allowFail: true, silent: true });
            log('docker compose up -d --profile sqlserver --profile nodered');
            // network_base first (shared netns), then SQL Server, wait until it's
            // accepting connections, then Node-RED — so the apigw-config pool
            // succeeds on its first connect. Keycloak/OPA are skipped (this
            // test's flow disables OAuth2/OPA).
            compose(['--profile', 'all', 'up', '-d', 'network_base']);
            compose(['--profile', 'all', 'up', '-d', '--no-deps', 'db']);
            await waitForSqlServer();
            compose(['--profile', 'all', 'up', '-d', '--no-deps', 'node-red']);
            stackStarted = true;
        } else {
            // When skipping setup, the user must have started the stack with both
            // profiles and our flow file already in place. Restart node-red so it
            // picks up the freshly written flows.json.
            compose(['restart', 'node-red'], { allowFail: true });
        }

        await waitForNodeRed();
        // Give Node-RED a couple of seconds after /200 to finish wiring routes.
        await new Promise(r => setTimeout(r, 3000));

        await runTest();
        log('TEST PASSED');
        process.exitCode = 0;
    } catch (e) {
        fail(e.message);
        try {
            const logs = execSync(`docker compose -f ${COMPOSE_FILE} -f ${COMPOSE_OVERRIDE} logs --tail=80 node-red`, { encoding: 'utf8' });
            process.stderr.write(`\n--- node-red logs (tail) ---\n${logs}\n`);
        } catch (_) { /* ignore */ }
        process.exitCode = 1;
    } finally {
        restoreBackup(saved);
        if (stackStarted && !process.env.SKIP_DOCKER_TEARDOWN) {
            log('docker compose down -v');
            compose(['down', '-v'], { allowFail: true, silent: true });
        }
    }
}

main().catch((e) => { fail(e.stack || e.message); process.exit(1); });
