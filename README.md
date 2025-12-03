# @user/node-red-api-gateway

Node-RED nodes for API gateway functionality.

## Installation

### From npm (once published)

```bash
cd ~/.node-red
npm install @user/node-red-api-gateway
```

### For Development

```bash
cd ~/.node-red
npm install /path/to/node-red-api-gateway
```

Or using npm link:

```bash
# In the node-red-api-gateway directory
npm link

# In your Node-RED user directory
cd ~/.node-red
npm link @user/node-red-api-gateway
```

## Development

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0

### Setup

```bash
npm install
```

### Running Tests

```bash
# Run tests once
npm test

# Run tests in watch mode
npm run test:watch
```

### Linting

```bash
# Check for linting errors
npm run lint

# Fix linting errors automatically
npm run lint:fix
```

### Project Structure

```
node-red-api-gateway/
├── nodes/                 # Node-RED nodes
│   ├── icons/            # Custom node icons (SVG preferred)
│   ├── lower-case.js     # Example node runtime
│   └── lower-case.html   # Example node editor
├── test/                  # Test files
│   └── lower-case_spec.js
├── examples/              # Example flows (appear in Node-RED import menu)
│   └── lower-case-example.json
├── package.json
├── .eslintrc.json
└── README.md
```

### Creating a New Node

Each node requires two files:

1. **JavaScript file** (`nodes/my-node.js`) - Runtime behavior
2. **HTML file** (`nodes/my-node.html`) - Editor UI and help text

#### Basic Node Template

**my-node.js:**
```javascript
module.exports = function(RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.on('input', function(msg, send, done) {
            // Node-RED 1.0+ compatibility
            send = send || function() { node.send.apply(node, arguments); };

            try {
                // Process message
                send(msg);
                if (done) done();
            } catch (err) {
                if (done) done(err);
                else node.error(err, msg);
            }
        });

        node.on('close', function(removed, done) {
            // Cleanup
            if (done) done();
        });
    }

    RED.nodes.registerType("my-node", MyNode);
};
```

**my-node.html:**
```html
<script type="text/javascript">
    RED.nodes.registerType('my-node', {
        category: 'function',
        color: '#a6bbcf',
        defaults: {
            name: { value: "" }
        },
        inputs: 1,
        outputs: 1,
        icon: "font-awesome/fa-cog",
        label: function() {
            return this.name || "my-node";
        }
    });
</script>

<script type="text/html" data-template-name="my-node">
    <div class="form-row">
        <label for="node-input-name"><i class="fa fa-tag"></i> Name</label>
        <input type="text" id="node-input-name" placeholder="Name">
    </div>
</script>

<script type="text/html" data-help-name="my-node">
    <p>Description of what this node does.</p>
</script>
```

#### Register the Node

Add the node to `package.json`:

```json
{
    "node-red": {
        "nodes": {
            "my-node": "nodes/my-node.js"
        }
    }
}
```

### Testing Nodes

Create a test file in `test/my-node_spec.js`:

```javascript
const helper = require("node-red-node-test-helper");
const myNode = require("../nodes/my-node.js");

helper.init(require.resolve("node-red"));

describe("my-node Node", function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it("should be loaded", function (done) {
        const flow = [{ id: "n1", type: "my-node", name: "test" }];
        helper.load(myNode, flow, function () {
            const n1 = helper.getNode("n1");
            n1.should.have.property("name", "test");
            done();
        });
    });
});
```

## Nodes

### lower-case

A simple example node that converts string payloads to lower case.

**Inputs:**
- `msg.payload` (string) - Text to convert

**Outputs:**
- `msg.payload` (string) - Converted text in lower case

## License

MIT
