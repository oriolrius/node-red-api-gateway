# Migration Guide: vX.x to vY.x

This guide helps you migrate from version X.x to version Y.x.

## Overview

Brief summary of what changed and why.

**Estimated time:** X minutes for typical projects

## Breaking Changes Summary

| Change | Impact | Migration Effort |
|--------|--------|------------------|
| [Change 1](#change-1-title) | High/Medium/Low | ~X minutes |
| [Change 2](#change-2-title) | High/Medium/Low | ~X minutes |

## Prerequisites

Before migrating:

- [ ] Back up your project
- [ ] Ensure tests pass on current version
- [ ] Review the [changelog](CHANGELOG.md) for all changes
- [ ] Update Node.js to version X.x or higher (if required)

## Step-by-Step Migration

### Step 1: Update Dependencies

```bash
npm install @scope/package-name@Y.x
```

### Step 2: Address Breaking Changes

#### Change 1: Title

**What changed:** Description of the change

**Why:** Reason for the change

**Before (vX.x):**
```javascript
// Old approach
const result = oldMethod(param);
```

**After (vY.x):**
```javascript
// New approach
const result = newMethod(param);
```

**Migration steps:**
1. Find all uses of `oldMethod`
2. Replace with `newMethod`
3. Update any dependent code

#### Change 2: Title

**What changed:** Description of the change

**Why:** Reason for the change

**Before (vX.x):**
```json
{
    "oldOption": "value"
}
```

**After (vY.x):**
```json
{
    "newOption": "value"
}
```

**Migration steps:**
1. Step one
2. Step two

### Step 3: Update Configuration

If you use a configuration file, update the following:

```diff
{
-    "oldSetting": true,
+    "newSetting": true,
     "unchangedSetting": "value"
}
```

### Step 4: Test Your Migration

```bash
# Run tests
npm test

# Start application and verify functionality
npm start
```

## Deprecated Features

The following features still work but will be removed in version Z.x:

| Feature | Replacement | Removal Version |
|---------|-------------|-----------------|
| `deprecatedMethod()` | `newMethod()` | vZ.0.0 |
| `oldOption` config | `newOption` config | vZ.0.0 |

**Recommendation:** Update these now to avoid issues in future upgrades.

## New Features (Optional)

These new features are available but not required for migration:

### Feature 1

Description and how to use it.

### Feature 2

Description and how to use it.

## Rollback Instructions

If you need to rollback:

```bash
npm install @scope/package-name@X.x
```

Then revert any configuration changes made during migration.

## Troubleshooting

### Issue: Error message after upgrade

**Solution:** Steps to resolve

### Issue: Another common issue

**Solution:** Steps to resolve

## Getting Help

If you encounter issues during migration:

- Check [GitHub Issues](https://github.com/user/repo/issues) for known problems
- Open a new issue with the "migration" label
- Include your package versions and error messages

## Migration Checklist

- [ ] Dependencies updated
- [ ] Breaking change 1 addressed
- [ ] Breaking change 2 addressed
- [ ] Configuration updated
- [ ] Tests passing
- [ ] Application tested manually
- [ ] Deprecated features updated (optional)
