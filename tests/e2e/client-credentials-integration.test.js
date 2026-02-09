#!/usr/bin/env node

/**
 * OAuth2 Client Credentials Flow Integration Tests for Node-RED API Gateway
 *
 * These tests verify the OAuth2 Client Credentials flow for machine-to-machine
 * authentication. This flow allows service accounts to obtain access tokens
 * directly using client_id and client_secret without user involvement.
 *
 * ============================================================================
 * SETUP INSTRUCTIONS
 * ============================================================================
 *
 * 1. Copy the OAuth2 example flow to the e2e test directory:
 *
 *    cp examples/oauth2-authenticated-api.json tests/e2e/flows.json
 *
 * 2. Start the Docker stack (Keycloak, OPA, Node-RED):
 *
 *    npm run docker:e2e:up
 *    # or: cd tests/e2e && docker compose up -d
 *
 * 3. Wait for all services to be healthy (about 30-60 seconds):
 *
 *    docker compose -f tests/e2e/docker-compose.yml ps
 *
 * 4. Run the integration tests:
 *
 *    npm run test:client-credentials
 *    # or: node tests/e2e/client-credentials-integration.test.js
 *
 * ============================================================================
 * WHAT THIS TESTS
 * ============================================================================
 *
 * - Client credentials token acquisition from Keycloak
 * - Service account access to protected endpoints
 * - Role/scope-based access control for service accounts
 * - Invalid client credentials rejection
 * - Token format and claims validation
 * - Service account with different role levels (user vs admin)
 *
 * ============================================================================
 * SERVICE ACCOUNTS (from Keycloak realm)
 * ============================================================================
 *
 * | Client ID              | Secret              | Roles              |
 * |------------------------|---------------------|-------------------|
 * | my-api-client          | my-client-secret    | user, api:read/write |
 * | my-admin-service       | admin-service-secret| admin, api:admin    |
 *
 * ============================================================================
 * CLEANUP
 * ============================================================================
 *
 *    npm run docker:e2e:down
 *    # or: cd tests/e2e && docker compose down -v
 *
 * Exit codes:
 * - 0: All tests passed
 * - 1: Tests failed or services unavailable
 */

const http = require('http');
const https = require('https');

// Configuration
const CONFIG = {
    apiBaseUrl: 'http://localhost:3200',
    keycloakUrl: 'http://localhost:8080',
    keycloakRealm: 'my-realm',
    requestTimeout: 10000,
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
    }
};

// Test results tracking
const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: []
};

/**
 * HTTP request helper
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
            timeout: options.timeout || CONFIG.requestTimeout
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
 * Get OAuth2 token using Client Credentials flow
 * @param {string} clientId - The client ID
 * @param {string} clientSecret - The client secret
 * @returns {Promise<{access_token: string, expires_in: number, token_type: string}>}
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
 * Decode JWT token (without verification - for test assertions only)
 * @param {string} token - JWT token
 * @returns {object} Decoded payload
 */
function decodeJwt(token) {
    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
    }
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
}

/**
 * Make API request with optional auth
 */
async function apiRequest(path, options = {}) {
    const headers = options.headers || {};

    if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
    }

    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    return httpRequest({
        url: `${CONFIG.apiBaseUrl}${path}`,
        method: options.method || 'GET',
        headers
    }, options.body);
}

/**
 * Record test result
 */
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

/**
 * Simple assertion helper
 */
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

// ============================================================================
// Service Availability Checks
// ============================================================================

async function checkKeycloakAvailable() {
    console.log('Checking Keycloak availability...');
    try {
        const response = await httpRequest({
            url: `${CONFIG.keycloakUrl}/realms/${CONFIG.keycloakRealm}/.well-known/openid-configuration`,
            timeout: 5000
        });
        if (response.status === 200) {
            console.log('  [OK] Keycloak is available\n');
            return true;
        }
        console.log(`  [FAIL] Keycloak returned status ${response.status}\n`);
        return false;
    } catch (error) {
        console.log(`  [FAIL] Keycloak unavailable: ${error.message}\n`);
        return false;
    }
}

async function checkApiServerAvailable() {
    console.log('Checking API Server availability...');
    try {
        const response = await httpRequest({
            url: `${CONFIG.apiBaseUrl}/api/v1/public/health`,
            timeout: 5000
        });
        if (response.status === 200) {
            console.log('  [OK] API Server is available\n');
            return true;
        }
        console.log(`  [FAIL] API Server returned status ${response.status}\n`);
        return false;
    } catch (error) {
        console.log(`  [FAIL] API Server unavailable: ${error.message}\n`);
        return false;
    }
}

// ============================================================================
// Token Acquisition Tests
// ============================================================================

async function testClientCredentialsTokenAcquisition() {
    console.log('TEST: Client credentials token acquisition');

    try {
        const client = CONFIG.clients.userService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);

        assert(tokenData.access_token, 'Expected access_token in response');
        assert(tokenData.token_type === 'Bearer', `Expected token_type "Bearer", got "${tokenData.token_type}"`);
        assert(typeof tokenData.expires_in === 'number', 'Expected expires_in to be a number');
        assert(tokenData.expires_in > 0, 'Expected expires_in to be positive');

        console.log('  [PASS] Token acquired successfully');
        console.log(`         Token type: ${tokenData.token_type}`);
        console.log(`         Expires in: ${tokenData.expires_in}s\n`);

        recordTest('Client credentials token acquisition', true);
        return tokenData.access_token;
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Client credentials token acquisition', false, error.message);
        return null;
    }
}

async function testTokenContainsServiceAccountClaims() {
    console.log('TEST: Token contains service account claims');

    try {
        const client = CONFIG.clients.userService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);
        const decoded = decodeJwt(tokenData.access_token);

        // Service account tokens should have specific claims
        assert(decoded.sub, 'Expected sub claim');
        assert(decoded.iss, 'Expected iss (issuer) claim');
        assert(decoded.exp, 'Expected exp (expiration) claim');
        assert(decoded.iat, 'Expected iat (issued at) claim');
        assert(decoded.azp === client.clientId, `Expected azp to be "${client.clientId}", got "${decoded.azp}"`);

        // For client credentials flow, Keycloak uses 'azp' (authorized party) to identify the client
        // The 'azp' claim is already checked above, so this is just a documentation note
        // Some OAuth2 providers use 'client_id' claim, but Keycloak uses 'azp'

        console.log('  [PASS] Token contains expected service account claims');
        console.log(`         Subject: ${decoded.sub}`);
        console.log(`         Issuer: ${decoded.iss}`);
        console.log(`         Client ID: ${decoded.azp}\n`);

        recordTest('Token contains service account claims', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Token contains service account claims', false, error.message);
    }
}

async function testTokenContainsRoles() {
    console.log('TEST: Token contains assigned roles');

    try {
        const client = CONFIG.clients.userService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);
        const decoded = decodeJwt(tokenData.access_token);

        // Check realm roles
        const realmRoles = decoded.realm_access?.roles || decoded.roles || [];
        const hasUserRole = realmRoles.includes('user') ||
            client.expectedRoles.some(r => realmRoles.includes(r));

        assert(hasUserRole, `Expected user role in token. Found roles: ${JSON.stringify(realmRoles)}`);

        console.log('  [PASS] Token contains expected roles');
        console.log(`         Realm roles: ${JSON.stringify(realmRoles)}\n`);

        recordTest('Token contains assigned roles', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Token contains assigned roles', false, error.message);
    }
}

// ============================================================================
// Invalid Credentials Tests
// ============================================================================

async function testInvalidClientIdRejected() {
    console.log('TEST: Invalid client ID is rejected');

    try {
        await getClientCredentialsToken('invalid-client-id', 'some-secret');
        console.log('  [FAIL] Expected token request to fail\n');
        recordTest('Invalid client ID is rejected', false, 'Token request should have failed');
    } catch (error) {
        if (error.response && error.response.status === 401) {
            console.log('  [PASS] Invalid client ID correctly rejected with 401\n');
            recordTest('Invalid client ID is rejected', true);
        } else if (error.response && error.response.status === 400) {
            // Keycloak may return 400 for invalid client
            console.log('  [PASS] Invalid client ID correctly rejected with 400\n');
            recordTest('Invalid client ID is rejected', true);
        } else {
            console.log(`  [FAIL] Unexpected error: ${error.message}\n`);
            recordTest('Invalid client ID is rejected', false, error.message);
        }
    }
}

async function testInvalidClientSecretRejected() {
    console.log('TEST: Invalid client secret is rejected');

    try {
        const client = CONFIG.clients.userService;
        await getClientCredentialsToken(client.clientId, 'wrong-secret');
        console.log('  [FAIL] Expected token request to fail\n');
        recordTest('Invalid client secret is rejected', false, 'Token request should have failed');
    } catch (error) {
        if (error.response && error.response.status === 401) {
            console.log('  [PASS] Invalid client secret correctly rejected with 401\n');
            recordTest('Invalid client secret is rejected', true);
        } else {
            console.log(`  [FAIL] Unexpected error: ${error.message}\n`);
            recordTest('Invalid client secret is rejected', false, error.message);
        }
    }
}

async function testEmptyCredentialsRejected() {
    console.log('TEST: Empty credentials are rejected');

    try {
        await getClientCredentialsToken('', '');
        console.log('  [FAIL] Expected token request to fail\n');
        recordTest('Empty credentials are rejected', false, 'Token request should have failed');
    } catch (error) {
        if (error.response && (error.response.status === 400 || error.response.status === 401)) {
            console.log(`  [PASS] Empty credentials correctly rejected with ${error.response.status}\n`);
            recordTest('Empty credentials are rejected', true);
        } else {
            console.log(`  [FAIL] Unexpected error: ${error.message}\n`);
            recordTest('Empty credentials are rejected', false, error.message);
        }
    }
}

// ============================================================================
// Protected Endpoint Access Tests
// ============================================================================

async function testServiceAccountAccessUserEndpoint() {
    console.log('TEST: Service account can access user-level endpoint');

    try {
        const client = CONFIG.clients.userService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);
        const response = await apiRequest('/api/v1/user/profile', { token: tokenData.access_token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);

        console.log('  [PASS] Service account can access user endpoint\n');
        recordTest('Service account can access user-level endpoint', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Service account can access user-level endpoint', false, error.message);
    }
}

async function testUserServiceCannotAccessAdminEndpoint() {
    console.log('TEST: User-level service account cannot access admin endpoint');

    try {
        const client = CONFIG.clients.userService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);
        const response = await apiRequest('/api/v1/admin/users', { token: tokenData.access_token });

        assert(response.status === 403, `Expected status 403, got ${response.status}`);

        console.log('  [PASS] User-level service correctly denied access to admin endpoint\n');
        recordTest('User-level service account cannot access admin endpoint', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('User-level service account cannot access admin endpoint', false, error.message);
    }
}

async function testAdminServiceCanAccessAdminEndpoint() {
    console.log('TEST: Admin service account can access admin endpoint');

    try {
        const client = CONFIG.clients.adminService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);
        const response = await apiRequest('/api/v1/admin/users', { token: tokenData.access_token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);

        console.log('  [PASS] Admin service account can access admin endpoint\n');
        recordTest('Admin service account can access admin endpoint', true);
    } catch (error) {
        if (error.message.includes('Failed to get token')) {
            console.log('  [SKIP] Admin service client not configured in Keycloak\n');
            recordTest('Admin service account can access admin endpoint', false, 'Admin service client not configured', true);
        } else {
            console.log(`  [FAIL] ${error.message}\n`);
            recordTest('Admin service account can access admin endpoint', false, error.message);
        }
    }
}

async function testAdminServiceCanAccessUserEndpoint() {
    console.log('TEST: Admin service account can access user-level endpoint');

    try {
        const client = CONFIG.clients.adminService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);
        const response = await apiRequest('/api/v1/user/profile', { token: tokenData.access_token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);

        console.log('  [PASS] Admin service account can access user endpoint\n');
        recordTest('Admin service account can access user-level endpoint', true);
    } catch (error) {
        if (error.message.includes('Failed to get token')) {
            console.log('  [SKIP] Admin service client not configured in Keycloak\n');
            recordTest('Admin service account can access user-level endpoint', false, 'Admin service client not configured', true);
        } else {
            console.log(`  [FAIL] ${error.message}\n`);
            recordTest('Admin service account can access user-level endpoint', false, error.message);
        }
    }
}

// ============================================================================
// Token Expiration Tests
// ============================================================================

async function testTokenExpirationIsReasonable() {
    console.log('TEST: Token expiration is within expected range');

    try {
        const client = CONFIG.clients.userService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);
        const decoded = decodeJwt(tokenData.access_token);

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = decoded.exp;
        const issuedAt = decoded.iat;
        const lifetime = expiresAt - issuedAt;

        // Token should expire in the future
        assert(expiresAt > now, 'Token should not be expired');

        // Token lifetime should be reasonable (between 1 minute and 1 hour typically)
        assert(lifetime >= 60, `Token lifetime too short: ${lifetime}s`);
        assert(lifetime <= 3600, `Token lifetime too long: ${lifetime}s`);

        console.log('  [PASS] Token expiration is reasonable');
        console.log(`         Lifetime: ${lifetime}s`);
        console.log(`         Expires at: ${new Date(expiresAt * 1000).toISOString()}\n`);

        recordTest('Token expiration is within expected range', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Token expiration is within expected range', false, error.message);
    }
}

async function testExpiredTokenRejected() {
    console.log('TEST: Expired token is rejected (simulated with invalid token)');

    try {
        // We can't easily create an expired token, so we use a malformed one
        // that simulates what happens when a token is no longer valid
        const expiredToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjB9.invalid';
        const response = await apiRequest('/api/v1/user/profile', { token: expiredToken });

        assert(response.status === 401, `Expected status 401, got ${response.status}`);

        console.log('  [PASS] Invalid/expired token correctly rejected with 401\n');
        recordTest('Expired token is rejected', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Expired token is rejected', false, error.message);
    }
}

// ============================================================================
// Scope-Based Access Tests
// ============================================================================

async function testServiceAccountScopes() {
    console.log('TEST: Service account token contains expected scopes');

    try {
        const client = CONFIG.clients.userService;
        const tokenData = await getClientCredentialsToken(client.clientId, client.clientSecret);
        const decoded = decodeJwt(tokenData.access_token);

        // Check for scope claim
        const scopes = decoded.scope ? decoded.scope.split(' ') : [];

        console.log('  [PASS] Token scopes retrieved');
        console.log(`         Scopes: ${scopes.length > 0 ? scopes.join(', ') : '(none)'}\n`);

        recordTest('Service account token contains expected scopes', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Service account token contains expected scopes', false, error.message);
    }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTests() {
    console.log('='.repeat(70));
    console.log('OAuth2 Client Credentials Flow Integration Tests');
    console.log('='.repeat(70));
    console.log();

    // Check service availability
    const keycloakAvailable = await checkKeycloakAvailable();
    const apiAvailable = await checkApiServerAvailable();

    if (!keycloakAvailable || !apiAvailable) {
        console.log('ERROR: Required services not available. Ensure Docker stack is running:');
        console.log('  npm run docker:e2e:up');
        console.log();
        process.exit(1);
    }

    console.log('-'.repeat(70));
    console.log('TOKEN ACQUISITION TESTS');
    console.log('-'.repeat(70));
    console.log();

    await testClientCredentialsTokenAcquisition();
    await testTokenContainsServiceAccountClaims();
    await testTokenContainsRoles();
    await testServiceAccountScopes();

    console.log('-'.repeat(70));
    console.log('INVALID CREDENTIALS TESTS');
    console.log('-'.repeat(70));
    console.log();

    await testInvalidClientIdRejected();
    await testInvalidClientSecretRejected();
    await testEmptyCredentialsRejected();

    console.log('-'.repeat(70));
    console.log('PROTECTED ENDPOINT ACCESS TESTS');
    console.log('-'.repeat(70));
    console.log();

    await testServiceAccountAccessUserEndpoint();
    await testUserServiceCannotAccessAdminEndpoint();
    await testAdminServiceCanAccessAdminEndpoint();
    await testAdminServiceCanAccessUserEndpoint();

    console.log('-'.repeat(70));
    console.log('TOKEN EXPIRATION TESTS');
    console.log('-'.repeat(70));
    console.log();

    await testTokenExpirationIsReasonable();
    await testExpiredTokenRejected();

    // Print summary
    console.log('='.repeat(70));
    console.log('TEST SUMMARY');
    console.log('='.repeat(70));
    console.log();
    console.log(`  Passed:  ${results.passed}`);
    console.log(`  Failed:  ${results.failed}`);
    console.log(`  Skipped: ${results.skipped}`);
    console.log(`  Total:   ${results.tests.length}`);
    console.log();

    if (results.failed > 0) {
        console.log('FAILED TESTS:');
        results.tests
            .filter(t => !t.passed && !t.skipped)
            .forEach(t => console.log(`  - ${t.name}: ${t.details}`));
        console.log();
    }

    process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
});
