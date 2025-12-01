---
name: node-red-testing
description: Comprehensive guide for testing Node-RED nodes. This skill should be used when writing unit tests with mocks, integration tests with Docker/testcontainers, end-to-end tests against Node-RED runtime, or setting up test infrastructure for Node-RED node packages.
---

# Node-RED Testing

This skill provides patterns, tools, and strategies for testing custom Node-RED nodes at all levels: unit, integration, and end-to-end.

## When to Use This Skill

- Writing unit tests for Node-RED nodes with mocked RED framework
- Setting up integration tests with Docker or testcontainers
- Creating end-to-end tests against a real Node-RED runtime
- Configuring test runners (Jest, Mocha) for Node-RED projects
- Testing message flows, error handling, and node lifecycle

## Quick Start

To scaffold test files for a node, run the initialization script:

```bash
# Unit test scaffold
python scripts/init_test.py my-node --type unit --path ./test

# Integration test scaffold
python scripts/init_test.py my-node --type integration --path ./test

# E2E test scaffold
python scripts/init_test.py my-node --type e2e --path ./test

# All test types
python scripts/init_test.py my-node --type all --path ./test
```

## Test Pyramid Overview

```
        /\
       /E2E\        <- Few: Full Node-RED runtime tests
      /------\
     /Integr- \     <- Some: Docker-based, real dependencies
    /  ation   \
   /------------\
  /    Unit      \  <- Many: Fast, isolated, mocked tests
 /________________\
```

## Unit Testing with Mocks

Unit tests verify node logic in isolation by mocking the Node-RED runtime (`RED` object) and simulating message flows.

### Mock RED Framework

Create a mock RED object that simulates the Node-RED runtime:

```javascript
// test/helpers/mock-red.js
function createMockRED() {
    const nodes = new Map();
    const registeredTypes = new Map();

    return {
        nodes: {
            createNode: function(node, config) {
                node.id = config.id || 'test-node-id';
                node.type = config.type || 'test-node';
                node.name = config.name || '';
                node._events = {};

                node.on = function(event, handler) {
                    this._events[event] = this._events[event] || [];
                    this._events[event].push(handler);
                };

                node.emit = function(event, ...args) {
                    const handlers = this._events[event] || [];
                    handlers.forEach(h => h.apply(node, args));
                };

                node.send = jest.fn();
                node.error = jest.fn();
                node.warn = jest.fn();
                node.log = jest.fn();
                node.debug = jest.fn();
                node.trace = jest.fn();
                node.status = jest.fn();

                node.context = function() {
                    const store = {};
                    return {
                        get: (key) => store[key],
                        set: (key, val) => { store[key] = val; },
                        flow: {
                            get: (key) => store[`flow_${key}`],
                            set: (key, val) => { store[`flow_${key}`] = val; }
                        },
                        global: {
                            get: (key) => store[`global_${key}`],
                            set: (key, val) => { store[`global_${key}`] = val; }
                        }
                    };
                };

                nodes.set(node.id, node);
            },

            registerType: function(type, constructor, opts) {
                registeredTypes.set(type, { constructor, opts });
            },

            getNode: function(id) {
                return nodes.get(id);
            }
        },

        // Helper to create a node instance for testing
        _createTestNode: function(type, config) {
            const registration = registeredTypes.get(type);
            if (!registration) {
                throw new Error(`Node type "${type}" not registered`);
            }
            const node = {};
            registration.constructor.call(node, config);
            return node;
        },

        // Helper to get registered types
        _getRegisteredTypes: function() {
            return registeredTypes;
        }
    };
}

module.exports = { createMockRED };
```

### Test Node Registration

```javascript
// test/my-node.unit.test.js
const { createMockRED } = require('./helpers/mock-red');
const myNodeModule = require('../nodes/my-node');

describe('my-node registration', () => {
    let RED;

    beforeEach(() => {
        RED = createMockRED();
        myNodeModule(RED);
    });

    it('should register the node type', () => {
        const types = RED._getRegisteredTypes();
        expect(types.has('my-node')).toBe(true);
    });

    it('should create node with config', () => {
        const config = { id: 'n1', name: 'Test Node', type: 'my-node' };
        const node = RED._createTestNode('my-node', config);

        expect(node.name).toBe('Test Node');
    });
});
```

### Test Message Input Handling

```javascript
describe('my-node input handling', () => {
    let RED, node;

    beforeEach(() => {
        RED = createMockRED();
        myNodeModule(RED);
        node = RED._createTestNode('my-node', { id: 'n1' });
    });

    it('should process input message', () => {
        const msg = { payload: 'test data' };
        const send = jest.fn();
        const done = jest.fn();

        // Trigger input event
        node.emit('input', msg, send, done);

        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.any(String)
        }));
        expect(done).toHaveBeenCalled();
    });

    it('should handle errors gracefully', () => {
        const msg = { payload: null }; // Invalid input
        const send = jest.fn();
        const done = jest.fn();

        node.emit('input', msg, send, done);

        expect(done).toHaveBeenCalledWith(expect.any(Error));
    });
});
```

### Test Node Status Updates

```javascript
describe('my-node status', () => {
    let RED, node;

    beforeEach(() => {
        RED = createMockRED();
        myNodeModule(RED);
        node = RED._createTestNode('my-node', { id: 'n1' });
    });

    it('should set connecting status on init', () => {
        expect(node.status).toHaveBeenCalledWith({
            fill: 'yellow',
            shape: 'ring',
            text: 'connecting'
        });
    });

    it('should set connected status after successful connection', async () => {
        // Simulate connection
        await node._connect();

        expect(node.status).toHaveBeenCalledWith({
            fill: 'green',
            shape: 'dot',
            text: 'connected'
        });
    });
});
```

### Test Node Cleanup

```javascript
describe('my-node cleanup', () => {
    let RED, node;

    beforeEach(() => {
        RED = createMockRED();
        myNodeModule(RED);
        node = RED._createTestNode('my-node', { id: 'n1' });
    });

    it('should cleanup on close', (done) => {
        node.emit('close', false, () => {
            // Assert cleanup happened
            expect(node._connection).toBeNull();
            done();
        });
    });

    it('should handle removed flag', (done) => {
        node.emit('close', true, () => {
            // Assert different cleanup for removed node
            done();
        });
    });
});
```

### Mock External Dependencies

```javascript
// test/my-node.unit.test.js
jest.mock('some-external-lib', () => ({
    connect: jest.fn().mockResolvedValue({ connected: true }),
    disconnect: jest.fn().mockResolvedValue(undefined)
}));

const externalLib = require('some-external-lib');

describe('my-node with external lib', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should call external lib on init', () => {
        RED = createMockRED();
        myNodeModule(RED);
        node = RED._createTestNode('my-node', { id: 'n1' });

        expect(externalLib.connect).toHaveBeenCalled();
    });
});
```

## Integration Testing with Docker

Integration tests verify nodes work with real external dependencies using Docker containers.

### Testcontainers Setup

For detailed testcontainers configuration and patterns, see `references/testcontainers-setup.md`.

### Basic Docker Compose for Testing

```yaml
# docker-compose.test.yml
version: '3.8'

services:
  node-red:
    image: nodered/node-red:latest
    ports:
      - "1880:1880"
    volumes:
      - ./test-flows:/data/flows
      - ./nodes:/data/node_modules/@myorg/my-nodes
    environment:
      - NODE_RED_ENABLE_SAFE_MODE=false
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:1880/"]
      interval: 5s
      timeout: 3s
      retries: 10

  # Example: Redis dependency
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 2s
      retries: 5

  # Example: MQTT broker
  mosquitto:
    image: eclipse-mosquitto:2
    ports:
      - "1883:1883"
    volumes:
      - ./test/mosquitto.conf:/mosquitto/config/mosquitto.conf
```

### Integration Test with Docker Compose

```javascript
// test/my-node.integration.test.js
const { execSync } = require('child_process');
const axios = require('axios');

const NODE_RED_URL = 'http://localhost:1880';

describe('my-node integration', () => {
    beforeAll(async () => {
        // Start containers
        execSync('docker-compose -f docker-compose.test.yml up -d', {
            stdio: 'inherit'
        });

        // Wait for Node-RED to be ready
        await waitForNodeRED();
    }, 60000);

    afterAll(() => {
        execSync('docker-compose -f docker-compose.test.yml down -v', {
            stdio: 'inherit'
        });
    });

    it('should process messages through the flow', async () => {
        // Deploy test flow
        const flow = require('./fixtures/test-flow.json');
        await axios.post(`${NODE_RED_URL}/flows`, flow, {
            headers: { 'Content-Type': 'application/json' }
        });

        // Trigger flow via inject node or HTTP endpoint
        const response = await axios.post(`${NODE_RED_URL}/test-endpoint`, {
            data: 'test'
        });

        expect(response.status).toBe(200);
        expect(response.data).toMatchObject({ processed: true });
    });
});

async function waitForNodeRED(maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            await axios.get(`${NODE_RED_URL}/`);
            return;
        } catch (e) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    throw new Error('Node-RED did not start in time');
}
```

### Health Check Utilities

```javascript
// test/helpers/docker-utils.js
const { execSync } = require('child_process');
const axios = require('axios');

async function waitForService(url, options = {}) {
    const {
        maxAttempts = 30,
        interval = 2000,
        healthPath = '/',
        expectedStatus = 200
    } = options;

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await axios.get(`${url}${healthPath}`);
            if (response.status === expectedStatus) {
                return true;
            }
        } catch (e) {
            // Service not ready yet
        }
        await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`Service at ${url} did not become ready`);
}

function startContainers(composeFile = 'docker-compose.test.yml') {
    execSync(`docker-compose -f ${composeFile} up -d`, { stdio: 'inherit' });
}

function stopContainers(composeFile = 'docker-compose.test.yml') {
    execSync(`docker-compose -f ${composeFile} down -v`, { stdio: 'inherit' });
}

function getContainerLogs(serviceName, composeFile = 'docker-compose.test.yml') {
    return execSync(`docker-compose -f ${composeFile} logs ${serviceName}`).toString();
}

module.exports = {
    waitForService,
    startContainers,
    stopContainers,
    getContainerLogs
};
```

### Message Flow Testing

```javascript
// test/flow-testing.integration.test.js
describe('message flow testing', () => {
    it('should pass messages through multiple nodes', async () => {
        // Deploy a flow: inject -> my-node -> debug
        const flow = [
            {
                id: 'inject1',
                type: 'inject',
                payload: '{"test": "data"}',
                payloadType: 'json',
                wires: [['mynode1']]
            },
            {
                id: 'mynode1',
                type: 'my-node',
                name: 'Test Node',
                wires: [['debug1']]
            },
            {
                id: 'debug1',
                type: 'debug',
                active: true,
                console: true
            }
        ];

        await deployFlow(flow);

        // Trigger inject node
        await axios.post(`${NODE_RED_URL}/inject/inject1`);

        // Check debug output or side effects
        const logs = getContainerLogs('node-red');
        expect(logs).toContain('processed');
    });
});
```

## End-to-End Testing

E2E tests verify the complete system including Node-RED runtime, UI, and external integrations.

### Node-RED Runtime Integration

```javascript
// test/my-node.e2e.test.js
const helper = require('node-red-node-test-helper');
const myNode = require('../nodes/my-node');

helper.init(require.resolve('node-red'));

describe('my-node E2E', () => {
    beforeEach((done) => {
        helper.startServer(done);
    });

    afterEach((done) => {
        helper.unload();
        helper.stopServer(done);
    });

    it('should load node', (done) => {
        const flow = [{ id: 'n1', type: 'my-node', name: 'test' }];

        helper.load(myNode, flow, () => {
            const n1 = helper.getNode('n1');
            expect(n1).toHaveProperty('name', 'test');
            done();
        });
    });

    it('should process messages', (done) => {
        const flow = [
            { id: 'n1', type: 'my-node', name: 'test', wires: [['n2']] },
            { id: 'n2', type: 'helper' }
        ];

        helper.load(myNode, flow, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                expect(msg).toHaveProperty('payload');
                done();
            });

            n1.receive({ payload: 'test' });
        });
    });

    it('should handle configuration', (done) => {
        const flow = [
            { id: 'n1', type: 'my-node', name: 'test', someConfig: 'value' }
        ];

        helper.load(myNode, flow, () => {
            const n1 = helper.getNode('n1');
            expect(n1.someConfig).toBe('value');
            done();
        });
    });
});
```

### Testing with Configuration Nodes

```javascript
describe('my-node with config node', () => {
    it('should use config node', (done) => {
        const flow = [
            { id: 'config1', type: 'my-server', host: 'localhost', port: 8080 },
            { id: 'n1', type: 'my-node', server: 'config1', wires: [['n2']] },
            { id: 'n2', type: 'helper' }
        ];

        helper.load([myNode, myServerNode], flow, () => {
            const n1 = helper.getNode('n1');
            expect(n1.server).toBeDefined();
            expect(n1.server.host).toBe('localhost');
            done();
        });
    });
});
```

### Testing Credentials

```javascript
describe('my-node credentials', () => {
    it('should handle credentials', (done) => {
        const flow = [
            { id: 'n1', type: 'my-node', name: 'test' }
        ];

        const credentials = {
            n1: { username: 'user', password: 'pass' }
        };

        helper.load(myNode, flow, credentials, () => {
            const n1 = helper.getNode('n1');
            expect(n1.credentials.username).toBe('user');
            expect(n1.credentials.password).toBe('pass');
            done();
        });
    });
});
```

### HTTP Endpoint Testing

```javascript
describe('my-node HTTP endpoints', () => {
    it('should respond to HTTP requests', (done) => {
        const flow = [
            { id: 'n1', type: 'http in', url: '/test', method: 'get', wires: [['n2']] },
            { id: 'n2', type: 'my-node', wires: [['n3']] },
            { id: 'n3', type: 'http response' }
        ];

        helper.load([httpIn, myNode, httpResponse], flow, () => {
            helper.request()
                .get('/test')
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body).toMatchObject({ success: true });
                    done();
                });
        });
    });
});
```

### UI Testing with Playwright

```javascript
// test/my-node.ui.test.js
const { test, expect } = require('@playwright/test');

test.describe('my-node editor UI', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:1880');
        await page.waitForSelector('.red-ui-palette');
    });

    test('should appear in palette', async ({ page }) => {
        const paletteNode = page.locator('.red-ui-palette-node[data-palette-type="my-node"]');
        await expect(paletteNode).toBeVisible();
    });

    test('should open edit dialog', async ({ page }) => {
        // Drag node to workspace
        const paletteNode = page.locator('.red-ui-palette-node[data-palette-type="my-node"]');
        const workspace = page.locator('#red-ui-workspace-chart');

        await paletteNode.dragTo(workspace);

        // Double-click to open editor
        const node = page.locator('.red-ui-flow-node').first();
        await node.dblclick();

        // Verify edit dialog
        await expect(page.locator('.red-ui-editableList')).toBeVisible();
    });

    test('should save configuration', async ({ page }) => {
        // ... setup node in workspace

        // Fill form
        await page.fill('#node-input-name', 'My Test Node');
        await page.fill('#node-input-host', 'localhost');

        // Save
        await page.click('.red-ui-editor-saveButton');

        // Verify saved
        const node = page.locator('.red-ui-flow-node').first();
        await expect(node).toContainText('My Test Node');
    });
});
```

## Test Organization & Patterns

### Directory Structure

```
project/
├── nodes/
│   ├── my-node.js
│   └── my-node.html
├── test/
│   ├── helpers/
│   │   ├── mock-red.js
│   │   └── docker-utils.js
│   ├── fixtures/
│   │   └── test-flow.json
│   ├── unit/
│   │   └── my-node.unit.test.js
│   ├── integration/
│   │   └── my-node.integration.test.js
│   └── e2e/
│       └── my-node.e2e.test.js
├── docker-compose.test.yml
├── jest.config.js
└── package.json
```

### Jest Configuration

```javascript
// jest.config.js
module.exports = {
    testEnvironment: 'node',
    testMatch: [
        '**/test/**/*.test.js'
    ],
    collectCoverageFrom: [
        'nodes/**/*.js',
        '!nodes/**/*.html'
    ],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },
    setupFilesAfterEnv: ['./test/setup.js'],
    testTimeout: 30000,
    projects: [
        {
            displayName: 'unit',
            testMatch: ['<rootDir>/test/unit/**/*.test.js'],
            testTimeout: 5000
        },
        {
            displayName: 'integration',
            testMatch: ['<rootDir>/test/integration/**/*.test.js'],
            testTimeout: 60000
        },
        {
            displayName: 'e2e',
            testMatch: ['<rootDir>/test/e2e/**/*.test.js'],
            testTimeout: 120000
        }
    ]
};
```

### Test Setup File

```javascript
// test/setup.js
jest.setTimeout(30000);

// Global test utilities
global.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Clean up after all tests
afterAll(async () => {
    // Cleanup code here
});
```

### Package.json Scripts

```json
{
    "scripts": {
        "test": "jest",
        "test:unit": "jest --selectProjects unit",
        "test:integration": "jest --selectProjects integration",
        "test:e2e": "jest --selectProjects e2e",
        "test:watch": "jest --watch --selectProjects unit",
        "test:coverage": "jest --coverage",
        "test:ci": "jest --ci --coverage --runInBand",
        "docker:test:up": "docker-compose -f docker-compose.test.yml up -d",
        "docker:test:down": "docker-compose -f docker-compose.test.yml down -v"
    }
}
```

### Test Isolation Patterns

```javascript
// Isolated test with fresh state
describe('isolated tests', () => {
    let RED, node;

    beforeEach(() => {
        // Fresh mocks for each test
        RED = createMockRED();
        jest.clearAllMocks();
    });

    afterEach(() => {
        // Cleanup
        node = null;
    });
});
```

### Fixture Management

```javascript
// test/fixtures/index.js
const path = require('path');
const fs = require('fs');

function loadFixture(name) {
    const fixturePath = path.join(__dirname, `${name}.json`);
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createMessage(overrides = {}) {
    return {
        _msgid: 'test-msg-id',
        payload: 'default payload',
        topic: '',
        ...overrides
    };
}

module.exports = { loadFixture, createMessage };
```

### Testing Async Operations

```javascript
describe('async operations', () => {
    it('should handle async input processing', async () => {
        const node = RED._createTestNode('my-node', { id: 'n1' });

        const result = await new Promise((resolve, reject) => {
            const send = jest.fn((msg) => resolve(msg));
            const done = jest.fn((err) => err ? reject(err) : null);

            node.emit('input', { payload: 'test' }, send, done);
        });

        expect(result.payload).toBe('processed');
    });

    it('should timeout long operations', async () => {
        jest.useFakeTimers();

        const promise = node.longOperation();
        jest.advanceTimersByTime(5000);

        await expect(promise).rejects.toThrow('Timeout');

        jest.useRealTimers();
    });
});
```

## Common Testing Mistakes

1. **Not isolating tests** - Always create fresh mocks in `beforeEach`
2. **Forgetting async cleanup** - Use `afterEach` and `afterAll` properly
3. **Hard-coded timeouts** - Use configurable wait utilities
4. **Testing implementation details** - Focus on behavior, not internals
5. **Missing error cases** - Test both success and failure paths
6. **No integration tests** - Unit tests alone miss real-world issues
7. **Flaky Docker tests** - Use proper health checks and retries
8. **Shared state between tests** - Reset all state in `beforeEach`

## Reference Documentation

For detailed setup guides, consult the references directory:

- `references/testcontainers-setup.md` - Docker and testcontainers configuration

To search for specific patterns:
```bash
grep -r "pattern" references/
```
