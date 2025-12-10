# Role-Based Access Control (RBAC) Policy Template
#
# This template implements hierarchical role-based access control.
# It maps roles to permissions and checks if a user has the required
# permission for a given resource and action.
#
# Key Features:
#   - Hierarchical roles with permission inheritance
#   - Role-to-permission mapping via external data
#   - Support for multiple token formats (Keycloak, Auth0, generic JWT)
#   - Fine-grained resource/action permissions
#
# Usage:
#   POST http://localhost:8181/v1/data/rbac/allow
#   {
#     "input": {
#       "method": "GET",
#       "path": "/api/v1/users",
#       "token": {
#         "sub": "user-123",
#         "realm_access": { "roles": ["user"] },
#         "exp": 1699999999
#       }
#     }
#   }

package rbac

import rego.v1

# ============================================================================
# Default Decision
# ============================================================================

# Deny by default - explicit allow rules must match
default allow := false

# ============================================================================
# Main Authorization Rules
# ============================================================================

# Allow access to public endpoints without authentication
allow if {
    is_public_endpoint
}

# Allow authenticated requests with required permission
allow if {
    not is_public_endpoint
    token_is_valid
    user_has_required_permission
}

# ============================================================================
# Public Endpoints Configuration
# ============================================================================

# Define endpoints that don't require authentication
# Customize this list based on your API
public_endpoints := {
    "/health",
    "/ready",
    "/api/health",
    "/metrics",
    "/api/v1/public",
}

is_public_endpoint if {
    input.path in public_endpoints
}

is_public_endpoint if {
    some endpoint in public_endpoints
    startswith(input.path, concat("", [endpoint, "/"]))
}

# ============================================================================
# Token Validation
# ============================================================================

token_is_valid if {
    input.token
    not token_is_expired
}

token_is_expired if {
    input.token.exp
    input.token.exp <= time.now_ns() / 1000000000
}

# ============================================================================
# Role Hierarchy and Permission Mapping
# ============================================================================

# Role hierarchy defines which roles inherit from others
# Higher-level roles automatically get permissions from lower-level roles
role_hierarchy := {
    "super_admin": ["admin", "editor", "viewer"],
    "admin": ["editor", "viewer"],
    "editor": ["viewer"],
    "viewer": [],
}

# Permission mapping - defines what permissions each base role has
# Customize these based on your application's needs
role_permissions := {
    "super_admin": ["*"],          # Wildcard - all permissions
    "admin": [
        "users:read", "users:write", "users:delete",
        "orders:read", "orders:write", "orders:delete",
        "products:read", "products:write", "products:delete",
        "reports:read", "reports:write",
        "settings:read", "settings:write",
    ],
    "editor": [
        "users:read",
        "orders:read", "orders:write",
        "products:read", "products:write",
        "reports:read",
    ],
    "viewer": [
        "users:read",
        "orders:read",
        "products:read",
        "reports:read",
    ],
}

# Resource-to-permission mapping for endpoints
# Maps HTTP method + path pattern to required permission
endpoint_permissions := {
    "GET": {
        "/api/v1/users": "users:read",
        "/api/v1/users/*": "users:read",
        "/api/v1/orders": "orders:read",
        "/api/v1/orders/*": "orders:read",
        "/api/v1/products": "products:read",
        "/api/v1/products/*": "products:read",
        "/api/v1/reports": "reports:read",
        "/api/v1/reports/*": "reports:read",
        "/api/v1/settings": "settings:read",
    },
    "POST": {
        "/api/v1/users": "users:write",
        "/api/v1/orders": "orders:write",
        "/api/v1/products": "products:write",
        "/api/v1/reports": "reports:write",
    },
    "PUT": {
        "/api/v1/users/*": "users:write",
        "/api/v1/orders/*": "orders:write",
        "/api/v1/products/*": "products:write",
        "/api/v1/settings": "settings:write",
    },
    "PATCH": {
        "/api/v1/users/*": "users:write",
        "/api/v1/orders/*": "orders:write",
        "/api/v1/products/*": "products:write",
    },
    "DELETE": {
        "/api/v1/users/*": "users:delete",
        "/api/v1/orders/*": "orders:delete",
        "/api/v1/products/*": "products:delete",
    },
}

# ============================================================================
# Permission Checking
# ============================================================================

user_has_required_permission if {
    required := get_required_permission
    user_has_permission(required)
}

# Get the required permission for the current request
get_required_permission := permission if {
    method_permissions := endpoint_permissions[input.method]
    some pattern, perm in method_permissions
    path_matches(pattern, input.path)
    permission := perm
}

# Check if user has a specific permission
user_has_permission(permission) if {
    # Superuser check - wildcard permission
    some role in user_roles
    "*" in role_permissions[role]
}

user_has_permission(permission) if {
    # Direct permission check
    some role in effective_roles
    permission in role_permissions[role]
}

# ============================================================================
# Role Extraction
# ============================================================================

# Get user's assigned roles from the token
# Supports multiple token formats

# Keycloak format - realm_access.roles
user_roles contains role if {
    role := input.token.realm_access.roles[_]
}

# Keycloak format - resource_access.{client}.roles
user_roles contains role if {
    some client
    role := input.token.resource_access[client].roles[_]
}

# Auth0 format - roles claim
user_roles contains role if {
    role := input.token.roles[_]
}

# Generic JWT format - groups claim
user_roles contains role if {
    role := input.token.groups[_]
}

# Custom claim format - customize as needed
user_roles contains role if {
    role := input.token["custom:roles"][_]
}

# Calculate effective roles including inherited roles
effective_roles contains role if {
    some r in user_roles
    role := r
}

effective_roles contains role if {
    some r in user_roles
    inherited := role_hierarchy[r]
    role := inherited[_]
}

# ============================================================================
# Path Matching Helpers
# ============================================================================

# Exact path match
path_matches(pattern, path) if {
    not contains(pattern, "*")
    pattern == path
}

# Wildcard match for single path segment
path_matches(pattern, path) if {
    endswith(pattern, "/*")
    prefix := trim_suffix(pattern, "/*")
    startswith(path, concat("", [prefix, "/"]))
}

# Wildcard match for path prefix
path_matches(pattern, path) if {
    endswith(pattern, "/**")
    prefix := trim_suffix(pattern, "/**")
    startswith(path, prefix)
}

# ============================================================================
# Authorization Response
# ============================================================================

# Get required permission safely (returns null if no match)
required_permission_or_null := perm if {
    perm := get_required_permission
}

required_permission_or_null := null if {
    not get_required_permission
}

# Expose detailed authorization result
authorization := {
    "allowed": allow,
    "reason": decision_reason,
    "user": user_info,
    "required_permission": required_permission_or_null,
    "user_roles": user_roles,
    "effective_roles": effective_roles,
} if {
    input.token
}

authorization := {
    "allowed": allow,
    "reason": decision_reason,
    "user": null,
    "required_permission": required_permission_or_null,
    "user_roles": set(),
    "effective_roles": set(),
} if {
    not input.token
}

# Decision reason for logging/debugging
decision_reason := "public_endpoint" if {
    is_public_endpoint
}

decision_reason := "authorized" if {
    not is_public_endpoint
    token_is_valid
    user_has_required_permission
}

decision_reason := "token_expired" if {
    not is_public_endpoint
    token_is_expired
}

decision_reason := "missing_token" if {
    not is_public_endpoint
    not input.token
}

decision_reason := "insufficient_permissions" if {
    not is_public_endpoint
    token_is_valid
    not user_has_required_permission
}

# User information for logging
user_info := {
    "sub": input.token.sub,
    "username": object.get(input.token, "preferred_username", null),
    "email": object.get(input.token, "email", null),
} if {
    input.token
}
