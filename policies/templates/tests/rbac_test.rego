# RBAC Policy Tests
#
# Run with: opa test policies/templates/rbac.rego policies/templates/tests/rbac_test.rego -v

package rbac_test

import rego.v1
import data.rbac

# ============================================================================
# Test Fixtures
# ============================================================================

# Valid token with viewer role
valid_user_token := {
    "sub": "user-123",
    "exp": 9999999999,
    "realm_access": {"roles": ["viewer"]},
}

# Valid token with editor role
valid_editor_token := {
    "sub": "editor-456",
    "exp": 9999999999,
    "realm_access": {"roles": ["editor"]},
}

# Valid token with admin role
valid_admin_token := {
    "sub": "admin-789",
    "exp": 9999999999,
    "realm_access": {"roles": ["admin"]},
}

# Valid token with super_admin role
valid_super_admin_token := {
    "sub": "superadmin-001",
    "exp": 9999999999,
    "realm_access": {"roles": ["super_admin"]},
}

# Expired token
expired_token := {
    "sub": "user-123",
    "exp": 1000000000,
    "realm_access": {"roles": ["admin"]},
}

# ============================================================================
# Public Endpoint Tests
# ============================================================================

test_allow_health_endpoint if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/health",
    }
}

test_allow_ready_endpoint if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/ready",
    }
}

test_allow_api_health_endpoint if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/api/health",
    }
}

test_allow_public_subpath if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/public/docs",
    }
}

# ============================================================================
# Authentication Tests
# ============================================================================

test_deny_without_token if {
    not rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/users",
    }
}

test_deny_with_expired_token if {
    not rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": expired_token,
    }
}

# ============================================================================
# RBAC Permission Tests - Viewer Role
# ============================================================================

test_viewer_can_read_users if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": valid_user_token,
    }
}

test_viewer_can_read_single_user if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/users/user-123",
        "token": valid_user_token,
    }
}

test_viewer_cannot_create_users if {
    not rbac.allow with input as {
        "method": "POST",
        "path": "/api/v1/users",
        "token": valid_user_token,
    }
}

test_viewer_cannot_delete_users if {
    not rbac.allow with input as {
        "method": "DELETE",
        "path": "/api/v1/users/user-123",
        "token": valid_user_token,
    }
}

# ============================================================================
# RBAC Permission Tests - Editor Role
# ============================================================================

test_editor_can_read_users if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": valid_editor_token,
    }
}

test_editor_can_create_orders if {
    rbac.allow with input as {
        "method": "POST",
        "path": "/api/v1/orders",
        "token": valid_editor_token,
    }
}

test_editor_can_update_products if {
    rbac.allow with input as {
        "method": "PUT",
        "path": "/api/v1/products/prod-123",
        "token": valid_editor_token,
    }
}

test_editor_cannot_delete_orders if {
    not rbac.allow with input as {
        "method": "DELETE",
        "path": "/api/v1/orders/order-123",
        "token": valid_editor_token,
    }
}

# ============================================================================
# RBAC Permission Tests - Admin Role
# ============================================================================

test_admin_can_read_users if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": valid_admin_token,
    }
}

test_admin_can_create_users if {
    rbac.allow with input as {
        "method": "POST",
        "path": "/api/v1/users",
        "token": valid_admin_token,
    }
}

test_admin_can_delete_users if {
    rbac.allow with input as {
        "method": "DELETE",
        "path": "/api/v1/users/user-123",
        "token": valid_admin_token,
    }
}

test_admin_can_access_settings if {
    rbac.allow with input as {
        "method": "PUT",
        "path": "/api/v1/settings",
        "token": valid_admin_token,
    }
}

# ============================================================================
# Role Hierarchy Tests
# ============================================================================

test_admin_inherits_editor_permissions if {
    # Admin should be able to do what editors can do
    rbac.allow with input as {
        "method": "POST",
        "path": "/api/v1/orders",
        "token": valid_admin_token,
    }
}

test_editor_inherits_viewer_permissions if {
    # Editor should be able to do what viewers can do
    rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/reports",
        "token": valid_editor_token,
    }
}

# ============================================================================
# Super Admin Tests (Wildcard Permissions)
# ============================================================================

test_super_admin_can_do_anything if {
    rbac.allow with input as {
        "method": "DELETE",
        "path": "/api/v1/users/user-123",
        "token": valid_super_admin_token,
    }
}

# ============================================================================
# Authorization Response Tests
# ============================================================================

test_authorization_response_for_allowed if {
    result := rbac.authorization with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": valid_user_token,
    }
    result.allowed == true
    result.reason == "authorized"
    result.required_permission == "users:read"
}

test_authorization_response_for_denied if {
    result := rbac.authorization with input as {
        "method": "POST",
        "path": "/api/v1/users",
        "token": valid_user_token,
    }
    result.allowed == false
    result.reason == "insufficient_permissions"
}

test_authorization_response_for_public if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/health",
    }
}

test_authorization_response_public_reason if {
    result := rbac.authorization with input as {
        "method": "GET",
        "path": "/health",
    }
    result.allowed == true
    result.reason == "public_endpoint"
}

test_authorization_response_for_expired if {
    result := rbac.authorization with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": expired_token,
    }
    result.allowed == false
    result.reason == "token_expired"
}

# ============================================================================
# Path Matching Tests
# ============================================================================

test_exact_path_match if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": valid_editor_token,
    }
}

test_wildcard_path_match if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/users/user-123",
        "token": valid_editor_token,
    }
}

test_nested_wildcard_path if {
    rbac.allow with input as {
        "method": "GET",
        "path": "/api/v1/users/user-123/profile",
        "token": valid_editor_token,
    }
}
