# API Gateway E2E Authorization Policy (TEST FIXTURE)
#
# This policy is a TEST FIXTURE for the e2e harness, not the reference
# architecture. In a real deployment OPA is a central, shared service (see
# decision-001 D1); here it runs as a throwaway container.
#
# It is written against the gateway's CANONICAL input and exposed at the path
# the e2e flow points its Policy Path at:
#
#   v1/data/gateway/decision
#
# It authorizes each endpoint's declared requiredScopes against the caller's
# verified token.scope (like the shipped gateway.rego), and additionally
# requires the `admin` realm role for write methods so the suite can exercise a
# role-based allow/deny.

package gateway

import rego.v1

decision := {
	"allowed": allow,
	"reason": reason,
}

default allow := false

is_authenticated if input.token

token_scopes := {s | some s in split(input.token.scope, " ")}

roles := {r | some r in input.token.realm_access.roles}

required := {s | some s in object.get(input, ["endpoint", "requiredScopes"], [])}

write_methods := {"POST", "PUT", "PATCH", "DELETE"}

# Every declared required scope must be present.
has_required_scopes if object.subset(token_scopes, required)

has_required_scopes if count(required) == 0

# Write methods additionally require the admin role.
method_ok if not write_methods[input.method]

method_ok if {
	write_methods[input.method]
	"admin" in roles
}

allow if {
	is_authenticated
	has_required_scopes
	method_ok
}

default reason := "denied"

reason := "allow" if allow

reason := "missing_token" if not is_authenticated

reason := "insufficient_scope" if {
	is_authenticated
	not has_required_scopes
}

reason := "requires_admin" if {
	is_authenticated
	has_required_scopes
	not method_ok
}
