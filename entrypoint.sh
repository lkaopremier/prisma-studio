#!/bin/sh
set -e

detect_provider() {
  case "$1" in
    postgres://*|postgresql://*) echo "postgresql" ;;
    mysql://*) echo "mysql" ;;
    sqlserver://*) echo "sqlserver" ;;
    mongodb*://*) echo "mongodb" ;;
    file:*) echo "sqlite" ;;
    *) echo "${DATABASE_PROVIDER:-postgresql}" ;;
  esac
}

if [ -z "$AUTH_PASSWORD" ]; then
  echo "ERROR: AUTH_PASSWORD environment variable is required"
  exit 1
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL environment variable is required"
  exit 1
fi

# Split pipe-separated entries into positional parameters
set -f
OLD_IFS="$IFS"
IFS='|'
# shellcheck disable=SC2086
set -- $DATABASE_URL
IFS="$OLD_IFS"
set +f

mkdir -p /app/prisma

# Generate schemas and introspect all databases in parallel
i=1
PIDS=""
for ENTRY in "$@"; do
  ENTRY=$(printf '%s' "$ENTRY" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -z "$ENTRY" ] && continue

  # Support optional "Label::url" format — extract the URL part
  case "$ENTRY" in
    *::*) DB_URL="${ENTRY#*::}" ;;
    *)    DB_URL="$ENTRY" ;;
  esac

  PROVIDER="$(detect_provider "$DB_URL")"
  DIR="/app/prisma/db_$i"
  mkdir -p "$DIR"

  cat > "$DIR/schema.prisma" <<SCHEMA
datasource db {
  provider = "$PROVIDER"
  url      = env("DATABASE_URL")
}
SCHEMA

  echo "DB $i: provider=$PROVIDER"

  if [ "$PROVIDER" != "sqlite" ]; then
    (
      echo "Introspecting DB $i..."
      DATABASE_URL="$DB_URL" npx prisma db pull --schema="$DIR/schema.prisma" \
        || echo "Warning: introspection failed for DB $i — starting Studio anyway."
    ) &
    PIDS="$PIDS $!"
  fi

  i=$((i + 1))
done

if [ "$i" -eq 1 ]; then
  echo "ERROR: No valid database URL found in DATABASE_URL"
  exit 1
fi

# Wait for all introspections to complete before starting Studio
if [ -n "$PIDS" ]; then
  for PID in $PIDS; do
    wait "$PID" || true
  done
fi

echo "Starting proxy (will launch Studio instances)..."
exec node /app/proxy.js
