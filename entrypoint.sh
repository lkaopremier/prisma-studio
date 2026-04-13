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

extract_db_name() {
  URL="$1"
  case "$URL" in
    sqlserver://*)
      NAME=$(printf '%s' "$URL" | sed -n 's/.*[;?]database=\([^;&#]*\).*/\1/p')
      printf '%s' "${NAME:-Database}"
      ;;
    file:*)
      FILEPATH=$(printf '%s' "$URL" | sed 's/^file://')
      FILENAME=$(basename "$FILEPATH")
      printf '%s' "${FILENAME%.*}"
      ;;
    *)
      # Remove query string then extract last path segment
      NAME=$(printf '%s' "$URL" | sed 's/[?#].*//' | sed 's|.*/||')
      printf '%s' "${NAME:-Database}"
      ;;
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

# Split pipe-separated URLs into positional parameters
set -f
OLD_IFS="$IFS"
IFS='|'
# shellcheck disable=SC2086
set -- $DATABASE_URL
IFS="$OLD_IFS"
set +f

mkdir -p /app/prisma

# Studio ports are computed relative to the public PORT to guarantee no conflict
PUBLIC_PORT="${PORT:-3000}"

i=1
for DB_URL in "$@"; do
  # Trim surrounding whitespace
  DB_URL=$(printf '%s' "$DB_URL" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -z "$DB_URL" ] && continue

  PROVIDER="$(detect_provider "$DB_URL")"
  DB_NAME="$(extract_db_name "$DB_URL")"
  STUDIO_PORT=$((PUBLIC_PORT + 10000 + i))
  DIR="/app/prisma/db_$i"

  mkdir -p "$DIR"
  cat > "$DIR/schema.prisma" <<SCHEMA
datasource db {
  provider = "$PROVIDER"
  url      = env("DATABASE_URL")
}
SCHEMA

  echo "DB $i ($DB_NAME): provider=$PROVIDER, port=$STUDIO_PORT"

  if [ "$PROVIDER" != "sqlite" ]; then
    echo "Introspecting DB $i..."
    DATABASE_URL="$DB_URL" npx prisma db pull --schema="$DIR/schema.prisma" \
      || echo "Warning: introspection failed for DB $i — starting Studio anyway."
  fi

  echo "Starting Prisma Studio for DB $i on port $STUDIO_PORT..."
  DATABASE_URL="$DB_URL" npx prisma studio --schema="$DIR/schema.prisma" --port "$STUDIO_PORT" --browser none &

  i=$((i + 1))
done

if [ "$i" -eq 1 ]; then
  echo "ERROR: No valid database URL found in DATABASES"
  exit 1
fi

echo "Starting auth proxy..."
exec node /app/proxy.js
