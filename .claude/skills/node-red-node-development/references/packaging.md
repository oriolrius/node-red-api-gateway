# Node-RED Node Packaging Reference

> Source: https://nodered.org/docs/creating-nodes/packaging

## Overview

Nodes are packaged as npm modules for easy installation and dependency management.

## Naming Requirements (Updated January 2022)

All new packages **must use scoped names**:

```
@myScope/node-red-my-node
```

- Use your npm username or organization as scope
- The `node-red` keyword helps association but is optional
- Forks may retain original names under your scope

## Directory Structure

```
@myScope/node-red-sample/
├── LICENSE
├── README.md
├── package.json
├── examples/
│   ├── example-1.json
│   └── example-2.json
└── nodes/
    ├── icons/
    │   └── my-icon.svg
    ├── my-node.html
    └── my-node.js
```

No strict directory structure required, but this is conventional.

## package.json

### Minimal Configuration

```json
{
    "name": "@myScope/node-red-sample",
    "version": "1.0.0",
    "description": "A sample Node-RED node",
    "keywords": ["node-red"],
    "node-red": {
        "nodes": {
            "sample": "nodes/sample.js"
        }
    }
}
```

### Complete Configuration

```json
{
    "name": "@myScope/node-red-sample",
    "version": "1.0.0",
    "description": "A sample Node-RED node for doing X",
    "author": "Your Name <email@example.com>",
    "license": "MIT",
    "repository": {
        "type": "git",
        "url": "https://github.com/username/node-red-sample.git"
    },
    "bugs": {
        "url": "https://github.com/username/node-red-sample/issues"
    },
    "homepage": "https://github.com/username/node-red-sample#readme",
    "keywords": [
        "node-red"
    ],
    "engines": {
        "node": ">=14.0.0"
    },
    "dependencies": {
        "some-library": "^2.0.0"
    },
    "devDependencies": {
        "node-red-node-test-helper": "^0.3.0"
    },
    "node-red": {
        "version": ">=2.0.0",
        "nodes": {
            "sample-input": "nodes/sample-input.js",
            "sample-output": "nodes/sample-output.js",
            "sample-config": "nodes/sample-config.js"
        }
    }
}
```

### node-red Section Fields

| Field | Description |
|-------|-------------|
| `version` | Node-RED version constraint (e.g., `">=2.0.0"`) |
| `nodes` | Object mapping node names to their `.js` files |

### Keywords

Only add `"node-red"` keyword when:
- Node is stable and working
- Documentation is complete
- Ready for public use

## Multiple Nodes per Package

```json
{
    "node-red": {
        "nodes": {
            "node-a": "nodes/node-a.js",
            "node-b": "nodes/node-b.js",
            "shared-config": "nodes/shared-config.js"
        }
    }
}
```

## Icons

Place custom icons in an `icons` folder adjacent to node files:

```
nodes/
├── icons/
│   ├── my-icon.svg      # Preferred format
│   └── my-icon.png      # 40x60 PNG also supported
├── my-node.html
└── my-node.js
```

Reference in node definition:

```javascript
RED.nodes.registerType('my-node', {
    icon: "my-icon.svg",
    // ...
});
```

## Examples

Place example flows in `examples/` directory:

```
examples/
├── basic-usage.json
├── advanced-features.json
└── integration-example.json
```

Examples appear in Node-RED's Import menu under Examples.

### Example File Format

Export flows from Node-RED editor and save as JSON:

```json
[
    {
        "id": "example-flow",
        "type": "tab",
        "label": "Basic Usage Example"
    },
    {
        "id": "node1",
        "type": "my-node",
        "name": "Example Node",
        "x": 200,
        "y": 100
    }
]
```

## Local Testing

### Install for Development

```bash
cd ~/.node-red
npm install /path/to/your/node-module
```

Or using npm link:

```bash
# In your node module directory
npm link

# In Node-RED user directory
cd ~/.node-red
npm link @myScope/node-red-sample
```

### Restart Node-RED

After installation, restart Node-RED to load the new node.

## Publishing to npm

1. **Login to npm**
   ```bash
   npm login
   ```

2. **Verify package.json**
   - Correct name (scoped)
   - Accurate version
   - Complete description
   - Proper keywords

3. **Publish**
   ```bash
   npm publish --access public
   ```

   Note: Scoped packages require `--access public` for public visibility.

## Publishing to flows.nodered.org

Since April 2020, automatic indexing is disabled. Manual submission required:

1. Ensure all packaging requirements met
2. Visit [flows.nodered.org](https://flows.nodered.org)
3. Click the `+` button
4. Select 'node'
5. Complete submission form

For updates, use the 'request refresh' link (requires login).

## README Best Practices

Include:

1. **Description** - What the node does
2. **Installation** - `npm install @myScope/node-red-sample`
3. **Usage** - How to use the node
4. **Configuration** - Available settings
5. **Examples** - Screenshots, flow examples
6. **API** - Message properties, inputs/outputs
7. **Changelog** - Version history
8. **License** - Clear licensing terms

### README Template

```markdown
# @myScope/node-red-sample

A Node-RED node for doing X.

## Installation

```bash
cd ~/.node-red
npm install @myScope/node-red-sample
```

## Usage

Drag the node from the palette and configure...

## Configuration

| Property | Type | Description |
|----------|------|-------------|
| Name | string | Node instance name |
| Server | config | Server configuration |

## Inputs

| Property | Type | Description |
|----------|------|-------------|
| payload | string | The data to process |

## Outputs

| Property | Type | Description |
|----------|------|-------------|
| payload | object | The processed result |

## Example

![Example Flow](examples/screenshot.png)

## License

MIT
```

## Versioning

Follow semantic versioning:

- **MAJOR** - Breaking changes
- **MINOR** - New features, backward compatible
- **PATCH** - Bug fixes, backward compatible

Update version before publishing:

```bash
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.1 -> 1.1.0
npm version major  # 1.1.0 -> 2.0.0
```
