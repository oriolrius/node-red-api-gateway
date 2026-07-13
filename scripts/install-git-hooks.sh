#!/usr/bin/env bash
# Installs local git hooks for this repository.
#
# pre-commit: scans staged changes with gitleaks so secrets are blocked
# before they ever land in a commit (CI scans again as a backstop).
#
# Usage: bash scripts/install-git-hooks.sh
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$(git -C "$REPO_ROOT" rev-parse --git-path hooks)"

if ! command -v gitleaks >/dev/null 2>&1; then
    echo "WARNING: gitleaks not found on PATH." >&2
    echo "Install it first: https://github.com/gitleaks/gitleaks#installing" >&2
    echo "The hook will be installed anyway and will no-op until gitleaks is available." >&2
fi

mkdir -p "$HOOKS_DIR"
cat > "$HOOKS_DIR/pre-commit" <<'HOOK'
#!/usr/bin/env bash
# Block commits that introduce secrets (see .gitleaks.toml for allowlists).
if command -v gitleaks >/dev/null 2>&1; then
    gitleaks git --pre-commit --staged --redact --no-banner
else
    echo "pre-commit: gitleaks not installed; skipping secret scan (CI will still scan)." >&2
fi
HOOK
chmod +x "$HOOKS_DIR/pre-commit"

echo "Installed pre-commit secret-scan hook at $HOOKS_DIR/pre-commit"
