#!/usr/bin/env node

/**
 * OPA (Open Policy Agent) Integration Tests for Node-RED API Gateway
 *
 * These tests verify the policy-based access control using OPA
 * for the API endpoints defined in the opa-protected-api example flow.
 *
 * ============================================================================
 * SETUP INSTRUCTIONS
 * ============================================================================
 *
 * Run the OPA integration tests (Docker stack starts automatically if needed):
 *
 *    npm run test:opa
 *
 * The test will automatically:
 * - Copy examples/opa-protected-api.json to tests/e2e/flows.json if needed
 * - Start the Docker stack (Keycloak, OPA, Node-RED)
 * - Run all tests
 * - Stop the Docker stack
 *
 * Environment variables:
 *    SKIP_DOCKER_SETUP=1    - Don't start Docker (use existing stack)
 *    SKIP_DOCKER_TEARDOWN=1 - Keep Docker running after tests
 *
 * ============================================================================
 * WHAT THIS TESTS
 * ============================================================================
 *
 * - Document listing with policy-based filtering
 * - Document access based on ownership
 * - Document access based on classification levels
 * - Admin role has full access
 * - Document creation with classification restrictions
 * - Document deletion (admin only)
 * - Policy decision information in responses
 *
 * ============================================================================
 * TEST USERS (from Keycloak realm)
 * ============================================================================
 *
 * | Username  | Password       | Roles              |
 * |-----------|----------------|--------------------|
 * | testuser  | testpassword   | user               |
 * | editor    | editorpassword | user, user:write   |
 * | admin     | adminpassword  | admin (composite)  |
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
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
    },
    // Docker configuration
    dockerComposeFile: path.join(__dirname, 'docker-compose.yml'),
    dockerComposeProfile: 'nodered',
    startupTimeout: 120000,  // 2 minutes max for services to start
    startupPollInterval: 3000,  // Check every 3 seconds
    skipDockerSetup: process.env.SKIP_DOCKER_SETUP === '1',
    skipDockerTeardown: process.env.SKIP_DOCKER_TEARDOWN === '1',
    // Flow configuration - OPA tests require the OPA example flow
    exampleFlowPath: path.join(__dirname, '..', '..', 'examples', 'opa-protected-api.json'),
    flowsPath: path.join(__dirname, 'flows.json'),
    nodeRedFlowsPath: path.join(__dirname, '.nodered', 'flows.json')
};

// Track if we started Docker (so we know whether to tear down)
let dockerStartedByUs = false;

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
// Docker Infrastructure
// ============================================================================

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
 * Copy OPA example flow to flows.json and .nodered/flows.json
 */
function setupFlows() {
    console.log('Setting up OPA test flows...\n');

    // Check if example exists
    if (!fs.existsSync(CONFIG.exampleFlowPath)) {
        console.error('  [FAIL] Example flow not found: examples/opa-protected-api.json\n');
        console.error('  The OPA example flow is required for these tests.');
        return false;
    }

    try {
        const exampleContent = fs.readFileSync(CONFIG.exampleFlowPath, 'utf8');
        const example = JSON.parse(exampleContent);

        // Check if flows.json needs updating
        let needsUpdate = true;
        if (fs.existsSync(CONFIG.flowsPath)) {
            const flowsContent = fs.readFileSync(CONFIG.flowsPath, 'utf8');
            const flows = JSON.parse(flowsContent);
            if (JSON.stringify(flows) === JSON.stringify(example)) {
                needsUpdate = false;
            }
        }

        if (needsUpdate) {
            fs.writeFileSync(CONFIG.flowsPath, exampleContent);
            console.log('  [OK] Copied opa-protected-api.json to flows.json');
        } else {
            console.log('  [OK] flows.json already matches OPA example');
        }

        // Always copy to .nodered/flows.json for Docker
        fs.writeFileSync(CONFIG.nodeRedFlowsPath, exampleContent);
        console.log('  [OK] Copied flows to .nodered/flows.json');

        // Show configuration details
        const apiConfigNode = example.find(n => n.type === 'apigw-config');
        if (apiConfigNode && apiConfigNode.opaEnabled) {
            console.log(`       OPA: ${apiConfigNode.opaUrl}${apiConfigNode.opaPolicyPath}`);
        }

        const endpoints = example.filter(n => n.type === 'apigw-endpoint');
        console.log(`  [OK] Found ${endpoints.length} API endpoint(s)`);
        console.log('');

        return true;
    } catch (error) {
        console.error(`  [FAIL] Error setting up flows: ${error.message}`);
        return false;
    }
}

/**
 * Start Docker stack
 */
function startDockerStack() {
    console.log('  Starting Docker stack...');

    try {
        execSync(
            `docker compose -f "${CONFIG.dockerComposeFile}" --profile ${CONFIG.dockerComposeProfile} up -d`,
            { stdio: 'inherit', cwd: __dirname }
        );
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
        execSync(
            `docker compose -f "${CONFIG.dockerComposeFile}" --profile ${CONFIG.dockerComposeProfile} down -v`,
            { stdio: 'inherit', cwd: __dirname }
        );
        console.log('  [OK] Docker stack stopped');
        return true;
    } catch (error) {
        console.error(`  [WARN] Failed to stop Docker stack: ${error.message}`);
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
                    url: 'http://localhost:8181/health',
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

        // Check API Server
        if (!apiServerReady) {
            try {
                // OPA flow uses /api/v1/documents endpoint
                const response = await httpRequest({
                    url: `${CONFIG.apiBaseUrl}/api/v1/documents`,
                    timeout: 3000
                });
                // Expect 401 without token - that's fine, API is responding
                if (response.status === 401 || response.status === 200) {
                    apiServerReady = true;
                    console.log('  [OK] API Server is ready');
                }
            } catch {
                // Not ready yet
            }
        }

        if (keycloakReady && opaReady && apiServerReady) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`  [OK] All services ready (took ${elapsed}s)\n`);
            return true;
        }

        // Progress indicator
        process.stdout.write('.');

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, CONFIG.startupPollInterval));
    }

    console.log('');
    console.error(`  [FAIL] Services did not become ready within ${CONFIG.startupTimeout / 1000}s`);
    console.error(`    Keycloak: ${keycloakReady ? 'ready' : 'not ready'}`);
    console.error(`    OPA: ${opaReady ? 'ready' : 'not ready'}`);
    console.error(`    API Server: ${apiServerReady ? 'ready' : 'not ready'}`);
    return false;
}

/**
 * Ensure Docker infrastructure is running
 */
async function ensureInfrastructure() {
    // Check if services are already running
    const keycloakAvailable = await isServiceAvailable(
        `${CONFIG.keycloakUrl}/realms/${CONFIG.keycloakRealm}/.well-known/openid-configuration`
    );
    const opaAvailable = await isServiceAvailable('http://localhost:8181/health');

    if (keycloakAvailable && opaAvailable) {
        console.log('  [OK] Services are already running\n');
        return true;
    }

    if (CONFIG.skipDockerSetup) {
        console.error('  [FAIL] Services not running and SKIP_DOCKER_SETUP=1\n');
        return false;
    }

    console.log('  Services not running, starting Docker stack...\n');

    if (!startDockerStack()) {
        return false;
    }

    dockerStartedByUs = true;

    return await waitForServices();
}

/**
 * Cleanup function for Docker teardown
 */
function cleanup() {
    if (dockerStartedByUs && !CONFIG.skipDockerTeardown) {
        stopDockerStack();
    } else if (dockerStartedByUs && CONFIG.skipDockerTeardown) {
        console.log('\nDocker teardown skipped (SKIP_DOCKER_TEARDOWN=1)');
        console.log('To stop the stack manually: npm run docker:e2e:down\n');
    }
}

// ============================================================================
// Pre-flight Checks
// ============================================================================

/**
 * Check services are ready (starts Docker if needed)
 */
async function checkServicesReady() {
    console.log('Checking services availability...\n');

    const ready = await ensureInfrastructure();

    if (!ready) {
        console.error('\n  Make sure Docker is installed and running.');
        console.error('  You can also start the stack manually:');
        console.error('    npm run docker:e2e:up');
        console.error('    # or: cd tests/e2e && docker compose --profile nodered up -d\n');
        process.exit(1);
    }

    console.log('All services are ready.\n');
}

// ============================================================================
// Test Cases
// ============================================================================

/**
 * Test: List documents returns policy-filtered results
 */
async function testListDocuments() {
    console.log('TEST: List documents returns policy-filtered results');

    try {
        const token = await getToken('testuser', CONFIG.users.testuser.password);
        const response = await apiRequest('/api/v1/documents', { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(Array.isArray(response.data.documents), 'Expected documents array');
        assert(response.data.filteredByPolicy === true, 'Expected filteredByPolicy flag');
        assert(response.data.userContext, 'Expected userContext in response');

        console.log(`  [PASS] User sees ${response.data.documents.length} of ${response.data.total} documents\n`);
        recordTest('List documents with policy filtering', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('List documents with policy filtering', false, error.message);
    }
}

/**
 * Test: Admin sees all documents
 */
async function testAdminSeesAllDocuments() {
    console.log('TEST: Admin sees all documents');

    try {
        const adminToken = await getToken('admin', CONFIG.users.admin.password);
        const userToken = await getToken('testuser', CONFIG.users.testuser.password);

        const adminResponse = await apiRequest('/api/v1/documents', { token: adminToken });
        const userResponse = await apiRequest('/api/v1/documents', { token: userToken });

        assert(adminResponse.status === 200, `Expected admin status 200, got ${adminResponse.status}`);
        assert(userResponse.status === 200, `Expected user status 200, got ${userResponse.status}`);
        assert(adminResponse.data.documents.length >= userResponse.data.documents.length,
            'Admin should see at least as many documents as regular user');

        console.log(`  [PASS] Admin sees ${adminResponse.data.documents.length} docs, user sees ${userResponse.data.documents.length}\n`);
        recordTest('Admin sees all documents', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Admin sees all documents', false, error.message);
    }
}

/**
 * Test: Get public document - everyone can access
 */
async function testGetPublicDocument() {
    console.log('TEST: Get public document - everyone can access');

    try {
        const token = await getToken('testuser', CONFIG.users.testuser.password);
        const response = await apiRequest('/api/v1/documents/doc-1', { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.id === 'doc-1', 'Expected document doc-1');
        assert(response.data.classification === 'public', 'Expected public classification');

        console.log('  [PASS] Public document accessible to regular user\n');
        recordTest('Get public document', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Get public document', false, error.message);
    }
}

/**
 * Test: Get confidential document - denied to regular user
 */
async function testGetConfidentialDocumentDenied() {
    console.log('TEST: Get confidential document - denied to regular user');

    try {
        const token = await getToken('testuser', CONFIG.users.testuser.password);
        const response = await apiRequest('/api/v1/documents/doc-3', { token });

        assert(response.status === 403, `Expected status 403, got ${response.status}`);
        assert(response.data.policyDecision, 'Expected policyDecision in error response');
        assert(response.data.policyDecision.allowed === false, 'Expected allowed=false in policy decision');

        console.log('  [PASS] Confidential document denied with policy decision info\n');
        recordTest('Get confidential document denied', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Get confidential document denied', false, error.message);
    }
}

/**
 * Test: Admin can access confidential documents
 */
async function testAdminCanAccessConfidential() {
    console.log('TEST: Admin can access confidential documents');

    try {
        const token = await getToken('admin', CONFIG.users.admin.password);
        const response = await apiRequest('/api/v1/documents/doc-3', { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.classification === 'confidential', 'Expected confidential document');
        assert(response.data._policyDecision?.allowed === true, 'Expected policy allowed');

        console.log('  [PASS] Admin can access confidential document\n');
        recordTest('Admin can access confidential documents', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Admin can access confidential documents', false, error.message);
    }
}

/**
 * Test: Create document - regular user can create internal docs
 */
async function testCreateInternalDocument() {
    console.log('TEST: Create document - regular user can create internal docs');

    try {
        const token = await getToken('testuser', CONFIG.users.testuser.password);
        const response = await apiRequest('/api/v1/documents', {
            method: 'POST',
            token,
            body: {
                title: 'Test Internal Document',
                content: 'This is a test document',
                classification: 'internal'
            }
        });

        assert(response.status === 201, `Expected status 201, got ${response.status}`);
        assert(response.data.id, 'Expected id in response');
        assert(response.data.classification === 'internal', 'Expected internal classification');

        console.log('  [PASS] User can create internal document\n');
        recordTest('Create internal document', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Create internal document', false, error.message);
    }
}

/**
 * Test: Create restricted document - denied to regular user
 */
async function testCreateRestrictedDocumentDenied() {
    console.log('TEST: Create restricted document - denied to regular user');

    try {
        const token = await getToken('testuser', CONFIG.users.testuser.password);
        const response = await apiRequest('/api/v1/documents', {
            method: 'POST',
            token,
            body: {
                title: 'Test Restricted Document',
                content: 'This should fail',
                classification: 'restricted'
            }
        });

        assert(response.status === 403, `Expected status 403, got ${response.status}`);
        assert(response.data.policyDecision, 'Expected policyDecision in error');
        assert(response.data.policyDecision.reason === 'insufficient_clearance',
            'Expected insufficient_clearance reason');

        console.log('  [PASS] Restricted document creation denied to regular user\n');
        recordTest('Create restricted document denied', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Create restricted document denied', false, error.message);
    }
}

/**
 * Test: Admin can create restricted documents
 */
async function testAdminCanCreateRestricted() {
    console.log('TEST: Admin can create restricted documents');

    try {
        const token = await getToken('admin', CONFIG.users.admin.password);
        const response = await apiRequest('/api/v1/documents', {
            method: 'POST',
            token,
            body: {
                title: 'Admin Restricted Document',
                content: 'Top secret content',
                classification: 'restricted'
            }
        });

        assert(response.status === 201, `Expected status 201, got ${response.status}`);
        assert(response.data.classification === 'restricted', 'Expected restricted classification');

        console.log('  [PASS] Admin can create restricted document\n');
        recordTest('Admin can create restricted documents', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Admin can create restricted documents', false, error.message);
    }
}

/**
 * Test: Delete document - denied to regular user
 */
async function testDeleteDocumentDenied() {
    console.log('TEST: Delete document - denied to regular user');

    try {
        const token = await getToken('testuser', CONFIG.users.testuser.password);
        const response = await apiRequest('/api/v1/documents/doc-1', {
            method: 'DELETE',
            token
        });

        assert(response.status === 403, `Expected status 403, got ${response.status}`);

        console.log('  [PASS] Delete denied to regular user\n');
        recordTest('Delete document denied to regular user', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Delete document denied to regular user', false, error.message);
    }
}

/**
 * Test: Admin can delete documents
 */
async function testAdminCanDelete() {
    console.log('TEST: Admin can delete documents');

    try {
        const token = await getToken('admin', CONFIG.users.admin.password);
        const response = await apiRequest('/api/v1/documents/doc-1', {
            method: 'DELETE',
            token
        });

        assert(response.status === 204, `Expected status 204, got ${response.status}`);

        console.log('  [PASS] Admin can delete documents\n');
        recordTest('Admin can delete documents', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Admin can delete documents', false, error.message);
    }
}

/**
 * Test: Get non-existent document returns 404
 */
async function testGetNonExistentDocument() {
    console.log('TEST: Get non-existent document returns 404');

    try {
        const token = await getToken('testuser', CONFIG.users.testuser.password);
        const response = await apiRequest('/api/v1/documents/doc-nonexistent', { token });

        assert(response.status === 404, `Expected status 404, got ${response.status}`);

        console.log('  [PASS] Non-existent document returns 404\n');
        recordTest('Get non-existent document returns 404', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Get non-existent document returns 404', false, error.message);
    }
}

/**
 * Test: Filter documents by classification
 */
async function testFilterByClassification() {
    console.log('TEST: Filter documents by classification');

    try {
        const token = await getToken('admin', CONFIG.users.admin.password);
        const response = await apiRequest('/api/v1/documents?classification=public', { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(Array.isArray(response.data.documents), 'Expected documents array');

        const allPublic = response.data.documents.every(d => d.classification === 'public');
        assert(allPublic, 'Expected all returned documents to be public');

        console.log(`  [PASS] Filtered to ${response.data.documents.length} public documents\n`);
        recordTest('Filter documents by classification', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('Filter documents by classification', false, error.message);
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
        assert(response.data.openapi, 'Expected OpenAPI spec');
        assert(response.data.info.title === 'OPA Protected API', 'Expected OPA Protected API title');

        console.log('  [PASS] OpenAPI spec is accessible\n');
        recordTest('OpenAPI endpoint', true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest('OpenAPI endpoint', false, error.message);
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
    console.log('OPA Integration Tests for Node-RED API Gateway');
    console.log('='.repeat(60) + '\n');

    try {
        // Setup flows (copies OPA example flow)
        if (!setupFlows()) {
            process.exit(1);
        }

        // Check services are ready (starts Docker if needed)
        await checkServicesReady();

        console.log('Running tests...\n');
        console.log('-'.repeat(60) + '\n');

        // Document listing tests
        await testListDocuments();
        await testAdminSeesAllDocuments();

        // Document access tests - policy based
        await testGetPublicDocument();
        await testGetConfidentialDocumentDenied();
        await testAdminCanAccessConfidential();

        // Document creation tests - clearance based
        await testCreateInternalDocument();
        await testCreateRestrictedDocumentDenied();
        await testAdminCanCreateRestricted();

        // Document deletion tests - admin only
        await testDeleteDocumentDenied();
        await testAdminCanDelete();

        // Misc tests
        await testGetNonExistentDocument();
        await testFilterByClassification();
        await testOpenAPIEndpoint();

        // Print summary
        printSummary();

    } finally {
        // Cleanup Docker if we started it
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
    console.error('\nTest runner error:', error.message);
    cleanup();
    process.exit(1);
});
