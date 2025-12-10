# Time-Based Restriction Policy Template
#
# This template implements time-based access control with support for
# business hours, maintenance windows, time-limited access, and scheduling.
#
# Key Features:
#   - Business hours enforcement
#   - Maintenance window blocking
#   - Time-limited/expiring access
#   - Day-of-week restrictions
#   - Holiday calendar support
#   - Timezone-aware time checks
#   - Scheduled access windows
#
# Usage:
#   POST http://localhost:8181/v1/data/timebased/allow
#   {
#     "input": {
#       "method": "POST",
#       "path": "/api/v1/orders",
#       "token": {
#         "sub": "user-123",
#         "roles": ["user"],
#         "access_schedule": {
#           "start": "2024-01-01T00:00:00Z",
#           "end": "2024-12-31T23:59:59Z"
#         }
#       },
#       "timestamp": "2024-06-15T10:30:00Z"
#     }
#   }

package timebased

import rego.v1

# ============================================================================
# Default Decision
# ============================================================================

default allow := false

# ============================================================================
# Configuration
# ============================================================================

# Business hours configuration (24-hour format, UTC)
config := {
    # Standard business hours
    "business_hours": {
        "start_hour": 8,    # 8:00 AM
        "end_hour": 18,     # 6:00 PM
    },
    # Extended hours for certain roles
    "extended_hours": {
        "start_hour": 6,    # 6:00 AM
        "end_hour": 22,     # 10:00 PM
    },
    # Working days (0=Sunday, 1=Monday, ..., 6=Saturday)
    "working_days": [1, 2, 3, 4, 5],  # Monday to Friday
    # Timezone offset from UTC (hours)
    "timezone_offset": 0,
}

# Maintenance windows (ISO 8601 format)
# Can be loaded from external data
maintenance_windows := [
    {
        "id": "weekly-maintenance",
        "start": "2024-01-01T02:00:00Z",
        "end": "2024-01-01T04:00:00Z",
        "recurring": "weekly",
        "day_of_week": 0,  # Sunday
        "message": "Weekly maintenance window",
    },
    {
        "id": "monthly-update",
        "start": "2024-01-15T03:00:00Z",
        "end": "2024-01-15T05:00:00Z",
        "recurring": "monthly",
        "day_of_month": 15,
        "message": "Monthly update window",
    },
]

# Holiday calendar (dates when system has restricted access)
holidays := [
    "2024-01-01",  # New Year's Day
    "2024-12-25",  # Christmas
    "2024-12-26",  # Boxing Day
    "2024-07-04",  # Independence Day (US)
]

# Roles exempt from time restrictions
exempt_roles := {"admin", "super_admin", "on_call", "emergency"}

# Resources that require business hours access
business_hours_resources := {
    "/api/v1/orders",
    "/api/v1/payments",
    "/api/v1/contracts",
}

# Resources available 24/7
always_available := {
    "/health",
    "/ready",
    "/api/health",
    "/api/v1/status",
    "/api/v1/emergency",
}

# ============================================================================
# Main Authorization Rules
# ============================================================================

# Always allow health/status endpoints
allow if {
    is_always_available
}

# Allow exempt roles anytime
allow if {
    token_is_valid
    user_is_exempt
}

# Allow during valid time windows
allow if {
    token_is_valid
    not user_is_exempt
    not is_always_available
    within_allowed_time_window
    not in_maintenance_window
    access_not_expired
}

# ============================================================================
# Token Validation
# ============================================================================

token_is_valid if {
    input.token
    input.token.exp > time.now_ns() / 1000000000
}

# ============================================================================
# Current Time Handling
# ============================================================================

# Get current timestamp from input or use system time
current_timestamp := ts if {
    input.timestamp
    ts := time.parse_rfc3339_ns(input.timestamp)
}

current_timestamp := time.now_ns() if {
    not input.timestamp
}

# Parse current time components
current_time := {
    "hour": time.clock([current_timestamp, "UTC"])[0],
    "minute": time.clock([current_timestamp, "UTC"])[1],
    "second": time.clock([current_timestamp, "UTC"])[2],
    "weekday": time.weekday(current_timestamp),
    "date": time.date(current_timestamp),
    "year": time.date(current_timestamp)[0],
    "month": time.date(current_timestamp)[1],
    "day": time.date(current_timestamp)[2],
}

# Weekday name to number mapping
weekday_number := {
    "Sunday": 0,
    "Monday": 1,
    "Tuesday": 2,
    "Wednesday": 3,
    "Thursday": 4,
    "Friday": 5,
    "Saturday": 6,
}

current_day_number := weekday_number[current_time.weekday]

# Format current date as string for holiday comparison
current_date_string := sprintf("%d-%02d-%02d", [
    current_time.year,
    current_time.month,
    current_time.day,
])

# ============================================================================
# Always Available Resources
# ============================================================================

is_always_available if {
    input.path in always_available
}

is_always_available if {
    some prefix in always_available
    startswith(input.path, concat("", [prefix, "/"]))
}

# ============================================================================
# Exempt Roles Check
# ============================================================================

user_roles := roles if {
    roles := object.get(input.token, "roles", [])
}

user_is_exempt if {
    some role in user_roles
    role in exempt_roles
}

# ============================================================================
# Business Hours Check
# ============================================================================

requires_business_hours if {
    some resource in business_hours_resources
    startswith(input.path, resource)
}

requires_business_hours if {
    input.method in {"POST", "PUT", "PATCH", "DELETE"}
    not is_always_available
}

# Check if within standard business hours
within_business_hours if {
    current_time.hour >= config.business_hours.start_hour
    current_time.hour < config.business_hours.end_hour
    current_day_number in config.working_days
}

# Check if within extended hours (for certain roles)
within_extended_hours if {
    current_time.hour >= config.extended_hours.start_hour
    current_time.hour < config.extended_hours.end_hour
    current_day_number in config.working_days
}

has_extended_hours_access if {
    some role in user_roles
    role in {"manager", "senior", "lead", "supervisor"}
}

# ============================================================================
# Time Window Logic
# ============================================================================

within_allowed_time_window if {
    # Read operations allowed during extended hours
    input.method in {"GET", "HEAD"}
    within_extended_hours
}

within_allowed_time_window if {
    # Read operations for users without extended access during business hours
    input.method in {"GET", "HEAD"}
    not has_extended_hours_access
    within_business_hours
}

within_allowed_time_window if {
    # Write operations require business hours for business resources
    requires_business_hours
    within_business_hours
}

within_allowed_time_window if {
    # Non-business resources available during extended hours
    not requires_business_hours
    within_extended_hours
}

within_allowed_time_window if {
    # Non-business resources for standard users during business hours
    not requires_business_hours
    not has_extended_hours_access
    within_business_hours
}

# ============================================================================
# Maintenance Window Check
# ============================================================================

in_maintenance_window if {
    some window in maintenance_windows
    is_in_window(window)
}

is_in_window(window) if {
    # Non-recurring window
    not window.recurring
    window_start := time.parse_rfc3339_ns(window.start)
    window_end := time.parse_rfc3339_ns(window.end)
    current_timestamp >= window_start
    current_timestamp < window_end
}

is_in_window(window) if {
    # Weekly recurring window
    window.recurring == "weekly"
    current_day_number == window.day_of_week
    window_start_hour := time.clock([time.parse_rfc3339_ns(window.start), "UTC"])[0]
    window_end_hour := time.clock([time.parse_rfc3339_ns(window.end), "UTC"])[0]
    current_time.hour >= window_start_hour
    current_time.hour < window_end_hour
}

is_in_window(window) if {
    # Monthly recurring window
    window.recurring == "monthly"
    current_time.day == window.day_of_month
    window_start_hour := time.clock([time.parse_rfc3339_ns(window.start), "UTC"])[0]
    window_end_hour := time.clock([time.parse_rfc3339_ns(window.end), "UTC"])[0]
    current_time.hour >= window_start_hour
    current_time.hour < window_end_hour
}

# Get active maintenance message
maintenance_message := msg if {
    some window in maintenance_windows
    is_in_window(window)
    msg := window.message
}

# ============================================================================
# Holiday Check
# ============================================================================

is_holiday if {
    current_date_string in holidays
}

# Holiday restrictions (write operations blocked)
holiday_restricted if {
    is_holiday
    input.method in {"POST", "PUT", "PATCH", "DELETE"}
    not user_is_exempt
}

# ============================================================================
# Time-Limited Access
# ============================================================================

# Check for user-specific access schedule
user_access_schedule := schedule if {
    schedule := input.token.access_schedule
}

access_not_expired if {
    # No schedule defined - always valid
    not user_access_schedule
}

access_not_expired if {
    # Check start time
    user_access_schedule.start
    schedule_start := time.parse_rfc3339_ns(user_access_schedule.start)
    current_timestamp >= schedule_start

    # Check end time
    user_access_schedule.end
    schedule_end := time.parse_rfc3339_ns(user_access_schedule.end)
    current_timestamp < schedule_end
}

access_not_expired if {
    # Only start time defined
    user_access_schedule.start
    not user_access_schedule.end
    schedule_start := time.parse_rfc3339_ns(user_access_schedule.start)
    current_timestamp >= schedule_start
}

access_not_expired if {
    # Only end time defined
    not user_access_schedule.start
    user_access_schedule.end
    schedule_end := time.parse_rfc3339_ns(user_access_schedule.end)
    current_timestamp < schedule_end
}

# ============================================================================
# Scheduled Access Windows (per-resource)
# ============================================================================

# Resource-specific access schedules
resource_schedules := {
    "/api/v1/batch-jobs": {
        "allowed_hours": [0, 1, 2, 3, 4, 5],  # Midnight to 6 AM
        "allowed_days": [0, 6],  # Weekend only
    },
    "/api/v1/reports/generate": {
        "allowed_hours": [6, 7, 8, 22, 23],  # Off-peak hours
        "allowed_days": [1, 2, 3, 4, 5],
    },
}

resource_has_schedule if {
    some path, _ in resource_schedules
    startswith(input.path, path)
}

within_resource_schedule if {
    not resource_has_schedule
}

within_resource_schedule if {
    some path, schedule in resource_schedules
    startswith(input.path, path)
    current_time.hour in schedule.allowed_hours
    current_day_number in schedule.allowed_days
}

# ============================================================================
# Rate Limiting by Time (Advisory)
# ============================================================================

# Define rate limits that vary by time of day
time_based_rate_limits := limit if {
    # Peak hours - stricter limits
    current_time.hour >= 9
    current_time.hour < 17
    limit := {
        "requests_per_minute": 30,
        "burst": 5,
    }
}

time_based_rate_limits := limit if {
    # Off-peak hours - relaxed limits
    current_time.hour < 9
    limit := {
        "requests_per_minute": 100,
        "burst": 20,
    }
}

time_based_rate_limits := limit if {
    # Evening hours
    current_time.hour >= 17
    limit := {
        "requests_per_minute": 60,
        "burst": 10,
    }
}

# ============================================================================
# Authorization Response
# ============================================================================

# Safe access to maintenance message (may be undefined)
maintenance_message_or_null := msg if {
    msg := maintenance_message
}

maintenance_message_or_null := null if {
    not maintenance_message
}

# Safe check for holiday
is_holiday_safe := true if {
    is_holiday
}

is_holiday_safe := false if {
    not is_holiday
}

# Safe check for business hours
within_business_hours_safe := true if {
    within_business_hours
}

within_business_hours_safe := false if {
    not within_business_hours
}

within_extended_hours_safe := true if {
    within_extended_hours
}

within_extended_hours_safe := false if {
    not within_extended_hours
}

# Safe check for maintenance window
in_maintenance_window_safe := true if {
    in_maintenance_window
}

in_maintenance_window_safe := false if {
    not in_maintenance_window
}

# Safe check for access schedule
has_access_schedule := true if {
    user_access_schedule
}

has_access_schedule := false if {
    not user_access_schedule
}

access_valid := true if {
    access_not_expired
}

access_valid := false if {
    not access_not_expired
}

authorization := {
    "allowed": allow,
    "reason": decision_reason,
    "current_time": {
        "timestamp": current_timestamp,
        "hour": current_time.hour,
        "weekday": current_time.weekday,
        "date": current_date_string,
        "is_holiday": is_holiday_safe,
    },
    "business_hours": {
        "within_business_hours": within_business_hours_safe,
        "within_extended_hours": within_extended_hours_safe,
    },
    "maintenance": {
        "in_maintenance": in_maintenance_window_safe,
        "message": maintenance_message_or_null,
    },
    "access_schedule": {
        "has_schedule": has_access_schedule,
        "is_valid": access_valid,
    },
    "rate_limits": time_based_rate_limits,
}

decision_reason := "always_available" if {
    is_always_available
}

decision_reason := "exempt_role" if {
    token_is_valid
    user_is_exempt
}

decision_reason := "authorized" if {
    token_is_valid
    not user_is_exempt
    not is_always_available
    within_allowed_time_window
    not in_maintenance_window
    access_not_expired
}

decision_reason := "outside_business_hours" if {
    token_is_valid
    not user_is_exempt
    not is_always_available
    not within_allowed_time_window
}

decision_reason := "maintenance_window" if {
    token_is_valid
    not user_is_exempt
    not is_always_available
    within_allowed_time_window
    in_maintenance_window
}

decision_reason := "access_expired" if {
    token_is_valid
    not user_is_exempt
    not is_always_available
    within_allowed_time_window
    not in_maintenance_window
    not access_not_expired
}

decision_reason := "holiday_restricted" if {
    token_is_valid
    not user_is_exempt
    holiday_restricted
}

decision_reason := "missing_token" if {
    not is_always_available
    not input.token
}

decision_reason := "token_expired" if {
    not is_always_available
    input.token
    input.token.exp <= time.now_ns() / 1000000000
}
