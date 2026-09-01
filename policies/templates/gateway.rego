# Gateway Reference Policy
#
# The reference policy for the node-red-api-gateway OPA integration. It is
# written against the gateway's CANONICAL input document (decision-001) and
# reproduces the old gateway-side scope check out of the box: it authorizes
# from the endpoint's declared `requiredScopes` against the caller's verified
# `token.scope`, returning `allowed` AND `reason` in a single round trip.
#
# Point the gateway's Policy Path at this document:
#
#   v1/data/gateway/decision
#
# It returns, e.g.:
#   { "allowed": true,  "reason": "allow" }
#   { "allowed": false, "reason": "missing_token" }
#   { "allowed": false, "reason": "insufficient_scope" }
#
# Canonical input (only the fields this policy reads):
#   {
#     "endpoint": { "requiredScopes": ["read:docs"], "operator": "AND" },
#     "token":    { "sub": "...", "scope": "openid read:docs" }   // omitted when anonymous
#   }
#
# Notes:
#   - `token` is PRESENT ONLY when the caller is authenticated. It is never null
#     and never an empty object, so `input.token` is a reliable authentication
#     test.
#   - `token.scope` is the space-delimited OAuth/OIDC scope string, verbatim.
#   - `input.endpoint.requiredScopes` is declarative context the gateway sends;
#     this policy chooses to honour it, but a policy is free to ignore it.

package gateway

import rego.v1

# ============================================================================
# Decision document — the rule the gateway points opaPolicyPath at.
# ============================================================================

decision := {
	"allowed": allow,
	"reason": reason,
}

# ============================================================================
# Authorization
# ============================================================================

default allow := false

# The caller is authenticated iff the gateway put a verified token in the input.
is_authenticated if input.token

# Verified scopes as a set. Undefined (not empty) when there is no scope claim,
# so any subset/membership test against it simply fails — it can never
# accidentally satisfy a check.
token_scopes := {s | some s in split(input.token.scope, " ")}

# The endpoint's declared required scopes as a set (defaults to none).
required := {s | some s in object.get(input, ["endpoint", "requiredScopes"], [])}

# Combine operator, defaulting to AND (require all).
operator := upper(object.get(input, ["endpoint", "operator"], "AND"))

# AND semantics: every required scope must be present.
# object.subset(super, sub) is true iff `sub` ⊆ `super`.
satisfies_scopes if {
	operator == "AND"
	object.subset(token_scopes, required)
}

# OR semantics: at least one required scope must be present.
satisfies_scopes if {
	operator == "OR"
	some s in required
	s in token_scopes
}

# An endpoint that declares no required scopes admits any authenticated caller.
satisfies_scopes if count(required) == 0

allow if {
	is_authenticated
	satisfies_scopes
}

# ============================================================================
# Reason — a single human-readable string, mutually exclusive with the others.
# ============================================================================

default reason := "denied"

reason := "allow" if allow

reason := "missing_token" if not is_authenticated

reason := "insufficient_scope" if {
	is_authenticated
	not satisfies_scopes
}
