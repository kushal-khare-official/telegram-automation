#!/bin/sh
# Omulimu container start-up. Runs on every boot and is safe to repeat:
#   1. pick the Supabase pooler host that accepts our login (aws-0 / aws-1 differ per project)
#   2. import the 3 credentials, built from env vars (nothing secret is baked into the image)
#   3. import the 7 workflows (fixed IDs, so this overwrites in place)
#   4. activate the router and the Numbers brain (19:00 nudge), then start n8n
set -eu

APP_DIR="${OMULIMU_DIR:-/opt/omulimu}"
log() { echo "[omulimu] $*"; }

# Render gives the public URL at runtime; n8n uses it to register the Telegram webhook.
if [ -z "${WEBHOOK_URL:-}" ] && [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export WEBHOOK_URL="${RENDER_EXTERNAL_URL%/}/"
fi
if [ -n "${RENDER_EXTERNAL_HOSTNAME:-}" ]; then
  export N8N_HOST="${N8N_HOST:-$RENDER_EXTERNAL_HOSTNAME}"
fi

: "${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}"
: "${DB_USER_ROLE:=omulimu_app}"
: "${DB_PASSWORD:?set DB_PASSWORD}"

# 1. Supabase pooler (session mode, port 5432). The role logs in as "<role>.<project ref>".
if [ -z "${DB_HOST:-}" ]; then
  DB_HOST=$(node "$APP_DIR/pick-db-host.js") || { log "no Supabase pooler host accepted the login"; exit 1; }
fi
log "database host: $DB_HOST"
export DB_TYPE=postgresdb
export DB_POSTGRESDB_HOST="$DB_HOST"
export DB_POSTGRESDB_PORT="${DB_PORT:-5432}"
export DB_POSTGRESDB_DATABASE="${DB_NAME:-postgres}"
export DB_POSTGRESDB_USER="${DB_USER:-${DB_USER_ROLE}.${SUPABASE_PROJECT_REF}}"
export DB_POSTGRESDB_PASSWORD="$DB_PASSWORD"
export DB_POSTGRESDB_SCHEMA="${N8N_DB_SCHEMA:-n8n}"
if [ "${DB_SSL:-true}" = "true" ]; then
  # Supabase needs TLS; its pooler certificate isn't in the default trust store.
  # (n8n turns SSL on whenever this is false, so only set it when SSL is wanted.)
  export DB_POSTGRESDB_SSL_ENABLED=true
  export DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED=false
fi

# 2. Credentials, written to a private temp file and deleted right after import.
CREDS=$(mktemp)
trap 'rm -f "$CREDS"' EXIT
( umask 077; node "$APP_DIR/write-credentials.js" > "$CREDS" )
n8n import:credentials --input="$CREDS"
rm -f "$CREDS"

# 3 + 4. Workflows, then activation.
n8n import:workflow --separate --input="$APP_DIR/workflows"
n8n update:workflow --id=omulimuRouter001 --active=true
n8n update:workflow --id=omulimuNumbers01 --active=true

log "starting n8n (webhook base: ${WEBHOOK_URL:-unset})"
exec n8n start
