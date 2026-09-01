# OPA Rego Policy Templates

This directory contains starter Rego policy templates for common authorization patterns. Each template is designed to be customizable and can be used as a foundation for your API Gateway authorization needs.

## Gateway integration & template compatibility

The gateway builds a single **canonical input document** (see the node help and
`backlog/decisions/decision-001`) and points its **Policy Path** at a rule that
returns a decision. The compatibility of the shipped templates with that
canonical input:

| Template | Path | Verdict |
|---|---|---|
| `gateway.rego` | `v1/data/gateway/decision` | **Supported** — the reference policy, written against the canonical input; used by the example flows and the e2e harness |
| `rbac.rego` | `v1/data/rbac/authorization` | **Supported** |
| `time-based.rego` | `v1/data/timebased/authorization` | **Supported** (bound the cache TTL for temporal policies) |
| `audit.rego` | `v1/data/audit/decision` | **Supported** (needs *Audit Fields*, which disables the decision cache) |
| `abac.rego` | `v1/data/abac/authorization` | **Reference-only** — needs a real resource object a route-derived stub cannot provide |
| `ownership.rego` | `v1/data/ownership/authorization` | **Reference-only** — needs a real resource object |

## Templates

### 0. Gateway Reference Policy - `gateway.rego`

The out-of-the-box policy for the gateway. Written against the canonical input,
it reproduces the old gateway-side scope check: it authorizes the endpoint's
declared `requiredScopes` against the caller's verified `token.scope` and
returns **`allowed` and `reason` in one round trip**.

**Use when:** You want scope-based authorization immediately, expressed in Rego
(and extendable) rather than as a static per-endpoint scope list.

```bash
# Point the apigw-config "Policy Path" at:
v1/data/gateway/decision

# Returns, e.g.:
#   { "allowed": true,  "reason": "allow" }
#   { "allowed": false, "reason": "missing_token" }
#   { "allowed": false, "reason": "insufficient_scope" }
```

Key behaviours: `default allow := false`; a caller is authenticated only when
`input.token` is present (the gateway omits it entirely for anonymous requests —
never `null`); a token with no `scope` claim is denied rather than accidentally
satisfying a subset test; `input.endpoint.operator` selects AND (require all) or
OR (require any) semantics.

### 1. RBAC (Role-Based Access Control) - `rbac.rego`

Implements hierarchical role-based access control with:
- **Role hierarchy** with permission inheritance (super_admin > admin > editor > viewer)
- **Role-to-permission mapping** via configurable data
- **Multiple token formats** support (Keycloak, Auth0, generic JWT)
- **Fine-grained resource/action permissions**
- **Public endpoints** configuration

**Use when:** You need to control access based on user roles and predefined permissions.

```bash
# Example request
POST http://localhost:8181/v1/data/rbac/allow
{
  "input": {
    "method": "GET",
    "path": "/api/v1/users",
    "token": {
      "sub": "user-123",
      "realm_access": { "roles": ["user"] },
      "exp": 1699999999
    }
  }
}
```

### 2. ABAC (Attribute-Based Access Control) - `abac.rego`

Implements attribute-based access control using:
- **User attributes** (department, clearance level, location)
- **Resource attributes** (classification, sensitivity, owner)
- **Environmental conditions** (IP address, device type, network)
- **Clearance level hierarchy** (top_secret > secret > confidential > internal > public)
- **Cross-department access** matrix

**Use when:** You need fine-grained control based on multiple attributes beyond simple roles.

```bash
# Example request
POST http://localhost:8181/v1/data/abac/allow
{
  "input": {
    "method": "GET",
    "path": "/api/v1/documents/doc-123",
    "token": {
      "sub": "user-456",
      "department": "engineering",
      "clearance_level": "confidential"
    },
    "resource": {
      "classification": "confidential",
      "department": "engineering"
    },
    "environment": {
      "ip_address": "10.0.0.50",
      "device_type": "corporate_laptop"
    }
  }
}
```

### 3. Resource Ownership - `ownership.rego`

Implements ownership-based access control with:
- **Owner-based access** (full control for resource owners)
- **Sharing and delegation** (grant access to specific users)
- **Team membership** access
- **Organization-level** visibility
- **Multi-tenancy** isolation
- **Admin override** capabilities

**Use when:** You need to control access based on who owns the resource.

```bash
# Example request
POST http://localhost:8181/v1/data/ownership/allow
{
  "input": {
    "method": "PUT",
    "path": "/api/v1/documents/doc-123",
    "token": {
      "sub": "user-456",
      "org_id": "org-789",
      "teams": ["team-alpha"]
    },
    "resource": {
      "owner_id": "user-456",
      "org_id": "org-789",
      "visibility": "private"
    }
  }
}
```

### 4. Time-Based Restrictions - `time-based.rego`

Implements temporal access control with:
- **Business hours** enforcement
- **Extended hours** for certain roles
- **Maintenance windows** (recurring and one-time)
- **Holiday calendar** support
- **Time-limited access** (scheduled access windows)
- **Exempt roles** (admin, on-call)

**Use when:** You need to restrict access based on time of day, maintenance windows, or temporary access.

```bash
# Example request
POST http://localhost:8181/v1/data/timebased/allow
{
  "input": {
    "method": "POST",
    "path": "/api/v1/orders",
    "token": {
      "sub": "user-123",
      "roles": ["user"],
      "access_schedule": {
        "start": "2024-01-01T00:00:00Z",
        "end": "2024-12-31T23:59:59Z"
      }
    },
    "timestamp": "2024-06-15T10:30:00Z"
  }
}
```

### 5. Audit Logging - `audit.rego`

Provides comprehensive audit logging with:
- **Structured audit events** for all authorization decisions
- **Risk scoring** based on operation, resource sensitivity, time, behavior
- **Compliance tagging** (GDPR, CCPA, PCI-DSS, HIPAA, SOC2)
- **Data masking** for sensitive fields
- **Retention policies** based on operation type
- **Query helpers** for high-risk, compliance, denied events

**Use when:** You need detailed audit trails for compliance or security monitoring.

```bash
# Example request
POST http://localhost:8181/v1/data/audit/decision
{
  "input": {
    "method": "DELETE",
    "path": "/api/v1/users/user-123",
    "token": {
      "sub": "admin-456",
      "preferred_username": "admin.user"
    },
    "source_ip": "10.0.0.50",
    "request_id": "req-abc-123"
  }
}
```

## Running Tests

Each template has accompanying tests in the `tests/` directory:

```bash
# Run all tests
opa test policies/templates/ -v

# Run specific template tests
opa test policies/templates/gateway.rego policies/templates/tests/gateway_test.rego -v
opa test policies/templates/rbac.rego policies/templates/tests/rbac_test.rego -v
opa test policies/templates/abac.rego policies/templates/tests/abac_test.rego -v
opa test policies/templates/ownership.rego policies/templates/tests/ownership_test.rego -v
opa test policies/templates/time-based.rego policies/templates/tests/time_based_test.rego -v
opa test policies/templates/audit.rego policies/templates/tests/audit_test.rego -v
```

## Customization

Each template is designed to be customized for your specific needs:

1. **Endpoints and permissions**: Modify the `endpoint_permissions` or similar mappings
2. **Roles and hierarchy**: Adjust `role_hierarchy` and `role_permissions`
3. **Resource classifications**: Update `sensitive_resources` or `clearance_hierarchy`
4. **Time windows**: Configure `business_hours`, `maintenance_windows`, `holidays`
5. **Compliance requirements**: Adjust `compliance_tags` and retention policies

## Composing Policies

You can combine multiple templates for comprehensive authorization:

```rego
package combined

import data.rbac
import data.timebased
import data.audit

# Allow if RBAC allows AND within time restrictions
allow if {
    rbac.allow
    timebased.allow
}

# Generate audit event for all decisions
decision := audit.decision
```

## Integration with Node-RED API Gateway

You do not call OPA from your own code — the gateway does it for you. Configure
it on the **apigw-config** node:

1. Enable OPA and set the **OPA URL** (`https://…`) and the gateway's **OPA
   Token** (its own service credential — never a user token).
2. Set the **Policy Path** to the rule that returns your decision, e.g.
   `v1/data/gateway/decision` for the reference policy above.
3. Choose the **Mode** (`enforce` denies on a policy denial; `monitor` evaluates
   and logs but never denies).

The gateway then builds the canonical input from the verified request, calls OPA
with its own bearer token over TLS, and enforces the decision in a Fastify
`preHandler` before your flow runs. When OPA is active for an endpoint, the
policy is the **single authority** — the gateway does not also run its own
Required Scopes check (it sends `requiredScopes` to the policy as
`input.endpoint.requiredScopes` context instead).

> **Note:** `OpaClient.isAllowed()` in `lib/opa-client.js` is **deprecated** and
> must not be wired into a flow — its input shape matches none of these
> templates. The node uses `lib/opa-input.js` + `evaluate()` internally.

## Best Practices

1. **Default deny**: All templates default to `allow := false`
2. **Token validation**: Always validate token expiration
3. **Structured responses**: Use the `authorization` or `decision` objects for detailed feedback
4. **Audit all decisions**: Use the audit template for compliance-critical applications
5. **Test thoroughly**: Write tests for your customized policies
6. **External data**: Load configuration from external data files for easier management
