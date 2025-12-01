# Skills

This directory contains custom skills that extend Claude's capabilities with specialized knowledge, workflows, and tools.

## Available Skills

| Skill | Description |
|-------|-------------|
| [skill-creator](skills/skill-creator/SKILL.md) | Guide for creating effective skills that extend Claude's capabilities |
| [node-red-node-development](skills/node-red-node-development/SKILL.md) | Comprehensive guide for developing Node-RED nodes with lifecycle handlers, edit dialogs, and packaging |

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
