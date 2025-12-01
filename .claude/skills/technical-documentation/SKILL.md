---
name: technical-documentation
description: Comprehensive guide for technical documentation including guides, how-tos, architecture docs, migration guides, troubleshooting, example creation, and changelog management. This skill should be used when writing or updating README files, creating usage examples, documenting APIs, writing migration guides, managing changelogs, or creating Node-RED flow examples.
---

# Technical Documentation

This skill provides patterns, templates, and best practices for creating clear, maintainable technical documentation for Node-RED projects and related software.

## When to Use This Skill

- Writing or updating README files
- Creating usage guides and how-tos
- Documenting architecture and design decisions
- Writing migration guides for breaking changes
- Creating troubleshooting documentation
- Building Node-RED flow examples
- Managing changelogs and release notes
- Creating API documentation

## Documentation Types

### README Files

A README is the first documentation users encounter. Structure for maximum clarity:

```markdown
# Project Name

One-line description of what this project does.

## Features

- Feature 1: Brief description
- Feature 2: Brief description

## Installation

\`\`\`bash
npm install @scope/package-name
\`\`\`

## Quick Start

Minimal example to get started immediately.

## Configuration

Document all configuration options with defaults.

## Usage Examples

Show common use cases with code examples.

## API Reference

Link to detailed API docs or include inline.

## Troubleshooting

Common issues and solutions.

## Contributing

How to contribute to the project.

## License

License type and link to LICENSE file.
```

### How-To Guides

Task-oriented documentation that guides users through specific goals:

```markdown
# How to [Accomplish Task]

## Overview

Brief description of what this guide covers and prerequisites.

## Prerequisites

- Required software/knowledge
- Configuration needed

## Steps

### Step 1: [Action]

Explanation of what this step accomplishes.

\`\`\`bash
# Commands or code
\`\`\`

Expected output or result.

### Step 2: [Action]

Continue with numbered steps...

## Verification

How to confirm the task was completed successfully.

## Next Steps

Related guides or advanced topics.
```

### Architecture Documentation

Document system design for maintainers and contributors:

```markdown
# Architecture Overview

## System Context

High-level view of where this project fits in the larger ecosystem.

## Components

### Component Name

- **Purpose**: What it does
- **Responsibilities**: What it's responsible for
- **Dependencies**: What it depends on
- **Interface**: How other components interact with it

## Data Flow

Describe how data moves through the system.

## Key Design Decisions

### Decision 1: [Title]

- **Context**: What situation led to this decision
- **Decision**: What was decided
- **Rationale**: Why this choice was made
- **Consequences**: Trade-offs and implications

## Deployment

How the system is deployed and operated.
```

### Migration Guides

Help users upgrade between versions:

```markdown
# Migration Guide: v1.x to v2.x

## Overview

Summary of breaking changes and new features.

## Breaking Changes

### Change 1: [Description]

**Before (v1.x):**
\`\`\`javascript
// Old way
\`\`\`

**After (v2.x):**
\`\`\`javascript
// New way
\`\`\`

**Migration steps:**
1. Step one
2. Step two

### Change 2: [Description]

Continue for each breaking change...

## Deprecated Features

Features that still work but will be removed in future versions.

## New Features

Optional improvements users can adopt.

## Checklist

- [ ] Update dependency version
- [ ] Migrate breaking change 1
- [ ] Migrate breaking change 2
- [ ] Test functionality
- [ ] Update configuration
```

### Troubleshooting Documentation

Help users solve problems independently:

```markdown
# Troubleshooting

## Common Issues

### Issue: [Error Message or Symptom]

**Symptoms:**
- What the user observes

**Cause:**
Why this happens

**Solution:**
\`\`\`bash
# Commands to fix
\`\`\`

Or step-by-step instructions.

### Issue: [Another Problem]

Continue pattern...

## Diagnostic Commands

Useful commands for debugging:

\`\`\`bash
# Check version
node -v
npm list @scope/package

# View logs
tail -f ~/.node-red/node-red.log

# Test connectivity
curl -v http://localhost:1880
\`\`\`

## Getting Help

- GitHub Issues: link
- Community Forum: link
- Stack Overflow tag: tag-name
```

## Node-RED Flow Examples

### Example Flow Structure

Create example flows in the `examples/` directory:

```
examples/
├── basic-usage.json
├── advanced-configuration.json
├── error-handling.json
└── README.md
```

### Example Flow JSON Format

```json
[
    {
        "id": "example-flow-tab",
        "type": "tab",
        "label": "Example: Basic Usage",
        "disabled": false,
        "info": "This flow demonstrates basic usage of the API Gateway node.\n\n## Prerequisites\n- Configure the server connection\n- API endpoint must be accessible\n\n## How it works\n1. Inject node triggers the request\n2. API Gateway node calls the endpoint\n3. Debug node shows the response"
    },
    {
        "id": "inject-node",
        "type": "inject",
        "z": "example-flow-tab",
        "name": "Trigger Request",
        "props": [
            {
                "p": "payload"
            }
        ],
        "repeat": "",
        "crontab": "",
        "once": false,
        "onceDelay": 0.1,
        "topic": "",
        "payload": "{}",
        "payloadType": "json",
        "x": 150,
        "y": 100,
        "wires": [["api-gateway-node"]]
    },
    {
        "id": "api-gateway-node",
        "type": "api-gateway",
        "z": "example-flow-tab",
        "name": "Call API",
        "server": "",
        "endpoint": "/api/example",
        "method": "GET",
        "x": 350,
        "y": 100,
        "wires": [["debug-node"]]
    },
    {
        "id": "debug-node",
        "type": "debug",
        "z": "example-flow-tab",
        "name": "Show Response",
        "active": true,
        "tosidebar": true,
        "console": false,
        "tostatus": false,
        "complete": "payload",
        "targetType": "msg",
        "x": 550,
        "y": 100,
        "wires": []
    }
]
```

### Example Flow Best Practices

1. **Use descriptive tab info**: Include prerequisites, how it works, and expected behavior
2. **Name all nodes**: Every node should have a meaningful `name` property
3. **Logical positioning**: Arrange nodes left-to-right, top-to-bottom
4. **Include comments**: Use comment nodes to explain complex sections
5. **Avoid hardcoded values**: Use environment variables or placeholders for sensitive data
6. **Test before publishing**: Import and run each example flow

### Examples README

Create an `examples/README.md`:

```markdown
# Example Flows

Import these example flows into Node-RED to learn how to use [Package Name].

## Available Examples

### basic-usage.json

Demonstrates the simplest way to use the node. Good starting point for new users.

**What it does:**
- Sends a simple GET request
- Displays the response

### advanced-configuration.json

Shows advanced features like authentication and error handling.

**What it does:**
- Configures authentication headers
- Handles errors gracefully
- Implements retry logic

### error-handling.json

Demonstrates proper error handling patterns.

**What it does:**
- Catches and logs errors
- Implements fallback behavior
- Shows status reporting

## How to Import

1. Open Node-RED editor
2. Menu (hamburger icon) > Import
3. Select file or paste JSON
4. Click Import
5. Deploy the flow
```

## Changelog Management

### Format: Keep a Changelog

Use [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- New features not yet released

### Changed
- Changes to existing functionality

### Deprecated
- Features that will be removed in future versions

### Removed
- Features removed in this release

### Fixed
- Bug fixes

### Security
- Security-related changes

## [1.2.0] - 2024-03-15

### Added
- Added retry configuration option (#45)
- Added support for custom headers

### Fixed
- Fixed timeout not being respected (#42)
- Fixed memory leak in connection pool

## [1.1.0] - 2024-02-01

### Added
- Initial feature set

[Unreleased]: https://github.com/user/repo/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/user/repo/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/user/repo/releases/tag/v1.1.0
```

### Changelog Entry Guidelines

#### Added
New features and capabilities:
```markdown
- Added retry configuration with exponential backoff (#123)
- Added `timeout` option to configuration node
- Added support for OAuth2 authentication
```

#### Changed
Modifications to existing features:
```markdown
- Changed default timeout from 30s to 10s
- Updated minimum Node.js version to 18
- Improved error messages for connection failures
```

#### Deprecated
Features that will be removed:
```markdown
- Deprecated `oldMethod()` in favor of `newMethod()`
- Deprecated legacy configuration format (will be removed in v3.0)
```

#### Removed
Features that have been removed:
```markdown
- Removed support for Node.js 14
- Removed deprecated `legacyOption` configuration
```

#### Fixed
Bug fixes:
```markdown
- Fixed race condition in request queue (#89)
- Fixed incorrect status display after reconnection
- Fixed memory leak when handling large responses
```

#### Security
Security patches:
```markdown
- Fixed XSS vulnerability in error display
- Updated dependencies to patch CVE-2024-XXXXX
- Added input sanitization for user-provided URLs
```

### Writing Good Changelog Entries

1. **Start with a verb**: Added, Changed, Fixed, Removed
2. **Be specific**: Mention what changed, not just that something changed
3. **Reference issues**: Include issue/PR numbers when applicable
4. **User perspective**: Describe impact on users, not implementation details
5. **Keep it scannable**: One line per change, grouped by type

**Good:**
```markdown
- Fixed timeout not being applied to retry attempts (#42)
```

**Bad:**
```markdown
- Bug fix
- Updated code
- Fixed issue reported by user
```

### Breaking Changes

Document breaking changes prominently:

```markdown
## [2.0.0] - 2024-04-01

### BREAKING CHANGES

- **Configuration format changed**: The `server` property now requires a URL instead of hostname/port

  Before:
  \`\`\`json
  { "hostname": "api.example.com", "port": 443 }
  \`\`\`

  After:
  \`\`\`json
  { "server": "https://api.example.com" }
  \`\`\`

  See [Migration Guide](./docs/migration-v2.md) for details.

- **Minimum Node.js version**: Now requires Node.js 18+

### Added
- New feature...
```

## Writing Style Guidelines

### General Principles

1. **Be concise**: Use short sentences and paragraphs
2. **Use active voice**: "Configure the node" not "The node should be configured"
3. **Present tense**: "This function returns" not "This function will return"
4. **Second person for instructions**: "You can configure..." or imperative "Configure..."
5. **Consistent terminology**: Pick terms and use them throughout

### Code Examples

1. **Complete and runnable**: Examples should work when copied
2. **Minimal**: Show only what's necessary for the concept
3. **Commented**: Explain non-obvious parts
4. **Realistic**: Use believable values, not "foo" and "bar"

```javascript
// Good: Realistic and complete
const config = {
    server: 'https://api.example.com',
    timeout: 5000,
    retries: 3
};

// Bad: Abstract and incomplete
const config = { foo: 'bar' };
```

### Formatting

1. **Headings**: Use sentence case ("Getting started" not "Getting Started")
2. **Lists**: Use bullet points for unordered items, numbers for sequences
3. **Code blocks**: Always specify language for syntax highlighting
4. **Links**: Use descriptive text ("see the configuration guide" not "click here")

## Reference Documentation

For detailed templates and style guidelines:

- `references/style-guide.md` - Comprehensive writing style reference
- `assets/templates/` - Ready-to-use documentation templates

## Common Documentation Mistakes

1. **Assuming knowledge**: Define terms, link to prerequisites
2. **Outdated examples**: Keep code examples synchronized with actual API
3. **Missing context**: Explain why, not just how
4. **Wall of text**: Break up with headings, lists, code blocks
5. **No error documentation**: Document what can go wrong
6. **Ignoring edge cases**: Cover unusual but valid scenarios
7. **Inconsistent formatting**: Use templates for consistency
