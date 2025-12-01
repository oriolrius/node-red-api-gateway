# NPM Publishing Checklist

Pre-publish verification checklist for Node-RED node packages.

## Before First Publish

### npm Account Setup

- [ ] Create npm account at [npmjs.com](https://www.npmjs.com/signup)
- [ ] Enable 2FA on npm account (required for publishing)
- [ ] Create organization scope if using scoped packages
- [ ] Generate automation token for CI/CD
- [ ] Add NPM_TOKEN to GitHub repository secrets

### Package Configuration

- [ ] Package name uses scoped format: `@scope/node-red-contrib-*`
- [ ] `keywords` includes `"node-red"`
- [ ] `node-red.nodes` correctly maps all node types to files
- [ ] `node-red.version` specifies minimum Node-RED version
- [ ] `engines.node` specifies minimum Node.js version
- [ ] `files` field whitelists only necessary files
- [ ] `repository` points to correct GitHub URL
- [ ] `bugs` and `homepage` URLs are correct
- [ ] `license` field matches LICENSE file
- [ ] `author` information is correct

### Files to Include

- [ ] `README.md` with installation and usage instructions
- [ ] `LICENSE` file present
- [ ] `CHANGELOG.md` initialized
- [ ] All node .js files in nodes/ directory
- [ ] All node .html files in nodes/ directory
- [ ] Icons in icons/ directory (if any)
- [ ] Example flows in examples/ directory (if any)

### Files to Exclude

Verify these are NOT in the `files` field:

- [ ] `test/` directory excluded
- [ ] `.github/` directory excluded
- [ ] Configuration files (`.eslintrc`, `jest.config.js`, etc.) excluded
- [ ] `.env` files excluded
- [ ] `node_modules/` excluded (automatic)
- [ ] Coverage reports excluded

## Before Each Release

### Code Quality

- [ ] All tests passing: `npm test`
- [ ] Linting passes: `npm run lint`
- [ ] No TypeScript errors (if applicable)
- [ ] Manual testing in Node-RED completed
- [ ] Code reviewed (if team project)

### Version and Changelog

- [ ] Version number follows semantic versioning
- [ ] CHANGELOG.md updated with all changes
- [ ] Breaking changes documented clearly
- [ ] Migration guide provided (for major versions)

### Documentation

- [ ] README.md reflects current functionality
- [ ] All new features documented
- [ ] API changes documented
- [ ] Example flows updated (if applicable)
- [ ] Screenshots updated (if UI changed)

### Dependencies

- [ ] All dependencies are necessary
- [ ] No dev dependencies in `dependencies`
- [ ] Dependency versions are appropriate (not too restrictive)
- [ ] No known security vulnerabilities: `npm audit`
- [ ] License compatibility checked

### Final Verification

- [ ] Clean working directory: `git status`
- [ ] On correct branch (main/master)
- [ ] All changes committed
- [ ] Tests pass in clean environment: `rm -rf node_modules && npm ci && npm test`

## Publishing Commands

### Standard Release

```bash
# 1. Ensure everything is ready
git status
npm test
npm audit

# 2. Update CHANGELOG.md
# Move [Unreleased] items to new version section

# 3. Bump version (creates commit and tag)
npm version patch   # or minor, major
npm version minor
npm version major

# 4. Push with tags (triggers CI/CD release)
git push origin main --tags
```

### Pre-release

```bash
# Beta release
npm version prerelease --preid=beta
git push origin main --tags

# The release workflow will publish with --tag beta
```

### Manual Publish (if not using CI/CD)

```bash
# Dry run first
npm publish --dry-run

# Publish for real
npm publish --access public

# Verify publication
npm info @scope/package-name
```

## Post-Publish Verification

- [ ] Package visible on npmjs.com
- [ ] Correct version displayed
- [ ] README renders correctly on npm
- [ ] Package installable: `npm install @scope/package-name`
- [ ] Node appears in Node-RED palette
- [ ] GitHub release created (if using CI/CD)
- [ ] flows.nodered.org listing updated (may take up to 24 hours)

## Troubleshooting

### "You must be logged in to publish"

```bash
npm login
npm whoami  # Verify logged in
```

### "Package name too similar to existing package"

- Use a more specific scoped name
- Check for typos in package name

### "You do not have permission to publish"

- Verify npm token has publish permissions
- Check organization membership
- Ensure 2FA is enabled

### "Package not appearing in Node-RED"

1. Check `node-red.nodes` paths are correct
2. Verify files are included in package: `npm pack && tar -tzf *.tgz`
3. Check Node-RED logs for loading errors
4. Ensure `registerType` names match package.json

### "Tests fail in CI but pass locally"

- Check Node.js version differences
- Verify all dependencies are in package.json
- Check for OS-specific code
- Review CI logs for environment differences

## Security Checklist

- [ ] No secrets in code or config files
- [ ] No API keys committed
- [ ] No internal URLs or paths
- [ ] Dependencies scanned for vulnerabilities
- [ ] npm token stored securely (not in code)
- [ ] 2FA enabled on npm account
- [ ] Minimal permissions for npm token
