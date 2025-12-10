# API Gateway Authorization Policy
#
# This policy implements role-based access control (RBAC) for the API Gateway.
# It integrates with Keycloak JWT tokens and provides fine-grained authorization.
#
# Usage:
#   POST http://localhost:8181/v1/data/authz/allow
#   {
#     "input": {
#       "method": "GET",
#       "path": "/api/v1/users",
#       "token": { "realm_access": { "roles": ["user"] }, "resource_access": {...} }
#     }
#   }

package authz

import rego.v1

# Default deny all requests
default allow := false

# ============================================================================
# Public Endpoints (No Authentication Required)
# ============================================================================

# Allow health check endpoints without authentication
allow if {
    is_public_endpoint
}

is_public_endpoint if {
    input.path == "/health"
}

is_public_endpoint if {
    input.path == "/ready"
}

is_public_endpoint if {
    input.path == "/api/health"
}

is_public_endpoint if {
    startswith(input.path, "/api/v1/public/")
}

# ============================================================================
# Authenticated Endpoints
# ============================================================================

# Allow if user has required permission for the resource/action
allow if {
    not is_public_endpoint
    token_is_valid
    has_required_permission
}

# ============================================================================
# Token Validation
# ============================================================================

token_is_valid if {
    input.token
    input.token.exp > time.now_ns() / 1000000000
}

# ============================================================================
# Permission Checks
# ============================================================================

has_required_permission if {
    # Get required permission for this endpoint
    required := required_permissions[input.method][_]
    path_matches(required.path, input.path)

    # Check if user has the required role or scope
    user_has_permission(required.permission)
}

# Check user permissions from token
user_has_permission(permission) if {
    # Check realm roles
    realm_role := input.token.realm_access.roles[_]
    role_grants_permission(realm_role, permission)
}

user_has_permission(permission) if {
    # Check client roles from api-gateway-client
    client_role := input.token.resource_access["api-gateway-client"].roles[_]
    client_role == permission
}

user_has_permission(permission) if {
    # Check scope claim (for service accounts)
    scope_part := split(input.token.scope, " ")[_]
    scope_part == permission
}

# ============================================================================
# Role-to-Permission Mapping
# ============================================================================

# Admin role grants all permissions
role_grants_permission("admin", _) := true

# Editor role grants read and write permissions
role_grants_permission("editor", permission) if {
    permission in ["api:read", "api:write"]
}

# User role grants read permission only
role_grants_permission("user", "api:read") := true

# ============================================================================
# Endpoint Permissions
# ============================================================================

# Define required permissions per HTTP method and path pattern
required_permissions := {
    "GET": [
        {"path": "/api/v1/users", "permission": "api:read"},
        {"path": "/api/v1/users/*", "permission": "api:read"},
        {"path": "/api/v1/orders", "permission": "api:read"},
        {"path": "/api/v1/orders/*", "permission": "api:read"},
        {"path": "/api/v1/products", "permission": "api:read"},
        {"path": "/api/v1/products/*", "permission": "api:read"}
    ],
    "POST": [
        {"path": "/api/v1/users", "permission": "api:write"},
        {"path": "/api/v1/orders", "permission": "api:write"},
        {"path": "/api/v1/products", "permission": "api:write"}
    ],
    "PUT": [
        {"path": "/api/v1/users/*", "permission": "api:write"},
        {"path": "/api/v1/orders/*", "permission": "api:write"},
        {"path": "/api/v1/products/*", "permission": "api:write"}
    ],
    "PATCH": [
        {"path": "/api/v1/users/*", "permission": "api:write"},
        {"path": "/api/v1/orders/*", "permission": "api:write"},
        {"path": "/api/v1/products/*", "permission": "api:write"}
    ],
    "DELETE": [
        {"path": "/api/v1/users/*", "permission": "api:delete"},
        {"path": "/api/v1/orders/*", "permission": "api:delete"},
        {"path": "/api/v1/products/*", "permission": "api:delete"}
    ]
}

# ============================================================================
# Path Matching Helpers
# ============================================================================

# Exact path match
path_matches(pattern, path) if {
    not contains(pattern, "*")
    pattern == path
}

# Wildcard path match (single segment)
path_matches(pattern, path) if {
    endswith(pattern, "/*")
    prefix := trim_suffix(pattern, "/*")
    startswith(path, concat("", [prefix, "/"]))
}

# ============================================================================
# Additional Authorization Data
# ============================================================================

# Expose user information for logging/auditing
user_info := {
    "subject": input.token.sub,
    "username": input.token.preferred_username,
    "email": input.token.email,
    "realm_roles": input.token.realm_access.roles,
    "client_roles": input.token.resource_access
} if {
    input.token
}

# Expose the decision reason for debugging
decision_reason := "public_endpoint" if {
    is_public_endpoint
}

decision_reason := "authenticated_with_permission" if {
    not is_public_endpoint
    token_is_valid
    has_required_permission
}

decision_reason := "token_expired" if {
    not is_public_endpoint
    input.token
    input.token.exp <= time.now_ns() / 1000000000
}

decision_reason := "missing_token" if {
    not is_public_endpoint
    not input.token
}

decision_reason := "insufficient_permissions" if {
    not is_public_endpoint
    token_is_valid
    not has_required_permission
}
