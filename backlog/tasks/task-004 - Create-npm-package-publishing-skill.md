---
id: task-004
title: Create npm-package-publishing skill
status: Done
assignee:
  - Claude
created_date: '2025-12-01 14:59'
updated_date: '2025-12-01 15:42'
labels:
  - skill
  - npm
  - ci-cd
  - github-actions
dependencies: []
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a Claude skill for NPM package management and CI/CD covering:
- NPM Package Management (package.json config, node-red.nodes, dependencies, publishing)
- GitHub Actions CI/CD (workflow syntax, actions, triggers, secrets, build/test/publish pipeline)
- Version Control & Release Process (tag-based releases, branch strategies, .gitignore, commit conventions)
- Changelog Management (semantic versioning, changelog entries, release notes)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SKILL.md created with YAML frontmatter
- [x] #2 Covers package.json configuration for Node-RED
- [x] #3 Covers GitHub Actions workflow creation
- [x] #4 Covers semantic versioning
- [x] #5 Assets contain workflow templates
- [x] #6 References contain npm publishing checklist
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Directory Structure
```
.claude/skills/npm-package-publishing/
├── SKILL.md                              # Main skill documentation
├── assets/
│   └── workflows/                        # GitHub Actions workflow templates
│       ├── ci.yml                        # CI workflow (test on PR/push)
│       ├── release.yml                   # Release workflow (publish on tag)
│       └── dependabot.yml                # Dependabot config
└── references/
    └── npm-publishing-checklist.md       # Pre-publish checklist
```

### SKILL.md Content
1. **YAML Frontmatter** - name, description for skill trigger
2. **NPM Package Management** - package.json for Node-RED, scoped packages, node-red.nodes config
3. **GitHub Actions CI/CD** - Workflow syntax, triggers, jobs, secrets management
4. **Semantic Versioning** - Version bumping, tag-based releases, CHANGELOG.md
5. **Release Process** - Pre-publish checklist, npm publish workflow

### Assets
- `workflows/ci.yml` - Test and lint on PR/push
- `workflows/release.yml` - Publish to npm on tag push
- `workflows/dependabot.yml` - Automated dependency updates

### References
- `npm-publishing-checklist.md` - Pre-publish verification steps

### Implementation Steps
1. Create skill directory structure
2. Write SKILL.md with comprehensive coverage
3. Create GitHub Actions workflow templates
4. Create npm publishing checklist reference
5. Update backlog task with completion status
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete

Created the npm-package-publishing skill with:

### Files Created
- `SKILL.md` - Comprehensive guide covering package.json config, semantic versioning, GitHub Actions, and release process
- `assets/workflows/ci.yml` - CI workflow template (lint, test matrix)
- `assets/workflows/release.yml` - Release workflow (npm publish on tag, GitHub release)
- `assets/workflows/dependabot.yml` - Automated dependency updates
- `references/npm-publishing-checklist.md` - Pre-publish verification checklist

### SKILL.md Coverage
1. **NPM Package Management** - package.json for Node-RED, scoped names, node-red.nodes, dependencies
2. **Semantic Versioning** - Version format, bump commands, CHANGELOG.md format
3. **GitHub Actions** - Workflow triggers, job matrix, secrets management
4. **Release Process** - Tag-based releases, pre-release versions, branch strategy
<!-- SECTION:NOTES:END -->
