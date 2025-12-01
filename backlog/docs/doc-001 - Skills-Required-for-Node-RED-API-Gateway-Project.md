---
id: doc-001
title: Skills Required for Node-RED API Gateway Project
type: other
created_date: '2025-12-01 14:56'
---
# Skills Required for Node-RED API Gateway Project

Based on deep analysis of the `node-red-contrib-kafka` project, this document lists the reusable skills needed to create a similar Node-RED integration library from scratch.

> **Note:** Kafka-specific skills have been excluded as they are domain-specific to the original project.

---

## Category 1: Node-RED Node Development (Core Framework)

### 1.1 Node-RED Node Architecture Pattern
- Understanding of `RED.nodes.createNode()` lifecycle
- Configuration nodes (config) vs operational nodes (input/output)
- `node.on('input')` message processing pattern
- `node.on('close')` cleanup and disconnection
- `node.status()` updates for UI feedback
- `registerType()` and node type naming conventions

### 1.2 Node-RED Configuration Management
- Storing and retrieving node configuration
- Reference resolution between nodes (parent/broker patterns)
- Configuration persistence and restoration
- Type-safe defaults and validation

### 1.3 Node-RED UI/Frontend Development
- HTML template structure (`data-template-name`, `data-help-name`)
- jQuery integration for dynamic form rendering
- Form input binding and validation
- Conditional UI visibility based on checkboxes/selects
- Editor hooks: `oneditprepare()`, `oneditsave()`, `oneditresize()`
- Editable list widgets for dynamic arrays (`editableList` API)

### 1.4 Node-RED Status & Debug System
- Status indicators (fill color, shape, text message)
- Debug message logging with context
- Error and warning reporting
- Performance monitoring (message counts, timing)

---

## Category 2: Asynchronous Programming & Promises

### 2.1 JavaScript Async/Await Patterns
- async/await syntax and control flow
- Promise chaining and error handling
- Error propagation in async contexts
- Timeout and cancellation patterns
- Async initialization and cleanup

### 2.2 Event-Driven Architecture
- Event emitter patterns (Node.js EventEmitter)
- Registering event listeners (`on`, `once`)
- Event lifecycle management
- Producer/Consumer event handling

### 2.3 Connection State Management
- Ready/connecting/disconnected states
- State transitions and guards
- Preventing operations during invalid states
- Connection retry logic

---

## Category 3: Testing & Test Automation

### 3.1 Unit Testing with Mocks
- Creating mock objects for RED framework
- Mocking client responses
- Testing node initialization
- Testing configuration persistence

### 3.2 Integration Testing
- Testcontainers for Docker-based testing
- Docker Compose orchestration
- Container setup and health checks
- Testing client interaction
- Real message flow testing

### 3.3 End-to-End Testing
- Node-RED runtime integration
- Full flow testing with HTTP servers
- Testing UI configuration and node behavior
- Cleanup and resource management

### 3.4 Test Organization & Patterns
- Test runner scripts (`npm test`, `test:*`)
- Test isolation and setup/teardown
- Logging and debugging test failures
- Example flow validation

---

## Category 4: Documentation & Communication

### 4.1 Technical Documentation Writing
- Feature documentation (guides, how-tos)
- Implementation architecture documentation
- Migration guides for breaking changes
- Troubleshooting/debug guides
- API documentation

### 4.2 Example Creation
- Node-RED flow JSON examples
- Demonstrating feature usage
- Real-world integration examples

### 4.3 Changelog Management
- Semantic versioning (MAJOR.MINOR.PATCH)
- Changelog entries (Added, Enhanced, Fixed, Deprecated)
- Breaking change documentation
- Release notes

---

## Category 5: Build & Deployment

### 5.1 NPM Package Management
- `package.json` configuration
- Node-RED specific configuration (`node-red.nodes`)
- Dependency management and version pinning
- Publishing to npm registry

### 5.2 GitHub Actions CI/CD
- Workflow file syntax (YAML)
- Action selection and configuration (`checkout`, `setup-node`)
- Conditional execution and triggers
- Secrets management (`NPM_TOKEN`)
- Build, test, and publish pipeline

### 5.3 Version Control & Release Process
- Git tag-based triggering for releases
- Branch management strategies
- `.gitignore` configuration
- Commit conventions

---

## Category 6: File System & Configuration

### 6.1 File Handling & Certificates
- Reading certificate files (`fs.readFileSync`)
- Handling file paths and validation
- Error handling for missing files
- Support for PEM and other certificate formats

### 6.2 Configuration Serialization
- JSON configuration format
- Node-RED flow JSON structure
- Environment variable usage (`.env`)
- Configuration migration strategies

---

## Category 7: Debugging & Troubleshooting

### 7.1 Logging & Debug Strategies
- Structured logging with context (e.g., `[Node Name]`)
- Log levels (debug, info, warn, error)
- Error message clarity and debugging info
- Performance metric logging

### 7.2 Debugging Tools & Techniques
- Node.js debugging
- Browser DevTools for UI debugging
- Connection/authentication troubleshooting

---

## Category 8: Advanced Patterns

### 8.1 Factory Pattern Implementation
- Creating client instances dynamically
- Factory methods for resource creation
- Client instantiation patterns

### 8.2 Configuration Inheritance & Composition
- Config inheritance (broker → consumer/producer pattern)
- Config composition
- Field mapping and data transformation

### 8.3 Performance Optimization
- Caching strategies
- Batch processing strategies
- Connection pooling concepts

### 8.4 State & Lifecycle Management
- Node initialization lifecycle
- Connection management
- Graceful shutdown patterns
- Resource cleanup (disconnect, close)

### 8.5 Security Practices
- Credential storage and passing
- Certificate file handling
- Authentication mechanism selection
- TLS/SSL configuration
- Password field masking in UI

---

## Summary Table

| Category | Skills Count | Focus Areas |
|----------|--------------|-------------|
| Node-RED Development | 4 | Architecture, UI, Status, Configuration |
| Async Programming | 3 | Async/Await, Events, State Management |
| Testing | 4 | Unit, Integration, E2E, Organization |
| Documentation | 3 | Technical Writing, Examples, Changelog |
| Build/Deploy | 3 | NPM, GitHub Actions, Version Control |
| Configuration | 2 | File Handling, Serialization |
| Debugging | 2 | Logging, Troubleshooting |
| Advanced Patterns | 5 | Factory, Composition, Performance, Lifecycle, Security |
| **Total** | **26** | **Comprehensive skill set** |

---

## Priority Skills for New Project

For the Node-RED API Gateway project, these skills are **critical**:

1. **Node-RED Node Architecture Pattern** - Foundation for all node development
2. **Node-RED UI/Frontend Development** - Essential for configuration interfaces
3. **JavaScript Async/Await Patterns** - Required for API gateway operations
4. **Connection State Management** - Critical for gateway reliability
5. **GitHub Actions CI/CD** - Enables automated testing and publishing
6. **Security Practices** - Essential for API gateway security features

---

## Next Steps

Consider creating individual skills (in `.claude/skills/`) for:
- `node-red-node-development` - Core Node-RED patterns
- `node-red-testing` - Testing strategies for Node-RED nodes
- `npm-package-publishing` - NPM and CI/CD workflows
