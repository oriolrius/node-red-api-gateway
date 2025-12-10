# Resource Ownership Policy Template
#
# This template implements ownership-based access control where users can only
# access resources they own or have been explicitly granted access to.
#
# Key Features:
#   - Owner-based access control
#   - Delegation and sharing support
#   - Organization/tenant isolation
#   - Hierarchical ownership (team, department)
#   - Admin override capabilities
#
# Usage:
#   POST http://localhost:8181/v1/data/ownership/allow
#   {
#     "input": {
#       "method": "GET",
#       "path": "/api/v1/documents/doc-123",
#       "token": {
#         "sub": "user-456",
#         "org_id": "org-789",
#         "teams": ["team-alpha"]
#       },
#       "resource": {
#         "id": "doc-123",
#         "owner_id": "user-456",
#         "org_id": "org-789",
#         "team_id": "team-alpha",
#         "shared_with": ["user-111", "user-222"],
#         "visibility": "private"
#       }
#     }
#   }

package ownership

import rego.v1

# ============================================================================
# Default Decision
# ============================================================================

default allow := false

# ============================================================================
# Main Authorization Rules
# ============================================================================

# Allow public resources
allow if {
    is_public_visibility
}

# Allow access to own resources
allow if {
    not is_public_visibility
    token_is_valid
    is_resource_owner
}

# Allow access through explicit sharing
allow if {
    not is_public_visibility
    token_is_valid
    is_shared_with_user
    action_allowed_for_shared_access
}

# Allow access through team membership
allow if {
    not is_public_visibility
    token_is_valid
    is_team_resource
    user_is_team_member
    action_allowed_for_team_access
}

# Allow access through organization membership (org-visible resources)
allow if {
    not is_public_visibility
    token_is_valid
    is_org_visible
    same_organization
    action_allowed_for_org_access
}

# Allow admin access (with restrictions)
allow if {
    not is_public_visibility
    token_is_valid
    is_admin
    same_organization
    admin_action_allowed
}

# ============================================================================
# Token Validation
# ============================================================================

token_is_valid if {
    input.token
    input.token.exp > time.now_ns() / 1000000000
}

# ============================================================================
# User Information
# ============================================================================

user := {
    "id": input.token.sub,
    "org_id": object.get(input.token, "org_id", ""),
    "teams": object.get(input.token, "teams", []),
    "roles": object.get(input.token, "roles", []),
    "permissions": object.get(input.token, "permissions", []),
}

# ============================================================================
# Resource Information
# ============================================================================

resource := {
    "id": object.get(input.resource, "id", ""),
    "owner_id": object.get(input.resource, "owner_id", ""),
    "org_id": object.get(input.resource, "org_id", ""),
    "team_id": object.get(input.resource, "team_id", ""),
    "visibility": object.get(input.resource, "visibility", "private"),
    "shared_with": object.get(input.resource, "shared_with", []),
    "shared_permissions": object.get(input.resource, "shared_permissions", {}),
    "type": object.get(input.resource, "type", "unknown"),
}

# ============================================================================
# Visibility Levels
# ============================================================================

# Visibility hierarchy: public > org > team > private
visibility_levels := {
    "public": 0,    # Anyone can access (read)
    "org": 1,       # Organization members can access
    "team": 2,      # Team members can access
    "private": 3,   # Only owner and explicitly shared users
}

is_public_visibility if {
    resource.visibility == "public"
}

is_org_visible if {
    resource.visibility in {"org", "public"}
}

is_team_resource if {
    resource.team_id != ""
}

# ============================================================================
# Ownership Checks
# ============================================================================

is_resource_owner if {
    resource.owner_id == user.id
}

same_organization if {
    user.org_id != ""
    resource.org_id == user.org_id
}

user_is_team_member if {
    resource.team_id in user.teams
}

is_shared_with_user if {
    user.id in resource.shared_with
}

# ============================================================================
# Action Permissions
# ============================================================================

# Get action from HTTP method
current_action := action if {
    method_actions := {
        "GET": "read",
        "HEAD": "read",
        "POST": "create",
        "PUT": "update",
        "PATCH": "update",
        "DELETE": "delete",
    }
    action := method_actions[input.method]
}

# Owner permissions - full access
owner_permissions := {"read", "update", "delete", "share", "transfer"}

# Shared access permissions - customizable per share
default_shared_permissions := {"read"}

# Team access permissions
team_permissions := {"read", "update"}

# Organization access permissions (for org-visible resources)
org_permissions := {"read"}

# Admin permissions
admin_permissions := {"read", "update", "delete", "audit"}

action_allowed_for_shared_access if {
    # Check if specific permissions defined for this user
    user_perms := resource.shared_permissions[user.id]
    current_action in user_perms
}

action_allowed_for_shared_access if {
    # Fall back to default shared permissions
    not resource.shared_permissions[user.id]
    current_action in default_shared_permissions
}

action_allowed_for_team_access if {
    current_action in team_permissions
}

action_allowed_for_org_access if {
    current_action in org_permissions
}

admin_action_allowed if {
    current_action in admin_permissions
}

# ============================================================================
# Admin Check
# ============================================================================

admin_roles := {"admin", "super_admin", "org_admin"}

is_admin if {
    some role in user.roles
    role in admin_roles
}

# ============================================================================
# Resource Isolation Rules
# ============================================================================

# Multi-tenancy: Ensure resources are isolated by organization
tenant_isolation_check if {
    # Resource has no org (global resource)
    resource.org_id == ""
}

tenant_isolation_check if {
    # Resource belongs to user's org
    resource.org_id == user.org_id
}

# ============================================================================
# Delegation Support
# ============================================================================

# Allow delegation of access (owner can share)
can_delegate if {
    is_resource_owner
    current_action == "share"
}

can_delegate if {
    # Check if user has delegation permission in their shared access
    user_perms := resource.shared_permissions[user.id]
    "delegate" in user_perms
}

# ============================================================================
# Transfer Ownership
# ============================================================================

can_transfer_ownership if {
    is_resource_owner
    current_action == "transfer"
}

can_transfer_ownership if {
    is_admin
    "transfer" in admin_permissions
}

# ============================================================================
# Authorization Response
# ============================================================================

authorization := {
    "allowed": allow,
    "reason": decision_reason,
    "access_type": access_type,
    "user": {
        "id": user.id,
        "org_id": user.org_id,
        "is_admin": is_admin,
    },
    "resource": {
        "id": resource.id,
        "owner_id": resource.owner_id,
        "visibility": resource.visibility,
    },
    "action": current_action,
}

# Determine access type for logging
access_type := "owner" if {
    is_resource_owner
}

access_type := "shared" if {
    not is_resource_owner
    is_shared_with_user
}

access_type := "public" if {
    is_public_visibility
}

access_type := "owner" if {
    not is_public_visibility
    is_resource_owner
}

access_type := "shared" if {
    not is_public_visibility
    not is_resource_owner
    is_shared_with_user
}

access_type := "team" if {
    not is_public_visibility
    not is_resource_owner
    not is_shared_with_user
    user_is_team_member
}

access_type := "org" if {
    not is_public_visibility
    not is_resource_owner
    not is_shared_with_user
    not user_is_team_member
    is_org_visible
    same_organization
}

access_type := "admin" if {
    not is_public_visibility
    not is_resource_owner
    not is_shared_with_user
    not user_is_team_member
    is_admin
    same_organization
}

access_type := "none" if {
    not is_public_visibility
    not is_resource_owner
    not is_shared_with_user
    not user_is_team_member
    not is_admin
}

# Decision reasons
decision_reason := "public_resource" if {
    is_public_visibility
}

decision_reason := "owner_access" if {
    not is_public_visibility
    token_is_valid
    is_resource_owner
}

decision_reason := "shared_access" if {
    not is_public_visibility
    token_is_valid
    not is_resource_owner
    is_shared_with_user
    action_allowed_for_shared_access
}

decision_reason := "team_access" if {
    not is_public_visibility
    token_is_valid
    not is_resource_owner
    not is_shared_with_user
    is_team_resource
    user_is_team_member
    action_allowed_for_team_access
}

decision_reason := "org_access" if {
    not is_public_visibility
    token_is_valid
    not is_resource_owner
    not is_shared_with_user
    not user_is_team_member
    is_org_visible
    same_organization
    action_allowed_for_org_access
}

decision_reason := "admin_access" if {
    not is_public_visibility
    token_is_valid
    not is_resource_owner
    not is_shared_with_user
    not user_is_team_member
    is_admin
    same_organization
    admin_action_allowed
}

decision_reason := "not_owner" if {
    not is_public_visibility
    token_is_valid
    same_organization
    not is_resource_owner
    not is_shared_with_user
    not user_is_team_member
    not is_admin
}

decision_reason := "action_not_permitted" if {
    not is_public_visibility
    token_is_valid
    same_organization
    is_shared_with_user
    not action_allowed_for_shared_access
}

decision_reason := "org_mismatch" if {
    not is_public_visibility
    token_is_valid
    not same_organization
}

decision_reason := "missing_token" if {
    not is_public_visibility
    not input.token
}

decision_reason := "token_expired" if {
    not is_public_visibility
    input.token
    input.token.exp <= time.now_ns() / 1000000000
}
