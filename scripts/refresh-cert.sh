#!/usr/bin/env bash
# refresh-cert.sh — fetch a certificate from Nginx Proxy Manager, write it to disk
# under configurable filenames, and (optionally) reload the service that serves it —
# but only when the certificate actually changed.
#
# Fully driven by environment variables: no hardcoded paths, domains, or credentials.
# Credentials are read from the environment (or a sourced ENV_FILE) and are never
# embedded in this script.
#
# ── Required ──────────────────────────────────────────────────────────────────
#   NPM_URL                 NPM base URL, e.g. http://rproxy.example.com:81
#   NPM_USER + NPM_PASS     NPM login  (or set NPM_TOKEN instead)
#   CERT_ID                 NPM certificate id   (see: npm-cli certs list)
#   DOMAIN                  certificate domain   (the subdir npm-cli downloads into)
#   OUT_DIR                 directory to write the cert files into
#
# ── Output filenames (defaults match npm-cli; set empty to skip that file) ─────
#   OUT_FULLCHAIN   default fullchain1.pem      e.g. nginx-style: OUT_FULLCHAIN=server.crt
#   OUT_PRIVKEY     default privkey1.pem                          OUT_PRIVKEY=server.key
#   OUT_CERT        default cert1.pem
#   OUT_CHAIN       default chain1.pem
#   Files are matched by ROLE in the download, so certbot archive-index bumps
#   (cert1.pem -> cert2.pem on renewal) are handled transparently.
#
# ── Reload on change (optional; RELOAD_CMD wins, else node-red, else none) ─────
#   RELOAD_CMD              arbitrary command, e.g. "systemctl reload nginx"
#   NR_URL + NR_USER + NR_PASS   Node-RED admin API: full flow redeploy (re-reads certs)
#
# ── Verify / self-heal (optional) ─────────────────────────────────────────────
#   VERIFY_HOST [+ VERIFY_PORT=443]  host:port to probe for the LIVE served cert.
#   When set, change-detection compares the new cert to what is actually being
#   served (so a previously-failed reload self-heals next run), and the reload is
#   verified afterwards. When unset, detection is on-disk and there is no verify.
#
# ── Misc ──────────────────────────────────────────────────────────────────────
#   NPM_CLI    npm-cli invocation. Default uses uvx from PATH against the GitHub repo:
#              "uvx --from git+https://github.com/oriolrius/npm-cli npm-cli"
#   ENV_FILE   optional file to source for all of the above (keeps secrets out of args)
#   VERIFY_WAIT  seconds to wait after reload before verifying (default 10)
set -euo pipefail

[ -n "${ENV_FILE:-}" ] && [ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

: "${NPM_URL:?set NPM_URL}"
: "${CERT_ID:?set CERT_ID}"
: "${DOMAIN:?set DOMAIN}"
: "${OUT_DIR:?set OUT_DIR}"
OUT_FULLCHAIN="${OUT_FULLCHAIN-fullchain1.pem}"
OUT_PRIVKEY="${OUT_PRIVKEY-privkey1.pem}"
OUT_CERT="${OUT_CERT-cert1.pem}"
OUT_CHAIN="${OUT_CHAIN-chain1.pem}"
VERIFY_PORT="${VERIFY_PORT:-443}"
NPM_CLI="${NPM_CLI:-uvx --from git+https://github.com/oriolrius/npm-cli npm-cli}"

log(){ echo "[$(date '+%F %T')] $*"; }
served_fp(){ echo | openssl s_client -connect "${VERIFY_HOST}:${VERIFY_PORT}" -servername "$DOMAIN" 2>/dev/null \
  | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 || true; }

if [ -z "${NPM_TOKEN:-}" ]; then
  : "${NPM_USER:?set NPM_USER or NPM_TOKEN}"; : "${NPM_PASS:?set NPM_PASS or NPM_TOKEN}"
fi

# Which roles to write (skip any whose OUT_* name is empty).
declare -A WANT=()
[ -n "$OUT_FULLCHAIN" ] && WANT[fullchain]="$OUT_FULLCHAIN"
[ -n "$OUT_PRIVKEY" ]   && WANT[privkey]="$OUT_PRIVKEY"
[ -n "$OUT_CERT" ]      && WANT[cert]="$OUT_CERT"
[ -n "$OUT_CHAIN" ]     && WANT[chain]="$OUT_CHAIN"
[ "${#WANT[@]}" -gt 0 ] || { log "ERROR: all OUT_* names are empty — nothing to write"; exit 1; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

if [ -z "${NPM_TOKEN:-}" ]; then
  log "Authenticating to NPM $NPM_URL ..."
  $NPM_CLI auth login --url "$NPM_URL" --user "$NPM_USER" --password "$NPM_PASS" >/dev/null
fi

log "Downloading cert $CERT_ID ($DOMAIN) ..."
$NPM_CLI --url "$NPM_URL" certs download "$CERT_ID" -o "$TMP" >/dev/null
SRC="$TMP/$DOMAIN"
[ -d "$SRC" ] || { log "ERROR: expected download dir $SRC missing"; exit 1; }

# newest file of a role (handles certbot index increments cert1->cert2->...)
role_src(){ ls -1 "$SRC/$1"*.pem 2>/dev/null | sort -V | tail -1; }

# leaf cert fingerprint (independent of which files we write)
LEAF=$(role_src cert); [ -n "$LEAF" ] || LEAF=$(role_src fullchain)
[ -n "$LEAF" ] || { log "ERROR: no leaf cert in download (fetch failed?)"; exit 1; }
NEW_FP=$(openssl x509 -in "$LEAF" -noout -fingerprint -sha256 | cut -d= -f2)
NEW_EXP=$(openssl x509 -in "$LEAF" -noout -enddate | cut -d= -f2)

mkdir -p "$OUT_DIR"

# change detection: vs the LIVE served cert if a verify host is set, else vs disk
USE_LIVE=0; CHANGED=0
if [ -n "${VERIFY_HOST:-}" ]; then
  USE_LIVE=1
  [ "$(served_fp)" = "$NEW_FP" ] || CHANGED=1
else
  for role in "${!WANT[@]}"; do
    s=$(role_src "$role"); d="$OUT_DIR/${WANT[$role]}"
    [ -n "$s" ] || { log "ERROR: no ${role}*.pem in download"; exit 1; }
    { [ -f "$d" ] && cmp -s "$s" "$d"; } || CHANGED=1
  done
fi

# always write the files (idempotent) so disk reflects the latest cert
for role in "${!WANT[@]}"; do
  s=$(role_src "$role"); [ -n "$s" ] || { log "ERROR: no ${role}*.pem in download"; exit 1; }
  cp "$s" "$OUT_DIR/${WANT[$role]}"
done

if [ "$CHANGED" -eq 0 ]; then
  log "No change — already current (cert valid until $NEW_EXP)."
  exit 0
fi
log "Cert changed (valid until $NEW_EXP, sha256 $NEW_FP). Wrote files to $OUT_DIR."

reload_nodered(){
  : "${NR_URL:?}"; : "${NR_USER:?}"; : "${NR_PASS:?}"
  local tok code
  tok=$(curl -s "$NR_URL/auth/token" \
    --data-urlencode client_id=node-red-admin --data-urlencode grant_type=password \
    --data-urlencode scope='*' --data-urlencode "username=$NR_USER" \
    --data-urlencode "password=$NR_PASS" | jq -r '.access_token // empty')
  [ -n "$tok" ] || { log "ERROR: node-red admin auth failed"; return 1; }
  curl -s -H "Authorization: Bearer $tok" "$NR_URL/flows" -o "$TMP/flows.json"
  [ -s "$TMP/flows.json" ] || { log "ERROR: could not fetch flows"; return 1; }
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$NR_URL/flows" \
    -H "Authorization: Bearer $tok" -H "Content-Type: application/json" \
    -H "Node-RED-Deployment-Type: full" --data-binary @"$TMP/flows.json")
  log "node-red full redeploy -> HTTP $code"
  case "$code" in 200|204) return 0 ;; *) return 1 ;; esac
}

if [ -n "${RELOAD_CMD:-}" ]; then
  log "Running RELOAD_CMD ..."
  bash -c "$RELOAD_CMD" || { log "ERROR: RELOAD_CMD failed"; exit 1; }
elif [ -n "${NR_URL:-}" ]; then
  reload_nodered || exit 1
else
  log "No reload configured — files refreshed only."
  exit 0
fi

if [ "$USE_LIVE" -eq 1 ]; then
  sleep "${VERIFY_WAIT:-10}"
  LIVE_FP=$(served_fp)
  if [ "$LIVE_FP" = "$NEW_FP" ]; then
    log "MIGRATION CONFIRMED: $DOMAIN now serving the new cert ($LIVE_FP, valid until $NEW_EXP)."
  else
    log "WARNING: live cert (${LIVE_FP:-unreachable}) != new cert ($NEW_FP). Investigate."
    exit 1
  fi
fi
