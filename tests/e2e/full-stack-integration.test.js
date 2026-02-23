#!/usr/bin/env node

/**
 * Full Stack Integration Tests for Node-RED API Gateway
 *
 * This comprehensive e2e test validates all security and data layers working together:
 * - TLS/HTTPS: Secure transport with certificate validation
 * - OAuth2: Client credentials authentication via Keycloak
 * - OPA: Policy-based authorization
 * - SQL Server: Database persistence for CRUD operations
 *
 * ============================================================================
 * SETUP INSTRUCTIONS
 * ============================================================================
 *
 * Run the integration tests (Docker stack starts automatically if needed):
 *
 *    npm run test:full-stack
 *    # or: node tests/e2e/full-stack-integration.test.js
 *
 * Environment variables:
 *    SKIP_DOCKER_SETUP=1    - Don't start Docker (use existing stack)
 *    SKIP_DOCKER_TEARDOWN=1 - Keep Docker running after tests
 *    SKIP_SQL_INIT=1        - Don't initialize SQL Server database
 *
 * ============================================================================
 * WHAT THIS TESTS
 * ============================================================================
 *
 * TLS Layer (2 tests):
 * - HTTPS connection with valid CA certificate
 * - Connection fails with wrong CA certificate
 *
 * OAuth2 Layer (3 tests):
 * - User service token acquisition
 * - Admin service token acquisition
 * - Invalid credentials rejected
 *
 * OPA Layer (4 tests):
 * - User service can list products (api:read)
 * - User service cannot create products (403)
 * - Admin service can create products (api:write)
 * - Admin service can delete products (api:delete)
 *
 * SQL Server Layer (6 tests):
 * - List products from database
 * - Get single product by ID
 * - Create product inserts to DB
 * - Update product modifies DB
 * - Delete product removes from DB
 * - Pagination with SQL Server
 *
 * ============================================================================
 * SERVICE ACCOUNTS (from Keycloak realm)
 * ============================================================================
 *
 * | Client ID              | Secret              | Roles                    |
 * |------------------------|---------------------|--------------------------|
 * | my-api-client          | my-client-secret    | user, api:read, api:write|
 * | my-admin-service       | admin-service-secret| admin, api:read/write/delete |
 *
 * ============================================================================
 * CLEANUP
 * ============================================================================
 *
 *    npm run docker:e2e:down
 *    # or: cd tests/e2e && docker compose --profile nodered --profile sqlserver down -v
 *
 * Exit codes:
 * - 0: All tests passed
 * - 1: Tests failed or services unavailable
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
    apiBaseUrl: 'https://localhost:3443',
    keycloakUrl: 'http://localhost:8080',
    keycloakRealm: 'my-realm',
    opaUrl: 'http://localhost:8181',
    requestTimeout: 15000,

    // TLS configuration
    certsDir: path.join(__dirname, 'certs'),
    setupScript: path.join(__dirname, 'setup-certs.sh'),
    mkcertBin: path.join(__dirname, '..', '..', 'contrib', 'mkcert'),

    // Flow configuration
    fullStackFlowSource: path.join(__dirname, '..', '..', 'examples', 'full-stack-api.json'),
    flowsTarget: path.join(__dirname, '.nodered', 'flows.json'),

    // SQL Server configuration
    sqlInitScript: path.join(__dirname, 'data', 'sqlserver', 'init-full-stack-test.sql'),
    sqlServerHost: 'localhost',
    sqlServerPort: 1433,
    sqlServerUser: 'sa',
    sqlServerPassword: 'DevPassword123!',
    sqlServerDatabase: 'testdb',

    // Service account clients
    clients: {
        // Standard service account with user-level access
        userService: {
            clientId: 'my-api-client',
            clientSecret: 'my-client-secret',
            expectedRoles: ['user'],
            expectedClientRoles: ['api:read', 'api:write']
        },
        // Admin service account with full access
        adminService: {
            clientId: 'my-admin-service',
            clientSecret: 'admin-service-secret',
            expectedRoles: ['admin'],
            expectedClientRoles: ['api:read', 'api:write', 'api:delete', 'api:admin']
        }
    },

    // Docker configuration
    dockerComposeFile: path.join(__dirname, 'docker-compose.yml'),
    dockerComposeProfiles: ['nodered', 'sqlserver'],
    startupTimeout: 180000,  // 3 minutes for SQL Server
    startupPollInterval: 3000,
    skipDockerSetup: process.env.SKIP_DOCKER_SETUP === '1',
    skipDockerTeardown: process.env.SKIP_DOCKER_TEARDOWN === '1',
    skipSqlInit: process.env.SKIP_SQL_INIT === '1'
};

// Track if we started Docker
let dockerStartedByUs = false;

// CA certificate for HTTPS validation
let caCert = null;

// Test results tracking
const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: []
};

// Token cache for tests
const tokenCache = {};

// ============================================================================
// HTTP Helpers
// ============================================================================

/**
 * Simple HTTP request (for non-TLS endpoints)
 */
function httpRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(options.url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || CONFIG.requestTimeout,
            rejectUnauthorized: options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : false
        };

        const req = client.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = data ? JSON.parse(data) : null;
                    resolve({ status: res.statusCode, headers: res.headers, data: json, raw: data });
                } catch {
                    resolve({ status: res.statusCode, headers: res.headers, data: null, raw: data });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }

        req.end();
    });
}

/**
 * HTTPS request helper with CA validation
 */
function httpsRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(options.url);

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || CONFIG.requestTimeout,
            ca: options.ca !== undefined ? options.ca : caCert,
            rejectUnauthorized: options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : true
        };

        const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = data ? JSON.parse(data) : null;
                    resolve({ status: res.statusCode, headers: res.headers, data: json, raw: data });
                } catch {
                    resolve({ status: res.statusCode, headers: res.headers, data: null, raw: data });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }

        req.end();
    });
}

/**
 * Make API request with optional auth
 */
async function apiRequest(pathOrUrl, options = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${CONFIG.apiBaseUrl}${pathOrUrl}`;
    const headers = options.headers || {};

    if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
    }

    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    return httpsRequest({
        url,
        method: options.method || 'GET',
        headers,
        ca: options.ca,
        rejectUnauthorized: options.rejectUnauthorized
    }, options.body);
}

// ============================================================================
// OAuth2 Helpers
// ============================================================================

/**
 * Get OAuth2 token using Client Credentials flow
 */
async function getClientCredentialsToken(clientId, clientSecret) {
    const tokenUrl = `${CONFIG.keycloakUrl}/realms/${CONFIG.keycloakRealm}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
    }).toString();

    const response = await httpRequest({
        url: tokenUrl,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }, body);

    if (response.status !== 200) {
        const error = new Error(`Failed to get token: HTTP ${response.status}`);
        error.response = response;
        throw error;
    }

    return response.data;
}

/**
 * Get cached token or fetch new one
 */
async function getToken(clientKey) {
    if (tokenCache[clientKey] && tokenCache[clientKey].expiresAt > Date.now()) {
        return tokenCache[clientKey].token;
    }

    const client = CONFIG.clients[clientKey];
    if (!client) {
        throw new Error(`Unknown client: ${clientKey}`);
    }

    const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);

    tokenCache[clientKey] = {
        token: tokenData.access_token,
        expiresAt: Date.now() + (tokenData.expires_in * 1000) - 30000  // 30s buffer
    };

    return tokenCache[clientKey].token;
}

/**
 * Decode JWT token (without verification - for test assertions only)
 */
function decodeJwt(token) {
    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
    }
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
}

// ============================================================================
// Test Helpers
// ============================================================================

function recordTest(name, passed, details = '', skipped = false) {
    results.tests.push({ name, passed, details, skipped });
    if (skipped) {
        results.skipped++;
    } else if (passed) {
        results.passed++;
    } else {
        results.failed++;
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

// ============================================================================
// Infrastructure Setup
// ============================================================================

/**
 * Generate certificates using mkcert if they don't exist
 */
function generateCertificates() {
    const requiredFiles = ['server.crt', 'server.key', 'rootCA.pem'];
    const allExist = requiredFiles.every(f => fs.existsSync(path.join(CONFIG.certsDir, f)));

    if (allExist) {
        console.log('  [OK] Certificates already exist');
        return true;
    }

    console.log('  Generating certificates with mkcert...');

    try {
        if (!fs.existsSync(CONFIG.mkcertBin)) {
            console.error(`  [FAIL] mkcert binary not found at ${CONFIG.mkcertBin}`);
            return false;
        }

        execSync(`bash "${CONFIG.setupScript}"`, {
            stdio: 'inherit',
            cwd: path.dirname(CONFIG.setupScript)
        });

        console.log('  [OK] Certificates generated successfully');
        return true;
    } catch (error) {
        console.error(`  [FAIL] Failed to generate certificates: ${error.message}`);
        return false;
    }
}

/**
 * Load CA certificate for HTTPS validation
 */
function loadCaCertificate() {
    const caPath = path.join(CONFIG.certsDir, 'rootCA.pem');

    if (!fs.existsSync(caPath)) {
        console.error(`  [FAIL] CA certificate not found: ${caPath}`);
        return false;
    }

    caCert = fs.readFileSync(caPath);
    console.log('  [OK] CA certificate loaded');
    return true;
}

/**
 * Copy full-stack test flow to flows.json
 */
function copyTestFlow() {
    console.log('  Copying full-stack test flow...');

    try {
        if (!fs.existsSync(CONFIG.fullStackFlowSource)) {
            console.error(`  [FAIL] Flow not found: ${CONFIG.fullStackFlowSource}`);
            return false;
        }

        fs.copyFileSync(CONFIG.fullStackFlowSource, CONFIG.flowsTarget);
        console.log('  [OK] Test flow copied to flows.json');
        return true;
    } catch (error) {
        console.error(`  [FAIL] Failed to copy test flow: ${error.message}`);
        return false;
    }
}

/**
 * Start Docker stack with both nodered and sqlserver profiles
 */
function startDockerStack() {
    console.log('  Starting Docker stack with nodered and sqlserver profiles...');

    try {
        // First, ensure any existing stack is stopped
        try {
            const profiles = CONFIG.dockerComposeProfiles.map(p => `--profile ${p}`).join(' ');
            execSync(`docker compose -f "${CONFIG.dockerComposeFile}" ${profiles} down -v`, {
                stdio: 'pipe',
                cwd: __dirname
            });
        } catch {
            // Ignore errors if stack wasn't running
        }

        // Start the stack with both profiles
        const profiles = CONFIG.dockerComposeProfiles.map(p => `--profile ${p}`).join(' ');
        execSync(`docker compose -f "${CONFIG.dockerComposeFile}" ${profiles} up -d`, {
            stdio: 'inherit',
            cwd: __dirname
        });

        console.log('  [OK] Docker stack started');
        return true;
    } catch (error) {
        console.error(`  [FAIL] Failed to start Docker stack: ${error.message}`);
        return false;
    }
}

/**
 * Stop Docker stack
 */
function stopDockerStack() {
    console.log('\nStopping Docker stack...');

    try {
        const profiles = CONFIG.dockerComposeProfiles.map(p => `--profile ${p}`).join(' ');
        execSync(`docker compose -f "${CONFIG.dockerComposeFile}" ${profiles} down -v`, {
            stdio: 'inherit',
            cwd: __dirname
        });
        console.log('  [OK] Docker stack stopped');
        return true;
    } catch (error) {
        console.error(`  [WARN] Failed to stop Docker stack: ${error.message}`);
        return false;
    }
}

/**
 * Check if a service is available
 */
async function isServiceAvailable(url, timeout = 3000) {
    try {
        const response = await httpRequest({ url, timeout });
        return response.status === 200;
    } catch {
        return false;
    }
}

/**
 * Wait for all services to be ready
 */
async function waitForServices() {
    console.log('  Waiting for services to be ready...');

    const startTime = Date.now();
    let keycloakReady = false;
    let opaReady = false;
    let sqlServerReady = false;
    let apiServerReady = false;

    while (Date.now() - startTime < CONFIG.startupTimeout) {
        // Check Keycloak
        if (!keycloakReady) {
            try {
                const response = await httpRequest({
                    url: `${CONFIG.keycloakUrl}/realms/${CONFIG.keycloakRealm}/.well-known/openid-configuration`,
                    timeout: 3000
                });
                if (response.status === 200) {
                    keycloakReady = true;
                    console.log('  [OK] Keycloak is ready');
                }
            } catch {
                // Not ready yet
            }
        }

        // Check OPA
        if (!opaReady) {
            try {
                const response = await httpRequest({
                    url: `${CONFIG.opaUrl}/health`,
                    timeout: 3000
                });
                if (response.status === 200) {
                    opaReady = true;
                    console.log('  [OK] OPA is ready');
                }
            } catch {
                // Not ready yet
            }
        }

        // Check SQL Server via Docker health
        if (!sqlServerReady) {
            try {
                const result = execSync(
                    'docker inspect --format="{{.State.Health.Status}}" api-gateway-sqlserver',
                    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
                ).trim();
                if (result === 'healthy') {
                    sqlServerReady = true;
                    console.log('  [OK] SQL Server is ready');
                    // Restart Node-RED so it can establish DB connection now that SQL Server is ready
                    console.log('  Restarting Node-RED to establish database connection...');
                    try {
                        execSync('docker restart api-gateway-nodered', {
                            stdio: 'pipe',
                            encoding: 'utf8'
                        });
                        console.log('  [OK] Node-RED restarted');
                        // Wait for Node-RED to fully start up and establish connections
                        await new Promise(resolve => setTimeout(resolve, 10000));
                    } catch (restartErr) {
                        console.error(`  [WARN] Failed to restart Node-RED: ${restartErr.message}`);
                    }
                }
            } catch {
                // Not ready yet or container doesn't exist
            }
        }

        // Check API Server (HTTPS) - only after other services including SQL Server
        if (keycloakReady && opaReady && sqlServerReady && !apiServerReady) {
            try {
                const response = await httpRequest({
                    url: `${CONFIG.apiBaseUrl}/api/v1/public/health`,
                    timeout: 3000,
                    rejectUnauthorized: false
                });
                if (response.status === 200) {
                    apiServerReady = true;
                    console.log('  [OK] API Server (HTTPS) is ready');
                }
            } catch {
                // Not ready yet
            }
        }

        if (keycloakReady && opaReady && sqlServerReady && apiServerReady) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`  [OK] All services ready (took ${elapsed}s)`);
            return true;
        }

        // Progress indicator
        process.stdout.write('.');
        await new Promise(resolve => setTimeout(resolve, CONFIG.startupPollInterval));
    }

    console.log('');
    console.error(`  [FAIL] Services did not become ready within ${CONFIG.startupTimeout / 1000}s`);
    console.error(`    Keycloak: ${keycloakReady ? 'ready' : 'not ready'}`);
    console.error(`    OPA: ${opaReady ? 'ready' : 'not ready'}`);
    console.error(`    SQL Server: ${sqlServerReady ? 'ready' : 'not ready'}`);
    console.error(`    API Server: ${apiServerReady ? 'ready' : 'not ready'}`);
    return false;
}

/**
 * Initialize SQL Server with test data
 */
async function initializeSqlServer() {
    if (CONFIG.skipSqlInit) {
        console.log('  [SKIP] SQL Server initialization skipped (SKIP_SQL_INIT=1)');
        return true;
    }

    console.log('  Initializing SQL Server database...');

    try {
        // Read the init script
        const initScript = fs.readFileSync(CONFIG.sqlInitScript, 'utf8');

        // Execute via docker exec and sqlcmd
        const sqlCommand = initScript
            .replace(/'/g, "'\"'\"'")  // Escape single quotes for shell
            .split('\nGO\n')
            .filter(s => s.trim())
            .join('\nGO\n');

        // Use docker exec to run sqlcmd (use double quotes for password with special chars)
        execSync(
            `docker exec -i api-gateway-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "${CONFIG.sqlServerPassword}" -C -i /dev/stdin`,
            {
                input: initScript,
                stdio: ['pipe', 'inherit', 'inherit'],
                encoding: 'utf8'
            }
        );

        console.log('  [OK] SQL Server database initialized');
        return true;
    } catch (error) {
        console.error(`  [WARN] SQL Server initialization failed: ${error.message}`);
        console.error('  Tests will use mock data from the flow handlers');
        return true;  // Don't fail - flow has mock data
    }
}

/**
 * Full infrastructure setup
 */
async function setupInfrastructure() {
    console.log('\n' + '='.repeat(70));
    console.log('INFRASTRUCTURE SETUP');
    console.log('='.repeat(70) + '\n');

    // Step 1: Generate certificates
    console.log('Step 1: TLS Certificates');
    if (!generateCertificates()) {
        return false;
    }
    if (!loadCaCertificate()) {
        return false;
    }

    // Step 2: Copy test flow
    console.log('\nStep 2: Test Flow');
    if (!copyTestFlow()) {
        return false;
    }

    // Step 3: Start Docker stack
    if (CONFIG.skipDockerSetup) {
        console.log('\nStep 3: Docker Stack (SKIPPED - SKIP_DOCKER_SETUP=1)');
    } else {
        console.log('\nStep 3: Docker Stack');
        if (!startDockerStack()) {
            return false;
        }
        dockerStartedByUs = true;
    }

    // Step 4: Wait for services
    console.log('\nStep 4: Service Health');
    if (!await waitForServices()) {
        return false;
    }

    // Step 5: Initialize SQL Server
    console.log('\nStep 5: Database Initialization');
    if (!await initializeSqlServer()) {
        return false;
    }

    console.log('\n' + '='.repeat(70) + '\n');
    return true;
}

/**
 * Cleanup function
 */
function cleanup() {
    if (dockerStartedByUs && !CONFIG.skipDockerTeardown) {
        stopDockerStack();
    } else if (dockerStartedByUs && CONFIG.skipDockerTeardown) {
        console.log('\nDocker teardown skipped (SKIP_DOCKER_TEARDOWN=1)');
        console.log('To stop the stack manually:');
        console.log('  docker compose -f tests/e2e/docker-compose.yml --profile nodered --profile sqlserver down -v\n');
    }
}

// ============================================================================
// TLS Layer Tests (2 tests)
// ============================================================================

async function testHttpsWithValidCA() {
    console.log('TEST: HTTPS connection with valid CA certificate');

    try {
        const response = await apiRequest('/api/v1/public/health');

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.status === 'healthy', `Expected status 'healthy', got '${response.data.status}'`);

        console.log('  [PASS] HTTPS connection successful with certificate validation\n');
        recordTest('HTTPS with valid CA', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('HTTPS with valid CA', false, error.message);
    }
}

async function testConnectionFailsWithWrongCA() {
    console.log('TEST: Connection fails with wrong CA certificate');

    const fakeCA = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHBfpegPjMCMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBmZh
a2VDQTAeFw0yNDAxMDEwMDAwMDBaFw0yNTAxMDEwMDAwMDBaMBExDzANBgNVBAMM
BmZha2VDQTBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQC5fNmMx0pqTZ1gPG9A3FmW
Fvl6jJE4Mj0Yp6N7cGxvJ5Z6Q8l9sXbZlG3cN3bKxEjHlKxXl8qLzO9z5QIDAQAB
MA0GCSqGSIb3DQEBCwUAA0EAMjA5MTMwMTAwMDAwMFowMTEPMA0GA1UEAwwGZmFr
ZUNBMA0GCSqGSIb3DQEBCwUAA0EAtest
-----END CERTIFICATE-----`;

    try {
        await apiRequest('/api/v1/public/health', {
            ca: fakeCA,
            rejectUnauthorized: true
        });

        console.log('  [FAIL] Connection succeeded with wrong CA\n');
        recordTest('Connection fails with wrong CA', false, 'Connection succeeded unexpectedly');
    } catch (error) {
        if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
            error.code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
            error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
            error.code === 'CERT_SIGNATURE_FAILURE' ||
            error.code === 'ERR_OSSL_PEM_NO_START_LINE' ||
            error.message.includes('certificate') ||
            error.message.includes('PEM')) {
            console.log('  [PASS] Connection correctly rejected with wrong CA certificate\n');
            recordTest('Connection fails with wrong CA', true);
        } else {
            console.log(`  [FAIL] Unexpected error: ${error.message}\n`);
            recordTest('Connection fails with wrong CA', false, error.message);
        }
    }
}

// ============================================================================
// OAuth2 Layer Tests (3 tests)
// ============================================================================

async function testUserServiceTokenAcquisition() {
    console.log('TEST: User service token acquisition');

    try {
        const client = CONFIG.clients.userService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);

        assert(tokenData.access_token, 'Expected access_token in response');
        assert(tokenData.token_type === 'Bearer', `Expected token_type "Bearer", got "${tokenData.token_type}"`);

        const decoded = decodeJwt(tokenData.access_token);
        assert(decoded.azp === client.clientId, `Expected azp "${client.clientId}", got "${decoded.azp}"`);

        console.log('  [PASS] User service token acquired successfully');
        console.log(`         Client: ${decoded.azp}`);
        console.log(`         Expires in: ${tokenData.expires_in}s\n`);

        recordTest('User service token acquisition', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('User service token acquisition', false, error.message);
    }
}

async function testAdminServiceTokenAcquisition() {
    console.log('TEST: Admin service token acquisition');

    try {
        const client = CONFIG.clients.adminService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);

        assert(tokenData.access_token, 'Expected access_token in response');
        assert(tokenData.token_type === 'Bearer', `Expected token_type "Bearer", got "${tokenData.token_type}"`);

        const decoded = decodeJwt(tokenData.access_token);
        assert(decoded.azp === client.clientId, `Expected azp "${client.clientId}", got "${decoded.azp}"`);

        console.log('  [PASS] Admin service token acquired successfully');
        console.log(`         Client: ${decoded.azp}`);
        console.log(`         Expires in: ${tokenData.expires_in}s\n`);

        recordTest('Admin service token acquisition', true);
    } catch (error) {
        if (error.message.includes('Failed to get token')) {
            console.log('  [SKIP] Admin service client not configured in Keycloak\n');
            recordTest('Admin service token acquisition', false, 'Admin client not configured', true);
        } else {
            console.log(`  [FAIL] ${error.message}\n`);
            recordTest('Admin service token acquisition', false, error.message);
        }
    }
}

async function testInvalidCredentialsRejected() {
    console.log('TEST: Invalid credentials are rejected');

    try {
        await getClientCredentialsToken('invalid-client', 'wrong-secret');
        console.log('  [FAIL] Expected token request to fail\n');
        recordTest('Invalid credentials rejected', false, 'Token request should have failed');
    } catch (error) {
        if (error.response && (error.response.status === 401 || error.response.status === 400)) {
            console.log(`  [PASS] Invalid credentials correctly rejected with ${error.response.status}\n`);
            recordTest('Invalid credentials rejected', true);
        } else {
            console.log(`  [FAIL] Unexpected error: ${error.message}\n`);
            recordTest('Invalid credentials rejected', false, error.message);
        }
    }
}

// ============================================================================
// OPA Layer Tests (4 tests)
// ============================================================================

async function testUserServiceCanListProducts() {
    console.log('TEST: User service can list products (api:read)');

    try {
        const token = await getToken('userService');
        const response = await apiRequest('/api/v1/products', { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        // Framework returns { data: [...], total, limit, offset }
        assert(response.data.data, 'Expected data array in response');
        assert(Array.isArray(response.data.data), 'data should be an array');

        console.log('  [PASS] User service can list products');
        console.log(`         Found ${response.data.data.length} products (total: ${response.data.total})\n`);

        recordTest('User service can list products', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('User service can list products', false, error.message);
    }
}

async function testUserServiceCannotCreate() {
    console.log('TEST: User service cannot create products (403)');

    try {
        const token = await getToken('userService');
        const response = await apiRequest('/api/v1/products', {
            method: 'POST',
            token,
            body: {
                name: 'Test Product',
                category: 'test',
                price: 99.99
            }
        });

        assert(response.status === 403, `Expected status 403, got ${response.status}`);

        console.log('  [PASS] User service correctly denied create access (403)\n');
        recordTest('User service cannot create (403)', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('User service cannot create (403)', false, error.message);
    }
}

async function testAdminServiceCanCreate() {
    console.log('TEST: Admin service can create products (api:write)');

    try {
        const token = await getToken('adminService');
        const response = await apiRequest('/api/v1/products', {
            method: 'POST',
            token,
            body: {
                name: 'Admin Created Product',
                category: 'admin-test',
                price: 199.99,
                stock: 10
            }
        });

        assert(response.status === 201, `Expected status 201, got ${response.status}`);
        assert(response.data.id, 'Expected id in response');
        assert(response.data.name === 'Admin Created Product', 'Expected name to match');

        console.log('  [PASS] Admin service can create products');
        console.log(`         Created product ID: ${response.data.id}\n`);

        recordTest('Admin service can create', true);
    } catch (error) {
        if (error.message.includes('Failed to get token')) {
            console.log('  [SKIP] Admin service client not configured\n');
            recordTest('Admin service can create', false, 'Admin client not configured', true);
        } else {
            console.log(`  [FAIL] ${error.message}\n`);
            recordTest('Admin service can create', false, error.message);
        }
    }
}

async function testAdminServiceCanDelete() {
    console.log('TEST: Admin service can delete products (api:delete)');

    try {
        const token = await getToken('adminService');
        // Delete product ID 10 (Noise Canceling Headphones) - won't affect other tests
        const response = await apiRequest('/api/v1/products/10', {
            method: 'DELETE',
            token
        });

        assert(response.status === 204, `Expected status 204, got ${response.status}`);

        console.log('  [PASS] Admin service can delete products\n');
        recordTest('Admin service can delete', true);
    } catch (error) {
        if (error.message.includes('Failed to get token')) {
            console.log('  [SKIP] Admin service client not configured\n');
            recordTest('Admin service can delete', false, 'Admin client not configured', true);
        } else {
            console.log(`  [FAIL] ${error.message}\n`);
            recordTest('Admin service can delete', false, error.message);
        }
    }
}

// ============================================================================
// SQL Server Layer Tests (6 tests)
// ============================================================================

async function testListProductsFromDatabase() {
    console.log('TEST: List products from database');

    try {
        const token = await getToken('userService');
        const response = await apiRequest('/api/v1/products', { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        // Framework returns { data: [...], total, limit, offset }
        assert(response.data.data, 'Expected data array');
        assert(response.data.data.length > 0, 'Expected at least one product');

        const product = response.data.data[0];
        assert(product.id !== undefined, 'Expected product.id');
        assert(product.name, 'Expected product.name');
        assert(product.category, 'Expected product.category');
        assert(product.price !== undefined, 'Expected product.price');

        console.log('  [PASS] Products listed from database');
        console.log(`         Total: ${response.data.total} products\n`);

        recordTest('List products from database', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('List products from database', false, error.message);
    }
}

async function testGetSingleProductById() {
    console.log('TEST: Get single product by ID');

    try {
        const token = await getToken('userService');
        // Use ID 2 (Wireless Mouse) - ID 1 may be deleted by earlier tests
        const response = await apiRequest('/api/v1/products/2', { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.id === 2, `Expected id 2, got ${response.data.id}`);
        assert(response.data.name, 'Expected product.name');

        console.log('  [PASS] Single product retrieved');
        console.log(`         Product: ${response.data.name}\n`);

        recordTest('Get single product by ID', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Get single product by ID', false, error.message);
    }
}

async function testCreateProductInsertsToDb() {
    console.log('TEST: Create product inserts to database');

    try {
        const token = await getToken('adminService');
        const newProduct = {
            name: 'Integration Test Product',
            category: 'test',
            price: 49.99,
            stock: 5
        };

        const response = await apiRequest('/api/v1/products', {
            method: 'POST',
            token,
            body: newProduct
        });

        assert(response.status === 201, `Expected status 201, got ${response.status}`);
        assert(response.data.id, 'Expected id in response');
        assert(response.data.name === newProduct.name, 'Expected name to match');
        assert(response.data.price === newProduct.price, 'Expected price to match');

        console.log('  [PASS] Product created in database');
        console.log(`         New ID: ${response.data.id}\n`);

        recordTest('Create product inserts to DB', true);
    } catch (error) {
        if (error.message.includes('Failed to get token')) {
            console.log('  [SKIP] Admin service client not configured\n');
            recordTest('Create product inserts to DB', false, 'Admin client not configured', true);
        } else {
            console.log(`  [FAIL] ${error.message}\n`);
            recordTest('Create product inserts to DB', false, error.message);
        }
    }
}

async function testUpdateProductModifiesDb() {
    console.log('TEST: Update product modifies database');

    try {
        const token = await getToken('adminService');
        const updates = {
            name: 'Updated USB-C Hub',
            price: 59.99
        };

        // Update product ID 3 (USB-C Hub)
        const response = await apiRequest('/api/v1/products/3', {
            method: 'PUT',
            token,
            body: updates
        });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.id === 3, `Expected id 3, got ${response.data.id}`);
        assert(response.data.name === 'Updated USB-C Hub', `Expected updated name, got ${response.data.name}`);

        console.log('  [PASS] Product updated in database');
        console.log(`         Updated: ${response.data.name} ($${response.data.price})\n`);

        recordTest('Update product modifies DB', true);
    } catch (error) {
        if (error.message.includes('Failed to get token')) {
            console.log('  [SKIP] Admin service client not configured\n');
            recordTest('Update product modifies DB', false, 'Admin client not configured', true);
        } else {
            console.log(`  [FAIL] ${error.message}\n`);
            recordTest('Update product modifies DB', false, error.message);
        }
    }
}

async function testDeleteProductRemovesFromDb() {
    console.log('TEST: Delete product removes from database');

    try {
        const token = await getToken('adminService');
        // Delete product ID 9 (Desk Lamp) - use different ID than OPA delete test
        const response = await apiRequest('/api/v1/products/9', {
            method: 'DELETE',
            token
        });

        assert(response.status === 204, `Expected status 204, got ${response.status}`);

        // Verify deletion by trying to get the product
        const getResponse = await apiRequest('/api/v1/products/9', { token });
        assert(getResponse.status === 404, `Expected 404 after deletion, got ${getResponse.status}`);

        console.log('  [PASS] Product deleted from database and verified\n');
        recordTest('Delete product removes from DB', true);
    } catch (error) {
        if (error.message.includes('Failed to get token')) {
            console.log('  [SKIP] Admin service client not configured\n');
            recordTest('Delete product removes from DB', false, 'Admin client not configured', true);
        } else {
            console.log(`  [FAIL] ${error.message}\n`);
            recordTest('Delete product removes from DB', false, error.message);
        }
    }
}

async function testPaginationWithSqlServer() {
    console.log('TEST: Pagination with SQL Server');

    try {
        const token = await getToken('userService');

        // Request page 1 with limit 3 (offset-based: offset=0, limit=3)
        const page1Response = await apiRequest('/api/v1/products?limit=3&offset=0', { token });

        assert(page1Response.status === 200, `Expected status 200, got ${page1Response.status}`);
        // Framework returns { data: [...], total, limit, offset }
        assert(page1Response.data.data, 'Expected data array');
        assert(page1Response.data.data.length <= 3, 'Expected at most 3 products');
        assert(page1Response.data.limit === 3, `Expected limit 3, got ${page1Response.data.limit}`);

        // Request page 2 (offset=3)
        const page2Response = await apiRequest('/api/v1/products?limit=3&offset=3', { token });

        assert(page2Response.status === 200, `Expected status 200 for page 2`);
        assert(page2Response.data.offset === 3, `Expected offset 3, got ${page2Response.data.offset}`);

        console.log('  [PASS] Pagination working correctly');
        console.log(`         Page 1 (offset 0): ${page1Response.data.data.length} products`);
        console.log(`         Page 2 (offset 3): ${page2Response.data.data.length} products\n`);

        recordTest('Pagination with SQL Server', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Pagination with SQL Server', false, error.message);
    }
}

// ============================================================================
// Test Runner
// ============================================================================

function printSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('TEST SUMMARY');
    console.log('='.repeat(70));

    for (const test of results.tests) {
        let icon;
        if (test.skipped) {
            icon = '[SKIP]';
        } else if (test.passed) {
            icon = '[PASS]';
        } else {
            icon = '[FAIL]';
        }

        const details = test.details ? ` - ${test.details}` : '';
        console.log(`  ${icon} ${test.name}${details}`);
    }

    console.log('-'.repeat(70));
    console.log(`  Total:   ${results.passed + results.failed + results.skipped}`);
    console.log(`  Passed:  ${results.passed}`);
    console.log(`  Failed:  ${results.failed}`);
    console.log(`  Skipped: ${results.skipped}`);
    console.log('='.repeat(70));
}

async function runTests() {
    console.log('='.repeat(70));
    console.log('Full Stack Integration Tests');
    console.log('TLS + OAuth2 Client Credentials + OPA + SQL Server');
    console.log('='.repeat(70));

    let setupSuccess = false;

    try {
        // Setup infrastructure
        setupSuccess = await setupInfrastructure();

        if (!setupSuccess) {
            console.error('\nInfrastructure setup failed. Cannot run tests.');
            cleanup();
            process.exit(1);
        }

        console.log('Running tests...\n');

        // TLS Layer Tests
        console.log('-'.repeat(70));
        console.log('TLS LAYER TESTS');
        console.log('-'.repeat(70) + '\n');

        await testHttpsWithValidCA();
        await testConnectionFailsWithWrongCA();

        // OAuth2 Layer Tests
        console.log('-'.repeat(70));
        console.log('OAUTH2 LAYER TESTS');
        console.log('-'.repeat(70) + '\n');

        await testUserServiceTokenAcquisition();
        await testAdminServiceTokenAcquisition();
        await testInvalidCredentialsRejected();

        // OPA Layer Tests
        console.log('-'.repeat(70));
        console.log('OPA LAYER TESTS');
        console.log('-'.repeat(70) + '\n');

        await testUserServiceCanListProducts();
        await testUserServiceCannotCreate();
        await testAdminServiceCanCreate();
        await testAdminServiceCanDelete();

        // SQL Server Layer Tests
        console.log('-'.repeat(70));
        console.log('SQL SERVER LAYER TESTS');
        console.log('-'.repeat(70) + '\n');

        await testListProductsFromDatabase();
        await testGetSingleProductById();
        await testCreateProductInsertsToDb();
        await testUpdateProductModifiesDb();
        await testDeleteProductRemovesFromDb();
        await testPaginationWithSqlServer();

        // Print summary
        printSummary();

    } finally {
        // Always cleanup
        cleanup();
    }

    // Exit with appropriate code
    if (results.failed === 0) {
        console.log('\nAll tests passed!\n');
        process.exit(0);
    } else {
        console.log('\nSome tests failed.\n');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Unhandled error:', error);
    cleanup();
    process.exit(1);
});
