---
id: task-006
title: Create security-practices skill
status: In Progress
assignee: []
created_date: '2025-12-01 14:59'
updated_date: '2025-12-01 16:08'
labels:
  - skill
  - security
  - node-red
dependencies:
  - task-008
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a Claude skill for security practices in Node.js applications covering:
- Credential storage and passing
- Certificate file handling (PEM, validation, error handling)
- Authentication mechanism selection (SASL, OAuth, API keys)
- TLS/SSL configuration
- Password field masking in UI
- File handling security (path validation, error handling)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SKILL.md created with YAML frontmatter
- [x] #2 Covers credential management patterns
- [x] #3 Covers certificate handling
- [x] #4 Covers TLS/SSL configuration
- [x] #5 Covers UI security (password masking)
- [x] #6 References contain security checklist
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented security-practices skill with:
- SKILL.md with YAML frontmatter and comprehensive overview
- references/credential-management.md - Node-RED credentials system, env vars, secrets management
- references/certificate-handling.md - PEM files, CA bundles, validation, error handling
- references/tls-ssl-configuration.md - TLS options, protocol versions, mTLS, cipher suites
- references/security-checklist.md - Pre-deployment security checklist with audit commands
<!-- SECTION:NOTES:END -->
