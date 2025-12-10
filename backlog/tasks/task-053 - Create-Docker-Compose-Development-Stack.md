---
id: task-053
title: Create Docker Compose Development Stack
status: Done
assignee: []
created_date: '2025-12-10 09:35'
updated_date: '2025-12-10 17:52'
labels:
  - infrastructure
  - docker
  - development
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create docker-compose.yml with Keycloak, OPA, and optional SQL Server for development and testing. Include health checks, volume mounts, environment templates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Keycloak service with admin console
- [x] #2 OPA service with policy volume mount
- [x] #3 Optional SQL Server service
- [x] #4 Health checks for all services
- [x] #5 Environment variable templates (.env.example)
- [x] #6 README with setup instructions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### References
- **doc-003**: HOWTO: Run SQL Server 2022 in Docker with Host Bindings (No Volumes) - Use for SQL Server service configuration
- **doc-004**: HOWTO: Run Keycloak 26 in Docker with Realm Provisioning - Use for Keycloak service configuration and realm import
- **doc-005**: HOWTO: Run OPA (Open Policy Agent) in Docker with Policy Provisioning - Use for OPA service configuration and policy loading

### Network Architecture for Testing

**Shared Container Network Namespace** - All services share a single container's network namespace using `network_mode: "container:<base>"`:

- A base container (e.g., `network-base` using `alpine:latest` with `sleep infinity`) creates the network namespace
- All services (Keycloak, OPA, SQL Server) join this namespace via `network_mode: "container:network-base"`
- Services communicate via `localhost:PORT` (e.g., `localhost:8080` for Keycloak, `localhost:8181` for OPA, `localhost:1433` for SQL Server)
- **No ports exposed to host** - The stack is completely isolated from the host machine
- Test runner container also joins the same namespace to access all services via `localhost`

**Benefits:**
- Simplified configuration: all services use `localhost` URLs
- Complete isolation: nothing accessible from outside
- Mirrors single-machine deployment for realistic testing

### Steps

1. **Create base network container**
   - Use minimal image (`alpine:latest` or `busybox`)
   - Run with `sleep infinity` to keep namespace alive
   - All other services depend on this container

2. **Add Keycloak service** (ref: doc-004)
   - Use `quay.io/keycloak/keycloak:26-latest` image
   - `network_mode: "container:network-base"`
   - No `ports:` section (not exposed)
   - Configure with `KC_BOOTSTRAP_ADMIN_USERNAME`/`KC_BOOTSTRAP_ADMIN_PASSWORD`
   - Mount realm import: `./data/keycloak/import:/opt/keycloak/data/import:ro`
   - Mount H2 database: `./data/keycloak/h2:/opt/keycloak/data/h2`
   - Add `--import-realm` to command
   - Health check on `localhost:8080/health/ready`

3. **Add OPA service** (ref: doc-005)
   - Use `openpolicyagent/opa:latest` image
   - `network_mode: "container:network-base"`
   - No `ports:` section (not exposed)
   - Mount policy directory: `./policies:/policies:ro`
   - Run in server mode with `--addr=0.0.0.0:8181`
   - Health check on `localhost:8181/health`

4. **Add SQL Server service (optional profile)** (ref: doc-003)
   - `network_mode: "container:network-base"`
   - No `ports:` section (not exposed)
   - Follow doc-003 for host binding configuration
   - Use separate env files (`sqlserver.env`, `sapassword.env`)
   - Mount directories: `./data/sqlserver/{system,user,log,backup}`
   - Health check using sqlcmd against `localhost:1433`

5. **Create environment templates**
   - `.env.example` with all configurable variables
   - `keycloak.env.example` (per doc-004)
   - `sqlserver.env.example` and `sapassword.env.example` (per doc-003)

6. **Create sample configuration files**
   - `data/keycloak/import/myrealm-realm.json` - example realm (per doc-004 section 5)
   - `policies/authz.rego` - example OPA policy (per doc-005 section 2)
   - `policies/data.json` - example static data for policies

7. **Add health checks for all services**
   - All health checks use `localhost:PORT` since services share network namespace
   - Keycloak: HTTP check on `localhost:8080/health/ready`
   - OPA: wget check on `localhost:8181/health`
   - SQL Server: sqlcmd query check on `localhost:1433`

8. **Write README with setup instructions**
   - Explain shared network namespace architecture
   - Prerequisites (Docker, permissions for SQL Server UID 10001)
   - Directory setup for host bindings
   - Starting services (with/without SQL Server profile)
   - How to run tests against the isolated stack
   - Links to detailed docs (doc-003, doc-004, doc-005)

### Example docker-compose.yml Structure

```yaml
services:
  network-base:
    image: alpine:latest
    container_name: network-base
    command: sleep infinity
    
  keycloak:
    image: quay.io/keycloak/keycloak:26-latest
    network_mode: "container:network-base"
    depends_on:
      - network-base
    # ... config per doc-004
    
  opa:
    image: openpolicyagent/opa:latest
    network_mode: "container:network-base"
    depends_on:
      - network-base
    # ... config per doc-005
    
  db:
    image: mcr.microsoft.com/mssql/server:2022-latest
    network_mode: "container:network-base"
    depends_on:
      - network-base
    profiles:
      - sqlserver
    # ... config per doc-003
```
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started implementation on 2025-12-10. Beginning work on shared container network namespace architecture using alpine base container with all services (Keycloak, OPA, SQL Server) joining the same namespace via network_mode.

Completed on 2025-12-10. All acceptance criteria completed:

**Created Artifacts:**
- docker-compose.yml: Complete stack with Keycloak, OPA, and optional SQL Server using shared container network namespace (alpine base container)
- Keycloak Configuration: Realm import with users (testuser, editor, admin) and OAuth2 client for api-gateway
- OPA Configuration: authz.rego policy with RBAC for API endpoints and static policy data
- Environment Configuration: .env.example and config/ directory with template files (keycloak.env, sqlserver.env, sapassword.env)
- Documentation: README.md with architecture explanation, quick start guide, health check details, troubleshooting section, and links to detailed implementation docs

**Architecture:**
- Shared network namespace via network_mode: 'container:network-base'
- Services communicate via localhost:PORT
- Complete isolation from host machine
- Mirrors single-machine deployment for realistic testing
- Health checks configured for all services

**References Applied:**
- doc-003: SQL Server 2022 Docker configuration with host bindings
- doc-004: Keycloak 26 Docker realm provisioning
- doc-005: OPA Docker policy provisioning

Commit: 1660f1b - feat(docker): create Docker Compose development stack with Keycloak, OPA, and SQL Server
<!-- SECTION:NOTES:END -->
