# Node-RED Node HTML API Reference

> Source: https://nodered.org/docs/creating-nodes/node-html

## Overview

The `.html` file defines how a node appears in the Node-RED editor. It contains three `<script>` sections:

1. **Node Definition** - Registers the node with the editor
2. **Edit Template** - Defines the edit dialog content
3. **Help Text** - Displayed in Info sidebar

## Node Registration

```html
<script type="text/javascript">
    RED.nodes.registerType('node-type', {
        // Node definition object
    });
</script>
```

**Important:** The type string must match the value used in `.js` file's `RED.nodes.registerType()`.

## Node Definition Properties

### Required Properties

| Property | Description |
|----------|-------------|
| `category` | Palette category (e.g., `"function"`, `"network"`, `"config"`) |
| `defaults` | Object defining editable properties |
| `inputs` | Number of inputs: `0` or `1` |
| `outputs` | Number of outputs: `0` or more |

### Visual Properties

| Property | Description |
|----------|-------------|
| `color` | Background color (hex string, e.g., `"#a6bbcf"`) |
| `icon` | Icon file name (e.g., `"file.svg"`) |
| `align` | Alignment: `"left"` or `"right"` |

### Label Properties

| Property | Description |
|----------|-------------|
| `label` | Function returning display label |
| `paletteLabel` | Function returning palette label |
| `labelStyle` | CSS style for label (e.g., `"node_label_italic"`) |
| `inputLabels` | Function/array for input port labels |
| `outputLabels` | Function/array for output port labels |

### Callback Properties

| Property | Description |
|----------|-------------|
| `oneditprepare` | Called when edit dialog is being built |
| `oneditsave` | Called when edit dialog OK is clicked |
| `oneditcancel` | Called when edit dialog is cancelled |
| `oneditdelete` | Called when delete button pressed (config nodes) |
| `oneditresize` | Called when edit dialog is resized |
| `onpaletteadd` | Called when node type added to palette |
| `onpaletteremove` | Called when node type removed from palette |

## Complete Example

```html
<script type="text/javascript">
    RED.nodes.registerType('my-node', {
        category: 'function',
        color: '#a6bbcf',
        defaults: {
            name: { value: "" },
            server: { value: "", type: "remote-server" },
            topic: { value: "", required: true },
            count: { value: 1, validate: RED.validators.number() }
        },
        credentials: {
            apiKey: { type: "password" }
        },
        inputs: 1,
        outputs: 1,
        icon: "file.svg",
        label: function() {
            return this.name || "my-node";
        },
        paletteLabel: "My Node",
        inputLabels: "input message",
        outputLabels: ["output message"],
        oneditprepare: function() {
            // Setup edit dialog
            $("#node-input-count").spinner({ min: 1, max: 10 });
        },
        oneditsave: function() {
            // Validate before save
        },
        oneditcancel: function() {
            // Cleanup if cancelled
        }
    });
</script>
```

## Defaults Object

Each property in `defaults` can have:

| Field | Description |
|-------|-------------|
| `value` | Default value |
| `required` | Boolean - must have non-blank value |
| `validate` | Validation function |
| `type` | Reference to config node type |

### Built-in Validators

```javascript
defaults: {
    name: { value: "" },
    count: { value: 1, validate: RED.validators.number() },
    url: { value: "", validate: RED.validators.regex(/^https?:\/\//) },
    typed: { value: "", validate: RED.validators.typedInput("typedField") }
}
```

### Custom Validator

```javascript
defaults: {
    value: {
        value: "",
        validate: function(v) {
            // Return true if valid, false if invalid
            return v.length > 0 && v.length < 100;
        }
    }
}
```

## Edit Dialog Template

```html
<script type="text/html" data-template-name="node-type">
    <div class="form-row">
        <label for="node-input-name">
            <i class="fa fa-tag"></i> Name
        </label>
        <input type="text" id="node-input-name" placeholder="Name">
    </div>

    <div class="form-row">
        <label for="node-input-topic">
            <i class="fa fa-tasks"></i> Topic
        </label>
        <input type="text" id="node-input-topic">
    </div>

    <div class="form-row">
        <label for="node-input-server">
            <i class="fa fa-server"></i> Server
        </label>
        <input type="text" id="node-input-server">
    </div>

    <div class="form-tips">
        <b>Tip:</b> This is helpful information.
    </div>
</script>
```

### Input ID Naming Convention

- Regular nodes: `node-input-<propertyname>`
- Config nodes: `node-config-input-<propertyname>`

### Common Form Elements

```html
<!-- Text input -->
<input type="text" id="node-input-name">

<!-- Checkbox -->
<input type="checkbox" id="node-input-enabled" style="width:auto">

<!-- Select dropdown -->
<select id="node-input-type">
    <option value="str">String</option>
    <option value="num">Number</option>
</select>

<!-- Textarea -->
<textarea id="node-input-template" rows="5"></textarea>
```

## Help Text Template

```html
<script type="text/html" data-help-name="node-type">
    <p>Brief description of the node (becomes tooltip).</p>

    <h3>Inputs</h3>
    <dl class="message-properties">
        <dt>payload
            <span class="property-type">string | buffer</span>
        </dt>
        <dd>The payload to process.</dd>
        <dt class="optional">topic
            <span class="property-type">string</span>
        </dt>
        <dd>Optional topic for the message.</dd>
    </dl>

    <h3>Outputs</h3>
    <dl class="message-properties">
        <dt>payload
            <span class="property-type">string</span>
        </dt>
        <dd>The processed result.</dd>
    </dl>

    <h3>Details</h3>
    <p>Extended description and usage details.</p>

    <h3>References</h3>
    <ul>
        <li><a href="https://example.com">External documentation</a></li>
    </ul>
</script>
```

### Help Style Classes

- `message-properties` - For input/output property lists
- `property-type` - Type annotation styling
- `optional` - Mark optional properties

## Configuration Node HTML

Config nodes use `category: "config"` and different input ID prefix:

```html
<script type="text/javascript">
    RED.nodes.registerType('remote-server', {
        category: 'config',
        defaults: {
            host: { value: "localhost", required: true },
            port: { value: 1234, required: true, validate: RED.validators.number() }
        },
        label: function() {
            return this.host + ":" + this.port;
        }
    });
</script>

<script type="text/html" data-template-name="remote-server">
    <div class="form-row">
        <label for="node-config-input-host">
            <i class="fa fa-bookmark"></i> Host
        </label>
        <input type="text" id="node-config-input-host">
    </div>
    <div class="form-row">
        <label for="node-config-input-port">
            <i class="fa fa-bookmark"></i> Port
        </label>
        <input type="text" id="node-config-input-port">
    </div>
</script>
```

## Editor Hooks

### oneditprepare

Called when dialog opens, before form is populated:

```javascript
oneditprepare: function() {
    var node = this;

    // Initialize jQuery widgets
    $("#node-input-list").editableList({
        addItem: function(container, i, data) { },
        removeItem: function(data) { },
        sortable: true
    });

    // Setup event handlers
    $("#node-input-type").on("change", function() {
        var type = $(this).val();
        if (type === "advanced") {
            $(".advanced-options").show();
        } else {
            $(".advanced-options").hide();
        }
    });

    // Initialize typed input
    $("#node-input-payload").typedInput({
        types: ['str', 'num', 'bool', 'json', 'msg', 'flow', 'global']
    });
}
```

### oneditsave

Called when user clicks Done - return false to prevent save:

```javascript
oneditsave: function() {
    var node = this;

    // Collect data from custom widgets
    var items = $("#node-input-list").editableList('items');
    node.items = [];
    items.each(function(i) {
        var data = $(this).data('data');
        node.items.push(data);
    });

    // Validate (return false to prevent save)
    if (node.items.length === 0) {
        return false;
    }
}
```

### oneditresize

Called when dialog resizes:

```javascript
oneditresize: function(size) {
    var rows = $("#dialog-form>div:not(.node-text-editor-row)");
    var height = size.height;
    for (var i = 0; i < rows.length; i++) {
        height -= $(rows[i]).outerHeight(true);
    }
    var editorRow = $("#dialog-form>div.node-text-editor-row");
    height -= parseInt(editorRow.css("marginTop")) + parseInt(editorRow.css("marginBottom"));
    $(".node-text-editor").css("height", height + "px");
    this.editor.resize();
}
```
