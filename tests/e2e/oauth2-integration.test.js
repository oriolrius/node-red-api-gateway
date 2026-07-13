#!/usr/bin/env node

/**
 * OAuth2 Integration Tests for Node-RED API Gateway
 *
 * These tests verify the OAuth2/Keycloak authentication flow
 * for the API endpoints defined in the oauth2-authenticated-api example flow.
 *
 * ============================================================================
 * SETUP INSTRUCTIONS
 * ============================================================================
 *
 * 1. Copy the OAuth2 example flow to the e2e test directory:
 *
 *    cp examples/oauth2-authenticated-api.json tests/e2e/flows.json
 *
 * 2. Run the integration tests (Docker stack starts automatically if needed):
 *
 *    npm run test:integration
 *
 * Environment variables:
 *    SKIP_DOCKER_SETUP=1    - Don't start Docker (use existing stack)
 *    SKIP_DOCKER_TEARDOWN=1 - Keep Docker running after tests
 *
 * ============================================================================
 * WHAT THIS TESTS
 * ============================================================================
 *
 * - Public endpoints accessible without authentication
 * - Protected endpoints return 401 without valid token
 * - User role can access user-level endpoints
 * - Admin role can access admin-level endpoints
 * - Role-based access control (RBAC) properly enforced
 * - Composite scope requirements (admin + user:write)
 * - Request validation (query params, body)
 * - OpenAPI/Swagger documentation endpoints
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

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Configuration
const CONFIG = {
    apiBaseUrl: "http://localhost:3200",
    keycloakUrl: "http://localhost:8080",
    keycloakRealm: "my-realm",
    clientId: "my-api-client",
    clientSecret: "my-client-secret",
    requestTimeout: 10000,
    users: {
        testuser: { password: "testpassword", roles: ["user"] },
        editor: { password: "editorpassword", roles: ["user", "user:write"] },
        admin: { password: "adminpassword", roles: ["admin"] }
    },
    // Docker configuration
    dockerComposeFile: path.join(__dirname, "docker-compose.yml"),
    dockerComposeProfile: "nodered",
    startupTimeout: 120000,  // 2 minutes max for services to start
    startupPollInterval: 3000,  // Check every 3 seconds
    skipDockerSetup: process.env.SKIP_DOCKER_SETUP === "1",
    skipDockerTeardown: process.env.SKIP_DOCKER_TEARDOWN === "1"
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
        const isHttps = urlObj.protocol === "https:";
        const client = isHttps ? https : http;

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || "GET",
            headers: options.headers || {},
            timeout: options.timeout || CONFIG.requestTimeout
        };

        const req = client.request(reqOptions, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const json = data ? JSON.parse(data) : null;
                    resolve({ status: res.statusCode, headers: res.headers, data: json, raw: data });
                } catch {
                    resolve({ status: res.statusCode, headers: res.headers, data: null, raw: data });
                }
            });
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timeout"));
        });

        if (postData) {
            req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
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
        grant_type: "password",
        username: username,
        password: password
    }).toString();

    const response = await httpRequest({
        url: tokenUrl,
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
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
        headers["Authorization"] = `Bearer ${options.token}`;
    }

    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    return httpRequest({
        url: `${CONFIG.apiBaseUrl}${path}`,
        method: options.method || "GET",
        headers
    }, options.body);
}

/**
 * Record test result
 */
function recordTest(name, passed, details = "", skipped = false) {
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
 * Copy flows.json to .nodered directory for Docker mount
 */
function copyFlowsToNodeRed() {
    const sourcePath = path.join(__dirname, "flows.json");
    const targetPath = path.join(__dirname, ".nodered", "flows.json");

    try {
        if (!fs.existsSync(sourcePath)) {
            console.error(`  [FAIL] Source flows.json not found: ${sourcePath}`);
            return false;
        }

        fs.copyFileSync(sourcePath, targetPath);
        console.log("  [OK] Copied flows.json to .nodered/");
        return true;
    } catch (error) {
        console.error(`  [FAIL] Failed to copy flows.json: ${error.message}`);
        return false;
    }
}

/**
 * Start Docker stack
 */
function startDockerStack() {
    console.log("  Starting Docker stack...");

    // Copy flows to Node-RED data directory before starting
    if (!copyFlowsToNodeRed()) {
        return false;
    }

    try {
        execSync(
            `docker compose -f "${CONFIG.dockerComposeFile}" --profile ${CONFIG.dockerComposeProfile} up -d`,
            { stdio: "inherit", cwd: __dirname }
        );
        console.log("  [OK] Docker stack started");
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
    console.log("\nStopping Docker stack...");

    try {
        execSync(
            `docker compose -f "${CONFIG.dockerComposeFile}" --profile ${CONFIG.dockerComposeProfile} down -v`,
            { stdio: "inherit", cwd: __dirname }
        );
        console.log("  [OK] Docker stack stopped");
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
    console.log("  Waiting for services to be ready...");

    const startTime = Date.now();
    let keycloakReady = false;
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
                    console.log("  [OK] Keycloak is ready");
                }
            } catch {
                // Not ready yet
            }
        }

        // Check API Server
        if (!apiServerReady) {
            try {
                const response = await httpRequest({
                    url: `${CONFIG.apiBaseUrl}/api/v1/public/health`,
                    timeout: 3000
                });
                if (response.status === 200) {
                    apiServerReady = true;
                    console.log("  [OK] API Server is ready");
                }
            } catch {
                // Not ready yet
            }
        }

        if (keycloakReady && apiServerReady) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`  [OK] All services ready (took ${elapsed}s)\n`);
            return true;
        }

        // Progress indicator
        process.stdout.write(".");

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, CONFIG.startupPollInterval));
    }

    console.log("");
    console.error(`  [FAIL] Services did not become ready within ${CONFIG.startupTimeout / 1000}s`);
    console.error(`    Keycloak: ${keycloakReady ? "ready" : "not ready"}`);
    console.error(`    API Server: ${apiServerReady ? "ready" : "not ready"}`);
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
    const apiAvailable = await isServiceAvailable(`${CONFIG.apiBaseUrl}/api/v1/public/health`);

    if (keycloakAvailable && apiAvailable) {
        console.log("  [OK] Services are already running\n");
        return true;
    }

    if (CONFIG.skipDockerSetup) {
        console.error("  [FAIL] Services not running and SKIP_DOCKER_SETUP=1\n");
        return false;
    }

    console.log("  Services not running, starting Docker stack...\n");

    if (!startDockerStack()) {
        return false;
    }

    dockerStartedByUs = true;

    return await waitForServices();
}

// ============================================================================
// Pre-flight Checks
// ============================================================================

/**
 * Check that flows.json exists and matches the expected OAuth2 example flow
 */
function checkFlowsConfiguration() {
    console.log("Checking test configuration...\n");

    // Determine project root (tests are run from project root)
    const projectRoot = process.cwd();
    const flowsPath = path.join(projectRoot, "tests/e2e/flows.json");
    const examplePath = path.join(projectRoot, "examples/oauth2-authenticated-api.json");

    // Check if example file exists first
    if (!fs.existsSync(examplePath)) {
        console.error("  [FAIL] Example flow not found: examples/oauth2-authenticated-api.json\n");
        console.error("  The OAuth2 example flow is required for these tests.");
        process.exit(1);
    }

    // Check if flows.json exists
    if (!fs.existsSync(flowsPath)) {
        console.error("  [FAIL] tests/e2e/flows.json not found\n");
        console.error("  Please copy the OAuth2 example flow:");
        console.error("    cp examples/oauth2-authenticated-api.json tests/e2e/flows.json\n");
        process.exit(1);
    }

    // Read both files and compare
    try {
        const flowsContent = fs.readFileSync(flowsPath, "utf8");
        const exampleContent = fs.readFileSync(examplePath, "utf8");

        // Parse both to validate JSON and normalize for comparison
        const flows = JSON.parse(flowsContent);
        const example = JSON.parse(exampleContent);

        // Compare the JSON content (normalized)
        const flowsNormalized = JSON.stringify(flows);
        const exampleNormalized = JSON.stringify(example);

        if (flowsNormalized !== exampleNormalized) {
            console.error("  [FAIL] tests/e2e/flows.json does not match the OAuth2 example flow\n");
            console.error("  The integration tests require the exact OAuth2 example flow.");
            console.error("  Please update flows.json:");
            console.error("    cp examples/oauth2-authenticated-api.json tests/e2e/flows.json\n");
            console.error("  Then restart the Docker stack to reload the flow:");
            console.error("    npm run docker:e2e:down && npm run docker:e2e:up\n");
            process.exit(1);
        }

        console.log("  [OK] flows.json matches oauth2-authenticated-api.json example");

        // Show configuration details
        const apiConfigNode = flows.find(n => n.type === "apigw-config");
        if (apiConfigNode && apiConfigNode.keycloakUrl) {
            console.log(`       Keycloak: ${apiConfigNode.keycloakUrl}/realms/${apiConfigNode.keycloakRealm}`);
        }

        // Check for expected endpoints
        const endpoints = flows.filter(n => n.type === "apigw-endpoint");
        console.log(`  [OK] Found ${endpoints.length} API endpoint(s)`);

    } catch (error) {
        if (error instanceof SyntaxError) {
            console.error("  [FAIL] Invalid JSON:", error.message);
        } else {
            console.error("  [FAIL] Error reading files:", error.message);
        }
        process.exit(1);
    }

    console.log("");
}

// ============================================================================
// Service Health Checks
// ============================================================================

async function checkServicesReady() {
    console.log("Checking services availability...\n");

    const ready = await ensureInfrastructure();

    if (!ready) {
        console.error("\n  Make sure Docker is installed and running.");
        console.error("  You can also start the stack manually:");
        console.error("    npm run docker:e2e:up");
        console.error("    # or: cd tests/e2e && docker compose --profile nodered up -d\n");
        process.exit(1);
    }

    console.log("All services are ready.\n");
}

// ============================================================================
// Test Cases
// ============================================================================

/**
 * Test: Public endpoint accessible without authentication
 */
async function testPublicEndpoint() {
    console.log("TEST: Public endpoint accessible without authentication");

    try {
        const response = await apiRequest("/api/v1/public/health");

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.status === "healthy", `Expected status 'healthy', got '${response.data.status}'`);
        assert(response.data.timestamp, "Expected timestamp in response");
        assert(response.data.version, "Expected version in response");

        console.log("  [PASS] Public health endpoint returns correct response\n");
        recordTest("Public endpoint without auth", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Public endpoint without auth", false, error.message);
    }
}

/**
 * Test: Protected endpoint returns 401 without token
 */
async function testProtectedEndpointNoAuth() {
    console.log("TEST: Protected endpoint returns 401 without authentication");

    try {
        const response = await apiRequest("/api/v1/user/profile");

        assert(response.status === 401, `Expected status 401, got ${response.status}`);

        console.log("  [PASS] Returns 401 Unauthorized without token\n");
        recordTest("Protected endpoint without auth returns 401", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Protected endpoint without auth returns 401", false, error.message);
    }
}

/**
 * Test: Protected endpoint returns 401 with invalid token
 */
async function testProtectedEndpointInvalidToken() {
    console.log("TEST: Protected endpoint returns 401 with invalid token");

    try {
        const response = await apiRequest("/api/v1/user/profile", {
            token: "invalid.jwt.token"
        });

        assert(response.status === 401, `Expected status 401, got ${response.status}`);

        console.log("  [PASS] Returns 401 Unauthorized with invalid token\n");
        recordTest("Protected endpoint with invalid token returns 401", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Protected endpoint with invalid token returns 401", false, error.message);
    }
}

/**
 * Test: User can access user-level endpoint with valid token
 */
async function testUserEndpointWithValidToken() {
    console.log("TEST: User can access user-level endpoint with valid token");

    try {
        const token = await getToken("testuser", CONFIG.users.testuser.password);
        const response = await apiRequest("/api/v1/user/profile", { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        // Check for user identity (sub, username) OR roles/scopes which indicate authenticated user
        const hasUserInfo = response.data.username || response.data.preferredUsername ||
            response.data.sub || (Array.isArray(response.data.roles) && response.data.roles.length > 0);
        assert(hasUserInfo, "Expected user info (username, sub, or roles) in response");

        console.log("  [PASS] User endpoint accessible with valid user token\n");
        recordTest("User endpoint with valid token", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("User endpoint with valid token", false, error.message);
    }
}

/**
 * Test: Regular user cannot access admin endpoint (returns 403)
 */
async function testUserCannotAccessAdminEndpoint() {
    console.log("TEST: Regular user cannot access admin endpoint");

    try {
        const token = await getToken("testuser", CONFIG.users.testuser.password);
        const response = await apiRequest("/api/v1/admin/users", { token });

        assert(response.status === 403, `Expected status 403, got ${response.status}`);

        console.log("  [PASS] Admin endpoint returns 403 Forbidden for regular user\n");
        recordTest("Regular user cannot access admin endpoint", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Regular user cannot access admin endpoint", false, error.message);
    }
}

/**
 * Test: Admin user can access admin endpoint
 */
async function testAdminCanAccessAdminEndpoint() {
    console.log("TEST: Admin user can access admin endpoint");

    try {
        const token = await getToken("admin", CONFIG.users.admin.password);
        const response = await apiRequest("/api/v1/admin/users", { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(Array.isArray(response.data.users), "Expected users array in response");
        assert(typeof response.data.total === "number", "Expected total count in response");

        console.log("  [PASS] Admin endpoint accessible with admin token\n");
        recordTest("Admin can access admin endpoint", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Admin can access admin endpoint", false, error.message);
    }
}

/**
 * Test: Admin user can access user endpoint (admin has user role)
 */
async function testAdminCanAccessUserEndpoint() {
    console.log("TEST: Admin user can access user endpoint");

    try {
        const token = await getToken("admin", CONFIG.users.admin.password);
        const response = await apiRequest("/api/v1/user/profile", { token });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);

        console.log("  [PASS] Admin can also access user endpoint\n");
        recordTest("Admin can access user endpoint", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Admin can access user endpoint", false, error.message);
    }
}

/**
 * Test: Admin create user endpoint requires both admin AND user:write scopes
 */
async function testCreateUserRequiresBothScopes() {
    console.log("TEST: Create user requires admin AND user:write scopes");

    try {
        // Test with admin token (should have admin + user:write via composite role)
        const adminToken = await getToken("admin", CONFIG.users.admin.password);
        const response = await apiRequest("/api/v1/admin/users", {
            method: "POST",
            token: adminToken,
            body: {
                username: "newuser",
                email: "newuser@example.com",
                password: "password123"
            }
        });

        assert(response.status === 201, `Expected status 201, got ${response.status}`);
        assert(response.data.id, "Expected id in response");
        assert(response.data.username === "newuser", `Expected username 'newuser', got '${response.data.username}'`);

        console.log("  [PASS] Admin can create users (has admin + user:write)\n");
        recordTest("Create user with admin+user:write scopes", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Create user with admin+user:write scopes", false, error.message);
    }
}

/**
 * Test: Editor with user:write cannot create users (missing admin role)
 */
async function testEditorCannotCreateUsers() {
    console.log("TEST: Editor with user:write cannot create users (missing admin role)");

    try {
        const editorToken = await getToken("editor", CONFIG.users.editor.password);
        const response = await apiRequest("/api/v1/admin/users", {
            method: "POST",
            token: editorToken,
            body: {
                username: "testcreate",
                email: "testcreate@example.com",
                password: "password123"
            }
        });

        // Editor has user:write but not admin, should get 403
        assert(response.status === 403, `Expected status 403, got ${response.status}`);

        console.log("  [PASS] Editor cannot create users (missing admin scope)\n");
        recordTest("Editor cannot create users (missing admin)", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Editor cannot create users (missing admin)", false, error.message);
    }
}

/**
 * Test: Query parameter validation on admin list users
 */
async function testQueryParameterValidation() {
    console.log("TEST: Query parameter validation on admin list users");

    try {
        const adminToken = await getToken("admin", CONFIG.users.admin.password);

        // Test with valid pagination parameters
        const response = await apiRequest("/api/v1/admin/users?page=1&limit=10", {
            token: adminToken
        });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.page === 1, `Expected page 1, got ${response.data.page}`);
        assert(response.data.limit === 10, `Expected limit 10, got ${response.data.limit}`);

        console.log("  [PASS] Query parameters work correctly\n");
        recordTest("Query parameter validation", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Query parameter validation", false, error.message);
    }
}

/**
 * Test: Request body validation on create user
 */
async function testRequestBodyValidation() {
    console.log("TEST: Request body validation on create user");

    try {
        const adminToken = await getToken("admin", CONFIG.users.admin.password);

        // Test with missing required fields
        const response = await apiRequest("/api/v1/admin/users", {
            method: "POST",
            token: adminToken,
            body: {
                username: "test"
                // Missing email and password
            }
        });

        assert(response.status === 400, `Expected status 400, got ${response.status}`);

        console.log("  [PASS] Invalid request body returns 400\n");
        recordTest("Request body validation", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Request body validation", false, error.message);
    }
}

/**
 * Test: OpenAPI documentation endpoint
 */
async function testOpenAPIEndpoint() {
    console.log("TEST: OpenAPI documentation endpoint");

    try {
        const response = await httpRequest({
            url: `${CONFIG.apiBaseUrl}/openapi.json`
        });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.openapi, "Expected openapi version in response");
        assert(response.data.info, "Expected info object in response");
        assert(response.data.paths, "Expected paths object in response");

        console.log("  [PASS] OpenAPI spec is accessible\n");
        recordTest("OpenAPI endpoint", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("OpenAPI endpoint", false, error.message);
    }
}

/**
 * Test: Swagger UI endpoint
 */
async function testSwaggerUIEndpoint() {
    console.log("TEST: Swagger UI endpoint");

    try {
        const response = await httpRequest({
            url: `${CONFIG.apiBaseUrl}/docs`
        });

        // Swagger UI may return 200 or redirect
        assert(response.status === 200 || response.status === 301 || response.status === 302,
            `Expected status 200/301/302, got ${response.status}`);

        console.log("  [PASS] Swagger UI is accessible\n");
        recordTest("Swagger UI endpoint", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Swagger UI endpoint", false, error.message);
    }
}

// ============================================================================
// Test Runner
// ============================================================================

function printSummary() {
    console.log("\n" + "=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));

    for (const test of results.tests) {
        let icon;
        if (test.skipped) {
            icon = "[SKIP]";
        } else if (test.passed) {
            icon = "[PASS]";
        } else {
            icon = "[FAIL]";
        }

        const details = test.details ? ` - ${test.details}` : "";
        console.log(`  ${icon} ${test.name}${details}`);
    }

    console.log("-".repeat(60));
    console.log(`  Total:   ${results.passed + results.failed + results.skipped}`);
    console.log(`  Passed:  ${results.passed}`);
    console.log(`  Failed:  ${results.failed}`);
    console.log(`  Skipped: ${results.skipped}`);
    console.log("=".repeat(60));
}

/**
 * Cleanup function for Docker teardown
 */
function cleanup() {
    if (dockerStartedByUs && !CONFIG.skipDockerTeardown) {
        stopDockerStack();
    } else if (dockerStartedByUs && CONFIG.skipDockerTeardown) {
        console.log("\nDocker teardown skipped (SKIP_DOCKER_TEARDOWN=1)");
        console.log("To stop the stack manually: npm run docker:e2e:down\n");
    }
}

async function runTests() {
    console.log("=".repeat(60));
    console.log("OAuth2 Integration Tests for Node-RED API Gateway");
    console.log("=".repeat(60) + "\n");

    try {
        // Pre-flight checks
        checkFlowsConfiguration();

        // Check services are ready (starts Docker if needed)
        await checkServicesReady();

        console.log("Running tests...\n");
        console.log("-".repeat(60) + "\n");

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

    } finally {
        // Cleanup Docker if we started it
        cleanup();
    }

    // Exit with appropriate code
    if (results.failed === 0) {
        console.log("\nAll tests passed!\n");
        process.exit(0);
    } else {
        console.log("\nSome tests failed.\n");
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error("Unhandled error:", error);
    cleanup();
    process.exit(1);
});
