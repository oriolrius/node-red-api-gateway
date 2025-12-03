---
id: doc-002
title: 'Testing Approaches: node-red-node-test-helper vs Real Node-RED Environment'
type: other
created_date: '2025-12-03 10:32'
---
# Testing Approaches: node-red-node-test-helper vs Real Node-RED Environment

## Overview

This document explains the difference between the current test setup using `node-red-node-test-helper` and testing in a real-world Node-RED environment.

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

### Testing Pyramid

```
        /\
       /E2E\        <- Few: Full Node-RED + browser + external services
      /------\
     /Integr- \     <- Some: Node-RED in Docker + real dependencies
    /  ation   \
   /------------\
  /    Unit      \  <- Many: node-red-node-test-helper (what we have)
 /________________\
```

### Real-World Test Approaches

#### 1. Docker-based Integration Testing

Run Node-RED in a Docker container with our node installed:

```yaml
# docker-compose.test.yml
services:
  node-red:
    image: nodered/node-red:latest
    ports:
      - "1880:1880"
    volumes:
      - ./:/data/node_modules/@user/node-red-api-gateway
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:1880/"]
```

Tests would:
- Start container
- Deploy flows via Admin API (`POST /flows`)
- Trigger flows via HTTP endpoints or inject timing
- Verify results via debug output or HTTP responses
- Stop container

#### 2. Browser-based E2E Testing (Playwright)

Test the editor UI:

```javascript
test('node should appear in palette', async ({ page }) => {
    await page.goto('http://localhost:1880');
    await expect(page.locator('[data-palette-type="lower-case"]')).toBeVisible();
});

test('edit dialog should work', async ({ page }) => {
    // Drag node to canvas, double-click, fill form, save
});
```

#### 3. Admin API Testing

Test flow deployment and runtime via Node-RED's Admin API:

```javascript
// Deploy a flow
await axios.post('http://localhost:1880/flows', testFlow);

// Get flow status
const response = await axios.get('http://localhost:1880/flows');

// Inject a message (if using http-in node)
await axios.post('http://localhost:1880/my-endpoint', { data: 'test' });
```

---

## Comparison Table

| Aspect | node-red-node-test-helper | Docker Integration | Browser E2E |
|--------|---------------------------|-------------------|-------------|
| **Speed** | ~50ms per test | ~5-30s startup + test | ~10-60s per test |
| **Isolation** | Excellent | Good | Moderate |
| **Real runtime** | Partial | Yes | Yes |
| **Editor UI** | No | Via API | Yes |
| **External deps** | Mocked | Real (containers) | Real |
| **Debugging** | Easy | Moderate | Hard |
| **CI/CD friendly** | Yes | Yes (needs Docker) | Yes (needs browser) |
| **Flakiness** | Low | Moderate | Higher |

---

## Recommendation

### Test Strategy for This Project

1. **Keep unit tests** (node-red-node-test-helper)
   - Fast feedback during development
   - Test node logic in isolation
   - Run on every commit

2. **Add Docker integration tests**
   - Test node in real Node-RED runtime
   - Test with real dependencies (if any)
   - Run before releases or on PR merge

3. **Add E2E tests for editor** (optional, later)
   - Test HTML dialog functionality
   - Test palette appearance
   - Run on major releases

### Implementation Priority

1. **High**: Docker-based integration testing with `docker-compose.test.yml`
2. **Medium**: Admin API tests for flow deployment/execution
3. **Low**: Playwright browser tests for editor UI

---

## Next Steps

To implement real-world testing, we would need to:

1. Create `docker-compose.test.yml` with Node-RED container
2. Create test fixtures (flow JSON files)
3. Add integration test scripts
4. Update `package.json` with integration test commands
5. (Optional) Add Playwright for browser testing

This would be a separate task from the current skeleton setup.
