
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

## Custom Subagents

This project includes custom subagents in `.claude/agents/`:

### backlog-manager

**Purpose:** Task and project management using Backlog.md MCP.

**When to use:**
- When starting a task (update status to "In Progress")
- During task execution (check acceptance criteria, add notes)
- When completing a task (mark done, final notes)

**Usage:**
```
Use the Task tool with subagent_type="backlog-manager" to update task status
```

**Example:**
```
Task tool: Update task-001 status to "In Progress" and add a note that work has started
```

**Important:** This subagent should be used proactively throughout task execution, not just at the end.

### git-backlog-sync

**Purpose:** Git operations synchronized with Backlog.md task tracking.

**When to use:**
- Creating feature branches for tasks
- Committing code with task references
- Creating pull requests linked to tasks
- Updating tasks after merges

**Usage:**
```
Use the Task tool with subagent_type="git-backlog-sync" for Git+Backlog operations
```

**Examples:**
```
# Start work on a task
Task tool: Create branch for task-003 and update its status to In Progress

# Commit with task reference
Task tool: Commit staged changes for task-003 with message about implementing X

# Create PR
Task tool: Create a pull request for task-003 and link it in the backlog
```

**Features:**
- Automatic task ID linking in commit messages
- Branch naming convention enforcement
- PR creation with task context
- Task status updates on Git events
- Git safety rules (no force push, etc.)
