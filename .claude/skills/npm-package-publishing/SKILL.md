---
name: npm-package-publishing
description: Comprehensive guide for publishing Node-RED nodes to npm with CI/CD automation. This skill should be used when configuring package.json for Node-RED nodes, setting up GitHub Actions workflows, managing semantic versioning, or preparing packages for npm publication.
---

# NPM Package Publishing for Node-RED

This skill provides patterns, workflows, and templates for publishing Node-RED node packages to npm with automated CI/CD pipelines.

## When to Use This Skill

- Configuring package.json for Node-RED node packages
- Setting up GitHub Actions for CI/CD
- Managing semantic versioning and releases
- Creating changelog entries
- Publishing packages to npm
- Setting up automated dependency updates

## Quick Start

To set up CI/CD for a Node-RED node package:

1. Copy workflow templates from `assets/workflows/` to `.github/workflows/`
2. Configure npm token in GitHub repository secrets
3. Review the pre-publish checklist in `references/npm-publishing-checklist.md`

## NPM Package Configuration

### package.json for Node-RED Nodes

```json
{
    "name": "@scope/node-red-contrib-example",
    "version": "1.0.0",
    "description": "Example Node-RED nodes for demonstration",
    "keywords": [
        "node-red",
        "example",
        "demo"
    ],
    "repository": {
        "type": "git",
        "url": "git+https://github.com/username/node-red-contrib-example.git"
    },
    "author": {
        "name": "Your Name",
        "email": "your.email@example.com"
    },
    "license": "MIT",
    "bugs": {
        "url": "https://github.com/username/node-red-contrib-example/issues"
    },
    "homepage": "https://github.com/username/node-red-contrib-example#readme",
    "engines": {
        "node": ">=14.0.0"
    },
    "node-red": {
        "version": ">=2.0.0",
        "nodes": {
            "example-node": "nodes/example-node.js",
            "example-config": "nodes/example-config.js"
        }
    },
    "dependencies": {},
    "devDependencies": {
        "jest": "^29.0.0",
        "node-red-node-test-helper": "^0.3.0"
    },
    "scripts": {
        "test": "jest",
        "test:coverage": "jest --coverage",
        "lint": "eslint nodes/ test/",
        "prepublishOnly": "npm test"
    },
    "files": [
        "nodes/",
        "icons/",
        "examples/",
        "LICENSE",
        "README.md"
    ]
}
```

### Key Fields Explained

#### `name` - Package Name
- **Since January 2022**: All new Node-RED packages MUST use scoped names
- Format: `@scope/node-red-contrib-*` or `@scope/node-red-*`
- Example: `@myorg/node-red-contrib-api-gateway`

#### `node-red` - Node-RED Specific Configuration
```json
{
    "node-red": {
        "version": ">=2.0.0",
        "nodes": {
            "node-type-name": "path/to/node.js"
        }
    }
}
```
- `version`: Minimum Node-RED version required
- `nodes`: Map of node type names to their JavaScript files

#### `keywords` - Discoverability
Always include `node-red` keyword for npm/flows.nodered.org discovery:
```json
{
    "keywords": ["node-red", "your-feature", "integration"]
}
```

#### `files` - Published Files
Whitelist approach - only listed files/directories are published:
```json
{
    "files": [
        "nodes/",
        "icons/",
        "examples/",
        "LICENSE",
        "README.md"
    ]
}
```

### .npmignore vs files

Prefer the `files` field (whitelist) over `.npmignore` (blacklist):

```json
{
    "files": [
        "nodes/",
        "icons/",
        "LICENSE",
        "README.md"
    ]
}
```

This ensures only necessary files are published, avoiding accidental inclusion of test files, configs, or secrets.

### Dependencies Best Practices

```json
{
    "dependencies": {
        "axios": "^1.6.0"
    },
    "devDependencies": {
        "jest": "^29.0.0",
        "node-red-node-test-helper": "^0.3.0",
        "eslint": "^8.0.0"
    },
    "peerDependencies": {
        "node-red": ">=2.0.0"
    }
}
```

- **dependencies**: Runtime requirements (minimal for Node-RED nodes)
- **devDependencies**: Test, lint, build tools
- **peerDependencies**: Node-RED itself (optional, can use engines instead)

## Semantic Versioning

### Version Format

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]

Examples:
1.0.0        - Initial release
1.0.1        - Patch: bug fix
1.1.0        - Minor: new feature, backward compatible
2.0.0        - Major: breaking changes
1.0.0-beta.1 - Pre-release
1.0.0-rc.1   - Release candidate
```

### When to Bump

| Change Type | Version Bump | Example |
|------------|--------------|---------|
| Bug fix, no API change | PATCH | 1.0.0 → 1.0.1 |
| New feature, backward compatible | MINOR | 1.0.1 → 1.1.0 |
| Breaking change | MAJOR | 1.1.0 → 2.0.0 |
| Pre-release | PRERELEASE | 1.0.0 → 1.0.0-beta.1 |

### Version Bump Commands

```bash
# Patch version (1.0.0 → 1.0.1)
npm version patch

# Minor version (1.0.0 → 1.1.0)
npm version minor

# Major version (1.0.0 → 2.0.0)
npm version major

# Specific version
npm version 2.0.0

# Pre-release
npm version prerelease --preid=beta
npm version 1.0.0-beta.1

# With git tag message
npm version minor -m "Release v%s"
```

### CHANGELOG.md Format

Use [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- New feature description

### Changed
- Modified behavior description

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Security patches

## [1.1.0] - 2024-01-15

### Added
- Added retry logic to API calls
- Added configurable timeout option

### Fixed
- Fixed memory leak in connection pool

## [1.0.0] - 2024-01-01

### Added
- Initial release
- Basic API gateway functionality
- Configuration node for server settings

[Unreleased]: https://github.com/user/repo/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/user/repo/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/user/repo/releases/tag/v1.0.0
```

## GitHub Actions CI/CD

### Workflow Templates

Copy the workflow templates from `assets/workflows/` to your repository's `.github/workflows/` directory.

### Available Templates

1. **ci.yml** - Continuous Integration
   - Runs on: push to main, pull requests
   - Jobs: lint, test (matrix across Node versions)
   - Caches npm dependencies

2. **release.yml** - Automated Release
   - Runs on: tag push (v*)
   - Jobs: test, publish to npm
   - Creates GitHub release

3. **dependabot.yml** - Dependency Updates
   - Weekly npm dependency updates
   - Weekly GitHub Actions updates

### Setting Up Secrets

#### NPM Token

1. Generate token at npmjs.com → Access Tokens → Generate New Token
2. Choose "Automation" type for CI/CD
3. Add to GitHub: Settings → Secrets → Actions → New repository secret
4. Name: `NPM_TOKEN`

#### Required Secrets

| Secret | Purpose | Where to Get |
|--------|---------|--------------|
| `NPM_TOKEN` | Publish to npm | npmjs.com → Access Tokens |
| `GITHUB_TOKEN` | Auto-provided | GitHub provides automatically |

### Workflow Triggers

```yaml
# Push to specific branches
on:
  push:
    branches: [main, develop]

# Pull requests
on:
  pull_request:
    branches: [main]

# Tag push (for releases)
on:
  push:
    tags:
      - 'v*'

# Manual trigger
on:
  workflow_dispatch:

# Scheduled
on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sunday
```

### Job Matrix for Node Versions

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
```

## Release Process

### Tag-Based Releases

```bash
# 1. Update version in package.json
npm version minor -m "Release v%s"

# 2. Push with tags
git push origin main --tags
```

The release workflow automatically:
1. Runs tests
2. Publishes to npm
3. Creates GitHub release with changelog

### Manual Release Steps

If not using automated release:

```bash
# 1. Ensure clean working directory
git status

# 2. Run tests
npm test

# 3. Update CHANGELOG.md
# Move [Unreleased] items to new version section

# 4. Bump version
npm version minor

# 5. Push changes and tags
git push origin main --tags

# 6. Publish to npm
npm publish --access public
```

### Pre-Release Versions

```bash
# Beta release
npm version prerelease --preid=beta
git push origin main --tags
npm publish --tag beta

# Release candidate
npm version prerelease --preid=rc
git push origin main --tags
npm publish --tag rc

# Install pre-release
npm install @scope/package@beta
npm install @scope/package@rc
```

## Branch Strategy

### Recommended: GitHub Flow

```
main (production-ready)
  └── feature/add-retry-logic
  └── fix/memory-leak
  └── docs/update-readme
```

- `main` - Always deployable
- Feature branches for all changes
- PR to main, squash merge
- Tag releases from main

### For Larger Projects: Git Flow

```
main (releases)
  └── develop (integration)
        └── feature/new-feature
        └── fix/bug-fix
  └── release/1.2.0
  └── hotfix/critical-fix
```

## .gitignore for Node-RED Projects

```gitignore
# Dependencies
node_modules/

# Test coverage
coverage/

# Build outputs
dist/
build/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Environment
.env
.env.local
.env.*.local

# Test artifacts
.nyc_output/
test-results/

# npm
*.tgz
package-lock.json  # Optional: include if you want reproducible installs
```

## Reference Documentation

For detailed checklists and guides:

- `references/npm-publishing-checklist.md` - Pre-publish verification steps
- `assets/workflows/` - GitHub Actions workflow templates

## Common Mistakes to Avoid

1. **Non-scoped package names** - All new packages must be scoped
2. **Missing `node-red` keyword** - Required for discoverability
3. **Including test files in package** - Use `files` field to whitelist
4. **Forgetting `prepublishOnly` script** - Run tests before publish
5. **Not setting npm token** - Required for automated publishing
6. **Mismatched version/tag** - Use `npm version` to keep in sync
7. **Empty CHANGELOG** - Document all changes for users
8. **Missing `engines` field** - Specify Node.js version requirements
