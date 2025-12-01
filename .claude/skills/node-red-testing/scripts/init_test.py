#!/usr/bin/env python3
"""
Node-RED Test Scaffolding Generator

Generates test file scaffolding for Node-RED nodes.

Usage:
    python init_test.py <node-name> --type <unit|integration|e2e|all> --path <output-dir>

Examples:
    python init_test.py my-node --type unit --path ./test
    python init_test.py my-node --type all --path ./test
"""

import argparse
import os
import sys
from pathlib import Path

UNIT_TEST_TEMPLATE = '''const {{ createMockRED }} = require('../helpers/mock-red');
const {nodeModuleName} = require('../../nodes/{nodeName}');

describe('{nodeName} unit tests', () => {{
    let RED;
    let node;

    beforeEach(() => {{
        RED = createMockRED();
        {nodeModuleName}(RED);
        jest.clearAllMocks();
    }});

    afterEach(() => {{
        node = null;
    }});

    describe('registration', () => {{
        it('should register the node type', () => {{
            const types = RED._getRegisteredTypes();
            expect(types.has('{nodeName}')).toBe(true);
        }});

        it('should create node with config', () => {{
            const config = {{ id: 'n1', name: 'Test Node', type: '{nodeName}' }};
            node = RED._createTestNode('{nodeName}', config);

            expect(node.name).toBe('Test Node');
        }});
    }});

    describe('input handling', () => {{
        beforeEach(() => {{
            node = RED._createTestNode('{nodeName}', {{ id: 'n1' }});
        }});

        it('should process input message', () => {{
            const msg = {{ payload: 'test data' }};
            const send = jest.fn();
            const done = jest.fn();

            node.emit('input', msg, send, done);

            expect(send).toHaveBeenCalled();
            expect(done).toHaveBeenCalled();
        }});

        it('should handle errors gracefully', () => {{
            const msg = {{ payload: null }};
            const send = jest.fn();
            const done = jest.fn();

            node.emit('input', msg, send, done);

            // Adjust expectation based on node's error handling
            expect(done).toHaveBeenCalled();
        }});
    }});

    describe('status updates', () => {{
        beforeEach(() => {{
            node = RED._createTestNode('{nodeName}', {{ id: 'n1' }});
        }});

        it('should update status appropriately', () => {{
            // TODO: Add status assertions based on node behavior
            expect(node.status).toBeDefined();
        }});
    }});

    describe('cleanup', () => {{
        beforeEach(() => {{
            node = RED._createTestNode('{nodeName}', {{ id: 'n1' }});
        }});

        it('should cleanup on close', (done) => {{
            node.emit('close', false, () => {{
                // TODO: Assert cleanup happened
                done();
            }});
        }});
    }});
}});
'''

INTEGRATION_TEST_TEMPLATE = '''const {{ execSync }} = require('child_process');
const axios = require('axios');
const path = require('path');

const NODE_RED_URL = process.env.NODE_RED_URL || 'http://localhost:1880';
const COMPOSE_FILE = path.join(__dirname, '../../docker-compose.test.yml');

describe('{nodeName} integration tests', () => {{
    beforeAll(async () => {{
        // Start containers
        execSync(`docker-compose -f ${{COMPOSE_FILE}} up -d`, {{
            stdio: 'inherit'
        }});

        // Wait for Node-RED to be ready
        await waitForNodeRED();
    }}, 120000);

    afterAll(() => {{
        execSync(`docker-compose -f ${{COMPOSE_FILE}} down -v`, {{
            stdio: 'inherit'
        }});
    }});

    it('should be available in Node-RED', async () => {{
        const response = await axios.get(`${{NODE_RED_URL}}/nodes`);
        const nodes = response.data;

        const hasNode = nodes.some(n => n.types && n.types.includes('{nodeName}'));
        expect(hasNode).toBe(true);
    }});

    it('should process messages in a flow', async () => {{
        // Deploy test flow
        const flow = [
            {{
                id: 'inject1',
                type: 'inject',
                payload: '{{"test": "data"}}',
                payloadType: 'json',
                once: false,
                wires: [['{nodeId}']]
            }},
            {{
                id: '{nodeId}',
                type: '{nodeName}',
                name: 'Test Node',
                wires: [['debug1']]
            }},
            {{
                id: 'debug1',
                type: 'debug',
                active: true,
                console: true
            }}
        ];

        await axios.post(`${{NODE_RED_URL}}/flows`, flow, {{
            headers: {{ 'Content-Type': 'application/json' }}
        }});

        // TODO: Trigger flow and verify output
        // This depends on how your node processes messages
    }});

    // TODO: Add more integration tests for specific scenarios
}});

async function waitForNodeRED(maxAttempts = 30) {{
    for (let i = 0; i < maxAttempts; i++) {{
        try {{
            await axios.get(`${{NODE_RED_URL}}/`);
            console.log('Node-RED is ready');
            return;
        }} catch (e) {{
            console.log(`Waiting for Node-RED... (${{i + 1}}/${{maxAttempts}})`);
            await new Promise(r => setTimeout(r, 2000));
        }}
    }}
    throw new Error('Node-RED did not start in time');
}}
'''

E2E_TEST_TEMPLATE = '''const helper = require('node-red-node-test-helper');
const {nodeModuleName} = require('../../nodes/{nodeName}');

helper.init(require.resolve('node-red'));

describe('{nodeName} E2E tests', () => {{
    beforeEach((done) => {{
        helper.startServer(done);
    }});

    afterEach((done) => {{
        helper.unload();
        helper.stopServer(done);
    }});

    describe('node loading', () => {{
        it('should load node', (done) => {{
            const flow = [{{ id: 'n1', type: '{nodeName}', name: 'test' }}];

            helper.load({nodeModuleName}, flow, () => {{
                const n1 = helper.getNode('n1');
                expect(n1).toHaveProperty('name', 'test');
                done();
            }});
        }});
    }});

    describe('message processing', () => {{
        it('should process messages', (done) => {{
            const flow = [
                {{ id: 'n1', type: '{nodeName}', name: 'test', wires: [['n2']] }},
                {{ id: 'n2', type: 'helper' }}
            ];

            helper.load({nodeModuleName}, flow, () => {{
                const n1 = helper.getNode('n1');
                const n2 = helper.getNode('n2');

                n2.on('input', (msg) => {{
                    expect(msg).toHaveProperty('payload');
                    done();
                }});

                n1.receive({{ payload: 'test' }});
            }});
        }});

        it('should handle empty payload', (done) => {{
            const flow = [
                {{ id: 'n1', type: '{nodeName}', name: 'test', wires: [['n2']] }},
                {{ id: 'n2', type: 'helper' }}
            ];

            helper.load({nodeModuleName}, flow, () => {{
                const n1 = helper.getNode('n1');
                const n2 = helper.getNode('n2');

                n2.on('input', (msg) => {{
                    // TODO: Adjust expectation based on node behavior
                    done();
                }});

                n1.receive({{ payload: '' }});
            }});
        }});
    }});

    describe('configuration', () => {{
        it('should handle configuration options', (done) => {{
            const flow = [
                {{
                    id: 'n1',
                    type: '{nodeName}',
                    name: 'test',
                    // TODO: Add config options specific to your node
                }}
            ];

            helper.load({nodeModuleName}, flow, () => {{
                const n1 = helper.getNode('n1');
                // TODO: Assert configuration is applied correctly
                expect(n1).toBeDefined();
                done();
            }});
        }});
    }});

    // TODO: Add tests for credentials if your node uses them
    // describe('credentials', () => {{
    //     it('should handle credentials', (done) => {{
    //         const flow = [{{ id: 'n1', type: '{nodeName}', name: 'test' }}];
    //         const credentials = {{ n1: {{ username: 'user', password: 'pass' }} }};
    //
    //         helper.load({nodeModuleName}, flow, credentials, () => {{
    //             const n1 = helper.getNode('n1');
    //             expect(n1.credentials.username).toBe('user');
    //             done();
    //         }});
    //     }});
    // }});
}});
'''

MOCK_RED_HELPER = '''/**
 * Mock RED Framework for Node-RED unit testing
 *
 * Provides a mock implementation of the Node-RED runtime API
 * for testing nodes in isolation.
 */

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

                // Apply config properties to node
                Object.keys(config).forEach(key => {
                    if (!['id', 'type', 'name', 'wires'].includes(key)) {
                        node[key] = config[key];
                    }
                });

                nodes.set(node.id, node);
            },

            registerType: function(type, constructor, opts) {
                registeredTypes.set(type, { constructor, opts });
            },

            getNode: function(id) {
                return nodes.get(id);
            }
        },

        log: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            trace: jest.fn()
        },

        settings: {},

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
        },

        // Helper to clear all nodes (for test isolation)
        _clearNodes: function() {
            nodes.clear();
        }
    };
}

module.exports = { createMockRED };
'''

DOCKER_COMPOSE_TEMPLATE = '''version: '3.8'

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
      - NODE_RED_ENABLE_PROJECTS=false
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:1880/"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  # Uncomment and configure additional services as needed:

  # redis:
  #   image: redis:7-alpine
  #   ports:
  #     - "6379:6379"
  #   healthcheck:
  #     test: ["CMD", "redis-cli", "ping"]
  #     interval: 2s
  #     timeout: 2s
  #     retries: 5

  # mosquitto:
  #   image: eclipse-mosquitto:2
  #   ports:
  #     - "1883:1883"
  #   volumes:
  #     - ./test/mosquitto.conf:/mosquitto/config/mosquitto.conf
'''

JEST_CONFIG_TEMPLATE = '''module.exports = {
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
            testTimeout: 120000
        },
        {
            displayName: 'e2e',
            testMatch: ['<rootDir>/test/e2e/**/*.test.js'],
            testTimeout: 60000
        }
    ]
};
'''


def to_camel_case(name: str) -> str:
    """Convert kebab-case to camelCase for module variable names."""
    components = name.split('-')
    return components[0] + ''.join(x.title() for x in components[1:])


def create_directory(path: Path) -> None:
    """Create directory if it doesn't exist."""
    path.mkdir(parents=True, exist_ok=True)


def write_file(path: Path, content: str, overwrite: bool = False) -> bool:
    """Write content to file. Returns True if file was written."""
    if path.exists() and not overwrite:
        print(f"  Skipping {path} (already exists)")
        return False

    path.write_text(content)
    print(f"  Created {path}")
    return True


def generate_unit_test(node_name: str, output_path: Path) -> None:
    """Generate unit test file."""
    test_dir = output_path / "unit"
    create_directory(test_dir)

    node_module_name = to_camel_case(node_name) + "Node"
    content = UNIT_TEST_TEMPLATE.format(
        nodeName=node_name,
        nodeModuleName=node_module_name
    )

    write_file(test_dir / f"{node_name}.unit.test.js", content)


def generate_integration_test(node_name: str, output_path: Path) -> None:
    """Generate integration test file."""
    test_dir = output_path / "integration"
    create_directory(test_dir)

    node_id = node_name.replace("-", "") + "1"
    content = INTEGRATION_TEST_TEMPLATE.format(
        nodeName=node_name,
        nodeId=node_id
    )

    write_file(test_dir / f"{node_name}.integration.test.js", content)


def generate_e2e_test(node_name: str, output_path: Path) -> None:
    """Generate E2E test file."""
    test_dir = output_path / "e2e"
    create_directory(test_dir)

    node_module_name = to_camel_case(node_name) + "Node"
    content = E2E_TEST_TEMPLATE.format(
        nodeName=node_name,
        nodeModuleName=node_module_name
    )

    write_file(test_dir / f"{node_name}.e2e.test.js", content)


def generate_helpers(output_path: Path) -> None:
    """Generate test helper files."""
    helpers_dir = output_path / "helpers"
    create_directory(helpers_dir)

    write_file(helpers_dir / "mock-red.js", MOCK_RED_HELPER)


def generate_fixtures(output_path: Path) -> None:
    """Generate fixtures directory and example files."""
    fixtures_dir = output_path / "fixtures"
    create_directory(fixtures_dir)

    example_flow = '''{
    "comment": "Example test flow fixture",
    "flows": []
}
'''
    write_file(fixtures_dir / "example-flow.json", example_flow)


def generate_docker_compose(output_path: Path) -> None:
    """Generate docker-compose.test.yml."""
    # Place docker-compose in parent of test directory
    parent_path = output_path.parent
    write_file(parent_path / "docker-compose.test.yml", DOCKER_COMPOSE_TEMPLATE)


def generate_jest_config(output_path: Path) -> None:
    """Generate jest.config.js."""
    parent_path = output_path.parent
    write_file(parent_path / "jest.config.js", JEST_CONFIG_TEMPLATE)


def main():
    parser = argparse.ArgumentParser(
        description="Generate test scaffolding for Node-RED nodes"
    )
    parser.add_argument(
        "node_name",
        help="Name of the node to generate tests for (e.g., my-node)"
    )
    parser.add_argument(
        "--type",
        choices=["unit", "integration", "e2e", "all"],
        default="all",
        help="Type of tests to generate (default: all)"
    )
    parser.add_argument(
        "--path",
        default="./test",
        help="Output directory for test files (default: ./test)"
    )
    parser.add_argument(
        "--with-config",
        action="store_true",
        help="Also generate docker-compose.test.yml and jest.config.js"
    )

    args = parser.parse_args()

    output_path = Path(args.path).resolve()
    node_name = args.node_name
    test_type = args.type

    print(f"Generating {test_type} test scaffolding for '{node_name}'")
    print(f"Output directory: {output_path}")
    print()

    # Create base test directory
    create_directory(output_path)

    # Generate helpers (always needed)
    print("Generating helpers...")
    generate_helpers(output_path)

    # Generate fixtures
    print("Generating fixtures...")
    generate_fixtures(output_path)

    # Generate requested test types
    if test_type in ["unit", "all"]:
        print("Generating unit tests...")
        generate_unit_test(node_name, output_path)

    if test_type in ["integration", "all"]:
        print("Generating integration tests...")
        generate_integration_test(node_name, output_path)

    if test_type in ["e2e", "all"]:
        print("Generating E2E tests...")
        generate_e2e_test(node_name, output_path)

    # Generate config files if requested or for integration/all
    if args.with_config or test_type in ["integration", "all"]:
        print("Generating configuration files...")
        generate_docker_compose(output_path)
        generate_jest_config(output_path)

    print()
    print("Done! Next steps:")
    print("  1. Install test dependencies:")
    print("     npm install --save-dev jest node-red-node-test-helper axios")
    print("  2. Update the generated test files with your node's specific logic")
    print("  3. Run tests:")
    print("     npm test              # Run all tests")
    print("     npm run test:unit     # Run unit tests only")
    print("     npm run test:integration  # Run integration tests")
    print("     npm run test:e2e      # Run E2E tests")


if __name__ == "__main__":
    main()
