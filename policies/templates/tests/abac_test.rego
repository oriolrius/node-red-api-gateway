# ABAC Policy Tests
#
# Run with: opa test policies/templates/abac.rego policies/templates/tests/abac_test.rego -v

package abac_test

import rego.v1
import data.abac

# ============================================================================
# Test Fixtures
# ============================================================================

# Engineering user with confidential clearance
engineering_user := {
    "sub": "user-eng-123",
    "exp": 9999999999,
    "department": "engineering",
    "clearance_level": "confidential",
    "location": "us-west",
    "roles": ["editor"],
}

# HR user with secret clearance
hr_user := {
    "sub": "user-hr-456",
    "exp": 9999999999,
    "department": "hr",
    "clearance_level": "secret",
    "location": "us-east",
    "roles": ["viewer"],
}

# Finance user
finance_user := {
    "sub": "user-fin-789",
    "exp": 9999999999,
    "department": "finance",
    "clearance_level": "confidential",
    "location": "eu-central",
    "roles": ["finance", "viewer"],
}

# Low clearance user
low_clearance_user := {
    "sub": "user-low-001",
    "exp": 9999999999,
    "department": "marketing",
    "clearance_level": "internal",
    "location": "us-west",
    "roles": ["viewer"],
}

# Expired token
expired_token := {
    "sub": "user-exp-001",
    "exp": 1000000000,
    "department": "engineering",
    "clearance_level": "top_secret",
}

# Engineering resource (confidential)
engineering_resource := {
    "id": "doc-eng-001",
    "type": "document",
    "classification": "confidential",
    "department": "engineering",
}

# HR resource (secret)
hr_resource := {
    "id": "doc-hr-001",
    "type": "document",
    "classification": "secret",
    "department": "hr",
}

# Public resource
public_resource := {
    "id": "doc-pub-001",
    "type": "document",
    "classification": "public",
    "department": "any",
}

# Cross-department resource
cross_dept_resource := {
    "id": "doc-cross-001",
    "type": "document",
    "classification": "internal",
    "department": "any",
}

# Corporate environment
corporate_environment := {
    "ip_address": "10.0.0.50",
    "device_type": "corporate_laptop",
    "network_type": "corporate",
}

# External environment
external_environment := {
    "ip_address": "203.0.113.50",
    "device_type": "personal_laptop",
    "network_type": "public",
}

# ============================================================================
# Public Resource Tests
# ============================================================================

test_allow_public_resource_without_auth if {
    abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-pub-001",
        "resource": public_resource,
    }
}

test_allow_public_health_endpoint if {
    abac.allow with input as {
        "method": "GET",
        "path": "/health",
        "resource": {},
    }
}

# ============================================================================
# Clearance Level Tests
# ============================================================================

test_allow_user_with_sufficient_clearance if {
    abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-eng-001",
        "token": engineering_user,
        "resource": engineering_resource,
        "environment": corporate_environment,
    }
}

test_deny_user_with_insufficient_clearance if {
    not abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-hr-001",
        "token": low_clearance_user,
        "resource": hr_resource,
        "environment": corporate_environment,
    }
}

test_allow_higher_clearance_access if {
    # Secret clearance can access confidential resources
    abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-eng-001",
        "token": hr_user,
        "resource": {
            "id": "doc-001",
            "type": "document",
            "classification": "internal",
            "department": "any",
        },
        "environment": corporate_environment,
    }
}

# ============================================================================
# Department Access Tests
# ============================================================================

test_allow_same_department_access if {
    abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-eng-001",
        "token": engineering_user,
        "resource": engineering_resource,
        "environment": corporate_environment,
    }
}

test_deny_different_department_access if {
    # Marketing user cannot access engineering resources
    not abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-eng-001",
        "token": low_clearance_user,
        "resource": engineering_resource,
        "environment": corporate_environment,
    }
}

test_allow_cross_department_resource if {
    abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-cross-001",
        "token": low_clearance_user,
        "resource": cross_dept_resource,
        "environment": corporate_environment,
    }
}

# ============================================================================
# Environment Condition Tests
# ============================================================================

test_allow_corporate_network_access if {
    abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-001",
        "token": engineering_user,
        "resource": engineering_resource,
        "environment": corporate_environment,
    }
}

test_deny_external_access_to_sensitive if {
    # High sensitivity resources require corporate network
    not abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-secret",
        "token": hr_user,
        "resource": {
            "id": "doc-secret",
            "type": "document",
            "classification": "secret",
            "department": "hr",
            "sensitivity": "high",
        },
        "environment": external_environment,
    }
}

# ============================================================================
# Token Validation Tests
# ============================================================================

test_deny_without_token if {
    not abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-eng-001",
        "resource": engineering_resource,
        "environment": corporate_environment,
    }
}

test_deny_expired_token if {
    not abac.allow with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-eng-001",
        "token": expired_token,
        "resource": engineering_resource,
        "environment": corporate_environment,
    }
}

# ============================================================================
# Authorization Response Tests
# ============================================================================

test_authorization_includes_attributes if {
    result := abac.authorization with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-eng-001",
        "token": engineering_user,
        "resource": engineering_resource,
        "environment": corporate_environment,
    }
    result.allowed == true
    result.user_attributes.department == "engineering"
    result.resource_attributes.classification == "confidential"
}

test_authorization_reason_insufficient_clearance if {
    result := abac.authorization with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-hr-001",
        "token": low_clearance_user,
        "resource": hr_resource,
        "environment": corporate_environment,
    }
    result.allowed == false
    # User with "internal" clearance cannot access "secret" resource
    result.reason == "insufficient_clearance"
}

test_authorization_reason_department_mismatch if {
    # Sales user with sufficient clearance but wrong department
    result := abac.authorization with input as {
        "method": "GET",
        "path": "/api/v1/docs/doc-eng-001",
        "token": {
            "sub": "user-001",
            "exp": 9999999999,
            "department": "sales",
            "clearance_level": "confidential",
        },
        "resource": engineering_resource,
        "environment": corporate_environment,
    }
    result.allowed == false
    # Clearance matches (confidential), so user_attributes_match is true
    # But department mismatch (sales != engineering)
    result.reason == "department_mismatch"
}

# ============================================================================
# User Attribute Extraction Tests
# ============================================================================

test_user_attributes_extraction if {
    attrs := abac.user_attributes with input as {
        "token": engineering_user,
    }
    attrs.department == "engineering"
    attrs.clearance_level == "confidential"
    attrs.location == "us-west"
}

test_user_attributes_defaults if {
    attrs := abac.user_attributes with input as {
        "token": {
            "sub": "minimal-user",
            "exp": 9999999999,
        },
    }
    attrs.department == "unknown"
    attrs.clearance_level == "none"
}
