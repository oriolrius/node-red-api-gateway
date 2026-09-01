# Gateway Reference Policy Tests
#
# Run with: opa test policies/templates/gateway.rego policies/templates/tests/gateway_test.rego -v

package gateway_test

import rego.v1

import data.gateway

# ----------------------------------------------------------------------------
# AC#1 — scope present is allowed, scope missing is denied
# ----------------------------------------------------------------------------

test_allow_when_required_scope_present if {
	data.gateway.decision.allowed with input as {
		"endpoint": {"requiredScopes": ["read:docs"], "operator": "AND"},
		"token": {"sub": "u1", "scope": "openid profile read:docs"},
	}
}

test_deny_when_required_scope_missing if {
	d := data.gateway.decision with input as {
		"endpoint": {"requiredScopes": ["write:docs"], "operator": "AND"},
		"token": {"sub": "u1", "scope": "openid read:docs"},
	}
	not d.allowed
	d.reason == "insufficient_scope"
}

test_allow_requires_all_scopes_under_and if {
	# Missing one of two required scopes -> deny
	not data.gateway.decision.allowed with input as {
		"endpoint": {"requiredScopes": ["read:docs", "write:docs"], "operator": "AND"},
		"token": {"sub": "u1", "scope": "read:docs"},
	}
}

# ----------------------------------------------------------------------------
# AC#2 — token omitted is denied; a token with no scope claim is denied
# ----------------------------------------------------------------------------

test_deny_when_token_omitted if {
	d := data.gateway.decision with input as {"endpoint": {"requiredScopes": ["read:docs"], "operator": "AND"}}
	not d.allowed
	d.reason == "missing_token"
}

test_deny_when_scope_claim_missing if {
	# token present but no scope claim must NOT accidentally satisfy the subset test
	d := data.gateway.decision with input as {
		"endpoint": {"requiredScopes": ["read:docs"], "operator": "AND"},
		"token": {"sub": "u1"},
	}
	not d.allowed
	d.reason == "insufficient_scope"
}

# ----------------------------------------------------------------------------
# Operator + default-allow behaviour
# ----------------------------------------------------------------------------

test_or_operator_allows_any_one_scope if {
	data.gateway.decision.allowed with input as {
		"endpoint": {"requiredScopes": ["admin", "write:docs"], "operator": "OR"},
		"token": {"sub": "u1", "scope": "openid write:docs"},
	}
}

test_or_operator_denies_when_none_present if {
	not data.gateway.decision.allowed with input as {
		"endpoint": {"requiredScopes": ["admin", "superuser"], "operator": "OR"},
		"token": {"sub": "u1", "scope": "openid read:docs"},
	}
}

test_allow_authenticated_when_no_required_scopes if {
	d := data.gateway.decision with input as {
		"endpoint": {"requiredScopes": [], "operator": "AND"},
		"token": {"sub": "u1", "scope": "openid"},
	}
	d.allowed
	d.reason == "allow"
}

test_default_deny_on_empty_input if {
	not data.gateway.decision.allowed with input as {}
}
