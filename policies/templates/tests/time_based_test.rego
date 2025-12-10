# Time-Based Restriction Policy Tests
#
# Run with: opa test policies/templates/time-based.rego policies/templates/tests/time_based_test.rego -v
#
# Note: These tests use fixed timestamps to ensure deterministic results.

package timebased_test

import rego.v1
import data.timebased

# ============================================================================
# Test Fixtures
# ============================================================================

# Regular user token
user_token := {
    "sub": "user-123",
    "exp": 9999999999,
    "roles": ["user"],
}

# Admin token (exempt from time restrictions)
admin_token := {
    "sub": "admin-456",
    "exp": 9999999999,
    "roles": ["admin"],
}

# On-call token (exempt from time restrictions)
oncall_token := {
    "sub": "oncall-789",
    "exp": 9999999999,
    "roles": ["on_call"],
}

# Manager token (extended hours access)
manager_token := {
    "sub": "manager-001",
    "exp": 9999999999,
    "roles": ["manager"],
}

# User with time-limited access
limited_access_token := {
    "sub": "temp-user-001",
    "exp": 9999999999,
    "roles": ["user"],
    "access_schedule": {
        "start": "2024-01-01T00:00:00Z",
        "end": "2024-06-30T23:59:59Z",
    },
}

# User with expired access schedule
expired_schedule_token := {
    "sub": "expired-user-001",
    "exp": 9999999999,
    "roles": ["user"],
    "access_schedule": {
        "start": "2023-01-01T00:00:00Z",
        "end": "2023-12-31T23:59:59Z",
    },
}

# Expired token
expired_token := {
    "sub": "user-expired",
    "exp": 1000000000,
    "roles": ["user"],
}

# Business hours timestamp (Tuesday 10:30 AM UTC)
business_hours_timestamp := "2024-06-18T10:30:00Z"

# After hours timestamp (Tuesday 11:00 PM UTC)
after_hours_timestamp := "2024-06-18T23:00:00Z"

# Weekend timestamp (Saturday 2:00 PM UTC)
weekend_timestamp := "2024-06-22T14:00:00Z"

# Early morning timestamp (Tuesday 3:00 AM UTC)
early_morning_timestamp := "2024-06-18T03:00:00Z"

# Maintenance window timestamp (Sunday 3:00 AM UTC)
maintenance_timestamp := "2024-06-23T03:00:00Z"

# Extended hours timestamp (Tuesday 7:00 AM UTC)
extended_hours_timestamp := "2024-06-18T07:00:00Z"

# Valid within schedule timestamp (March 2024)
within_schedule_timestamp := "2024-03-15T10:30:00Z"

# Outside schedule timestamp (August 2024)
outside_schedule_timestamp := "2024-08-15T10:30:00Z"

# ============================================================================
# Always Available Endpoint Tests
# ============================================================================

test_health_always_available if {
    timebased.allow with input as {
        "method": "GET",
        "path": "/health",
        "timestamp": after_hours_timestamp,
    }
}

test_ready_always_available if {
    timebased.allow with input as {
        "method": "GET",
        "path": "/ready",
        "timestamp": weekend_timestamp,
    }
}

test_status_always_available if {
    timebased.allow with input as {
        "method": "GET",
        "path": "/api/v1/status",
        "timestamp": early_morning_timestamp,
    }
}

test_emergency_always_available if {
    timebased.allow with input as {
        "method": "POST",
        "path": "/api/v1/emergency",
        "token": user_token,
        "timestamp": maintenance_timestamp,
    }
}

# ============================================================================
# Exempt Role Tests
# ============================================================================

test_admin_exempt_after_hours if {
    timebased.allow with input as {
        "method": "POST",
        "path": "/api/v1/orders",
        "token": admin_token,
        "timestamp": after_hours_timestamp,
    }
}

test_admin_exempt_weekend if {
    timebased.allow with input as {
        "method": "DELETE",
        "path": "/api/v1/users/user-123",
        "token": admin_token,
        "timestamp": weekend_timestamp,
    }
}

test_oncall_exempt_early_morning if {
    timebased.allow with input as {
        "method": "PUT",
        "path": "/api/v1/settings",
        "token": oncall_token,
        "timestamp": early_morning_timestamp,
    }
}

# ============================================================================
# Business Hours Tests
# ============================================================================

test_allow_read_during_business_hours if {
    timebased.allow with input as {
        "method": "GET",
        "path": "/api/v1/orders",
        "token": user_token,
        "timestamp": business_hours_timestamp,
    }
}

test_allow_write_during_business_hours if {
    timebased.allow with input as {
        "method": "POST",
        "path": "/api/v1/orders",
        "token": user_token,
        "timestamp": business_hours_timestamp,
    }
}

test_deny_write_after_hours if {
    not timebased.allow with input as {
        "method": "POST",
        "path": "/api/v1/orders",
        "token": user_token,
        "timestamp": after_hours_timestamp,
    }
}

test_deny_write_on_weekend if {
    not timebased.allow with input as {
        "method": "POST",
        "path": "/api/v1/orders",
        "token": user_token,
        "timestamp": weekend_timestamp,
    }
}

# ============================================================================
# Extended Hours Tests
# ============================================================================

test_manager_extended_hours_read if {
    timebased.allow with input as {
        "method": "GET",
        "path": "/api/v1/reports",
        "token": manager_token,
        "timestamp": extended_hours_timestamp,
    }
}

# ============================================================================
# Time-Limited Access Tests
# ============================================================================

test_allow_within_access_schedule if {
    timebased.allow with input as {
        "method": "GET",
        "path": "/api/v1/data",
        "token": limited_access_token,
        "timestamp": within_schedule_timestamp,
    }
}

test_deny_outside_access_schedule if {
    not timebased.allow with input as {
        "method": "GET",
        "path": "/api/v1/data",
        "token": limited_access_token,
        "timestamp": outside_schedule_timestamp,
    }
}

test_deny_expired_access_schedule if {
    not timebased.allow with input as {
        "method": "GET",
        "path": "/api/v1/data",
        "token": expired_schedule_token,
        "timestamp": business_hours_timestamp,
    }
}

# ============================================================================
# Token Validation Tests
# ============================================================================

test_deny_without_token if {
    not timebased.allow with input as {
        "method": "GET",
        "path": "/api/v1/data",
        "timestamp": business_hours_timestamp,
    }
}

test_deny_expired_token if {
    not timebased.allow with input as {
        "method": "GET",
        "path": "/api/v1/data",
        "token": expired_token,
        "timestamp": business_hours_timestamp,
    }
}

# ============================================================================
# Authorization Response Tests
# ============================================================================

test_authorization_always_available if {
    result := timebased.authorization with input as {
        "method": "GET",
        "path": "/health",
        "timestamp": after_hours_timestamp,
    }
    result.allowed == true
    result.reason == "always_available"
}

test_authorization_exempt_role if {
    result := timebased.authorization with input as {
        "method": "POST",
        "path": "/api/v1/orders",
        "token": admin_token,
        "timestamp": after_hours_timestamp,
    }
    result.allowed == true
    result.reason == "exempt_role"
}

test_authorization_authorized if {
    result := timebased.authorization with input as {
        "method": "GET",
        "path": "/api/v1/orders",
        "token": user_token,
        "timestamp": business_hours_timestamp,
    }
    result.allowed == true
    result.reason == "authorized"
}

test_authorization_outside_business_hours if {
    result := timebased.authorization with input as {
        "method": "POST",
        "path": "/api/v1/orders",
        "token": user_token,
        "timestamp": after_hours_timestamp,
    }
    result.allowed == false
    result.reason == "outside_business_hours"
}

test_authorization_access_expired if {
    result := timebased.authorization with input as {
        "method": "GET",
        "path": "/api/v1/data",
        "token": limited_access_token,
        "timestamp": outside_schedule_timestamp,
    }
    result.allowed == false
    result.reason == "access_expired"
}

# ============================================================================
# Current Time Info Tests
# ============================================================================

test_current_time_info if {
    result := timebased.authorization with input as {
        "method": "GET",
        "path": "/api/v1/orders",
        "token": user_token,
        "timestamp": business_hours_timestamp,
    }
    result.current_time.hour == 10
    result.current_time.weekday == "Tuesday"
}

# ============================================================================
# Rate Limits Info Tests
# ============================================================================

test_rate_limits_included if {
    result := timebased.authorization with input as {
        "method": "GET",
        "path": "/api/v1/orders",
        "token": user_token,
        "timestamp": business_hours_timestamp,
    }
    result.rate_limits.requests_per_minute > 0
}
