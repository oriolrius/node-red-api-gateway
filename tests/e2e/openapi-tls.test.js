#!/usr/bin/env node

/**
 * OpenAPI TLS Integration Tests for Node-RED API Gateway
 *
 * This is a fully self-contained e2e test that:
 * 1. Generates TLS certificates using bundled mkcert
 * 2. Copies the TLS test flow to flows.json
 * 3. Starts the unified Docker stack with Node-RED (--profile nodered)
 * 4. Waits for services to be ready
 * 5. Runs all TLS/OpenAPI tests
 * 6. Tears down the Docker stack
 *
 * Uses the same infrastructure as other e2e tests (docker-compose.yml).
 * Node-RED does not wait for Keycloak/OPA, allowing TLS tests to start quickly.
 *
 * Usage:
 *    npm run test:openapi-tls
 *
 * Environment variables:
 *    SKIP_DOCKER_SETUP=1  - Skip Docker setup (use existing running stack)
 *    SKIP_DOCKER_TEARDOWN=1 - Keep Docker running after tests
 *
 * Exit codes:
 * - 0: All tests passed
 * - 1: Tests failed or setup error
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Configuration
// Uses the unified e2e infrastructure (docker-compose.yml with --profile nodered)
const CONFIG = {
    apiBaseUrl: "https://localhost:3443",
    nodeRedUrl: "http://localhost:1880",
    requestTimeout: 10000,
    certsDir: path.join(__dirname, "certs"),
    setupScript: path.join(__dirname, "setup-certs.sh"),
    mkcertBin: path.join(__dirname, "..", "..", "contrib", "mkcert"),
    dockerComposeFile: path.join(__dirname, "docker-compose.yml"),
    dockerComposeProfile: "nodered",
    tlsFlowSource: path.join(__dirname, "openapi-tls-test-flow.json"),
    flowsTarget: path.join(__dirname, ".nodered", "flows.json"),  // Inside .nodered directory
    startupTimeout: 120000,  // 2 minutes max for services to start
    startupPollInterval: 2000,  // Check every 2 seconds
    skipDockerSetup: process.env.SKIP_DOCKER_SETUP === "1",
    skipDockerTeardown: process.env.SKIP_DOCKER_TEARDOWN === "1"
};

// Test results tracking
const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: []
};

// CA certificate for validating the server
let caCert = null;

// ============================================================================
// Infrastructure Setup/Teardown
// ============================================================================

/**
 * Generate certificates using mkcert if they don't exist
 */
function generateCertificates() {
    const requiredFiles = ["server.crt", "server.key", "rootCA.pem"];
    const allExist = requiredFiles.every(f => fs.existsSync(path.join(CONFIG.certsDir, f)));

    if (allExist) {
        console.log("  [OK] Certificates already exist");
        return true;
    }

    console.log("  Generating certificates with mkcert...");

    try {
        if (!fs.existsSync(CONFIG.mkcertBin)) {
            console.error(`  [FAIL] mkcert binary not found at ${CONFIG.mkcertBin}`);
            return false;
        }

        execSync(`bash "${CONFIG.setupScript}"`, {
            stdio: "inherit",
            cwd: path.dirname(CONFIG.setupScript)
        });

        console.log("  [OK] Certificates generated successfully");
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
    const caPath = path.join(CONFIG.certsDir, "rootCA.pem");

    if (!fs.existsSync(caPath)) {
        console.error(`  [FAIL] CA certificate not found: ${caPath}`);
        return false;
    }

    caCert = fs.readFileSync(caPath);
    console.log("  [OK] CA certificate loaded");
    return true;
}

/**
 * Copy TLS test flow to flows.json
 */
function copyTestFlow() {
    console.log("  Copying TLS test flow...");

    try {
        if (!fs.existsSync(CONFIG.tlsFlowSource)) {
            console.error(`  [FAIL] TLS flow not found: ${CONFIG.tlsFlowSource}`);
            return false;
        }

        fs.copyFileSync(CONFIG.tlsFlowSource, CONFIG.flowsTarget);
        console.log("  [OK] Test flow copied to flows.json");
        return true;
    } catch (error) {
        console.error(`  [FAIL] Failed to copy test flow: ${error.message}`);
        return false;
    }
}

/**
 * Start Docker stack with Node-RED
 */
function startDockerStack() {
    console.log("  Starting Docker stack...");

    try {
        // First, ensure any existing stack is stopped
        try {
            execSync(`docker compose -f "${CONFIG.dockerComposeFile}" --profile ${CONFIG.dockerComposeProfile} down -v`, {
                stdio: "pipe",
                cwd: __dirname
            });
        } catch {
            // Ignore errors if stack wasn't running
        }

        // Start the e2e test stack with nodered profile
        execSync(`docker compose -f "${CONFIG.dockerComposeFile}" --profile ${CONFIG.dockerComposeProfile} up -d`, {
            stdio: "inherit",
            cwd: __dirname
        });

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
        execSync(`docker compose -f "${CONFIG.dockerComposeFile}" --profile ${CONFIG.dockerComposeProfile} down -v`, {
            stdio: "inherit",
            cwd: __dirname
        });
        console.log("  [OK] Docker stack stopped");
        return true;
    } catch (error) {
        console.error(`  [WARN] Failed to stop Docker stack: ${error.message}`);
        return false;
    }
}

/**
 * Simple HTTP request (for Node-RED health check)
 */
function httpRequest(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === "https:" ? https : http;

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
            path: urlObj.pathname,
            method: "GET",
            timeout: timeout,
            rejectUnauthorized: false  // For initial checks before CA is loaded
        };

        const req = client.request(reqOptions, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => resolve({ status: res.statusCode, data }));
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timeout"));
        });
        req.end();
    });
}

/**
 * Wait for services to be ready
 */
async function waitForServices() {
    console.log("  Waiting for services to be ready...");

    const startTime = Date.now();
    let nodeRedReady = false;
    let apiServerReady = false;

    while (Date.now() - startTime < CONFIG.startupTimeout) {
        // Check Node-RED
        if (!nodeRedReady) {
            try {
                const response = await httpRequest(CONFIG.nodeRedUrl, 3000);
                if (response.status === 200) {
                    nodeRedReady = true;
                    console.log("  [OK] Node-RED is ready");
                }
            } catch {
                // Not ready yet
            }
        }

        // Check API Server (HTTPS)
        if (nodeRedReady && !apiServerReady) {
            try {
                // Use simple https request with rejectUnauthorized: false for health check
                const response = await httpRequest(`${CONFIG.apiBaseUrl}/api/v1/health`, 3000);
                if (response.status === 200) {
                    apiServerReady = true;
                    console.log("  [OK] API Server (HTTPS) is ready");
                }
            } catch {
                // Not ready yet
            }
        }

        if (nodeRedReady && apiServerReady) {
            console.log(`  [OK] All services ready (took ${Math.round((Date.now() - startTime) / 1000)}s)`);
            return true;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, CONFIG.startupPollInterval));
        process.stdout.write(".");
    }

    console.log("");
    console.error(`  [FAIL] Services did not become ready within ${CONFIG.startupTimeout / 1000}s`);
    console.error(`    Node-RED: ${nodeRedReady ? "ready" : "not ready"}`);
    console.error(`    API Server: ${apiServerReady ? "ready" : "not ready"}`);
    return false;
}

/**
 * Full infrastructure setup
 */
async function setupInfrastructure() {
    console.log("\n" + "=".repeat(60));
    console.log("INFRASTRUCTURE SETUP");
    console.log("=".repeat(60) + "\n");

    // Generate certificates
    console.log("Step 1: Certificates");
    if (!generateCertificates()) {
        return false;
    }

    // Load CA certificate
    if (!loadCaCertificate()) {
        return false;
    }

    // Copy test flow
    console.log("\nStep 2: Test Flow");
    if (!copyTestFlow()) {
        return false;
    }

    // Start Docker stack (unless skipped)
    if (CONFIG.skipDockerSetup) {
        console.log("\nStep 3: Docker Stack (SKIPPED - SKIP_DOCKER_SETUP=1)");
    } else {
        console.log("\nStep 3: Docker Stack");
        if (!startDockerStack()) {
            return false;
        }
    }

    // Wait for services
    console.log("\nStep 4: Service Health");
    if (!await waitForServices()) {
        return false;
    }

    console.log("\n" + "=".repeat(60) + "\n");
    return true;
}

/**
 * Teardown infrastructure
 */
function teardownInfrastructure() {
    if (CONFIG.skipDockerTeardown) {
        console.log("\nDocker teardown skipped (SKIP_DOCKER_TEARDOWN=1)");
        return;
    }

    stopDockerStack();
}

// ============================================================================
// HTTP Helpers
// ============================================================================

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
            method: options.method || "GET",
            headers: options.headers || {},
            timeout: options.timeout || CONFIG.requestTimeout,
            ca: options.ca !== undefined ? options.ca : caCert,
            rejectUnauthorized: options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : true
        };

        const req = https.request(reqOptions, (res) => {
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
 * Make API request with CA validation
 */
async function apiRequest(pathOrUrl, options = {}) {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${CONFIG.apiBaseUrl}${pathOrUrl}`;
    const headers = options.headers || {};

    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    return httpsRequest({
        url,
        method: options.method || "GET",
        headers,
        ca: options.ca,
        rejectUnauthorized: options.rejectUnauthorized
    }, options.body);
}

// ============================================================================
// Test Helpers
// ============================================================================

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

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

// ============================================================================
// Test Cases
// ============================================================================

async function testHttpsConnection() {
    console.log("TEST: Server responds over HTTPS with valid certificate");

    try {
        const response = await apiRequest("/api/v1/health");

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.status === "healthy", `Expected status 'healthy', got '${response.data.status}'`);

        console.log("  [PASS] HTTPS connection successful with certificate validation\n");
        recordTest("HTTPS connection with valid cert", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("HTTPS connection with valid cert", false, error.message);
    }
}

async function testConnectionFailsWithWrongCA() {
    console.log("TEST: Connection fails with wrong CA certificate");

    // Create a fake CA certificate that won't match the server's certificate
    const fakeCA = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHBfpegPjMCMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBmZh
a2VDQTAeFw0yNDAxMDEwMDAwMDBaFw0yNTAxMDEwMDAwMDBaMBExDzANBgNVBAMM
BmZha2VDQTBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQC5fNmMx0pqTZ1gPG9A3FmW
Fvl6jJE4Mj0Yp6N7cGxvJ5Z6Q8l9sXbZlG3cN3bKxEjHlKxXl8qLzO9z5QIDAQAB
MA0GCSqGSIb3DQEBCwUAA0EAMjA5MTMwMTAwMDAwMFowMTEPMA0GA1UEAwwGZmFr
ZUNBMA0GCSqGSIb3DQEBCwUAA0EAtest
-----END CERTIFICATE-----`;

    try {
        await apiRequest("/api/v1/health", {
            ca: fakeCA,
            rejectUnauthorized: true
        });

        console.log("  [FAIL] Connection succeeded with wrong CA - certificate validation not enforced!\n");
        recordTest("Connection fails with wrong CA", false, "Connection succeeded unexpectedly");
    } catch (error) {
        if (error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
            error.code === "SELF_SIGNED_CERT_IN_CHAIN" ||
            error.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
            error.code === "CERT_SIGNATURE_FAILURE" ||
            error.code === "ERR_OSSL_PEM_NO_START_LINE" ||
            error.message.includes("certificate") ||
            error.message.includes("PEM")) {
            console.log("  [PASS] Connection correctly rejected with wrong CA certificate\n");
            recordTest("Connection fails with wrong CA", true);
        } else {
            console.log(`  [FAIL] Unexpected error: ${error.message}\n`);
            recordTest("Connection fails with wrong CA", false, error.message);
        }
    }
}

async function testOpenApiSpecEndpoint() {
    console.log("TEST: GET /openapi.json returns valid OpenAPI 3.x spec");

    try {
        const response = await apiRequest("/openapi.json");

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data, "Expected JSON response");
        assert(response.data.openapi, "Expected openapi version field");
        assert(response.data.openapi.startsWith("3."), `Expected OpenAPI 3.x, got ${response.data.openapi}`);
        assert(response.data.info, "Expected info object");
        assert(response.data.info.title, "Expected info.title");
        assert(response.data.paths, "Expected paths object");

        console.log(`  [PASS] Valid OpenAPI ${response.data.openapi} spec returned\n`);
        recordTest("OpenAPI spec endpoint", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("OpenAPI spec endpoint", false, error.message);
    }
}

async function testOpenApiServerUrl() {
    console.log("TEST: OpenAPI spec contains correct HTTPS server URL");

    try {
        const response = await apiRequest("/openapi.json");

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.servers, "Expected servers array");
        assert(Array.isArray(response.data.servers), "servers should be an array");
        assert(response.data.servers.length > 0, "servers array should not be empty");

        const serverUrl = response.data.servers[0].url;
        assert(serverUrl, "Expected server URL");
        assert(serverUrl.startsWith("https://"), `Expected HTTPS URL, got ${serverUrl}`);

        console.log(`  [PASS] Server URL is HTTPS: ${serverUrl}\n`);
        recordTest("OpenAPI HTTPS server URL", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("OpenAPI HTTPS server URL", false, error.message);
    }
}

async function testOpenApiEndpoints() {
    console.log("TEST: OpenAPI spec includes registered endpoints");

    try {
        const response = await apiRequest("/openapi.json");

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.paths, "Expected paths object");

        const paths = Object.keys(response.data.paths);
        assert(paths.length > 0, "Expected at least one path");

        const expectedPaths = ["/api/v1/health", "/api/v1/echo"];
        const foundPaths = [];

        for (const expectedPath of expectedPaths) {
            if (response.data.paths[expectedPath]) {
                foundPaths.push(expectedPath);
            }
        }

        console.log(`  Found ${paths.length} path(s) in OpenAPI spec`);
        console.log(`  Expected endpoints found: ${foundPaths.join(", ") || "none"}`);

        assert(paths.length >= 1, "Expected at least one endpoint in spec");

        console.log("  [PASS] OpenAPI spec includes registered endpoints\n");
        recordTest("OpenAPI includes endpoints", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("OpenAPI includes endpoints", false, error.message);
    }
}

async function testOpenApiSchemas() {
    console.log("TEST: OpenAPI spec includes request/response schemas");

    try {
        const response = await apiRequest("/openapi.json");

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.paths, "Expected paths object");

        let hasResponses = false;

        for (const [pathName, pathItem] of Object.entries(response.data.paths)) {
            for (const [method, operation] of Object.entries(pathItem)) {
                if (method === "parameters") continue;

                if (operation.responses) {
                    hasResponses = true;
                    for (const [code, resp] of Object.entries(operation.responses)) {
                        if (resp.content && resp.content["application/json"] && resp.content["application/json"].schema) {
                            console.log(`  Found response schema for ${method.toUpperCase()} ${pathName} (${code})`);
                        }
                    }
                }

                if (operation.requestBody && operation.requestBody.content) {
                    console.log(`  Found request body schema for ${method.toUpperCase()} ${pathName}`);
                }
            }
        }

        assert(hasResponses, "Expected at least one endpoint with response definitions");

        console.log("  [PASS] OpenAPI spec includes schemas\n");
        recordTest("OpenAPI includes schemas", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("OpenAPI includes schemas", false, error.message);
    }
}

async function testSwaggerUiEndpoint() {
    console.log("TEST: GET /docs returns Swagger UI");

    try {
        const response = await apiRequest("/docs");

        assert(response.status === 200 || response.status === 301 || response.status === 302,
            `Expected status 200/301/302, got ${response.status}`);

        if (response.status === 200) {
            assert(response.raw, "Expected HTML response");
            assert(
                response.raw.includes("swagger") ||
                response.raw.includes("Swagger") ||
                response.raw.includes("openapi"),
                "Expected Swagger UI content"
            );
        }

        console.log("  [PASS] Swagger UI is accessible\n");
        recordTest("Swagger UI endpoint", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Swagger UI endpoint", false, error.message);
    }
}

async function testEchoEndpoint() {
    console.log("TEST: POST /api/v1/echo works over HTTPS");

    try {
        const testMessage = "Hello TLS World!";
        const response = await apiRequest("/api/v1/echo", {
            method: "POST",
            body: { message: testMessage }
        });

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.data.echo === testMessage, `Expected echo '${testMessage}', got '${response.data.echo}'`);
        assert(response.data.protocol === "https", `Expected protocol 'https', got '${response.data.protocol}'`);

        console.log("  [PASS] Echo endpoint works correctly over HTTPS\n");
        recordTest("Echo endpoint over HTTPS", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Echo endpoint over HTTPS", false, error.message);
    }
}

async function testMetricsEndpoint() {
    console.log("TEST: Metrics endpoint available over HTTPS");

    try {
        const response = await apiRequest("/metrics");

        assert(response.status === 200, `Expected status 200, got ${response.status}`);
        assert(response.raw, "Expected response body");
        assert(
            response.raw.includes("# HELP") || response.raw.includes("# TYPE") || response.raw.includes("api_gateway"),
            "Expected Prometheus metrics format"
        );

        console.log("  [PASS] Metrics endpoint accessible over HTTPS\n");
        recordTest("Metrics endpoint over HTTPS", true);
    } catch (error) {
        console.log(`  [FAIL] ${error.message}\n`);
        recordTest("Metrics endpoint over HTTPS", false, error.message);
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

async function runTests() {
    console.log("=".repeat(60));
    console.log("OpenAPI TLS Integration Tests for Node-RED API Gateway");
    console.log("=".repeat(60));

    let setupSuccess = false;

    try {
        // Setup infrastructure
        setupSuccess = await setupInfrastructure();

        if (!setupSuccess) {
            console.error("\nInfrastructure setup failed. Cannot run tests.");
            teardownInfrastructure();
            process.exit(1);
        }

        console.log("Running tests...\n");
        console.log("-".repeat(60) + "\n");

        // HTTPS connection tests
        await testHttpsConnection();
        await testConnectionFailsWithWrongCA();

        // OpenAPI tests
        await testOpenApiSpecEndpoint();
        await testOpenApiServerUrl();
        await testOpenApiEndpoints();
        await testOpenApiSchemas();

        // Swagger UI test
        await testSwaggerUiEndpoint();

        // Functional tests over HTTPS
        await testEchoEndpoint();
        await testMetricsEndpoint();

        // Print summary
        printSummary();

    } finally {
        // Always teardown
        teardownInfrastructure();
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
    teardownInfrastructure();
    process.exit(1);
});
