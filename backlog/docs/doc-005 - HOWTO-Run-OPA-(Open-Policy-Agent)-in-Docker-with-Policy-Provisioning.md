---
id: doc-005
title: 'HOWTO: Run OPA (Open Policy Agent) in Docker with Policy Provisioning'
type: other
created_date: '2025-12-10 16:27'
---
# HOWTO: Run OPA (Open Policy Agent) in Docker with Policy Provisioning

This guide shows how to run OPA in Docker with automatic policy loading for development and testing environments.

## Why Use OPA for Authorization?

- **Decoupled authorization**: Separate policy decisions from application code
- **Policy as code**: Version control your authorization rules
- **Unified policy language**: Rego works across services and platforms
- **High performance**: Sub-millisecond policy decisions

## 1. Directory Structure

Create a project directory with these files and folders:

```
opa-dev/
├── docker-compose.yml
├── opa-config.yaml           # Optional: for bundles/advanced config
├── policies/
│   ├── authz.rego            # Authorization policies
│   └── data.json             # Static data for policies
└── bundles/                  # Optional: pre-built bundles
```

Create the directories:

```bash
mkdir -p policies bundles
```

---

## 2. Basic Policy File

Create `policies/authz.rego`:

```rego
package authz

import rego.v1

# Default deny
default allow := false

# Allow if user has required role
allow if {
    input.user.roles[_] == required_role
}

# Define required roles per resource and action
required_role := "admin" if {
    input.resource == "admin"
}

required_role := "user" if {
    input.resource == "api"
    input.action == "read"
}

required_role := "editor" if {
    input.resource == "api"
    input.action in ["create", "update", "delete"]
}

# Allow health checks without authentication
allow if {
    input.path == "/health"
}

# Helper: check if user has specific permission
has_permission(permission) if {
    input.user.permissions[_] == permission
}
```

Create `policies/data.json` for static data:

```json
{
  "roles": {
    "admin": {
      "permissions": ["read", "write", "delete", "admin"]
    },
    "editor": {
      "permissions": ["read", "write"]
    },
    "user": {
      "permissions": ["read"]
    }
  },
  "protected_resources": [
    "/api/users",
    "/api/orders",
    "/admin"
  ]
}
```

---

## 3. `docker-compose.yml`

### Simple Mode (Policies from Files)

```yaml
networks:
  app-network-public:
    driver: bridge

services:
  opa:
    image: openpolicyagent/opa:latest
    container_name: opa
    hostname: opa
    networks:
      - app-network-public
    ports:
      - "8181:8181"
    command:
      - "run"
      - "--server"
      - "--addr=0.0.0.0:8181"
      - "--log-level=info"
      - "--log-format=json"
      - "/policies"
    volumes:
      # Host binding for policies
      - ./policies:/policies:ro
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8181/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s
```

### With Configuration File (Bundles Support)

```yaml
networks:
  app-network-public:
    driver: bridge

services:
  opa:
    image: openpolicyagent/opa:latest
    container_name: opa
    hostname: opa
    networks:
      - app-network-public
    ports:
      - "8181:8181"
    command:
      - "run"
      - "--server"
      - "--addr=0.0.0.0:8181"
      - "--config-file=/config/opa-config.yaml"
      - "--log-level=info"
    volumes:
      - ./policies:/policies:ro
      - ./opa-config.yaml:/config/opa-config.yaml:ro
      - ./bundles:/bundles:ro
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8181/health?bundles=true"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
```

### Production Mode (With Authorization)

For production, enable OPA's built-in authorization:

```yaml
networks:
  app-network-public:
    driver: bridge

services:
  opa:
    image: openpolicyagent/opa:latest
    container_name: opa
    hostname: opa
    networks:
      - app-network-public
    ports:
      - "8181:8181"
    command:
      - "run"
      - "--server"
      - "--addr=0.0.0.0:8181"
      - "--config-file=/config/opa-config.yaml"
      - "--authorization=basic"
      - "--authentication=token"
      - "--log-level=info"
      - "--log-format=json"
    volumes:
      - ./policies:/policies:ro
      - ./opa-config.yaml:/config/opa-config.yaml:ro
    environment:
      - OPA_AUTH_TOKEN=${OPA_AUTH_TOKEN}
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "--header=Authorization: Bearer ${OPA_AUTH_TOKEN}", "http://localhost:8181/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 128M
```

---

## 4. OPA Configuration File

Create `opa-config.yaml` for advanced configuration:

### Basic Configuration

```yaml
# Labels identify this OPA instance
labels:
  app: my-application
  environment: development
  region: local

# Decision logs (for debugging)
decision_logs:
  console: true

# Server configuration
server:
  encoding:
    gzip:
      min_length: 1024
      compression_level: 6
```

### With Bundle Service

```yaml
labels:
  app: my-application
  environment: development

services:
  bundle-server:
    url: http://bundle-server:8080
    response_header_timeout_seconds: 5

bundles:
  authz:
    service: bundle-server
    resource: bundles/authz.tar.gz
    persist: true
    polling:
      min_delay_seconds: 10
      max_delay_seconds: 30

decision_logs:
  console: true

status:
  console: true
```

### With Environment Variables

```yaml
labels:
  app: ${APP_NAME}
  environment: ${ENVIRONMENT}

services:
  policy-service:
    url: ${BUNDLE_SERVICE_URL}
    credentials:
      bearer:
        token: ${BUNDLE_SERVICE_TOKEN}

bundles:
  main:
    service: policy-service
    resource: ${BUNDLE_PATH}
    polling:
      min_delay_seconds: 60
      max_delay_seconds: 120

decision_logs:
  service: policy-service
  resource: /logs
  reporting:
    min_delay_seconds: 60
    max_delay_seconds: 300
```

---

## 5. Building Policy Bundles

For larger deployments, pre-build bundles:

```bash
# Build a bundle from policies directory
opa build --bundle --output bundles/authz.tar.gz policies/

# Verify bundle contents
tar -tzf bundles/authz.tar.gz
```

Bundle structure:
```
authz.tar.gz
├── authz.rego
├── data.json
└── .manifest
```

---

## 6. Start the Container

```bash
docker compose up -d
```

Check logs:

```bash
docker compose logs -f opa
```

---

## 7. Verify the Setup

### Health Check

```bash
# Basic health
curl http://localhost:8181/health

# Health with bundle status (if using bundles)
curl http://localhost:8181/health?bundles=true
```

### List Loaded Policies

```bash
curl http://localhost:8181/v1/policies
```

### Test Policy Evaluation

```bash
# Test authorization decision
curl -X POST http://localhost:8181/v1/data/authz/allow \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "user": {
        "name": "alice",
        "roles": ["user"]
      },
      "resource": "api",
      "action": "read"
    }
  }'

# Expected response: {"result": true}
```

### Query with Full Input

```bash
curl -X POST http://localhost:8181/v1/data/authz \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "user": {
        "name": "bob",
        "roles": ["editor"],
        "permissions": ["read", "write"]
      },
      "resource": "api",
      "action": "delete",
      "path": "/api/users/123"
    }
  }'
```

---

## 8. API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/health?bundles=true` | GET | Health with bundle status |
| `/v1/policies` | GET | List all policies |
| `/v1/policies/{id}` | PUT | Upload policy |
| `/v1/policies/{id}` | DELETE | Delete policy |
| `/v1/data/{path}` | GET | Query data/rules |
| `/v1/data/{path}` | POST | Query with input |
| `/v1/query` | POST | Ad-hoc query |
| `/metrics` | GET | Prometheus metrics |

---

## 9. Hot-Reload Policies

When using file mounts, OPA watches for changes. Update policies without restarting:

```bash
# Edit policy file
vim policies/authz.rego

# OPA automatically reloads (check logs)
docker compose logs -f opa | grep -i "reload\|bundle"
```

For bundles, rebuild and wait for polling interval:

```bash
opa build --bundle --output bundles/authz.tar.gz policies/
# OPA will fetch updated bundle on next poll
```

---

## 10. Example: HTTP API Authorization Policy

Create `policies/http_authz.rego` for REST API authorization:

```rego
package httpapi.authz

import rego.v1

# Default deny all requests
default allow := false

# Allow GET requests to public endpoints
allow if {
    input.method == "GET"
    is_public_endpoint
}

# Allow authenticated users to access protected endpoints
allow if {
    input.token
    token_is_valid
    has_required_scope
}

# Public endpoints that don't require authentication
is_public_endpoint if {
    public_paths[input.path]
}

public_paths := {
    "/health",
    "/ready",
    "/api/public",
    "/api/v1/status"
}

# Token validation (simplified - integrate with your auth system)
token_is_valid if {
    input.token.exp > time.now_ns() / 1000000000
    input.token.iss == "https://auth.example.com"
}

# Scope-based authorization
has_required_scope if {
    required := required_scopes[input.method][input.path]
    input.token.scope[_] == required
}

required_scopes := {
    "GET": {
        "/api/users": "users:read",
        "/api/orders": "orders:read"
    },
    "POST": {
        "/api/users": "users:write",
        "/api/orders": "orders:write"
    },
    "DELETE": {
        "/api/users": "users:admin",
        "/api/orders": "orders:admin"
    }
}

# Rate limiting data (can be used with external data)
rate_limit_exceeded if {
    data.rate_limits[input.client_id].requests > 1000
}
```

---

## 11. Troubleshooting

### Policies not loading

```bash
# Check if policies are mounted
docker exec opa ls -la /policies

# Verify policy syntax
opa check policies/

# Test policy locally
opa eval -d policies/ 'data.authz.allow' -i input.json
```

### Bundle not activating

```bash
# Check health with bundle status
curl http://localhost:8181/health?bundles=true

# Check OPA logs for bundle errors
docker compose logs opa | grep -i bundle

# Verify bundle structure
tar -tzf bundles/authz.tar.gz
```

### Decision returns undefined

- Ensure the package path matches your query
- Check that input structure matches policy expectations
- Verify data.json is loaded: `curl http://localhost:8181/v1/data`

### Performance issues

```bash
# Enable profiling
curl -X POST http://localhost:8181/v1/data/authz/allow?profile=true \
  -H "Content-Type: application/json" \
  -d '{"input": {...}}'

# Check metrics
curl http://localhost:8181/metrics
```

---

## 12. Security Considerations

1. **Enable authentication in production** - Use `--authentication=token` or `--authentication=tls`
2. **Enable authorization** - Use `--authorization=basic` to protect OPA's API
3. **Use TLS** - Configure HTTPS for production deployments
4. **Limit network access** - Don't expose OPA publicly; use internal networks
5. **Audit decision logs** - Enable and monitor decision logging for compliance
6. **Review policies** - Ensure default-deny and test edge cases

---

## 13. Integration with Applications

### Node.js Example

```javascript
const axios = require('axios');

async function checkAuthorization(user, resource, action) {
  const response = await axios.post('http://opa:8181/v1/data/authz/allow', {
    input: {
      user,
      resource,
      action
    }
  });
  return response.data.result === true;
}

// Usage
const allowed = await checkAuthorization(
  { name: 'alice', roles: ['user'] },
  'api',
  'read'
);
```

### Express Middleware

```javascript
async function opaAuthMiddleware(req, res, next) {
  const allowed = await checkAuthorization(
    req.user,
    req.baseUrl,
    req.method
  );
  
  if (!allowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

app.use('/api', opaAuthMiddleware);
```

---

## References

- [OPA Docker Deployment](https://www.openpolicyagent.org/docs/deploy/docker)
- [OPA Configuration Reference](https://www.openpolicyagent.org/docs/latest/configuration/)
- [OPA Bundle Documentation](https://www.openpolicyagent.org/docs/management-bundles)
- [Rego Policy Language](https://www.openpolicyagent.org/docs/latest/policy-language/)
- [OPA GitHub Repository](https://github.com/open-policy-agent/opa)
