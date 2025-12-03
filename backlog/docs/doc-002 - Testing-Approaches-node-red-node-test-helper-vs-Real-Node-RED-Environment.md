---
id: doc-002
title: 'Testing Approaches: node-red-node-test-helper vs Real Node-RED Environment'
type: other
created_date: '2025-12-03 10:32'
updated_date: '2025-12-03 10:39'
---
# Testing Approaches: node-red-node-test-helper vs Real Node-RED Environment

## Overview

This document explains the difference between the current test setup using `node-red-node-test-helper` and testing in a real-world Node-RED environment. It incorporates learnings from two reference projects:

- **nodred4testing**: A standalone Node-RED launcher for testing
- **node-red-contrib-kafka**: A production Node-RED node with comprehensive testing

---

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

### Approach 3: Docker Compose E2E Testing (node-red-contrib-kafka pattern)

For comprehensive E2E testing with full Node-RED runtime:

#### docker-compose.test.yml

```yaml
services:
  node-red:
    image: nodered/node-red:latest
    container_name: node-red-e2e-test
    ports:
      - "1880:1880"
    volumes:
      # Mount the node package
      - ./:/data/node_modules/@user/node-red-api-gateway
      # Mount test flows
      - ./tests/e2e/flows:/data/flows
    environment:
      - NODE_RED_ENABLE_SAFE_MODE=false
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:1880/"]
      interval: 5s
      timeout: 3s
      retries: 10

  # Add external dependencies as needed
  # redis:
  #   image: redis:7-alpine
  #   ports:
  #     - "6379:6379"
```

#### tests/e2e/run-e2e-tests.js

```javascript
#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const RED = require('node-red');
const path = require('path');

const execAsync = promisify(exec);

let server;

// Docker Compose helpers
async function dockerCompose(command) {
    const cwd = path.join(__dirname);
    return execAsync(`docker compose ${command}`, { cwd });
}

// Start dependencies
async function startDependencies() {
    console.log('📦 Starting containers...');
    await dockerCompose('down -v');
    await dockerCompose('up -d');
    
    // Wait for health checks
    let ready = false;
    let attempts = 0;
    while (!ready && attempts < 30) {
        try {
            const { stdout } = await execAsync('docker inspect --format="{{.State.Health.Status}}" node-red-e2e-test');
            if (stdout.trim() === 'healthy') {
                ready = true;
            }
        } catch (e) {
            attempts++;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    
    if (!ready) throw new Error('Containers failed to start');
    console.log('✅ Containers ready!\n');
}

// Start Node-RED programmatically (alternative to Docker)
async function startNodeRED() {
    console.log('🔴 Starting Node-RED runtime...');
    
    return new Promise((resolve, reject) => {
        server = http.createServer();
        
        const settings = {
            httpAdminRoot: false,
            httpNodeRoot: false,
            userDir: path.join(__dirname, '.nodered'),
            nodesDir: path.join(__dirname, '../../nodes'),
            logging: { console: { level: 'error' } }
        };
        
        RED.init(server, settings);
        
        server.listen(0, () => {
            RED.start().then(() => {
                console.log('✅ Node-RED runtime started\n');
                resolve();
            }).catch(reject);
        });
    });
}

// Deploy a flow programmatically
async function deployFlow(flow) {
    await RED.nodes.loadFlows(flow);
    await new Promise(r => setTimeout(r, 2000)); // Wait for initialization
}

// Test: Basic functionality
async function testBasicFunctionality() {
    console.log('📝 Test 1: Basic Message Processing');
    console.log('--------------------------------------------------');
    
    const flow = [
        {
            id: 'node-1',
            type: 'lower-case',
            name: 'Test Node',
            wires: [['output-1']]
        },
        {
            id: 'output-1',
            type: 'function',
            func: `
                global.set('test_result', msg.payload);
                return msg;
            `,
            wires: []
        }
    ];
    
    await deployFlow(flow);
    
    // Get node and send message
    const node = RED.nodes.getNode('node-1');
    if (!node) throw new Error('Node not found');
    
    console.log('  📤 Sending test message...');
    node.receive({ payload: 'HELLO WORLD' });
    
    // Wait for processing
    await new Promise(r => setTimeout(r, 1000));
    
    // Verify result via global context
    const result = RED.settings.functionGlobalContext.test_result;
    
    if (result === 'hello world') {
        console.log('  ✅ Message processed correctly!');
        return true;
    } else {
        console.log(`  ❌ Expected "hello world", got "${result}"`);
        return false;
    }
}

// Cleanup
async function cleanup() {
    console.log('\n🛑 Cleaning up...');
    if (RED) await RED.stop();
    if (server) server.close();
    await dockerCompose('down -v');
    console.log('✅ Cleanup complete\n');
}

// Main test runner
async function runTests() {
    let passed = 0;
    let total = 0;
    
    try {
        await startDependencies();
        await startNodeRED();
        
        total++;
        if (await testBasicFunctionality()) passed++;
        
        // Add more tests here...
        
    } catch (error) {
        console.error('\n❌ Test execution failed:', error.message);
    } finally {
        await cleanup();
    }
    
    console.log('📊 Test Summary');
    console.log('==================================================');
    console.log(`Tests passed: ${passed}/${total}`);
    
    process.exit(passed === total ? 0 : 1);
}

runTests();
```

**Use cases:**
- Full integration testing with all dependencies
- CI/CD pipeline testing
- Regression testing before releases

---

### Approach 4: Simple KafkaJS-style Direct Testing

For nodes that wrap external libraries, test the library integration directly (faster than full Node-RED):

```javascript
// tests/e2e/simple-test.js
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);

async function dockerCompose(command) {
    return execAsync(`docker compose ${command}`, { cwd: __dirname });
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
    try {
        await dockerCompose('up -d');
        await new Promise(r => setTimeout(r, 5000)); // Wait for services
        
        if (await testDirectIntegration()) {
            console.log('🎉 All tests passed!');
        }
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
│   ├── e2e/                       # Full E2E tests
│   │   ├── docker-compose.yml
│   │   ├── .nodered/              # Node-RED test config
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

1. **High**: Docker-based E2E testing with programmatic Node-RED
2. **Medium**: Mock RED framework for integration tests
3. **Medium**: Standalone launcher for development
4. **Low**: Playwright browser tests for editor UI

---

## Next Steps

To implement real-world testing, create a new task with:

1. Create `tests/launcher/launch.js` based on nodred4testing pattern
2. Create `tests/e2e/docker-compose.yml` for dependencies
3. Create `tests/e2e/run-e2e-tests.js` with programmatic Node-RED
4. Create `tests/integration/helpers/mock-red.js` for mock framework
5. Update `package.json` with new test scripts
6. (Optional) Add Playwright for browser testing
