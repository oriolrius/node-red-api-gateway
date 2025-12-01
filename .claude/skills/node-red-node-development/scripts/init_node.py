#!/usr/bin/env python3
"""
Node-RED Node Scaffolding Generator

Creates the basic structure for a new Node-RED node with:
- JavaScript file (.js) with proper lifecycle handlers
- HTML file (.html) with edit dialog, help text, and registration
- Updates package.json if present

Usage:
    python init_node.py <node-name> [--path <output-directory>] [--config]

Arguments:
    node-name           Name of the node (kebab-case, e.g., "my-node")
    --path              Output directory (default: current directory)
    --config            Create a configuration node instead of regular node

Examples:
    python init_node.py my-processor
    python init_node.py api-gateway --path ./nodes
    python init_node.py remote-server --config --path ./nodes
"""

import argparse
import os
import json
import re
import sys


def to_pascal_case(kebab_name: str) -> str:
    """Convert kebab-case to PascalCase."""
    return ''.join(word.capitalize() for word in kebab_name.split('-'))


def to_camel_case(kebab_name: str) -> str:
    """Convert kebab-case to camelCase."""
    pascal = to_pascal_case(kebab_name)
    return pascal[0].lower() + pascal[1:] if pascal else ''


def generate_js_file(node_name: str, is_config: bool = False) -> str:
    """Generate the JavaScript file content."""
    class_name = to_pascal_case(node_name) + 'Node'

    if is_config:
        return f'''module.exports = function(RED) {{
    function {class_name}(config) {{
        RED.nodes.createNode(this, config);

        // Store configuration properties
        this.name = config.name;
        this.host = config.host;
        this.port = config.port;

        var node = this;

        // Shared connection/resource
        this.client = null;

        /**
         * Get or create the shared connection
         */
        this.getConnection = function() {{
            if (!node.client) {{
                // Initialize shared resource
                node.client = {{
                    host: node.host,
                    port: node.port,
                    connected: false
                }};
                // TODO: Replace with actual connection logic
            }}
            return node.client;
        }};

        /**
         * Close the shared connection
         */
        this.closeConnection = function(callback) {{
            if (node.client) {{
                // TODO: Replace with actual disconnect logic
                node.client = null;
            }}
            if (callback) callback();
        }};

        // Cleanup on node close
        this.on('close', function(done) {{
            node.closeConnection(done);
        }});
    }}

    RED.nodes.registerType("{node_name}", {class_name}, {{
        credentials: {{
            username: {{ type: "text" }},
            password: {{ type: "password" }}
        }}
    }});
}}
'''
    else:
        return f'''module.exports = function(RED) {{
    function {class_name}(config) {{
        RED.nodes.createNode(this, config);

        // Store configuration
        this.name = config.name;
        // TODO: Add your config properties here

        var node = this;

        // Initial status
        node.status({{ fill: "grey", shape: "ring", text: "ready" }});

        // Handle incoming messages
        node.on('input', function(msg, send, done) {{
            // For Node-RED 0.x compatibility
            send = send || function() {{ node.send.apply(node, arguments) }};

            try {{
                // TODO: Process the message
                node.status({{ fill: "green", shape: "dot", text: "processing" }});

                // Example: pass through with modification
                // msg.payload = processPayload(msg.payload);

                send(msg);
                node.status({{ fill: "green", shape: "dot", text: "done" }});

                if (done) done();
            }} catch (err) {{
                node.status({{ fill: "red", shape: "ring", text: "error" }});
                if (done) {{
                    done(err);
                }} else {{
                    node.error(err, msg);
                }}
            }}
        }});

        // Cleanup on node close
        node.on('close', function(removed, done) {{
            if (removed) {{
                // Node has been disabled or deleted
                node.debug("{class_name} removed");
            }} else {{
                // Node is being restarted
                node.debug("{class_name} restarting");
            }}
            // TODO: Cleanup resources
            node.status({{}});
            done();
        }});
    }}

    RED.nodes.registerType("{node_name}", {class_name});
}}
'''


def generate_html_file(node_name: str, is_config: bool = False) -> str:
    """Generate the HTML file content."""
    class_name = to_pascal_case(node_name)
    input_prefix = "node-config-input" if is_config else "node-input"

    if is_config:
        return f'''<script type="text/javascript">
    RED.nodes.registerType('{node_name}', {{
        category: 'config',
        defaults: {{
            name: {{ value: "" }},
            host: {{ value: "localhost", required: true }},
            port: {{ value: 1234, required: true, validate: RED.validators.number() }}
        }},
        credentials: {{
            username: {{ type: "text" }},
            password: {{ type: "password" }}
        }},
        label: function() {{
            if (this.name) {{
                return this.name;
            }}
            return this.host + ":" + this.port;
        }}
    }});
</script>

<script type="text/html" data-template-name="{node_name}">
    <div class="form-row">
        <label for="{input_prefix}-name">
            <i class="fa fa-tag"></i> Name
        </label>
        <input type="text" id="{input_prefix}-name" placeholder="Optional display name">
    </div>
    <div class="form-row">
        <label for="{input_prefix}-host">
            <i class="fa fa-server"></i> Host
        </label>
        <input type="text" id="{input_prefix}-host" placeholder="localhost">
    </div>
    <div class="form-row">
        <label for="{input_prefix}-port">
            <i class="fa fa-hashtag"></i> Port
        </label>
        <input type="text" id="{input_prefix}-port" placeholder="1234">
    </div>
    <div class="form-row">
        <label for="{input_prefix}-username">
            <i class="fa fa-user"></i> Username
        </label>
        <input type="text" id="{input_prefix}-username">
    </div>
    <div class="form-row">
        <label for="{input_prefix}-password">
            <i class="fa fa-lock"></i> Password
        </label>
        <input type="password" id="{input_prefix}-password">
    </div>
</script>

<script type="text/html" data-help-name="{node_name}">
    <p>Configuration node for {class_name}.</p>

    <h3>Settings</h3>
    <dl class="message-properties">
        <dt>Host <span class="property-type">string</span></dt>
        <dd>The hostname or IP address of the server.</dd>
        <dt>Port <span class="property-type">number</span></dt>
        <dd>The port number to connect to.</dd>
        <dt class="optional">Username <span class="property-type">string</span></dt>
        <dd>Optional username for authentication.</dd>
        <dt class="optional">Password <span class="property-type">string</span></dt>
        <dd>Optional password for authentication.</dd>
    </dl>
</script>
'''
    else:
        return f'''<script type="text/javascript">
    RED.nodes.registerType('{node_name}', {{
        category: 'function',
        color: '#a6bbcf',
        defaults: {{
            name: {{ value: "" }}
            // TODO: Add your default properties here
            // server: {{ value: "", type: "config-node-type" }},
            // topic: {{ value: "", required: true }}
        }},
        inputs: 1,
        outputs: 1,
        icon: "file.svg",
        label: function() {{
            return this.name || "{node_name}";
        }},
        paletteLabel: "{class_name}",
        inputLabels: "input",
        outputLabels: "output",
        oneditprepare: function() {{
            // Called when edit dialog opens
            // Initialize jQuery widgets, setup event handlers, etc.
        }},
        oneditsave: function() {{
            // Called when user clicks Done
            // Return false to prevent save
        }},
        oneditcancel: function() {{
            // Called when user clicks Cancel
        }}
    }});
</script>

<script type="text/html" data-template-name="{node_name}">
    <div class="form-row">
        <label for="{input_prefix}-name">
            <i class="fa fa-tag"></i> Name
        </label>
        <input type="text" id="{input_prefix}-name" placeholder="Name">
    </div>
    <!-- TODO: Add your form fields here -->
    <!--
    <div class="form-row">
        <label for="{input_prefix}-topic">
            <i class="fa fa-tasks"></i> Topic
        </label>
        <input type="text" id="{input_prefix}-topic">
    </div>
    -->
    <div class="form-tips">
        <b>Tip:</b> Add helpful information for users here.
    </div>
</script>

<script type="text/html" data-help-name="{node_name}">
    <p>Brief description of what this node does (shown as tooltip).</p>

    <h3>Inputs</h3>
    <dl class="message-properties">
        <dt>payload
            <span class="property-type">string | buffer</span>
        </dt>
        <dd>The payload to process.</dd>
        <dt class="optional">topic
            <span class="property-type">string</span>
        </dt>
        <dd>Optional message topic.</dd>
    </dl>

    <h3>Outputs</h3>
    <dl class="message-properties">
        <dt>payload
            <span class="property-type">string</span>
        </dt>
        <dd>The processed result.</dd>
    </dl>

    <h3>Details</h3>
    <p>Detailed description of the node functionality.</p>
    <p>Explain how to use the node, what configuration options mean,
    and any important behavior users should know about.</p>

    <h3>References</h3>
    <ul>
        <li><a href="https://example.com">External documentation</a></li>
    </ul>
</script>
'''


def update_package_json(path: str, node_name: str, js_file: str) -> bool:
    """Update package.json with the new node entry."""
    package_path = os.path.join(path, 'package.json')

    if not os.path.exists(package_path):
        # Look in parent directory
        parent_package = os.path.join(os.path.dirname(path), 'package.json')
        if os.path.exists(parent_package):
            package_path = parent_package
            js_file = os.path.relpath(os.path.join(path, js_file), os.path.dirname(path))
        else:
            return False

    try:
        with open(package_path, 'r') as f:
            package = json.load(f)

        if 'node-red' not in package:
            package['node-red'] = {'nodes': {}}
        if 'nodes' not in package['node-red']:
            package['node-red']['nodes'] = {}

        package['node-red']['nodes'][node_name] = js_file

        with open(package_path, 'w') as f:
            json.dump(package, f, indent=2)

        return True
    except Exception as e:
        print(f"Warning: Could not update package.json: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Generate Node-RED node scaffolding',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('node_name', help='Node name in kebab-case (e.g., my-node)')
    parser.add_argument('--path', default='.', help='Output directory')
    parser.add_argument('--config', action='store_true', help='Create a configuration node')

    args = parser.parse_args()

    # Validate node name
    if not re.match(r'^[a-z][a-z0-9]*(-[a-z0-9]+)*$', args.node_name):
        print(f"Error: Invalid node name '{args.node_name}'")
        print("Node name must be kebab-case (e.g., 'my-node', 'api-gateway')")
        sys.exit(1)

    # Create output directory
    output_path = os.path.abspath(args.path)
    os.makedirs(output_path, exist_ok=True)

    # Generate files
    js_filename = f"{args.node_name}.js"
    html_filename = f"{args.node_name}.html"

    js_content = generate_js_file(args.node_name, args.config)
    html_content = generate_html_file(args.node_name, args.config)

    # Write files
    js_path = os.path.join(output_path, js_filename)
    html_path = os.path.join(output_path, html_filename)

    with open(js_path, 'w') as f:
        f.write(js_content)
    print(f"Created: {js_path}")

    with open(html_path, 'w') as f:
        f.write(html_content)
    print(f"Created: {html_path}")

    # Try to update package.json
    if update_package_json(output_path, args.node_name, js_filename):
        print(f"Updated: package.json")

    print(f"\nNode '{args.node_name}' scaffolding created successfully!")
    print(f"\nNext steps:")
    print(f"  1. Edit {js_filename} to implement your node logic")
    print(f"  2. Edit {html_filename} to customize the edit dialog")
    print(f"  3. Test with: cd ~/.node-red && npm install {output_path}")


if __name__ == '__main__':
    main()
