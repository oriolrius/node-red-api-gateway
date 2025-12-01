---
id: task-004
title: Create npm-package-publishing skill
status: In Progress
assignee:
  - Claude
created_date: '2025-12-01 14:59'
updated_date: '2025-12-01 15:39'
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
- [ ] #1 SKILL.md created with YAML frontmatter
- [ ] #2 Covers package.json configuration for Node-RED
- [ ] #3 Covers GitHub Actions workflow creation
- [ ] #4 Covers semantic versioning
- [ ] #5 Assets contain workflow templates
- [ ] #6 References contain npm publishing checklist
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
