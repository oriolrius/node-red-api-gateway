# Audit Logging Policy Tests
#
# Run with: opa test policies/templates/audit.rego policies/templates/tests/audit_test.rego -v

package audit_test

import rego.v1
import data.audit

# ============================================================================
# Test Fixtures
# ============================================================================

# Regular user token
user_token := {
    "sub": "user-123",
    "exp": 9999999999,
    "preferred_username": "john.doe",
    "email": "john.doe@example.com",
    "roles": ["user"],
    "groups": ["engineering"],
    "org_id": "org-001",
    "sid": "session-abc",
    "auth_time": 1700000000,
    "amr": ["password", "otp"],
}

# Admin token
admin_token := {
    "sub": "admin-456",
    "exp": 9999999999,
    "preferred_username": "admin.user",
    "email": "admin@example.com",
    "roles": ["admin"],
    "org_id": "org-001",
}

# Expired token
expired_token := {
    "sub": "user-expired",
    "exp": 1000000000,
    "roles": ["user"],
}

# ============================================================================
# Basic Authorization Tests
# ============================================================================

test_allow_valid_request if {
    audit.allow with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": user_token,
        "source_ip": "10.0.0.50",
        "request_id": "req-001",
    }
}

test_deny_blocked_action if {
    not audit.allow with input as {
        "method": "DELETE",
        "path": "/api/v1/audit-logs/log-123",
        "token": admin_token,
    }
}

test_deny_without_token if {
    not audit.allow with input as {
        "method": "GET",
        "path": "/api/v1/users",
    }
}

test_deny_expired_token if {
    not audit.allow with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": expired_token,
    }
}

# ============================================================================
# Audit Event Structure Tests
# ============================================================================

test_audit_event_has_required_fields if {
    event := audit.audit_event with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": user_token,
        "source_ip": "10.0.0.50",
        "request_id": "req-001",
    }
    event.event_type == "authorization_decision"
    event.event_id == "req-001"
    event.decision.allowed == true
    event.actor.subject == "user-123"
    event.action.method == "GET"
    event.action.operation == "read"
    event.resource.path == "/api/v1/users"
}

test_audit_event_actor_info if {
    event := audit.audit_event with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": user_token,
    }
    event.actor.subject == "user-123"
    event.actor.username == "john.doe"
    event.actor.roles == ["user"]
    event.actor.groups == ["engineering"]
    event.actor.org_id == "org-001"
    event.actor.session_id == "session-abc"
}

test_audit_event_context if {
    event := audit.audit_event with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": user_token,
        "source_ip": "10.0.0.50",
        "user_agent": "Mozilla/5.0 Test",
        "correlation_id": "corr-001",
    }
    event.context.source_ip == "10.0.0.50"
    event.context.user_agent == "Mozilla/5.0 Test"
    event.context.correlation_id == "corr-001"
}

# ============================================================================
# Resource Classification Tests
# ============================================================================

test_pii_resource_classification if {
    info := audit.resource_info with input as {
        "method": "GET",
        "path": "/api/v1/users/user-123",
    }
    info.category == "pii"
    info.is_sensitive == true
    "GDPR" in info.compliance
    "CCPA" in info.compliance
}

test_financial_resource_classification if {
    info := audit.resource_info with input as {
        "method": "POST",
        "path": "/api/v1/payments",
    }
    info.category == "financial"
    info.is_sensitive == true
    "PCI-DSS" in info.compliance
}

test_health_resource_classification if {
    info := audit.resource_info with input as {
        "method": "GET",
        "path": "/api/v1/health-records/rec-001",
    }
    info.category == "health"
    info.is_sensitive == true
    "HIPAA" in info.compliance
}

test_general_resource_classification if {
    info := audit.resource_info with input as {
        "method": "GET",
        "path": "/api/v1/products",
    }
    info.category == "general"
    info.is_sensitive == false
}

# ============================================================================
# Risk Score Tests
# ============================================================================

test_high_risk_delete_operation if {
    score := audit.risk_score with input as {
        "method": "DELETE",
        "path": "/api/v1/users/user-123",
        "token": user_token,
        "source_ip": "10.0.0.50",
    }
    score >= 40
}

test_medium_risk_update_operation if {
    score := audit.risk_score with input as {
        "method": "PUT",
        "path": "/api/v1/products/prod-001",
        "token": user_token,
        "source_ip": "10.0.0.50",
    }
    score >= 20
}

test_low_risk_read_operation if {
    score := audit.risk_score with input as {
        "method": "GET",
        "path": "/api/v1/products",
        "token": user_token,
        "source_ip": "10.0.0.50",
    }
    score < 40
}

test_sensitive_resource_increases_risk if {
    score_sensitive := audit.risk_score with input as {
        "method": "GET",
        "path": "/api/v1/payments/pay-001",
        "token": user_token,
        "source_ip": "10.0.0.50",
    }
    score_general := audit.risk_score with input as {
        "method": "GET",
        "path": "/api/v1/products/prod-001",
        "token": user_token,
        "source_ip": "10.0.0.50",
    }
    score_sensitive > score_general
}

# ============================================================================
# Risk Level Tests
# ============================================================================

test_risk_level_classification if {
    level := audit.risk_level with input as {
        "method": "DELETE",
        "path": "/api/v1/payments/pay-001",
        "token": user_token,
        "source_ip": "203.0.113.50",
    }
    level in {"critical", "high", "medium", "low", "info"}
}

# ============================================================================
# Email Masking Tests
# ============================================================================

test_email_masking if {
    masked := audit.mask_email("john.doe@example.com")
    masked == "jo***@example.com"
}

test_empty_email_masking if {
    masked := audit.mask_email("")
    masked == ""
}

# ============================================================================
# User Context Tests
# ============================================================================

test_user_context_with_token if {
    ctx := audit.user_context with input as {
        "token": user_token,
    }
    ctx.subject == "user-123"
    ctx.username == "john.doe"
    ctx.roles == ["user"]
    ctx.amr == ["password", "otp"]
}

test_user_context_without_token if {
    ctx := audit.user_context with input as {}
    ctx.subject == "anonymous"
    ctx.username == "anonymous"
    ctx.roles == []
}

# ============================================================================
# Decision Reason Tests
# ============================================================================

test_decision_reason_authorized if {
    reason := audit.decision_reason with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": user_token,
    }
    reason == "authorized"
}

test_decision_reason_blocked if {
    reason := audit.decision_reason with input as {
        "method": "DELETE",
        "path": "/api/v1/audit-logs/log-001",
        "token": admin_token,
    }
    reason == "blocked_action"
}

test_decision_reason_missing_token if {
    reason := audit.decision_reason with input as {
        "method": "GET",
        "path": "/api/v1/users",
    }
    reason == "missing_token"
}

test_decision_reason_expired if {
    reason := audit.decision_reason with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": expired_token,
    }
    reason == "token_expired"
}

# ============================================================================
# Compliance Tags Tests
# ============================================================================

test_compliance_tags_for_pii if {
    tags := audit.compliance_tags with input as {
        "method": "GET",
        "path": "/api/v1/users/user-123",
    }
    "GDPR" in tags
    "CCPA" in tags
}

test_compliance_tags_empty_for_general if {
    tags := audit.compliance_tags with input as {
        "method": "GET",
        "path": "/api/v1/products",
    }
    count(tags) == 0
}

# ============================================================================
# Retention Days Tests
# ============================================================================

test_retention_days_delete if {
    days := audit.get_retention_days with input as {
        "method": "DELETE",
    }
    days == 365
}

test_retention_days_post if {
    days := audit.get_retention_days with input as {
        "method": "POST",
    }
    days == 90
}

test_retention_days_get if {
    days := audit.get_retention_days with input as {
        "method": "GET",
    }
    days == 30
}

# ============================================================================
# Audit Query Tests
# ============================================================================

test_high_risk_events_query if {
    is_high_risk := audit.high_risk_events with input as {
        "method": "DELETE",
        "path": "/api/v1/payments/pay-001",
        "token": user_token,
        "source_ip": "203.0.113.50",
    }
    is_high_risk == true
}

test_compliance_events_query if {
    is_compliance := audit.compliance_events with input as {
        "method": "GET",
        "path": "/api/v1/users/user-123",
        "token": user_token,
    }
    is_compliance == true
}

test_denied_events_query if {
    is_denied := audit.denied_events with input as {
        "method": "DELETE",
        "path": "/api/v1/audit-logs/log-001",
        "token": admin_token,
    }
    is_denied == true
}

test_sensitive_access_events_query if {
    is_sensitive := audit.sensitive_access_events with input as {
        "method": "GET",
        "path": "/api/v1/payments/pay-001",
    }
    is_sensitive == true
}

# ============================================================================
# Complete Decision Tests
# ============================================================================

test_complete_decision_allowed if {
    result := audit.decision with input as {
        "method": "GET",
        "path": "/api/v1/users",
        "token": user_token,
        "source_ip": "10.0.0.50",
        "request_id": "req-001",
    }
    result.allow == true
    result.audit.event_type == "authorization_decision"
    result.audit.decision.allowed == true
}

test_complete_decision_denied if {
    result := audit.decision with input as {
        "method": "DELETE",
        "path": "/api/v1/audit-logs/log-001",
        "token": admin_token,
        "source_ip": "10.0.0.50",
        "request_id": "req-002",
    }
    result.allow == false
    result.audit.decision.allowed == false
    result.audit.decision.reason == "blocked_action"
}
