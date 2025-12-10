---
id: doc-002
title: 'doc-002 - Testing Approaches: node-red-node-test-helper vs Real Node-RED Environment'
type: other
created_date: '2025-12-03 10:32'
updated_date: '2025-12-03 10:46'
---

# Testing Approaches: node-red-node-test-helper vs Real Node-RED Environment

## Overview

This document explains the difference between the current test setup using `node-red-node-test-helper` and testing in a real-world Node-RED environment. It incorporates learnings from two reference projects:

- **nodred4testing**: A standalone Node-RED launcher for testing
- **node-red-contrib-kafka**: A production Node-RED node with comprehensive testing



## What We Have: node-red-node-test-helper

### How It Works

The `node-red-node-test-helper` is the official testing library for Node-RED nodes. Our current test (`test/lower-case_spec.js`) uses this approach:

```javascript
const helper = require("node-red-node-test-helper");
const lowerCaseNode = require("../nodes/lower-case.js");

helper.init(require.resolve("node-red"));

describe("lower-case Node", function () {
    beforeEach(function (done) {
        helper.startServer(done);  // Starts a minimal Node-RED runtime
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);   // Stops the runtime
    });

    it("should convert payload to lower case", function (done) {
        const flow = [
            { id: "n1", type: "lower-case", wires: [["n2"]] },
            { id: "n2", type: "helper" }  // Special test node to capture output
        ];
        helper.load(lowerCaseNode, flow, function () {
            const n1 = helper.getNode("n1");
            const n2 = helper.getNode("n2");
            n2.on("input", function (msg) {
                msg.should.have.property("payload", "hello world");
                done();
            });
            n1.receive({ payload: "HELLO WORLD" });  // Programmatic message injection
        });
    });
});
```

### What This Test Does

1. **Starts a minimal Node-RED runtime** - NOT a full Node-RED instance
2. **Loads only our node** - No other nodes, no editor UI
3. **Creates an in-memory flow** - Defined as JSON, not deployed via UI
4. **Uses a "helper" node** - A special test node that captures messages
5. **Programmatically sends messages** - Via `node.receive()`, not through inject nodes or external triggers
6. **Runs in ~50ms** - Very fast, no network, no containers

### What It Tests

- Node registration with Node-RED runtime
- Message input/output handling
- Node configuration properties
- Error handling in the `input` event
- Basic lifecycle (load/unload)

### What It Does NOT Test

| Aspect | Tested? | Why Not |
|--------|---------|---------|
| Editor UI (HTML dialog) | No | No browser, no editor loaded |
| Node appearance in palette | No | No palette rendered |
| Help text rendering | No | No help panel |
| Real HTTP endpoints | No | Minimal runtime, no express routes |
| Interaction with other real nodes | No | Only loads our node + helper |
| Deploy/restart behavior | No | No deploy mechanism |
| Context storage (file/memory) | Partial | Uses mocked context |
| Credentials encryption | Partial | Simplified handling |
| Performance under load | No | Single message tests |
| Real external dependencies | No | No actual connections |

---

## What We Want: Real-World Testing

### Definition

Real-world testing means running our node in a **full Node-RED instance** where:

1. **Full Node-RED runtime** is running (with all built-in nodes)
2. **Editor UI** is accessible in a browser
3. **Flows can be deployed** through the UI or Admin API
4. **Real inject/debug nodes** can be used
5. **External dependencies** (databases, APIs, MQTT brokers) are available
6. **Multiple instances** can test concurrency/clustering

---

## Real-World Testing Approaches (From Reference Projects)

### Testing Pyramid

```
        /\
       /E2E\        <- Few: Full Node-RED + browser + external services
      /------\
     /Integr- \     <- Some: Node-RED runtime + Docker dependencies
    /  ation   \
   /------------\
  /  Mock RED    \  <- More: testcontainers + mock RED framework
 /----------------\
/      Unit        \ <- Many: node-red-node-test-helper (what we have)
\__________________/
```

---

### Approach 1: Standalone Node-RED Launcher (nodred4testing pattern)

A lightweight script that starts a real Node-RED instance programmatically:

```javascript
// launch.js - Standalone Node-RED launcher for testing
const http = require('http');
const express = require('express');
const RED = require('node-red');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Create temporary directory for test data
const tempDir = path.join('./', 'tmp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Node-RED settings optimized for testing
const settings = {
    flowFile: 'flows.json',
    flowFilePretty: true,
    userDir: tempDir,
    uiPort: process.env.PORT || 1880,
    httpAdminRoot: '/',
    httpNodeRoot: '/api',
    
    // CORS for API testing
    httpAdminCors: { origin: "*", credentials: true },
    httpNodeCors: { origin: "*", methods: "GET,PUT,POST,DELETE" },
    
    // Disable authentication for testing
    // adminAuth: false,
    
    // Minimal logging
    logging: {
        console: { level: "info", metrics: false, audit: false }
    },
    
    // Editor configuration
    editorTheme: {
        tours: false,
        projects: { enabled: false }
    }
};

// Initialize and start
RED.init(server, settings);
app.use(settings.httpAdminRoot, RED.httpAdmin);
app.use(settings.httpNodeRoot, RED.httpNode);

server.listen(1880, async () => {
    await RED.start();
    console.log('Node-RED started at http://localhost:1880');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    await RED.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.exit(0);
});
```

**Use cases:**
- Manual testing during development
- Browser-based E2E testing with Playwright
- Quick validation of node behavior in real runtime

---

### Approach 2: Mock RED Framework with Testcontainers (node-red-contrib-kafka pattern)

For nodes that require external services (Kafka, databases, APIs), use testcontainers with a mock RED framework:

```javascript
// tests/basic-integration-test.js
const { GenericContainer } = require('testcontainers');

// Mock Node-RED environment (simulates RED object)
const mockRED = {
    nodes: {
        createNode: function(node, config) {
            node.config = config;
            node.status = function(status) {
                console.log('[STATUS]', JSON.stringify(status));
            };
            node.debug = console.log;
            node.error = console.error;
            node.warn = console.warn;
            node.send = function(msg) {
                console.log('[SEND]', JSON.stringify(msg));
            };
            node.on = function(event, callback) {
                if (event === 'input') node._inputCallback = callback;
                if (event === 'close') node._closeCallback = callback;
            };
        },
        getNode: function(id) {
            return mockNodes[id];
        },
        registerType: function(type, constructor) {
            console.log(`Node registered: ${type}`);
        }
    }
};

async function runIntegrationTest() {
    // Start dependency container (e.g., database, message broker)
    const container = await new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .start();
    
    const host = container.getHost();
    const port = container.getMappedPort(6379);
    
    try {
        // Load the node module with mock RED
        const MyNode = require('../nodes/my-node.js')(mockRED);
        
        // Create node instance
        const nodeConfig = {
            name: 'Test Node',
            host: host,
            port: port
        };
        
        const testNode = {};
        mockRED.nodes.createNode(testNode, nodeConfig);
        new MyNode(nodeConfig).call(testNode);
        
        // Wait for initialization
        await new Promise(r => setTimeout(r, 2000));
        
        // Test message handling
        if (testNode._inputCallback) {
            testNode._inputCallback({ payload: 'test data' });
        }
        
        // Wait and verify
        await new Promise(r => setTimeout(r, 1000));
        
        console.log('✅ Integration test passed!');
    } finally {
        await container.stop();
    }
}
```

**Use cases:**
- Testing node logic with real external services
- Faster than full E2E (no Node-RED runtime overhead)
- Isolated, reproducible tests

---

### Approach 3: Docker Compose E2E Testing (Strict Docker Requirement)

**IMPORTANT: Docker is a hard requirement for E2E tests. If Docker is not available or fails, tests MUST fail.**

This approach uses Docker Compose to run Node-RED and all dependencies in containers. The test script starts Node-RED programmatically and connects to Docker-based dependencies.

#### Prerequisites

- Docker Engine installed and running
- Docker Compose v2 installed
- No fallback - tests fail if Docker is unavailable

#### tests/e2e/docker-compose.yml

```yaml
services:
  node-red:
    image: nodered/node-red:latest
    container_name: node-red-e2e-test
    ports:
      - "1880:1880"
    volumes:
      # Mount the node package for testing
      - ../../:/data/node_modules/@user/node-red-api-gateway:ro
      # Mount Node-RED user directory
      - ./.nodered:/data
    environment:
      - NODE_RED_ENABLE_SAFE_MODE=false
      - TZ=UTC
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:1880/ || exit 1"]
      interval: 5s
      timeout: 10s
      retries: 12
      start_period: 30s
    restart: "no"

  # Example: Add external dependencies as needed
  # redis:
  #   image: redis:7-alpine
  #   container_name: redis-e2e-test
  #   ports:
  #     - "6379:6379"
  #   healthcheck:
  #     test: ["CMD", "redis-cli", "ping"]
  #     interval: 2s
  #     timeout: 2s
  #     retries: 5
```

#### tests/e2e/run-e2e-tests.js

```javascript
#!/usr/bin/env node

/**
 * E2E Tests for Node-RED Nodes
 * 
 * REQUIREMENTS:
 * - Docker must be installed and running
 * - Docker Compose v2 must be available
 * - No fallbacks - tests fail if Docker is unavailable
 */

const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const path = require('path');
const axios = require('axios');

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    dockerComposeFile: path.join(__dirname, 'docker-compose.yml'),
    nodeRedUrl: 'http://localhost:1880',
    startupTimeout: 120000,  // 2 minutes max for startup
    healthCheckInterval: 2000,
    maxHealthCheckAttempts: 60
};

/**
 * Verify Docker is available - FAIL FAST if not
 */
function verifyDockerAvailable() {
    console.log('🔍 Verifying Docker availability...');
    
    try {
        execSync('docker --version', { stdio: 'pipe' });
        execSync('docker compose version', { stdio: 'pipe' });
        execSync('docker info', { stdio: 'pipe' });
        console.log('✅ Docker is available and running\n');
    } catch (error) {
        console.error('❌ FATAL: Docker is not available or not running');
        console.error('');
        console.error('E2E tests require Docker. Please ensure:');
        console.error('  1. Docker Engine is installed');
        console.error('  2. Docker daemon is running');
        console.error('  3. Docker Compose v2 is available');
        console.error('  4. Current user has permission to use Docker');
        console.error('');
        console.error('Error details:', error.message);
        process.exit(1);
    }
}

/**
 * Execute docker compose command
 */
async function dockerCompose(command) {
    const cmd = `docker compose -f "${CONFIG.dockerComposeFile}" ${command}`;
    console.log(`  $ ${cmd}`);
    
    try {
        const { stdout, stderr } = await execAsync(cmd, {
            cwd: path.dirname(CONFIG.dockerComposeFile),
            timeout: 60000
        });
        if (stdout) console.log(stdout.trim());
        return { stdout, stderr };
    } catch (error) {
        console.error(`❌ Docker Compose command failed: ${command}`);
        console.error(error.message);
        throw error;
    }
}

/**
 * Start all containers - FAIL if any container fails to start
 */
async function startContainers() {
    console.log('📦 Starting Docker containers...');
    
    // Clean up any existing containers first
    try {
        await dockerCompose('down -v --remove-orphans');
    } catch (e) {
        // Ignore cleanup errors
    }
    
    // Start containers
    await dockerCompose('up -d');
    
    console.log('\n⏳ Waiting for containers to be healthy...');
    
    let healthy = false;
    let attempts = 0;
    
    while (!healthy && attempts < CONFIG.maxHealthCheckAttempts) {
        attempts++;
        
        try {
            // Check container health status
            const { stdout } = await execAsync(
                'docker inspect --format="{{.State.Health.Status}}" node-red-e2e-test',
                { timeout: 5000 }
            );
            
            const status = stdout.trim();
            
            if (status === 'healthy') {
                healthy = true;
                console.log(`✅ Node-RED container is healthy (attempt ${attempts})`);
            } else if (status === 'unhealthy') {
                throw new Error('Container became unhealthy');
            } else {
                process.stdout.write(`  Health check ${attempts}/${CONFIG.maxHealthCheckAttempts}: ${status}\r`);
            }
        } catch (error) {
            if (error.message.includes('unhealthy')) {
                throw error;
            }
            // Container might not exist yet or health check not started
        }
        
        if (!healthy) {
            await new Promise(r => setTimeout(r, CONFIG.healthCheckInterval));
        }
    }
    
    if (!healthy) {
        // Get container logs for debugging
        console.error('\n❌ Container failed to become healthy');
        console.error('\n📋 Container logs:');
        try {
            await dockerCompose('logs --tail=50');
        } catch (e) {
            // Ignore log errors
        }
        throw new Error('Containers failed to start within timeout');
    }
    
    // Additional verification: HTTP endpoint is responding
    console.log('\n🔌 Verifying Node-RED API is accessible...');
    
    let apiReady = false;
    attempts = 0;
    
    while (!apiReady && attempts < 15) {
        attempts++;
        try {
            const response = await axios.get(CONFIG.nodeRedUrl, { timeout: 3000 });
            if (response.status === 200) {
                apiReady = true;
                console.log('✅ Node-RED API is responding\n');
            }
        } catch (error) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    
    if (!apiReady) {
        throw new Error('Node-RED API not accessible');
    }
}

/**
 * Stop and clean up all containers
 */
async function stopContainers() {
    console.log('\n🛑 Stopping Docker containers...');
    
    try {
        await dockerCompose('down -v --remove-orphans');
        console.log('✅ Containers stopped and cleaned up\n');
    } catch (error) {
        console.error('⚠️  Failed to stop containers cleanly:', error.message);
        // Force kill if normal stop fails
        try {
            await execAsync('docker rm -f node-red-e2e-test 2>/dev/null || true');
        } catch (e) {
            // Ignore
        }
    }
}

/**
 * Deploy a flow to Node-RED via Admin API
 */
async function deployFlow(flow) {
    console.log('  📤 Deploying test flow...');
    
    try {
        // Get current flows
        const currentFlows = await axios.get(`${CONFIG.nodeRedUrl}/flows`, {
            headers: { 'Accept': 'application/json' }
        });
        
        // Deploy new flow
        const response = await axios.post(`${CONFIG.nodeRedUrl}/flows`, flow, {
            headers: {
                'Content-Type': 'application/json',
                'Node-RED-Deployment-Type': 'full'
            }
        });
        
        // Wait for flow to initialize
        await new Promise(r => setTimeout(r, 3000));
        
        console.log('  ✅ Flow deployed successfully');
        return response.data;
    } catch (error) {
        console.error('  ❌ Failed to deploy flow:', error.message);
        throw error;
    }
}

/**
 * Inject a message into a node via Admin API
 */
async function injectMessage(nodeId, payload) {
    try {
        await axios.post(`${CONFIG.nodeRedUrl}/inject/${nodeId}`, {
            __user_inject_props__: payload
        });
    } catch (error) {
        // Inject endpoint may not exist, that's okay
    }
}

/**
 * TEST: Basic node functionality
 */
async function testBasicFunctionality() {
    console.log('📝 Test 1: Basic Node Functionality');
    console.log('--------------------------------------------------');
    
    // Create a test flow that uses our node
    const testFlow = [
        {
            id: "test-tab",
            type: "tab",
            label: "E2E Test Flow"
        },
        {
            id: "inject-1",
            type: "inject",
            z: "test-tab",
            name: "Test Input",
            props: [{ p: "payload" }],
            payload: "HELLO WORLD",
            payloadType: "str",
            repeat: "",
            once: false,
            wires: [["lower-case-1"]]
        },
        {
            id: "lower-case-1",
            type: "lower-case",
            z: "test-tab",
            name: "Test Lower Case",
            wires: [["http-response-1"]]
        },
        {
            id: "http-in-1",
            type: "http in",
            z: "test-tab",
            name: "Test Endpoint",
            url: "/test-lower-case",
            method: "post",
            wires: [["lower-case-2"]]
        },
        {
            id: "lower-case-2",
            type: "lower-case",
            z: "test-tab",
            name: "HTTP Lower Case",
            wires: [["http-response-1"]]
        },
        {
            id: "http-response-1",
            type: "http response",
            z: "test-tab",
            name: "Response",
            statusCode: "200",
            wires: []
        }
    ];
    
    await deployFlow(testFlow);
    
    // Test via HTTP endpoint
    console.log('  📤 Testing via HTTP endpoint...');
    
    try {
        const response = await axios.post(
            `${CONFIG.nodeRedUrl}/test-lower-case`,
            { payload: "TEST MESSAGE" },
            { 
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            }
        );
        
        if (response.status === 200) {
            console.log('  ✅ HTTP endpoint responded successfully');
            return true;
        } else {
            console.log(`  ❌ Unexpected response status: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`  ❌ HTTP request failed: ${error.message}`);
        return false;
    }
}

/**
 * TEST: Node appears in palette
 */
async function testNodeInPalette() {
    console.log('\n📝 Test 2: Node Registration');
    console.log('--------------------------------------------------');
    
    try {
        const response = await axios.get(`${CONFIG.nodeRedUrl}/nodes`, {
            headers: { 'Accept': 'application/json' }
        });
        
        const nodes = response.data;
        const lowerCaseNode = nodes.find(n => 
            n.types && n.types.includes('lower-case')
        );
        
        if (lowerCaseNode) {
            console.log('  ✅ lower-case node is registered in palette');
            return true;
        } else {
            console.log('  ❌ lower-case node not found in palette');
            console.log('  Available nodes:', nodes.map(n => n.types).flat().slice(0, 10).join(', '), '...');
            return false;
        }
    } catch (error) {
        console.log(`  ❌ Failed to query nodes: ${error.message}`);
        return false;
    }
}

/**
 * TEST: Multiple messages
 */
async function testMultipleMessages() {
    console.log('\n📝 Test 3: Multiple Message Processing');
    console.log('--------------------------------------------------');
    
    const messageCount = 5;
    let successCount = 0;
    
    console.log(`  📤 Sending ${messageCount} messages...`);
    
    for (let i = 0; i < messageCount; i++) {
        try {
            const response = await axios.post(
                `${CONFIG.nodeRedUrl}/test-lower-case`,
                { payload: `MESSAGE ${i}` },
                { timeout: 5000 }
            );
            
            if (response.status === 200) {
                successCount++;
            }
        } catch (error) {
            // Continue with other messages
        }
        
        // Small delay between messages
        await new Promise(r => setTimeout(r, 100));
    }
    
    console.log(`  📨 Received responses: ${successCount}/${messageCount}`);
    
    if (successCount === messageCount) {
        console.log('  ✅ All messages processed successfully');
        return true;
    } else {
        console.log(`  ❌ Only ${successCount}/${messageCount} messages succeeded`);
        return false;
    }
}

/**
 * Main test runner
 */
async function runTests() {
    console.log('🚀 Starting E2E Tests');
    console.log('==================================================\n');
    
    // STEP 1: Verify Docker is available (FAIL FAST)
    verifyDockerAvailable();
    
    let passed = 0;
    let total = 0;
    
    try {
        // STEP 2: Start containers (FAIL if Docker issues)
        await startContainers();
        
        // STEP 3: Run tests
        total++;
        if (await testBasicFunctionality()) passed++;
        
        total++;
        if (await testNodeInPalette()) passed++;
        
        total++;
        if (await testMultipleMessages()) passed++;
        
    } catch (error) {
        console.error('\n❌ FATAL: Test execution failed');
        console.error('Error:', error.message);
        console.error('');
        console.error('Ensure Docker is running and try again.');
        
        // Attempt cleanup before exit
        try {
            await stopContainers();
        } catch (e) {
            // Ignore cleanup errors
        }
        
        process.exit(1);
    } finally {
        // STEP 4: Cleanup
        await stopContainers();
    }
    
    // STEP 5: Report results
    console.log('📊 Test Summary');
    console.log('==================================================');
    console.log(`Tests passed: ${passed}/${total}`);
    console.log('');
    
    if (passed === total) {
        console.log('🎉 All E2E tests passed!');
        process.exit(0);
    } else {
        console.log('❌ Some E2E tests failed');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
});
```

#### tests/e2e/.nodered/settings.js

```javascript
// Minimal Node-RED settings for E2E testing
module.exports = {
    flowFile: 'flows.json',
    flowFilePretty: true,
    
    // Disable authentication
    adminAuth: null,
    
    // Disable projects
    editorTheme: {
        projects: { enabled: false },
        tours: false
    },
    
    // Logging
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false
        }
    },
    
    // Function node config
    functionGlobalContext: {},
    functionExternalModules: false
};
```

#### tests/e2e/.nodered/package.json

```json
{
    "name": "node-red-e2e-test-config",
    "description": "Node-RED E2E test configuration",
    "version": "1.0.0",
    "private": true,
    "dependencies": {}
}
```

**Key design principles:**

1. **Docker is mandatory** - `verifyDockerAvailable()` runs first and fails immediately if Docker is unavailable
2. **No fallbacks** - All container failures result in test failure
3. **Strict health checks** - Containers must pass health checks before tests run
4. **Clean failure modes** - Clear error messages when Docker fails
5. **Proper cleanup** - Containers are always stopped, even on failure

**Use cases:**
- CI/CD pipeline testing (Docker required in CI environment)
- Pre-release validation
- Full integration testing with external dependencies

---

### Approach 4: Simple Direct Library Testing

For nodes that wrap external libraries, test the library integration directly (faster than full Node-RED):

```javascript
// tests/e2e/simple-test.js
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);

// Verify Docker first - FAIL FAST
function verifyDocker() {
    try {
        require('child_process').execSync('docker info', { stdio: 'pipe' });
    } catch (error) {
        console.error('❌ FATAL: Docker is required but not available');
        process.exit(1);
    }
}

async function dockerCompose(command) {
    const cwd = path.join(__dirname);
    return execAsync(`docker compose ${command}`, { cwd });
}

async function testDirectIntegration() {
    console.log('📝 Testing direct library integration');
    
    // Test the underlying library our node uses
    // This validates the integration without Node-RED overhead
    
    const myLibrary = require('my-library');
    const client = new myLibrary.Client({ host: 'localhost', port: 58092 });
    
    await client.connect();
    console.log('  ✅ Client connected');
    
    await client.send({ data: 'test' });
    console.log('  ✅ Message sent');
    
    const result = await client.receive();
    console.log(`  ✅ Message received: ${result.data}`);
    
    await client.disconnect();
    return true;
}

async function runTests() {
    // FAIL FAST if Docker not available
    verifyDocker();
    
    try {
        await dockerCompose('up -d');
        await new Promise(r => setTimeout(r, 5000)); // Wait for services
        
        if (await testDirectIntegration()) {
            console.log('🎉 All tests passed!');
            process.exit(0);
        } else {
            console.log('❌ Tests failed');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ FATAL:', error.message);
        process.exit(1);
    } finally {
        await dockerCompose('down -v');
    }
}

runTests();
```

**Advantages:**
- Faster execution (~45 seconds vs 2+ minutes)
- More reliable (no Node-RED runtime complexity)
- Direct library testing
- Better error reporting

---

## Comparison Table

| Aspect | node-red-node-test-helper | Mock RED + Testcontainers | Docker E2E | Standalone Launcher |
|--------|---------------------------|---------------------------|------------|---------------------|
| **Speed** | ~50ms | ~10-30s | ~60s+ | Manual |
| **Isolation** | Excellent | Good | Moderate | None |
| **Real runtime** | Partial | No | Yes | Yes |
| **Editor UI** | No | No | Optional | Yes |
| **External deps** | No | Yes (containers) | Yes | Yes |
| **CI/CD friendly** | Yes | Yes | Yes | No |
| **Debugging** | Easy | Moderate | Hard | Easy |
| **Setup complexity** | Low | Medium | Medium | Low |
| **Docker required** | No | Yes | **Yes (strict)** | No |

---

## Recommended Test Strategy

### For This Project

1. **Keep unit tests** (node-red-node-test-helper) - `npm test`
   - Fast feedback during development
   - Test node logic in isolation
   - Run on every commit

2. **Add mock RED integration tests** - `npm run test:integration`
   - Test with testcontainers for external dependencies
   - Mock RED framework for node instantiation
   - Run on PR merge

3. **Add Docker E2E tests** - `npm run test:e2e`
   - Full Node-RED runtime in Docker
   - Real flow deployment and execution
   - **Fails immediately if Docker unavailable**
   - Run before releases

4. **Use standalone launcher for development** - `npm run dev:nodered`
   - Manual testing with browser
   - Quick validation of editor UI

### Suggested package.json Scripts

```json
{
    "scripts": {
        "test": "mocha \"test/**/*_spec.js\" --exit",
        "test:watch": "mocha \"test/**/*_spec.js\" --watch",
        "test:integration": "node tests/integration/run-tests.js",
        "test:e2e": "node tests/e2e/run-e2e-tests.js",
        "test:e2e:simple": "node tests/e2e/simple-test.js",
        "dev:nodered": "node tests/launcher/launch.js",
        "docker:test:up": "docker compose -f tests/e2e/docker-compose.yml up -d",
        "docker:test:down": "docker compose -f tests/e2e/docker-compose.yml down -v"
    }
}
```

### Suggested Directory Structure

```
project/
├── nodes/
│   ├── lower-case.js
│   └── lower-case.html
├── test/                          # Unit tests (node-red-node-test-helper)
│   └── lower-case_spec.js
├── tests/
│   ├── integration/               # Mock RED + testcontainers
│   │   ├── helpers/
│   │   │   └── mock-red.js
│   │   └── my-node.integration.test.js
│   ├── e2e/                       # Full E2E tests (Docker required)
│   │   ├── docker-compose.yml
│   │   ├── .nodered/
│   │   │   ├── settings.js
│   │   │   └── package.json
│   │   ├── flows/                 # Test flow fixtures
│   │   ├── run-e2e-tests.js
│   │   └── simple-test.js
│   └── launcher/                  # Standalone launcher
│       └── launch.js
├── examples/
├── package.json
└── README.md
```

---

## Implementation Priority

1. **High**: Docker-based E2E testing (strict Docker requirement)
2. **Medium**: Mock RED framework for integration tests
3. **Medium**: Standalone launcher for development
4. **Low**: Playwright browser tests for editor UI

---

## Next Steps

To implement real-world testing, create a new task with:

1. Create `tests/launcher/launch.js` based on nodred4testing pattern
2. Create `tests/e2e/docker-compose.yml` with Node-RED container
3. Create `tests/e2e/run-e2e-tests.js` with strict Docker verification
4. Create `tests/e2e/.nodered/` configuration directory
5. Create `tests/integration/helpers/mock-red.js` for mock framework
6. Update `package.json` with new test scripts
7. (Optional) Add Playwright for browser testing
