## Git Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages.

### Commit Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat` - New feature or functionality
- `fix` - Bug fix
- `docs` - Documentation only changes
- `style` - Code style changes (formatting, semicolons, etc.)
- `refactor` - Code change that neither fixes a bug nor adds a feature
- `perf` - Performance improvement
- `test` - Adding or updating tests
- `build` - Changes to build system or dependencies
- `ci` - CI/CD configuration changes
- `chore` - Other changes that don't modify src or test files

### Scope (optional)

The scope provides additional context. For this project, common scopes include:
- `node` - Node-RED node changes
- `skill` - Claude skill changes
- `test` - Test infrastructure
- `deps` - Dependency updates

### Examples

```
feat(node): add retry logic to API gateway node

fix(skill): correct mock RED framework context handling

docs: update README with installation instructions

test(node): add integration tests for error handling

chore(deps): update node-red-node-test-helper to v0.3.0
```

### Breaking Changes

For breaking changes, add `!` after the type/scope or include `BREAKING CHANGE:` in the footer:

```
feat(node)!: change default timeout from 30s to 10s

BREAKING CHANGE: Default timeout reduced, update your flows if needed.
```

<!-- MANDATORY SUBAGENT RULES START -->

<CRITICAL_INSTRUCTION>

## MANDATORY: Subagent Usage for Git and Backlog Operations

This project has custom subagents that MUST be used for specific operations. **DO NOT use Bash or MCP tools directly for these operations.**

### Git Operations → ALWAYS use `git-backlog-sync` subagent

**NEVER run git commands directly with Bash for:**
- `git commit` - Use subagent to ensure task linking and conventional commits
- `git branch` / `git checkout -b` - Use subagent to link branches to tasks
- `gh pr create` - Use subagent to include task context in PR

**How to use:**
```
Task tool with subagent_type="git-backlog-sync"
Prompt: "Commit the staged changes for task-XXX with message about implementing Y"
```

**Why:** The subagent enforces conventional commits, links commits to backlog tasks, and updates task status automatically.

### Backlog Operations → ALWAYS use `backlog-manager` subagent

**NEVER call mcp__backlog__* tools directly for:**
- Updating task status (To Do → In Progress → Done)
- Checking off acceptance criteria
- Adding implementation notes
- Creating new tasks related to current work

**How to use:**
```
Task tool with subagent_type="backlog-manager"
Prompt: "Update task-XXX status to In Progress and note that work has started"
```

**Why:** The subagent follows proper workflow patterns, checks task state before editing, and maintains consistent note formatting.

### When Direct Tool Use IS Allowed

- **Reading/searching tasks**: `mcp__backlog__task_list`, `mcp__backlog__task_search`, `mcp__backlog__task_view` - OK for quick lookups
- **Git status/diff**: `git status`, `git diff` via Bash - OK for inspection only
- **Non-task git operations**: Simple `git add`, `git stash` - OK when not related to task workflow

### Enforcement Checklist

Before ANY git commit, branch, or PR operation, ask yourself:
- [ ] Am I using the `git-backlog-sync` subagent? If no, STOP and use it.

Before ANY task status change or update, ask yourself:
- [ ] Am I using the `backlog-manager` subagent? If no, STOP and use it.

</CRITICAL_INSTRUCTION>

<!-- MANDATORY SUBAGENT RULES END -->

<!-- BACKLOG.MD MCP GUIDELINES START -->

<CRITICAL_INSTRUCTION>

## BACKLOG WORKFLOW INSTRUCTIONS

This project uses Backlog.md MCP for all task and project management activities.

**CRITICAL GUIDANCE**

- If your client supports MCP resources, read `backlog://workflow/overview` to understand when and how to use Backlog for this project.
- If your client only supports tools or the above request fails, call `backlog.get_workflow_overview()` tool to load the tool-oriented overview (it lists the matching guide tools).

- **First time working here?** Read the overview resource IMMEDIATELY to learn the workflow
- **Already familiar?** You should have the overview cached ("## Backlog.md Overview (MCP)")
- **When to read it**: BEFORE creating tasks, or when you're unsure whether to track work

These guides cover:
- Decision framework for when to create tasks
- Search-first workflow to avoid duplicates
- Links to detailed guides for task creation, execution, and completion
- MCP tools reference

You MUST read the overview resource to understand the complete workflow. The information is NOT summarized here.

</CRITICAL_INSTRUCTION>

<!-- BACKLOG.MD MCP GUIDELINES END -->
