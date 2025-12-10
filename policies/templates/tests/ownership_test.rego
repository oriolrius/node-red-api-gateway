# Resource Ownership Policy Tests
#
# Run with: opa test policies/templates/ownership.rego policies/templates/tests/ownership_test.rego -v

package ownership_test

import rego.v1
import data.ownership

# ============================================================================
# Test Fixtures
# ============================================================================

# Resource owner
owner_token := {
    "sub": "user-owner-123",
    "exp": 9999999999,
    "org_id": "org-001",
    "teams": ["team-alpha", "team-beta"],
    "roles": ["user"],
}

# Different user in same org
org_member_token := {
    "sub": "user-member-456",
    "exp": 9999999999,
    "org_id": "org-001",
    "teams": ["team-gamma"],
    "roles": ["user"],
}

# User in same team
team_member_token := {
    "sub": "user-team-789",
    "exp": 9999999999,
    "org_id": "org-001",
    "teams": ["team-alpha"],
    "roles": ["user"],
}

# Admin user
admin_token := {
    "sub": "user-admin-001",
    "exp": 9999999999,
    "org_id": "org-001",
    "teams": [],
    "roles": ["admin"],
}

# User from different org
different_org_token := {
    "sub": "user-other-001",
    "exp": 9999999999,
    "org_id": "org-002",
    "teams": ["team-alpha"],
    "roles": ["user"],
}

# Shared user
shared_user_token := {
    "sub": "user-shared-001",
    "exp": 9999999999,
    "org_id": "org-001",
    "teams": [],
    "roles": ["user"],
}

# Expired token
expired_token := {
    "sub": "user-expired",
    "exp": 1000000000,
    "org_id": "org-001",
}

# Private resource owned by user-owner-123
private_resource := {
    "id": "doc-private-001",
    "owner_id": "user-owner-123",
    "org_id": "org-001",
    "team_id": "",
    "visibility": "private",
    "shared_with": [],
    "shared_permissions": {},
    "type": "document",
}

# Team resource
team_resource := {
    "id": "doc-team-001",
    "owner_id": "user-owner-123",
    "org_id": "org-001",
    "team_id": "team-alpha",
    "visibility": "team",
    "shared_with": [],
    "shared_permissions": {},
    "type": "document",
}

# Org-visible resource
org_resource := {
    "id": "doc-org-001",
    "owner_id": "user-owner-123",
    "org_id": "org-001",
    "team_id": "",
    "visibility": "org",
    "shared_with": [],
    "shared_permissions": {},
    "type": "document",
}

# Public resource
public_resource := {
    "id": "doc-public-001",
    "owner_id": "user-owner-123",
    "org_id": "org-001",
    "visibility": "public",
    "shared_with": [],
    "type": "document",
}

# Resource shared with specific user
shared_resource := {
    "id": "doc-shared-001",
    "owner_id": "user-owner-123",
    "org_id": "org-001",
    "team_id": "",
    "visibility": "private",
    "shared_with": ["user-shared-001"],
    "shared_permissions": {
        "user-shared-001": ["read", "update"],
    },
    "type": "document",
}

# ============================================================================
# Public Resource Tests
# ============================================================================

test_allow_public_resource_without_auth if {
    ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-public-001",
        "resource": public_resource,
    }
}

test_allow_public_resource_with_any_user if {
    ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-public-001",
        "token": different_org_token,
        "resource": public_resource,
    }
}

# ============================================================================
# Owner Access Tests
# ============================================================================

test_owner_can_read if {
    ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-private-001",
        "token": owner_token,
        "resource": private_resource,
    }
}

test_owner_can_update if {
    ownership.allow with input as {
        "method": "PUT",
        "path": "/api/v1/docs/doc-private-001",
        "token": owner_token,
        "resource": private_resource,
    }
}

test_owner_can_delete if {
    ownership.allow with input as {
        "method": "DELETE",
        "path": "/api/v1/docs/doc-private-001",
        "token": owner_token,
        "resource": private_resource,
    }
}

# ============================================================================
# Non-Owner Private Resource Tests
# ============================================================================

test_deny_non_owner_private_read if {
    not ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-private-001",
        "token": org_member_token,
        "resource": private_resource,
    }
}

test_deny_non_owner_private_update if {
    not ownership.allow with input as {
        "method": "PUT",
        "path": "/api/v1/docs/doc-private-001",
        "token": org_member_token,
        "resource": private_resource,
    }
}

# ============================================================================
# Shared Access Tests
# ============================================================================

test_shared_user_can_read if {
    ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-shared-001",
        "token": shared_user_token,
        "resource": shared_resource,
    }
}

test_shared_user_can_update if {
    ownership.allow with input as {
        "method": "PUT",
        "path": "/api/v1/docs/doc-shared-001",
        "token": shared_user_token,
        "resource": shared_resource,
    }
}

test_shared_user_cannot_delete if {
    # Shared permissions only include read and update
    not ownership.allow with input as {
        "method": "DELETE",
        "path": "/api/v1/docs/doc-shared-001",
        "token": shared_user_token,
        "resource": shared_resource,
    }
}

test_non_shared_user_cannot_read if {
    not ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-shared-001",
        "token": org_member_token,
        "resource": shared_resource,
    }
}

# ============================================================================
# Team Access Tests
# ============================================================================

test_team_member_can_read if {
    ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-team-001",
        "token": team_member_token,
        "resource": team_resource,
    }
}

test_team_member_can_update if {
    ownership.allow with input as {
        "method": "PUT",
        "path": "/api/v1/docs/doc-team-001",
        "token": team_member_token,
        "resource": team_resource,
    }
}

test_non_team_member_cannot_access if {
    not ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-team-001",
        "token": org_member_token,
        "resource": team_resource,
    }
}

# ============================================================================
# Organization Access Tests
# ============================================================================

test_org_member_can_read_org_resource if {
    ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-org-001",
        "token": org_member_token,
        "resource": org_resource,
    }
}

test_org_member_cannot_update_org_resource if {
    # Org visibility only grants read access
    not ownership.allow with input as {
        "method": "PUT",
        "path": "/api/v1/docs/doc-org-001",
        "token": org_member_token,
        "resource": org_resource,
    }
}

test_different_org_cannot_access if {
    not ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-org-001",
        "token": different_org_token,
        "resource": org_resource,
    }
}

# ============================================================================
# Admin Access Tests
# ============================================================================

test_admin_can_read_private if {
    ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-private-001",
        "token": admin_token,
        "resource": private_resource,
    }
}

test_admin_can_update_private if {
    ownership.allow with input as {
        "method": "PUT",
        "path": "/api/v1/docs/doc-private-001",
        "token": admin_token,
        "resource": private_resource,
    }
}

test_admin_can_delete_private if {
    ownership.allow with input as {
        "method": "DELETE",
        "path": "/api/v1/docs/doc-private-001",
        "token": admin_token,
        "resource": private_resource,
    }
}

test_admin_different_org_cannot_access if {
    # Admin from different org shouldn't access resources
    not ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-private-001",
        "token": {
            "sub": "admin-other",
            "exp": 9999999999,
            "org_id": "org-002",
            "roles": ["admin"],
        },
        "resource": private_resource,
    }
}

# ============================================================================
# Token Validation Tests
# ============================================================================

test_deny_without_token if {
    not ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-private-001",
        "resource": private_resource,
    }
}

test_deny_expired_token if {
    not ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-private-001",
        "token": expired_token,
        "resource": private_resource,
    }
}

# ============================================================================
# Authorization Response Tests
# ============================================================================

test_authorization_owner_access if {
    ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-private-001",
        "token": owner_token,
        "resource": private_resource,
    }
}

test_authorization_owner_has_access_type if {
    result := ownership.access_type with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-private-001",
        "token": owner_token,
        "resource": private_resource,
    }
    result == "owner"
}

test_authorization_shared_access if {
    ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-shared-001",
        "token": shared_user_token,
        "resource": shared_resource,
    }
}

test_authorization_shared_has_access_type if {
    result := ownership.access_type with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-shared-001",
        "token": shared_user_token,
        "resource": shared_resource,
    }
    result == "shared"
}

test_authorization_team_access if {
    ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-team-001",
        "token": team_member_token,
        "resource": team_resource,
    }
}

test_authorization_team_has_access_type if {
    result := ownership.access_type with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-team-001",
        "token": team_member_token,
        "resource": team_resource,
    }
    result == "team"
}

test_authorization_denied_not_owner if {
    not ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-private-001",
        "token": org_member_token,
        "resource": private_resource,
    }
}

test_authorization_denied_org_mismatch if {
    not ownership.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-org-001",
        "token": different_org_token,
        "resource": org_resource,
    }
}
