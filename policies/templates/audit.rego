# Audit Logging Policy Template
#
# This template provides comprehensive audit logging for authorization decisions.
# It generates structured audit events with contextual information for compliance,
# security monitoring, and forensic analysis.
#
# Key Features:
#   - Structured audit events for all authorization decisions
#   - Risk scoring for anomaly detection
#   - Sensitive resource tracking
#   - User behavior analysis support
#   - Compliance-ready audit trails
#   - Data masking for sensitive fields
#
# Usage:
#   POST http://localhost:8181/v1/data/audit/decision
#   {
#     "input": {
#       "method": "DELETE",
#       "path": "/api/v1/users/user-123",
#       "token": {
#         "sub": "user-456",
#         "roles": ["admin"],
#         "preferred_username": "admin.user"
#       },
#       "source_ip": "10.0.0.50",
#       "user_agent": "Mozilla/5.0...",
#       "request_id": "req-abc-123"
#     }
#   }

package audit

import rego.v1

# ============================================================================
# Default Decision (Inherits from main policy)
# ============================================================================

default allow := false

# Import authorization decision from main policy (compose with other policies)
# In production, this would import from your main authorization policy
# For this template, we implement basic authorization

allow if {
    token_is_valid
    not is_blocked_action
}

# ============================================================================
# Token Validation
# ============================================================================

token_is_valid if {
    input.token
    input.token.exp > time.now_ns() / 1000000000
}

# ============================================================================
# Sensitive Operations Configuration
# ============================================================================

# Operations that require enhanced auditing
sensitive_operations := {
    "DELETE": {
        "risk_level": "high",
        "requires_approval": true,
        "retention_days": 365,
    },
    "PUT": {
        "risk_level": "medium",
        "requires_approval": false,
        "retention_days": 180,
    },
    "PATCH": {
        "risk_level": "medium",
        "requires_approval": false,
        "retention_days": 180,
    },
    "POST": {
        "risk_level": "low",
        "requires_approval": false,
        "retention_days": 90,
    },
    "GET": {
        "risk_level": "info",
        "requires_approval": false,
        "retention_days": 30,
    },
}

# Sensitive resources requiring enhanced audit
sensitive_resources := {
    "/api/v1/users": {
        "category": "pii",
        "compliance": ["GDPR", "CCPA"],
        "mask_fields": ["ssn", "email", "phone"],
    },
    "/api/v1/payments": {
        "category": "financial",
        "compliance": ["PCI-DSS", "SOX"],
        "mask_fields": ["card_number", "cvv", "account"],
    },
    "/api/v1/health-records": {
        "category": "health",
        "compliance": ["HIPAA"],
        "mask_fields": ["diagnosis", "treatment", "medications"],
    },
    "/api/v1/admin": {
        "category": "administrative",
        "compliance": ["SOC2"],
        "mask_fields": [],
    },
    "/api/v1/secrets": {
        "category": "credentials",
        "compliance": ["SOC2", "ISO27001"],
        "mask_fields": ["api_key", "secret", "password", "token"],
    },
}

# Actions that are always blocked and logged
blocked_actions := {
    {"method": "DELETE", "path": "/api/v1/system"},
    {"method": "DELETE", "path": "/api/v1/audit-logs"},
}

is_blocked_action if {
    some action in blocked_actions
    input.method == action.method
    startswith(input.path, action.path)
}

# ============================================================================
# User Context Extraction
# ============================================================================

user_context := {
    "subject": input.token.sub,
    "username": object.get(input.token, "preferred_username", "unknown"),
    "email": mask_email(object.get(input.token, "email", "")),
    "roles": object.get(input.token, "roles", []),
    "groups": object.get(input.token, "groups", []),
    "org_id": object.get(input.token, "org_id", ""),
    "session_id": object.get(input.token, "sid", ""),
    "auth_time": object.get(input.token, "auth_time", 0),
    "amr": object.get(input.token, "amr", []),  # Authentication methods
} if {
    input.token
}

user_context := {
    "subject": "anonymous",
    "username": "anonymous",
    "email": "",
    "roles": [],
    "groups": [],
    "org_id": "",
    "session_id": "",
    "auth_time": 0,
    "amr": [],
} if {
    not input.token
}

# ============================================================================
# Request Context
# ============================================================================

request_context := {
    "request_id": object.get(input, "request_id", generate_request_id),
    "timestamp": time.now_ns(),
    "timestamp_iso": time.format(time.now_ns()),
    "method": input.method,
    "path": input.path,
    "source_ip": object.get(input, "source_ip", "unknown"),
    "user_agent": object.get(input, "user_agent", "unknown"),
    "correlation_id": object.get(input, "correlation_id", ""),
}

# Generate a pseudo-request ID if not provided
generate_request_id := id if {
    id := sprintf("audit-%d", [time.now_ns()])
}

# ============================================================================
# Resource Classification
# ============================================================================

resource_info := info if {
    some path, details in sensitive_resources
    startswith(input.path, path)
    info := {
        "path_pattern": path,
        "category": details.category,
        "compliance": details.compliance,
        "is_sensitive": true,
    }
}

resource_info := {
    "path_pattern": input.path,
    "category": "general",
    "compliance": [],
    "is_sensitive": false,
} if {
    not any_sensitive_match
}

any_sensitive_match if {
    some path, _ in sensitive_resources
    startswith(input.path, path)
}

# ============================================================================
# Risk Assessment
# ============================================================================

# Calculate risk score based on multiple factors
risk_score := score if {
    base_score := operation_risk_score
    sensitivity_bonus := resource_sensitivity_score
    time_bonus := time_risk_score
    behavior_bonus := behavior_risk_score
    score := base_score + sensitivity_bonus + time_bonus + behavior_bonus
}

# Operation risk (0-40 points)
operation_risk_score := 40 if {
    sensitive_operations[input.method].risk_level == "high"
}

operation_risk_score := 20 if {
    sensitive_operations[input.method].risk_level == "medium"
}

operation_risk_score := 10 if {
    sensitive_operations[input.method].risk_level == "low"
}

operation_risk_score := 0 if {
    sensitive_operations[input.method].risk_level == "info"
}

operation_risk_score := 5 if {
    not sensitive_operations[input.method]
}

# Resource sensitivity (0-30 points)
resource_sensitivity_score := 30 if {
    resource_info.category in {"credentials", "financial"}
}

resource_sensitivity_score := 25 if {
    resource_info.category == "health"
}

resource_sensitivity_score := 20 if {
    resource_info.category == "pii"
}

resource_sensitivity_score := 10 if {
    resource_info.category == "administrative"
}

resource_sensitivity_score := 0 if {
    not resource_info.is_sensitive
}

# Time-based risk (0-15 points)
current_hour := time.clock([time.now_ns(), "UTC"])[0]

time_risk_score := 15 if {
    # High risk during off-hours (11 PM - 5 AM)
    current_hour >= 23
}

time_risk_score := 15 if {
    current_hour < 5
}

time_risk_score := 5 if {
    # Moderate risk during extended hours
    current_hour >= 20
    current_hour < 23
}

time_risk_score := 5 if {
    current_hour >= 5
    current_hour < 7
}

time_risk_score := 0 if {
    current_hour >= 7
    current_hour < 20
}

# Behavior risk (0-15 points)
# This would integrate with external behavior analysis in production
behavior_risk_score := 15 if {
    # First-time access to sensitive resource (placeholder)
    resource_info.is_sensitive
    is_first_access
}

behavior_risk_score := 10 if {
    # Unusual source IP (placeholder)
    is_unusual_ip
}

behavior_risk_score := 0 if {
    not is_first_access
    not is_unusual_ip
}

# Placeholder rules - integrate with behavior analysis system
is_first_access := false

is_unusual_ip if {
    # Check if IP is from unexpected location
    not startswith(request_context.source_ip, "10.")
    not startswith(request_context.source_ip, "192.168.")
    not startswith(request_context.source_ip, "172.")
}

# Risk level classification
risk_level := "critical" if {
    risk_score >= 80
}

risk_level := "high" if {
    risk_score >= 60
    risk_score < 80
}

risk_level := "medium" if {
    risk_score >= 40
    risk_score < 60
}

risk_level := "low" if {
    risk_score >= 20
    risk_score < 40
}

risk_level := "info" if {
    risk_score < 20
}

# ============================================================================
# Data Masking
# ============================================================================

# Mask email addresses
mask_email(email) := masked if {
    email != ""
    parts := split(email, "@")
    count(parts) == 2
    local := parts[0]
    domain := parts[1]
    masked_local := concat("", [substring(local, 0, 2), "***"])
    masked := concat("@", [masked_local, domain])
}

mask_email(email) := "" if {
    email == ""
}

mask_email(email) := email if {
    parts := split(email, "@")
    count(parts) != 2
}

# Mask sensitive request body fields
mask_sensitive_body(body) := masked if {
    resource_info.is_sensitive
    details := sensitive_resources[resource_info.path_pattern]
    masked := object.filter(body, object.keys(body) - {x | x := details.mask_fields[_]})
}

mask_sensitive_body(body) := body if {
    not resource_info.is_sensitive
}

# ============================================================================
# Compliance Tagging
# ============================================================================

compliance_tags := tags if {
    resource_info.is_sensitive
    tags := resource_info.compliance
}

compliance_tags := [] if {
    not resource_info.is_sensitive
}

# ============================================================================
# Audit Event Generation
# ============================================================================

# Main audit event structure
audit_event := {
    "event_type": "authorization_decision",
    "event_id": request_context.request_id,
    "timestamp": request_context.timestamp_iso,
    "timestamp_ns": request_context.timestamp,

    # Decision
    "decision": {
        "allowed": allow,
        "reason": decision_reason,
        "policy_version": "1.0.0",
    },

    # Actor (who)
    "actor": user_context,

    # Action (what)
    "action": {
        "method": input.method,
        "operation": method_to_operation[input.method],
    },

    # Resource (on what)
    "resource": {
        "path": input.path,
        "type": resource_info.category,
        "sensitive": resource_info.is_sensitive,
    },

    # Context (where/when/how)
    "context": {
        "source_ip": request_context.source_ip,
        "user_agent": request_context.user_agent,
        "correlation_id": request_context.correlation_id,
    },

    # Risk assessment
    "risk": {
        "score": risk_score,
        "level": risk_level,
        "factors": risk_factors,
    },

    # Compliance
    "compliance": {
        "tags": compliance_tags,
        "retention_days": get_retention_days,
    },
}

method_to_operation := {
    "GET": "read",
    "HEAD": "read",
    "POST": "create",
    "PUT": "update",
    "PATCH": "update",
    "DELETE": "delete",
    "OPTIONS": "preflight",
}

# Risk factors for explanation
risk_factors := factors if {
    factors := [factor |
        factor := risk_factor_explanations[_]
    ]
}

risk_factor_explanations contains "high_risk_operation" if {
    operation_risk_score >= 30
}

risk_factor_explanations contains "sensitive_resource" if {
    resource_sensitivity_score >= 20
}

risk_factor_explanations contains "off_hours_access" if {
    time_risk_score >= 10
}

risk_factor_explanations contains "unusual_behavior" if {
    behavior_risk_score >= 10
}

# Get retention days based on operation
get_retention_days := days if {
    op := sensitive_operations[input.method]
    days := op.retention_days
}

get_retention_days := 90 if {
    not sensitive_operations[input.method]
}

# ============================================================================
# Decision Reason
# ============================================================================

decision_reason := "authorized" if {
    allow
    token_is_valid
}

decision_reason := "blocked_action" if {
    is_blocked_action
}

decision_reason := "missing_token" if {
    not input.token
}

decision_reason := "token_expired" if {
    input.token
    input.token.exp <= time.now_ns() / 1000000000
}

# ============================================================================
# Audit Queries
# ============================================================================

# Query: Get all high-risk events (for alerting)
high_risk_events if {
    risk_level in {"critical", "high"}
}

# Query: Get compliance-relevant events
compliance_events if {
    count(compliance_tags) > 0
}

# Query: Get denied events (for security monitoring)
denied_events if {
    not allow
}

# Query: Get sensitive resource access
sensitive_access_events if {
    resource_info.is_sensitive
}

# ============================================================================
# Output: Complete Decision with Audit
# ============================================================================

# Use this as the main response - includes both decision and audit trail
decision := {
    "allow": allow,
    "audit": audit_event,
}
