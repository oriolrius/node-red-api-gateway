#!/usr/bin/env node

/**
 * E2E Tests for Node-RED API Gateway Nodes
 *
 * REQUIREMENTS:
 * - Docker must be installed and running
 * - Docker Compose v2 must be available
 * - No fallbacks - tests fail if Docker is unavailable
 *
 * Exit codes:
 * - 0: All tests passed
 * - 1: Tests failed or Docker unavailable
 */

const { execSync, exec } = require("child_process");
const { promisify } = require("util");
const http = require("http");
const path = require("path");

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    dockerComposeFile: path.join(__dirname, "docker-compose.yml"),
    dockerComposeProfile: "nodered",  // Profile to start Node-RED
    nodeRedUrl: "http://localhost:1880",
    containerName: "api-gateway-nodered",  // Must match container_name in docker-compose.yml
    startupTimeout: 120000,  // 2 minutes max for startup
    healthCheckInterval: 2000,
    maxHealthCheckAttempts: 60,
    testTimeout: 30000,  // 30 seconds per test
    requestTimeout: 10000  // 10 seconds per HTTP request
};

// Test results tracking
const results = {
    passed: 0,
    failed: 0,
    tests: []
};

/**
 * Simple HTTP request helper (no external dependencies)
 */
function httpRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(options.url || `${CONFIG.nodeRedUrl}${options.path || ""}`);

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname + urlObj.search,
            method: options.method || "GET",
            headers: options.headers || {},
            timeout: options.timeout || CONFIG.requestTimeout
        };

        const req = http.request(reqOptions, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    const json = data ? JSON.parse(data) : null;
                    resolve({ status: res.statusCode, data: json, raw: data });
                } catch {
                    resolve({ status: res.statusCode, data: null, raw: data });
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
 * Verify Docker is available - FAIL FAST if not
 */
function verifyDockerAvailable() {
    console.log("🔍 Verifying Docker availability...");

    try {
        // Check Docker is installed
        const dockerVersion = execSync("docker --version", { stdio: "pipe", encoding: "utf8" });
        console.log(`  ✓ Docker installed: ${dockerVersion.trim()}`);

        // Check Docker Compose v2 is available
        const composeVersion = execSync("docker compose version", { stdio: "pipe", encoding: "utf8" });
        console.log(`  ✓ Docker Compose: ${composeVersion.trim()}`);

        // Check Docker daemon is running
        execSync("docker info", { stdio: "pipe" });
        console.log("  ✓ Docker daemon is running");

        console.log("✅ Docker is available and running\n");
        return true;
    } catch (error) {
        console.error("");
        console.error("❌ FATAL: Docker is not available or not running");
        console.error("");
        console.error("E2E tests require Docker. Please ensure:");
        console.error("  1. Docker Engine is installed");
        console.error("  2. Docker daemon is running (try: sudo systemctl start docker)");
        console.error("  3. Docker Compose v2 is available (docker compose version)");
        console.error("  4. Current user has permission to use Docker");
        console.error("     (try: sudo usermod -aG docker $USER, then log out/in)");
        console.error("");
        if (error.message) {
            console.error("Error details:", error.message);
        }
        process.exit(1);
    }
}

/**
 * Execute docker compose command
 */
async function dockerCompose(command, options = {}) {
    const cmd = `docker compose -f "${CONFIG.dockerComposeFile}" --profile ${CONFIG.dockerComposeProfile} ${command}`;

    if (!options.silent) {
        console.log(`  $ ${cmd}`);
    }

    try {
        const { stdout, stderr } = await execAsync(cmd, {
            cwd: path.dirname(CONFIG.dockerComposeFile),
            timeout: options.timeout || 60000,
            encoding: "utf8"
        });

        if (stdout && !options.silent) {
            console.log(stdout.trim());
        }

        return { stdout, stderr };
    } catch (error) {
        if (!options.ignoreError) {
            console.error(`❌ Docker Compose command failed: ${command}`);
            console.error(error.message);
        }
        throw error;
    }
}

/**
 * Get container health status
 */
async function getContainerHealth() {
    try {
        const { stdout } = await execAsync(
            `docker inspect --format="{{.State.Health.Status}}" ${CONFIG.containerName}`,
            { timeout: 5000, encoding: "utf8" }
        );
        return stdout.trim();
    } catch {
        return "not_found";
    }
}

/**
 * Print container logs (for debugging failures)
 */
async function printContainerLogs(tail = 50) {
    console.log("\n📋 Container logs (last " + tail + " lines):");
    console.log("─".repeat(60));

    try {
        await dockerCompose(`logs --tail=${tail}`, { silent: true });
        const { stdout } = await execAsync(
            `docker compose -f "${CONFIG.dockerComposeFile}" logs --tail=${tail}`,
            { encoding: "utf8", timeout: 10000 }
        );
        console.log(stdout || "(no logs available)");
    } catch (error) {
        console.log("(failed to retrieve logs)");
    }

    console.log("─".repeat(60));
}

/**
 * Start all containers - FAIL if any container fails to start
 */
async function startContainers() {
    console.log("📦 Starting Docker containers...");

    // Clean up any existing containers first
    try {
        await dockerCompose("down -v --remove-orphans", { silent: true, ignoreError: true });
    } catch {
        // Ignore cleanup errors
    }

    // Start containers
    await dockerCompose("up -d");

    console.log("\n⏳ Waiting for containers to be healthy...");

    let healthy = false;
    let attempts = 0;
    const startTime = Date.now();

    while (!healthy && attempts < CONFIG.maxHealthCheckAttempts) {
        attempts++;

        // Check if we've exceeded the startup timeout
        if (Date.now() - startTime > CONFIG.startupTimeout) {
            console.error("\n❌ Container startup timeout exceeded");
            await printContainerLogs();
            throw new Error("Containers failed to start within timeout");
        }

        const status = await getContainerHealth();

        if (status === "healthy") {
            healthy = true;
            console.log(`\n✅ Node-RED container is healthy (attempt ${attempts})`);
        } else if (status === "unhealthy") {
            console.error("\n❌ Container became unhealthy");
            await printContainerLogs();
            throw new Error("Container health check failed");
        } else if (status === "not_found") {
            process.stdout.write(`  Waiting for container to start (${attempts}/${CONFIG.maxHealthCheckAttempts})...\r`);
        } else {
            process.stdout.write(`  Health check ${attempts}/${CONFIG.maxHealthCheckAttempts}: ${status}        \r`);
        }

        if (!healthy) {
            await sleep(CONFIG.healthCheckInterval);
        }
    }

    if (!healthy) {
        console.error("\n❌ Container failed to become healthy");
        await printContainerLogs();
        throw new Error("Containers failed to start within timeout");
    }

    // Additional verification: HTTP endpoint is responding
    console.log("\n🔌 Verifying Node-RED API is accessible...");

    let apiReady = false;
    attempts = 0;

    while (!apiReady && attempts < 15) {
        attempts++;
        try {
            const response = await httpRequest({
                path: "/",
                timeout: 3000
            });

            if (response.status === 200) {
                apiReady = true;
                console.log("✅ Node-RED API is responding\n");
            }
        } catch {
            await sleep(2000);
        }
    }

    if (!apiReady) {
        await printContainerLogs();
        throw new Error("Node-RED API not accessible");
    }
}

/**
 * Stop and clean up all containers
 */
async function stopContainers() {
    console.log("\n🛑 Stopping Docker containers...");

    try {
        await dockerCompose("down -v --remove-orphans");
        console.log("✅ Containers stopped and cleaned up\n");
    } catch (error) {
        console.error("⚠️  Failed to stop containers cleanly:", error.message);

        // Force kill if normal stop fails
        try {
            await execAsync(`docker rm -f ${CONFIG.containerName} 2>/dev/null || true`);
        } catch {
            // Ignore
        }
    }
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deploy a flow to Node-RED via Admin API
 */
async function deployFlow(flow) {
    console.log("  📤 Deploying test flow...");

    try {
        // Deploy new flow
        const response = await httpRequest({
            path: "/flows",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Node-RED-Deployment-Type": "full"
            },
            timeout: 15000
        }, flow);

        if (response.status >= 200 && response.status < 300) {
            // Wait for flow to initialize
            await sleep(3000);
            console.log("  ✅ Flow deployed successfully");
            return true;
        } else {
            console.error(`  ❌ Failed to deploy flow: HTTP ${response.status}`);
            console.error("  Response:", response.raw);
            return false;
        }
    } catch (error) {
        console.error("  ❌ Failed to deploy flow:", error.message);
        return false;
    }
}

/**
 * Record test result
 */
function recordTest(name, passed, details = "") {
    results.tests.push({ name, passed, details });
    if (passed) {
        results.passed++;
    } else {
        results.failed++;
    }
}

/**
 * TEST: Node appears in palette (node registration)
 */
async function testNodeInPalette() {
    console.log("\n📝 Test 1: Node Registration in Palette");
    console.log("─".repeat(50));

    try {
        const response = await httpRequest({
            path: "/nodes",
            headers: { "Accept": "application/json" }
        });

        if (response.status !== 200) {
            console.log(`  ❌ Failed to query nodes: HTTP ${response.status}`);
            recordTest("Node Registration", false, `HTTP ${response.status}`);
            return false;
        }

        const nodes = response.data;

        // Check for api-server node
        const apiServerNode = nodes.find(n =>
            n.types && n.types.includes("apigw-server")
        );

        // Check for api-endpoint node
        const apiEndpointNode = nodes.find(n =>
            n.types && n.types.includes("apigw-endpoint")
        );

        let allFound = true;

        if (apiServerNode) {
            console.log("  ✅ api-server node is registered in palette");
        } else {
            console.log("  ❌ api-server node NOT found in palette");
            allFound = false;
        }

        if (apiEndpointNode) {
            console.log("  ✅ api-endpoint node is registered in palette");
        } else {
            console.log("  ❌ api-endpoint node NOT found in palette");
            allFound = false;
        }

        if (!allFound) {
            // List available node types for debugging
            const allTypes = nodes.flatMap(n => n.types || []).slice(0, 20);
            console.log("  Available nodes (first 20):", allTypes.join(", "));
        }

        recordTest("Node Registration", allFound);
        return allFound;
    } catch (error) {
        console.log(`  ❌ Failed to query nodes: ${error.message}`);
        recordTest("Node Registration", false, error.message);
        return false;
    }
}

/**
 * TEST: Basic node functionality via HTTP endpoint
 */
async function testBasicFunctionality() {
    console.log("\n📝 Test 2: Basic Node Functionality");
    console.log("─".repeat(50));

    // Create a test flow with HTTP endpoints to test nodes
    const testFlow = [
        {
            id: "e2e-test-tab",
            type: "tab",
            label: "E2E Test Flow"
        },
        // HTTP endpoint to test api-server node
        {
            id: "http-in-test",
            type: "http in",
            z: "e2e-test-tab",
            name: "Test Endpoint",
            url: "/e2e-test",
            method: "post",
            wires: [["api-server-test"]]
        },
        {
            id: "api-server-test",
            type: "apigw-server",
            z: "e2e-test-tab",
            name: "Test API Server",
            wires: [["http-response-test"]]
        },
        {
            id: "http-response-test",
            type: "http response",
            z: "e2e-test-tab",
            name: "Response",
            statusCode: "200",
            wires: []
        }
    ];

    // Deploy the test flow
    const deployed = await deployFlow(testFlow);
    if (!deployed) {
        recordTest("Basic Functionality", false, "Flow deployment failed");
        return false;
    }

    // Test the HTTP endpoint
    console.log("  📤 Testing via HTTP endpoint...");

    try {
        const response = await httpRequest({
            path: "/e2e-test",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            timeout: CONFIG.testTimeout
        }, { payload: "TEST MESSAGE" });

        if (response.status === 200) {
            console.log("  ✅ HTTP endpoint responded successfully");
            recordTest("Basic Functionality", true);
            return true;
        } else {
            console.log(`  ❌ Unexpected response status: ${response.status}`);
            recordTest("Basic Functionality", false, `HTTP ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`  ❌ HTTP request failed: ${error.message}`);
        recordTest("Basic Functionality", false, error.message);
        return false;
    }
}

/**
 * TEST: Multiple message processing
 */
async function testMultipleMessages() {
    console.log("\n📝 Test 3: Multiple Message Processing");
    console.log("─".repeat(50));

    const messageCount = 5;
    let successCount = 0;

    console.log(`  📤 Sending ${messageCount} messages...`);

    for (let i = 0; i < messageCount; i++) {
        try {
            const response = await httpRequest({
                path: "/e2e-test",
                method: "POST",
                headers: { "Content-Type": "application/json" },
                timeout: 5000
            }, { payload: `MESSAGE ${i + 1}` });

            if (response.status === 200) {
                successCount++;
            }
        } catch {
            // Continue with other messages
        }

        // Small delay between messages
        await sleep(100);
    }

    console.log(`  📨 Received responses: ${successCount}/${messageCount}`);

    if (successCount === messageCount) {
        console.log("  ✅ All messages processed successfully");
        recordTest("Multiple Messages", true);
        return true;
    } else if (successCount > 0) {
        console.log(`  ⚠️  Only ${successCount}/${messageCount} messages succeeded`);
        recordTest("Multiple Messages", false, `${successCount}/${messageCount} succeeded`);
        return false;
    } else {
        console.log("  ❌ No messages were processed");
        recordTest("Multiple Messages", false, "No messages processed");
        return false;
    }
}

/**
 * TEST: Flow deployment and persistence
 */
async function testFlowDeployment() {
    console.log("\n📝 Test 4: Flow Deployment");
    console.log("─".repeat(50));

    // Get current flows
    try {
        const response = await httpRequest({
            path: "/flows",
            headers: { "Accept": "application/json" }
        });

        if (response.status === 200 && Array.isArray(response.data)) {
            console.log(`  ✅ Retrieved flows: ${response.data.length} nodes`);
            recordTest("Flow Deployment", true);
            return true;
        } else {
            console.log(`  ❌ Failed to retrieve flows: HTTP ${response.status}`);
            recordTest("Flow Deployment", false, `HTTP ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`  ❌ Flow retrieval failed: ${error.message}`);
        recordTest("Flow Deployment", false, error.message);
        return false;
    }
}

/**
 * Print test summary
 */
function printSummary() {
    console.log("\n" + "═".repeat(60));
    console.log("📊 Test Summary");
    console.log("═".repeat(60));

    for (const test of results.tests) {
        const icon = test.passed ? "✅" : "❌";
        const details = test.details ? ` (${test.details})` : "";
        console.log(`  ${icon} ${test.name}${details}`);
    }

    console.log("─".repeat(60));
    console.log(`  Total: ${results.passed + results.failed} tests`);
    console.log(`  Passed: ${results.passed}`);
    console.log(`  Failed: ${results.failed}`);
    console.log("═".repeat(60));
}

/**
 * Main test runner
 */
async function runTests() {
    console.log("🚀 Starting E2E Tests for Node-RED API Gateway");
    console.log("═".repeat(60) + "\n");

    // STEP 1: Verify Docker is available (FAIL FAST)
    verifyDockerAvailable();

    try {
        // STEP 2: Start containers (FAIL if Docker issues)
        await startContainers();

        // STEP 3: Run tests
        await testNodeInPalette();
        await testBasicFunctionality();
        await testMultipleMessages();
        await testFlowDeployment();

    } catch (error) {
        console.error("\n❌ FATAL: Test execution failed");
        console.error("Error:", error.message);
        console.error("");
        console.error("Ensure Docker is running and try again.");

        // Attempt cleanup before exit
        try {
            await stopContainers();
        } catch {
            // Ignore cleanup errors
        }

        process.exit(1);
    } finally {
        // STEP 4: Cleanup
        await stopContainers();
    }

    // STEP 5: Report results
    printSummary();

    if (results.failed === 0) {
        console.log("\n🎉 All E2E tests passed!\n");
        process.exit(0);
    } else {
        console.log("\n❌ Some E2E tests failed\n");
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error("❌ Unhandled error:", error);
    process.exit(1);
});
