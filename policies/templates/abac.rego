# Attribute-Based Access Control (ABAC) Policy Template
#
# This template implements attribute-based access control using user attributes,
# resource attributes, and environmental conditions for fine-grained authorization.
#
# Key Features:
#   - User attribute evaluation (department, clearance, location)
#   - Resource attribute matching (classification, owner, sensitivity)
#   - Environmental conditions (IP, time, device)
#   - Policy rules combining multiple attribute conditions
#   - Support for complex boolean expressions
#
# Usage:
#   POST http://localhost:8181/v1/data/abac/allow
#   {
#     "input": {
#       "method": "GET",
#       "path": "/api/v1/documents/doc-123",
#       "token": {
#         "sub": "user-456",
#         "department": "engineering",
#         "clearance_level": "confidential",
#         "location": "us-west"
#       },
#       "resource": {
#         "id": "doc-123",
#         "type": "document",
#         "classification": "confidential",
#         "department": "engineering"
#       },
#       "environment": {
#         "ip_address": "10.0.0.1",
#         "timestamp": "2024-01-15T10:30:00Z",
#         "device_type": "corporate_laptop"
#       }
#     }
#   }

package abac

import rego.v1

# ============================================================================
# Default Decision
# ============================================================================

default allow := false

# ============================================================================
# Main Authorization Rules
# ============================================================================

# Allow access to public resources
allow if {
    is_public_resource
}

# Allow access when all attribute conditions are satisfied
allow if {
    not is_public_resource
    token_is_valid
    user_attributes_match
    resource_attributes_match
    environment_conditions_match
}

# ============================================================================
# Public Resources
# ============================================================================

is_public_resource if {
    input.resource.classification == "public"
}

is_public_resource if {
    input.path in {"/health", "/ready", "/api/public"}
}

# ============================================================================
# Token Validation
# ============================================================================

token_is_valid if {
    input.token
    input.token.exp > time.now_ns() / 1000000000
}

# ============================================================================
# User Attribute Conditions
# ============================================================================

# User attributes extracted from token or external source
user_attributes := {
    "subject": input.token.sub,
    "department": object.get(input.token, "department", "unknown"),
    "clearance_level": object.get(input.token, "clearance_level", "none"),
    "location": object.get(input.token, "location", "unknown"),
    "roles": object.get(input.token, "roles", []),
    "teams": object.get(input.token, "teams", []),
    "job_title": object.get(input.token, "job_title", "unknown"),
    "employee_type": object.get(input.token, "employee_type", "unknown"),
}

# Clearance level hierarchy
clearance_hierarchy := {
    "top_secret": 4,
    "secret": 3,
    "confidential": 2,
    "internal": 1,
    "public": 0,
    "none": -1,
}

# Check if user has sufficient clearance
user_has_clearance(required_level) if {
    user_level := clearance_hierarchy[user_attributes.clearance_level]
    required := clearance_hierarchy[required_level]
    user_level >= required
}

# User attribute matching rules
user_attributes_match if {
    # Rule: User must have clearance for resource classification
    resource_classification := object.get(input.resource, "classification", "public")
    user_has_clearance(resource_classification)
}

# ============================================================================
# Resource Attribute Conditions
# ============================================================================

# Resource attributes from input or external lookup
resource_attributes := {
    "id": object.get(input.resource, "id", "unknown"),
    "type": object.get(input.resource, "type", "unknown"),
    "classification": object.get(input.resource, "classification", "public"),
    "department": object.get(input.resource, "department", "any"),
    "owner": object.get(input.resource, "owner", "unknown"),
    "sensitivity": object.get(input.resource, "sensitivity", "low"),
    "tags": object.get(input.resource, "tags", []),
}

# Resource attribute matching rules
resource_attributes_match if {
    # Rule: Same department OR resource is cross-department accessible
    department_access_allowed
}

department_access_allowed if {
    resource_attributes.department == "any"
}

department_access_allowed if {
    resource_attributes.department == user_attributes.department
}

department_access_allowed if {
    # User is in a department that has cross-access
    user_attributes.department in cross_department_access[resource_attributes.department]
}

# Cross-department access matrix
# Defines which departments can access other departments' resources
cross_department_access := {
    "engineering": ["devops", "security"],
    "hr": ["legal", "executive"],
    "finance": ["executive", "audit"],
    "security": ["engineering", "devops", "it"],
    "executive": ["hr", "finance", "legal"],
}

# ============================================================================
# Environment Conditions
# ============================================================================

# Environment context from request
environment := {
    "ip_address": object.get(input.environment, "ip_address", "0.0.0.0"),
    "timestamp": object.get(input.environment, "timestamp", ""),
    "device_type": object.get(input.environment, "device_type", "unknown"),
    "network_type": object.get(input.environment, "network_type", "unknown"),
    "geo_location": object.get(input.environment, "geo_location", "unknown"),
}

# Corporate network ranges
corporate_networks := [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
]

# VPN network ranges
vpn_networks := [
    "10.100.0.0/16",
]

# Trusted device types
trusted_devices := {
    "corporate_laptop",
    "corporate_desktop",
    "mobile_mdm",
}

# Environment conditions must be satisfied
environment_conditions_match if {
    # For highly sensitive resources, require additional environment checks
    not is_highly_sensitive
}

environment_conditions_match if {
    is_highly_sensitive
    is_corporate_network
    is_trusted_device
}

is_highly_sensitive if {
    resource_attributes.sensitivity == "high"
}

is_highly_sensitive if {
    resource_attributes.classification in {"top_secret", "secret"}
}

is_corporate_network if {
    some network in corporate_networks
    net.cidr_contains(network, environment.ip_address)
}

is_corporate_network if {
    some network in vpn_networks
    net.cidr_contains(network, environment.ip_address)
}

is_trusted_device if {
    environment.device_type in trusted_devices
}

# ============================================================================
# Action-Based Rules
# ============================================================================

# Define allowed actions per resource type
allowed_actions := {
    "document": {
        "read": ["viewer", "editor", "admin", "owner"],
        "write": ["editor", "admin", "owner"],
        "delete": ["admin", "owner"],
        "share": ["editor", "admin", "owner"],
    },
    "report": {
        "read": ["viewer", "editor", "admin"],
        "generate": ["editor", "admin"],
        "delete": ["admin"],
    },
    "settings": {
        "read": ["viewer", "admin"],
        "write": ["admin"],
    },
}

# Get action from HTTP method
action_from_method := action if {
    method_to_action := {
        "GET": "read",
        "HEAD": "read",
        "POST": "write",
        "PUT": "write",
        "PATCH": "write",
        "DELETE": "delete",
    }
    action := method_to_action[input.method]
}

# Check if user has permission for action
user_can_perform_action if {
    action := action_from_method
    resource_type := resource_attributes.type
    allowed_roles := allowed_actions[resource_type][action]
    some role in allowed_roles
    user_has_role_or_ownership(role)
}

user_has_role_or_ownership(role) if {
    role == "owner"
    resource_attributes.owner == user_attributes.subject
}

user_has_role_or_ownership(role) if {
    role != "owner"
    role in user_attributes.roles
}

# ============================================================================
# Policy Rules (Combine Conditions)
# ============================================================================

# Policy: Engineering documents require engineering department
engineering_policy if {
    resource_attributes.type == "document"
    resource_attributes.department == "engineering"
    user_attributes.department == "engineering"
}

# Policy: Financial reports require finance role and confidential clearance
finance_policy if {
    resource_attributes.type == "report"
    "financial" in resource_attributes.tags
    "finance" in user_attributes.roles
    user_has_clearance("confidential")
}

# Policy: HR records require HR department and restricted location
hr_policy if {
    resource_attributes.type == "employee_record"
    user_attributes.department == "hr"
    user_attributes.location in {"us-east", "us-west", "eu-central"}
}

# ============================================================================
# Authorization Response
# ============================================================================

# Safe boolean wrappers for evaluation results
user_match_safe := true if {
    user_attributes_match
}

user_match_safe := false if {
    not user_attributes_match
}

resource_match_safe := true if {
    resource_attributes_match
}

resource_match_safe := false if {
    not resource_attributes_match
}

environment_match_safe := true if {
    environment_conditions_match
}

environment_match_safe := false if {
    not environment_conditions_match
}

authorization := {
    "allowed": allow,
    "reason": decision_reason,
    "user_attributes": user_attributes,
    "resource_attributes": resource_attributes,
    "environment": environment,
    "evaluation": {
        "user_match": user_match_safe,
        "resource_match": resource_match_safe,
        "environment_match": environment_match_safe,
    },
}

decision_reason := "public_resource" if {
    is_public_resource
}

decision_reason := "authorized" if {
    not is_public_resource
    token_is_valid
    user_attributes_match
    resource_attributes_match
    environment_conditions_match
}

decision_reason := "insufficient_clearance" if {
    not is_public_resource
    token_is_valid
    not user_attributes_match
}

decision_reason := "department_mismatch" if {
    not is_public_resource
    token_is_valid
    user_attributes_match
    not resource_attributes_match
}

decision_reason := "environment_restricted" if {
    not is_public_resource
    token_is_valid
    user_attributes_match
    resource_attributes_match
    not environment_conditions_match
}

decision_reason := "missing_token" if {
    not is_public_resource
    not input.token
}

decision_reason := "token_expired" if {
    not is_public_resource
    input.token
    input.token.exp <= time.now_ns() / 1000000000
}
