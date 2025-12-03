# Skills

This directory contains custom skills that extend Claude's capabilities with specialized knowledge, workflows, and tools.

## Available Skills

| Skill | Description |
|-------|-------------|
| [skill-creator](skills/skill-creator/SKILL.md) | Guide for creating effective skills that extend Claude's capabilities |
| [node-red-node-development](skills/node-red-node-development/SKILL.md) | Comprehensive guide for developing Node-RED nodes with lifecycle handlers, edit dialogs, and packaging |
| [javascript-async-patterns](skills/javascript-async-patterns/SKILL.md) | Comprehensive guide for JavaScript asynchronous programming patterns including async/await, EventEmitters, and state machines |
| [node-red-testing](skills/node-red-testing/SKILL.md) | Comprehensive guide for testing Node-RED nodes at all levels (unit, integration, e2e) |
| [npm-package-publishing](skills/npm-package-publishing/SKILL.md) | Comprehensive guide for publishing Node-RED nodes to npm with CI/CD workflows |
| [technical-documentation](skills/technical-documentation/SKILL.md) | Guide for creating clear, maintainable technical documentation including READMEs, changelogs, and migration guides |
| [security-practices](skills/security-practices/SKILL.md) | Comprehensive security practices for Node.js and Node-RED applications including credential management and TLS |
| [advanced-patterns](skills/advanced-patterns/SKILL.md) | Advanced software patterns for Node.js and Node-RED including factories, connection pooling, and lifecycle management |
| [fastify-server](skills/fastify-server/SKILL.md) | Comprehensive guide for Fastify web framework development with plugins, hooks, and validation |
| [openapi-fastify](skills/openapi-fastify/SKILL.md) | Guide for OpenAPI documentation with Fastify including Swagger UI, Scalar, and design-first workflows |
| [mssql](skills/mssql/SKILL.md) | Comprehensive guide for Microsoft SQL Server connectivity with connection pooling, transactions, and streaming |
| [claude-agent-sdk](skills/claude-agent-sdk/SKILL.md) | Comprehensive guide for building AI-powered applications using the Claude Agent SDK with streaming, tool calling, and Node-RED integration |

## Directory Structure

```
.claude/
├── SKILLS.md              # This file - skills overview
└── skills/                # Skills directory
    └── <skill-name>/      # Individual skill folder
        ├── SKILL.md       # Required - skill definition with YAML frontmatter
        ├── scripts/       # Optional - executable code (Python/Bash/etc.)
        ├── references/    # Optional - documentation loaded into context as needed
        └── assets/        # Optional - files used in output (templates, icons, etc.)
```

## Using Skills

Skills are automatically discovered from `.claude/skills/<skill-name>/SKILL.md` and appear in Claude's available skills list.

To invoke a skill during a conversation:
```
skill: "<skill-name>"
```

## Creating New Skills

Use the `skill-creator` skill to create new skills:
```
skill: "skill-creator"
```

Or manually:
1. Create a new directory under `.claude/skills/<skill-name>/`
2. Add a `SKILL.md` file with required YAML frontmatter (`name` and `description`)
3. Add optional `scripts/`, `references/`, and `assets/` directories as needed
