# Technical Documentation Style Guide

Comprehensive writing guidelines for consistent, clear technical documentation.

## Voice and Tone

### Active Voice

Use active voice to make documentation direct and clear.

| Passive (Avoid) | Active (Preferred) |
|-----------------|-------------------|
| The configuration file is read by the node | The node reads the configuration file |
| Errors are logged to the console | The system logs errors to the console |
| The request can be retried by setting... | Set the retry option to retry requests |

### Tense

- **Present tense** for descriptions: "This function returns a promise"
- **Imperative mood** for instructions: "Configure the server settings"
- **Future tense** only for consequences: "If you enable this, the node will retry failed requests"

### Person

- **Second person** for tutorials: "You can configure..."
- **Imperative** for quick instructions: "Configure...", "Run...", "Click..."
- **Third person** for technical descriptions: "The node processes messages..."

## Sentence Structure

### Conciseness

Keep sentences short. Aim for 15-25 words maximum.

**Too long:**
> The configuration node, which is used to store server connection details that are shared between multiple API gateway nodes in the flow, must be created before you can use the API gateway node.

**Better:**
> Create a configuration node to store shared server connection details. The API gateway nodes reference this configuration.

### One Idea Per Sentence

Split compound ideas into separate sentences.

**Combined:**
> The node validates the input and if validation fails it logs an error and stops processing but if validation succeeds it proceeds to make the API call.

**Split:**
> The node validates the input. If validation fails, it logs an error and stops processing. Otherwise, it makes the API call.

### Front-Load Important Information

Put the key information at the beginning.

**Buried:**
> In order to ensure that the connection pool doesn't run out of connections during high traffic periods, the maximum connections setting should be increased.

**Front-loaded:**
> Increase the maximum connections setting to prevent connection pool exhaustion during high traffic.

## Terminology

### Consistency

Choose one term and use it throughout. Create a terminology table for your project.

| Use | Don't Use |
|-----|-----------|
| Node-RED | node-red, NodeRED, nodeRED |
| configuration node | config node, settings node |
| flow | Flow, workflow |
| message | msg, Message |
| payload | Payload, data |

### Technical Terms

- Define terms on first use
- Link to glossary for complex terms
- Avoid jargon when simpler words work

**With jargon:**
> The node leverages async/await paradigm for non-blocking I/O operations.

**Clearer:**
> The node uses async/await to handle requests without blocking other operations.

### Abbreviations

- Spell out on first use: "Application Programming Interface (API)"
- Use abbreviation thereafter: "The API returns..."
- Common abbreviations don't need expansion: HTTP, URL, JSON

## Formatting

### Headings

Use sentence case (capitalize first word only):

```markdown
## Getting started          (correct)
## Getting Started          (incorrect)
## GETTING STARTED          (incorrect)
```

Heading hierarchy:

```markdown
# Page Title (H1) - One per page
## Major Section (H2)
### Subsection (H3)
#### Minor section (H4) - Use sparingly
```

### Lists

**Bullet points** for unordered items:
```markdown
The node supports these methods:
- GET
- POST
- PUT
- DELETE
```

**Numbered lists** for sequences:
```markdown
To configure the node:
1. Drag the node onto the canvas
2. Double-click to open settings
3. Enter the server URL
4. Click Done
```

**Parallel structure** - start each item the same way:
```markdown
Good (all start with verbs):
- Configure the server URL
- Set the timeout value
- Enable retry on failure

Bad (mixed structure):
- Server URL configuration
- Set the timeout value
- Retry on failure should be enabled
```

### Code Formatting

**Inline code** for:
- File names: `package.json`
- Node types: `api-gateway`
- Properties: `msg.payload`
- Short commands: `npm install`
- Values: `true`, `null`, `"string"`

**Code blocks** for:
- Multi-line code
- Command sequences
- Configuration files
- Example output

Always specify the language:

````markdown
```javascript
const result = await gateway.request(options);
```

```bash
npm install @scope/node-red-contrib-example
```

```json
{
    "server": "https://api.example.com",
    "timeout": 5000
}
```
````

### Tables

Use tables for structured comparisons:

```markdown
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| timeout | number | 30000 | Request timeout in milliseconds |
| retries | number | 0 | Number of retry attempts |
| validateStatus | function | - | Custom status validation |
```

### Admonitions

Use consistent formatting for notes, warnings, and tips:

```markdown
> **Note:** Additional information that's helpful but not critical.

> **Warning:** Important information to prevent errors or data loss.

> **Tip:** Optional suggestion to improve the user's experience.

> **Important:** Critical information the user must know.
```

## Links

### Descriptive Link Text

**Good:**
- See the [configuration guide](./configuration.md) for details
- Read more about [error handling patterns](./errors.md)

**Bad:**
- Click [here](./configuration.md) for the configuration guide
- For more information, see [this page](./errors.md)

### Internal vs External Links

- **Internal links**: Use relative paths (`./configuration.md`)
- **External links**: Use full URLs (`https://nodered.org/docs`)
- Add context for external links: "See the [Node-RED documentation](https://nodered.org/docs) for flow programming basics"

## Code Examples

### Completeness

Examples should be copy-paste ready when possible.

**Incomplete:**
```javascript
// Configure the options
const options = { ... };
```

**Complete:**
```javascript
const options = {
    server: 'https://api.example.com',
    timeout: 5000,
    retries: 3
};
```

### Realistic Values

Use believable placeholder values:

| Type | Good | Avoid |
|------|------|-------|
| URLs | `https://api.example.com` | `http://foo.bar` |
| Names | `user-service`, `OrderProcessor` | `foo`, `MyClass` |
| IDs | `user-123`, `order-456` | `abc123`, `xxx` |
| Emails | `user@example.com` | `foo@bar.baz` |

### Comments

Comment non-obvious code, not obvious code:

```javascript
// Good: explains why
const timeout = 30000; // 30 seconds, matching server-side timeout

// Bad: states the obvious
const timeout = 30000; // set timeout to 30000
```

### Error Handling

Show error handling in examples when relevant:

```javascript
try {
    const result = await gateway.request(options);
    // Process successful result
} catch (error) {
    if (error.code === 'TIMEOUT') {
        // Handle timeout specifically
    } else {
        // Handle other errors
    }
}
```

## Document Structure

### Information Architecture

Organize content by user task, not system structure:

**Task-oriented (Good):**
```
docs/
├── getting-started.md
├── configuration.md
├── sending-requests.md
├── handling-errors.md
├── authentication.md
└── troubleshooting.md
```

**System-oriented (Avoid):**
```
docs/
├── node-api-gateway.md
├── node-config.md
├── class-request-handler.md
├── class-error-handler.md
└── utils.md
```

### Page Structure

Each documentation page should have:

1. **Title**: Clear, descriptive H1
2. **Overview**: 1-2 sentences explaining what this page covers
3. **Prerequisites** (if applicable): What users need to know/have
4. **Content**: Main documentation content
5. **Next steps** (if applicable): Where to go next
6. **Related topics**: Links to related documentation

### Progressive Disclosure

Start with the simplest case, then add complexity:

```markdown
## Basic Usage

The simplest way to use the node:

[Basic example]

## Adding Options

Customize behavior with options:

[Example with options]

## Advanced Configuration

For complex scenarios:

[Advanced example]
```

## Accessibility

### Image Alt Text

Provide meaningful alt text for images:

```markdown
![Flow diagram showing inject node connected to API gateway node connected to debug node](./images/basic-flow.png)
```

### Heading Hierarchy

Don't skip heading levels. Use H2 after H1, H3 after H2:

```markdown
# Title (H1)
## Section (H2)
### Subsection (H3)
## Another Section (H2)  // Back to H2, not H4
```

### Color Independence

Don't rely on color alone to convey information:

**Color-dependent:**
> Green items are optional, red items are required.

**Accessible:**
> Optional items are marked with "(optional)". Required items are marked with "(required)" or an asterisk (*).

## Review Checklist

Before publishing documentation:

- [ ] Spelling and grammar checked
- [ ] All code examples tested
- [ ] Links verified (internal and external)
- [ ] Headings follow hierarchy
- [ ] Consistent terminology throughout
- [ ] Prerequisites clearly stated
- [ ] Screenshots/diagrams current
- [ ] Version numbers accurate
- [ ] No sensitive information (API keys, internal URLs)
