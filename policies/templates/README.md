# OPA Rego Policy Templates

This directory contains starter Rego policy templates for common authorization patterns. Each template is designed to be customizable and can be used as a foundation for your API Gateway authorization needs.

## Templates

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

These policies integrate with the OPA client module in `lib/opa-client.js`:

```javascript
const OpaClient = require('./lib/opa-client');

const opa = new OpaClient({
    opaUrl: 'http://localhost:8181',
    policyPath: 'v1/data/rbac/allow', // or abac, ownership, timebased, audit
});

const allowed = await opa.isAllowed(user, method, path, body);
```

## Best Practices

1. **Default deny**: All templates default to `allow := false`
2. **Token validation**: Always validate token expiration
3. **Structured responses**: Use the `authorization` or `decision` objects for detailed feedback
4. **Audit all decisions**: Use the audit template for compliance-critical applications
5. **Test thoroughly**: Write tests for your customized policies
6. **External data**: Load configuration from external data files for easier management
