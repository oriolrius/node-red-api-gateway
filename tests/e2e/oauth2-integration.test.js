#!/usr/bin/env node

/**
 * OAuth2 Integration Tests for Node-RED API Gateway
 *
 * These tests verify the OAuth2/Keycloak authentication flow
 * for the API endpoints defined in flows.json.
 *
 * REQUIREMENTS:
 * - Docker stack must be running: docker compose --profile nodered up -d
 * - Keycloak realm 'my-realm' must be configured
 * - Node-RED must have loaded the flows.json
 *
 * Run separately from unit tests:
 *   npm run test:integration
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
    clientId: 'my-api-client',
    clientSecret: 'my-client-secret',
    requestTimeout: 10000,
    users: {
        testuser: { password: 'testpassword', roles: ['user'] },
        editor: { password: 'editorpassword', roles: ['user', 'user:write'] },
        admin: { password: 'adminpassword', roles: ['admin'] }
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
 * Get OAuth2 token from Keycloak
 */
async function getToken(username, password) {
    const tokenUrl = `${CONFIG.keycloakUrl}/realms/${CONFIG.keycloakRealm}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
        client_id: CONFIG.clientId,
        client_secret: CONFIG.clientSecret,
        grant_type: 'password',
        username: username,
        password: password
    }).toString();

    const response = await httpRequest({
        url: tokenUrl,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }, body);

    if (response.status !== 200) {
        throw new Error(`Failed to get token: HTTP ${response.status} - ${response.raw}`);
    }

    return response.data.access_token;
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
 * Assert helper
 */
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

// ============================================================================
// Service Health Checks
// ============================================================================

async function checkServicesReady() {
    console.log('Checking services availability...\n');

    // Check Keycloak
    try {
        const response = await httpRequest({
            url: `${CONFIG.keycloakUrl}/realms/${CONFIG.keycloakRealm}/.well-known/openid-configuration`,
            timeout: 5000
        });
        if (response.status !== 200) {
            throw new Error(`Keycloak returned HTTP ${response.status}`);
        }
        console.log('  [OK] Keycloak is ready');
    } catch (error) {
        console.error('  [FAIL] Keycloak is not available:', error.message);
        console.error('\n  Make sure the docker stack is running:');
        console.error('    cd tests/e2e && docker compose --profile nodered up -d\n');
        process.exit(1);
    }

    // Check API Server
    try {
        const response = await httpRequest({
            url: `${CONFIG.apiBaseUrl}/api/v1/public/health`,
            timeout: 5000
        });
        if (response.status !== 200) {
            throw new Error(`API server returned HTTP ${response.status}`);
        }
        console.log('  [OK] API Server is ready');
    } catch (error) {
        console.error('  [FAIL] API Server is not available:', error.message);
        console.error('\n  Make sure the docker stack is running:');
        console.error('    cd tests/e2e && docker compose --profile nodered up -d\n');
        process.exit(1);
    }

    console.log('\nAll services are ready.\n');
}

// ============================================================================
// Test Cases
// ============================================================================

/**
 * Test: Public endpoint accessible without authentication
 */
async function testPublicEndpoint() {
    console.log('TEST: Public endpoint accessible without authentication');

    try {
        const response = await apiRequest('/api/v1/public/health');

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.status === 'healthy', `Expected status 'healthy', got '${response.data.status}'`);
        assert(response.data.timestamp, 'Expected timestamp in response');
        assert(response.data.version, 'Expected version in response');

        console.log('  [PASS] Public health endpoint returns correct response\n');
        recordTest('Public endpoint without auth', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Public endpoint without auth', false, error.message);
    }
}

/**
 * Test: Protected endpoint returns 401 without token
 */
async function testProtectedEndpointNoAuth() {
    console.log('TEST: Protected endpoint returns 401 without authentication');

    try {
        const response = await apiRequest('/api/v1/user/profile');

        assert(response.status === 401, `Expected status 401, got ${response.status}`);

        console.log('  [PASS] Returns 401 Unauthorized without token\n');
        recordTest('Protected endpoint without auth returns 401', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Protected endpoint without auth returns 401', false, error.message);
    }
}

/**
 * Test: Protected endpoint returns 401 with invalid token
 */
async function testProtectedEndpointInvalidToken() {
    console.log('TEST: Protected endpoint returns 401 with invalid token');

    try {
        const response = await apiRequest('/api/v1/user/profile', {
            token: 'invalid.jwt.token'
        });

        assert(response.status === 401, `Expected status 401, got ${response.status}`);

        console.log('  [PASS] Returns 401 Unauthorized with invalid token\n');
        recordTest('Protected endpoint with invalid token returns 401', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Protected endpoint with invalid token returns 401', false, error.message);
    }
}

/**
 * Test: User can access user-level endpoint with valid token
 */
async function testUserEndpointWithValidToken() {
    console.log('TEST: User can access user-level endpoint with valid token');

    try {
        const token = await getToken('testuser', CONFIG.users.testuser.password);
        const response = await apiRequest('/api/v1/user/profile', { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        // Check for user identity (sub, username) OR roles/scopes which indicate authenticated user
        const hasUserInfo = response.data.username || response.data.preferredUsername ||
            response.data.sub || (Array.isArray(response.data.roles) && response.data.roles.length > 0);
        assert(hasUserInfo, 'Expected user info (username, sub, or roles) in response');

        console.log('  [PASS] User endpoint accessible with valid user token\n');
        recordTest('User endpoint with valid token', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('User endpoint with valid token', false, error.message);
    }
}

/**
 * Test: Regular user cannot access admin endpoint (returns 403)
 */
async function testUserCannotAccessAdminEndpoint() {
    console.log('TEST: Regular user cannot access admin endpoint');

    try {
        const token = await getToken('testuser', CONFIG.users.testuser.password);
        const response = await apiRequest('/api/v1/admin/users', { token });

        assert(response.status === 403, `Expected status 403, got ${response.status}`);

        console.log('  [PASS] Admin endpoint returns 403 Forbidden for regular user\n');
        recordTest('Regular user cannot access admin endpoint', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Regular user cannot access admin endpoint', false, error.message);
    }
}

/**
 * Test: Admin user can access admin endpoint
 */
async function testAdminCanAccessAdminEndpoint() {
    console.log('TEST: Admin user can access admin endpoint');

    try {
        const token = await getToken('admin', CONFIG.users.admin.password);
        const response = await apiRequest('/api/v1/admin/users', { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(Array.isArray(response.data.users), 'Expected users array in response');
        assert(typeof response.data.total === 'number', 'Expected total count in response');

        console.log('  [PASS] Admin endpoint accessible with admin token\n');
        recordTest('Admin can access admin endpoint', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Admin can access admin endpoint', false, error.message);
    }
}

/**
 * Test: Admin user can access user endpoint (admin has user role)
 */
async function testAdminCanAccessUserEndpoint() {
    console.log('TEST: Admin user can access user endpoint');

    try {
        const token = await getToken('admin', CONFIG.users.admin.password);
        const response = await apiRequest('/api/v1/user/profile', { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);

        console.log('  [PASS] Admin can also access user endpoint\n');
        recordTest('Admin can access user endpoint', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Admin can access user endpoint', false, error.message);
    }
}

/**
 * Test: Admin create user endpoint requires both admin AND user:write scopes
 */
async function testCreateUserRequiresBothScopes() {
    console.log('TEST: Create user requires admin AND user:write scopes');

    try {
        // Test with admin token (should have admin + user:write via composite role)
        const adminToken = await getToken('admin', CONFIG.users.admin.password);
        const response = await apiRequest('/api/v1/admin/users', {
            method: 'POST',
            token: adminToken,
            body: {
                username: 'newuser',
                email: 'newuser@example.com',
                password: 'password123'
            }
        });

        assert(response.status === 201, `Expected status 201, got ${response.status}`);
        assert(response.data.id, 'Expected id in response');
        assert(response.data.username === 'newuser', `Expected username 'newuser', got '${response.data.username}'`);

        console.log('  [PASS] Admin can create users (has admin + user:write)\n');
        recordTest('Create user with admin+user:write scopes', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Create user with admin+user:write scopes', false, error.message);
    }
}

/**
 * Test: Editor with user:write cannot create users (missing admin role)
 */
async function testEditorCannotCreateUsers() {
    console.log('TEST: Editor with user:write cannot create users (missing admin role)');

    try {
        const editorToken = await getToken('editor', CONFIG.users.editor.password);
        const response = await apiRequest('/api/v1/admin/users', {
            method: 'POST',
            token: editorToken,
            body: {
                username: 'testcreate',
                email: 'testcreate@example.com',
                password: 'password123'
            }
        });

        // Editor has user:write but not admin, should get 403
        assert(response.status === 403, `Expected status 403, got ${response.status}`);

        console.log('  [PASS] Editor cannot create users (missing admin scope)\n');
        recordTest('Editor cannot create users (missing admin)', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Editor cannot create users (missing admin)', false, error.message);
    }
}

/**
 * Test: Query parameter validation on admin list users
 */
async function testQueryParameterValidation() {
    console.log('TEST: Query parameter validation on admin list users');

    try {
        const adminToken = await getToken('admin', CONFIG.users.admin.password);

        // Test with valid pagination parameters
        const response = await apiRequest('/api/v1/admin/users?page=1&limit=10', {
            token: adminToken
        });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.page === 1, `Expected page 1, got ${response.data.page}`);
        assert(response.data.limit === 10, `Expected limit 10, got ${response.data.limit}`);

        console.log('  [PASS] Query parameters work correctly\n');
        recordTest('Query parameter validation', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Query parameter validation', false, error.message);
    }
}

/**
 * Test: Request body validation on create user
 */
async function testRequestBodyValidation() {
    console.log('TEST: Request body validation on create user');

    try {
        const adminToken = await getToken('admin', CONFIG.users.admin.password);

        // Test with missing required fields
        const response = await apiRequest('/api/v1/admin/users', {
            method: 'POST',
            token: adminToken,
            body: {
                username: 'test'
                // Missing email and password
            }
        });

        assert(response.status === 400, `Expected status 400, got ${response.status}`);

        console.log('  [PASS] Invalid request body returns 400\n');
        recordTest('Request body validation', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Request body validation', false, error.message);
    }
}

/**
 * Test: OpenAPI documentation endpoint
 */
async function testOpenAPIEndpoint() {
    console.log('TEST: OpenAPI documentation endpoint');

    try {
        const response = await httpRequest({
            url: `${CONFIG.apiBaseUrl}/openapi.json`
        });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.openapi, 'Expected openapi version in response');
        assert(response.data.info, 'Expected info object in response');
        assert(response.data.paths, 'Expected paths object in response');

        console.log('  [PASS] OpenAPI spec is accessible\n');
        recordTest('OpenAPI endpoint', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('OpenAPI endpoint', false, error.message);
    }
}

/**
 * Test: Swagger UI endpoint
 */
async function testSwaggerUIEndpoint() {
    console.log('TEST: Swagger UI endpoint');

    try {
        const response = await httpRequest({
            url: `${CONFIG.apiBaseUrl}/docs`
        });

        // Swagger UI may return 200 or redirect
        assert(response.status === 200 || response.status === 301 || response.status === 302,
            `Expected status 200/301/302, got ${response.status}`);

        console.log('  [PASS] Swagger UI is accessible\n');
        recordTest('Swagger UI endpoint', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Swagger UI endpoint', false, error.message);
    }
}

// ============================================================================
// Test Runner
// ============================================================================

function printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));

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

    console.log('-'.repeat(60));
    console.log(`  Total:   ${results.passed + results.failed + results.skipped}`);
    console.log(`  Passed:  ${results.passed}`);
    console.log(`  Failed:  ${results.failed}`);
    console.log(`  Skipped: ${results.skipped}`);
    console.log('='.repeat(60));
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('OAuth2 Integration Tests for Node-RED API Gateway');
    console.log('='.repeat(60) + '\n');

    // Check services are ready
    await checkServicesReady();

    console.log('Running tests...\n');
    console.log('-'.repeat(60) + '\n');

    // Public endpoint tests
    await testPublicEndpoint();

    // Authentication tests
    await testProtectedEndpointNoAuth();
    await testProtectedEndpointInvalidToken();

    // Authorization tests - user role
    await testUserEndpointWithValidToken();
    await testUserCannotAccessAdminEndpoint();

    // Authorization tests - admin role
    await testAdminCanAccessAdminEndpoint();
    await testAdminCanAccessUserEndpoint();

    // Composite scope tests (admin AND user:write)
    await testCreateUserRequiresBothScopes();
    await testEditorCannotCreateUsers();

    // Validation tests
    await testQueryParameterValidation();
    await testRequestBodyValidation();

    // Documentation tests
    await testOpenAPIEndpoint();
    await testSwaggerUIEndpoint();

    // Print summary
    printSummary();

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
    process.exit(1);
});
