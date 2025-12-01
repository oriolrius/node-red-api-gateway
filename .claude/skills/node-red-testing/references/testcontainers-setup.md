# Testcontainers Setup Guide for Node-RED Testing

This guide covers setting up Docker-based testing infrastructure for Node-RED nodes using testcontainers and Docker Compose.

## Overview

Integration testing Node-RED nodes often requires:
- A running Node-RED instance
- External services (databases, message brokers, APIs)
- Reproducible, isolated test environments

This guide covers two approaches:
1. **Docker Compose** - Simple multi-container setup
2. **Testcontainers** - Programmatic container management in tests

## Docker Compose Approach

### Basic Setup

Create `docker-compose.test.yml` in your project root:

```yaml
version: '3.8'

services:
  node-red:
    image: nodered/node-red:latest
    ports:
      - "1880:1880"
    volumes:
      # Mount your nodes for testing
      - ./nodes:/data/node_modules/@myorg/my-nodes
      # Mount test flows
      - ./test/flows:/data/lib/flows
    environment:
      - NODE_RED_ENABLE_SAFE_MODE=false
      - NODE_RED_ENABLE_PROJECTS=false
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:1880/"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 2s
      retries: 5

  mosquitto:
    image: eclipse-mosquitto:2
    ports:
      - "1883:1883"
      - "9001:9001"
    volumes:
      - ./test/config/mosquitto.conf:/mosquitto/config/mosquitto.conf
    healthcheck:
      test: ["CMD-SHELL", "mosquitto_sub -t '$$SYS/#' -C 1 -i healthcheck -W 3"]
      interval: 5s
      timeout: 3s
      retries: 5

  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: testdb
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test -d testdb"]
      interval: 2s
      timeout: 2s
      retries: 5
```

### Mosquitto Configuration

Create `test/config/mosquitto.conf`:

```
listener 1883
allow_anonymous true
listener 9001
protocol websockets
```

### Custom Node-RED Settings

Create `test/config/settings.js` for Node-RED:

```javascript
module.exports = {
    flowFile: 'flows.json',
    flowFilePretty: true,

    adminAuth: null,  // Disable auth for testing

    functionGlobalContext: {
        // Add any global context needed for tests
    },

    logging: {
        console: {
            level: "debug",
            metrics: false,
            audit: false
        }
    },

    // Disable editor in headless tests
    // httpAdminRoot: false,

    // API settings
    httpNodeRoot: '/api',

    // Useful for debugging tests
    debugMaxLength: 10000
};
```

Mount it in docker-compose:

```yaml
services:
  node-red:
    volumes:
      - ./test/config/settings.js:/data/settings.js
```

### Running Tests with Docker Compose

```bash
# Start containers
docker-compose -f docker-compose.test.yml up -d

# Wait for services
docker-compose -f docker-compose.test.yml exec node-red curl -s http://localhost:1880/

# Run tests
npm run test:integration

# View logs on failure
docker-compose -f docker-compose.test.yml logs node-red

# Cleanup
docker-compose -f docker-compose.test.yml down -v
```

### Package.json Scripts

```json
{
  "scripts": {
    "docker:up": "docker-compose -f docker-compose.test.yml up -d",
    "docker:down": "docker-compose -f docker-compose.test.yml down -v",
    "docker:logs": "docker-compose -f docker-compose.test.yml logs -f",
    "pretest:integration": "npm run docker:up && npm run docker:wait",
    "posttest:integration": "npm run docker:down",
    "docker:wait": "node scripts/wait-for-services.js"
  }
}
```

### Wait Script

Create `scripts/wait-for-services.js`:

```javascript
const axios = require('axios');

const services = [
    { name: 'Node-RED', url: 'http://localhost:1880/' },
    // Add other service health endpoints
];

async function waitForService(service, maxAttempts = 30, interval = 2000) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            await axios.get(service.url, { timeout: 2000 });
            console.log(`✓ ${service.name} is ready`);
            return true;
        } catch (e) {
            console.log(`Waiting for ${service.name}... (${i + 1}/${maxAttempts})`);
            await new Promise(r => setTimeout(r, interval));
        }
    }
    throw new Error(`${service.name} did not become ready`);
}

async function main() {
    console.log('Waiting for services...\n');

    for (const service of services) {
        await waitForService(service);
    }

    console.log('\nAll services ready!');
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
```

## Testcontainers Approach

Testcontainers provides programmatic control over containers within your test code.

### Installation

```bash
npm install --save-dev testcontainers
```

### Basic Usage

```javascript
// test/integration/setup.js
const { GenericContainer, Wait } = require('testcontainers');

let nodeRedContainer;
let redisContainer;

async function startContainers() {
    // Start Redis first
    redisContainer = await new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
        .start();

    const redisHost = redisContainer.getHost();
    const redisPort = redisContainer.getMappedPort(6379);

    // Start Node-RED with Redis connection
    nodeRedContainer = await new GenericContainer('nodered/node-red:latest')
        .withExposedPorts(1880)
        .withEnvironment({
            REDIS_HOST: redisHost,
            REDIS_PORT: redisPort.toString()
        })
        .withBindMounts([
            {
                source: process.cwd() + '/nodes',
                target: '/data/node_modules/@myorg/my-nodes',
                mode: 'ro'
            }
        ])
        .withWaitStrategy(Wait.forHttp('/', 1880))
        .start();

    return {
        nodeRedUrl: `http://${nodeRedContainer.getHost()}:${nodeRedContainer.getMappedPort(1880)}`,
        redisUrl: `redis://${redisHost}:${redisPort}`
    };
}

async function stopContainers() {
    if (nodeRedContainer) await nodeRedContainer.stop();
    if (redisContainer) await redisContainer.stop();
}

module.exports = { startContainers, stopContainers };
```

### Using in Tests

```javascript
// test/integration/my-node.test.js
const { startContainers, stopContainers } = require('./setup');
const axios = require('axios');

describe('my-node integration', () => {
    let urls;

    beforeAll(async () => {
        urls = await startContainers();
    }, 120000);

    afterAll(async () => {
        await stopContainers();
    });

    it('should process messages', async () => {
        const response = await axios.get(`${urls.nodeRedUrl}/nodes`);
        expect(response.status).toBe(200);
    });
});
```

### Custom Node-RED Container

For complex setups, create a custom container:

```javascript
// test/containers/node-red-container.js
const { GenericContainer, Wait } = require('testcontainers');
const path = require('path');

class NodeRedContainer {
    constructor() {
        this.container = new GenericContainer('nodered/node-red:latest')
            .withExposedPorts(1880)
            .withWaitStrategy(Wait.forHttp('/', 1880).withStartupTimeout(60000));
    }

    withNodes(nodesPath) {
        this.container = this.container.withBindMounts([{
            source: path.resolve(nodesPath),
            target: '/data/node_modules/@myorg/my-nodes',
            mode: 'ro'
        }]);
        return this;
    }

    withFlows(flowsPath) {
        this.container = this.container.withBindMounts([{
            source: path.resolve(flowsPath),
            target: '/data/lib/flows',
            mode: 'ro'
        }]);
        return this;
    }

    withSettings(settingsPath) {
        this.container = this.container.withBindMounts([{
            source: path.resolve(settingsPath),
            target: '/data/settings.js',
            mode: 'ro'
        }]);
        return this;
    }

    withEnvironment(env) {
        this.container = this.container.withEnvironment(env);
        return this;
    }

    async start() {
        this._startedContainer = await this.container.start();
        return this;
    }

    async stop() {
        if (this._startedContainer) {
            await this._startedContainer.stop();
        }
    }

    getUrl() {
        return `http://${this._startedContainer.getHost()}:${this._startedContainer.getMappedPort(1880)}`;
    }

    async getLogs() {
        const logs = await this._startedContainer.logs();
        return logs;
    }
}

module.exports = { NodeRedContainer };
```

### Using Custom Container

```javascript
const { NodeRedContainer } = require('./containers/node-red-container');

describe('my-node', () => {
    let nodeRed;

    beforeAll(async () => {
        nodeRed = await new NodeRedContainer()
            .withNodes('./nodes')
            .withFlows('./test/flows')
            .start();
    }, 120000);

    afterAll(async () => {
        await nodeRed.stop();
    });

    it('should be accessible', async () => {
        const response = await axios.get(nodeRed.getUrl());
        expect(response.status).toBe(200);
    });
});
```

## Network Configuration

### Container-to-Container Communication

```javascript
const { Network } = require('testcontainers');

const network = await new Network().start();

const redis = await new GenericContainer('redis:7-alpine')
    .withNetwork(network)
    .withNetworkAliases('redis')
    .start();

const nodeRed = await new GenericContainer('nodered/node-red:latest')
    .withNetwork(network)
    .withEnvironment({ REDIS_HOST: 'redis' })
    .start();
```

### Docker Compose Network

```yaml
services:
  node-red:
    networks:
      - test-network
    environment:
      - REDIS_HOST=redis

  redis:
    networks:
      - test-network

networks:
  test-network:
    driver: bridge
```

## Test Data Management

### Seeding Test Data

```javascript
async function seedTestData(nodeRedUrl) {
    const testFlow = require('./fixtures/test-flow.json');

    await axios.post(`${nodeRedUrl}/flows`, testFlow, {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function clearTestData(nodeRedUrl) {
    await axios.post(`${nodeRedUrl}/flows`, [], {
        headers: { 'Content-Type': 'application/json' }
    });
}
```

### Test Flow Fixtures

Create `test/fixtures/test-flow.json`:

```json
[
    {
        "id": "flow1",
        "type": "tab",
        "label": "Test Flow"
    },
    {
        "id": "inject1",
        "type": "inject",
        "z": "flow1",
        "name": "Test Trigger",
        "props": [{"p": "payload"}],
        "payload": "{\"test\": true}",
        "payloadType": "json",
        "once": false,
        "wires": [["mynode1"]]
    },
    {
        "id": "mynode1",
        "type": "my-node",
        "z": "flow1",
        "name": "Test Node",
        "wires": [["debug1"]]
    },
    {
        "id": "debug1",
        "type": "debug",
        "z": "flow1",
        "name": "Output",
        "active": true,
        "console": true
    }
]
```

## Debugging Failed Tests

### Capturing Container Logs

```javascript
afterEach(async function() {
    if (this.currentTest.state === 'failed') {
        const logs = await nodeRedContainer.logs();
        console.log('=== Node-RED Logs ===');
        console.log(logs);
    }
});
```

### Interactive Debugging

```bash
# Keep containers running after test failure
docker-compose -f docker-compose.test.yml up

# In another terminal, inspect Node-RED
docker-compose -f docker-compose.test.yml exec node-red sh

# Check installed nodes
ls /data/node_modules/

# View Node-RED logs
docker-compose -f docker-compose.test.yml logs -f node-red
```

### Taking Screenshots (UI Tests)

```javascript
afterEach(async function() {
    if (this.currentTest.state === 'failed') {
        await page.screenshot({
            path: `test-failures/${this.currentTest.title}.png`
        });
    }
});
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration

      - name: Upload test artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: test-logs
          path: |
            test-failures/
            *.log
```

### GitLab CI

```yaml
# .gitlab-ci.yml
test:
  image: node:18
  services:
    - docker:dind

  variables:
    DOCKER_HOST: tcp://docker:2375

  before_script:
    - npm ci

  script:
    - npm run test:unit
    - npm run test:integration

  artifacts:
    when: on_failure
    paths:
      - test-failures/
```

## Performance Considerations

### Container Reuse

```javascript
// Start containers once for all tests in a file
let containers;

beforeAll(async () => {
    containers = await startContainers();
}, 120000);

afterAll(async () => {
    await stopContainers();
});

// Reset state between tests instead of restarting containers
beforeEach(async () => {
    await clearTestData(containers.nodeRedUrl);
});
```

### Parallel Test Execution

```javascript
// jest.config.js
module.exports = {
    // Run integration tests serially (shared containers)
    projects: [
        {
            displayName: 'integration',
            testMatch: ['<rootDir>/test/integration/**/*.test.js'],
            maxWorkers: 1  // Serial execution
        }
    ]
};
```

### Resource Cleanup

```javascript
// Ensure cleanup even on test failure
process.on('SIGINT', async () => {
    await stopContainers();
    process.exit(1);
});

process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
    await stopContainers();
    process.exit(1);
});
```

## Troubleshooting

### Common Issues

1. **Container startup timeout**
   - Increase `withStartupTimeout()` value
   - Check container logs for errors
   - Verify health check configuration

2. **Port conflicts**
   - Use dynamic port mapping (let testcontainers assign ports)
   - Clean up orphaned containers: `docker rm -f $(docker ps -aq)`

3. **Volume mount issues**
   - Use absolute paths
   - Check file permissions
   - On Windows/Mac, ensure paths are shared with Docker

4. **Network connectivity**
   - Verify containers are on same network
   - Use container names (not localhost) for inter-container communication
   - Check firewall rules

5. **Node-RED not loading custom nodes**
   - Verify mount path matches package.json "node-red.nodes" paths
   - Check Node-RED logs for loading errors
   - Ensure package.json is valid
