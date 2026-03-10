#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL environment variable is required"
  exit 1
fi

# Detect database provider from URL scheme
case "$DATABASE_URL" in
  postgres://*|postgresql://*)
    PROVIDER="postgresql"
    ;;
  mysql://*)
    PROVIDER="mysql"
    ;;
  sqlserver://*)
    PROVIDER="sqlserver"
    ;;
  mongodb*://*)
    PROVIDER="mongodb"
    ;;
  file:*)
    PROVIDER="sqlite"
    ;;
  *)
    PROVIDER="${DATABASE_PROVIDER:-postgresql}"
    ;;
esac

mkdir -p /app/prisma

# Write schema with detected provider
cat > /app/prisma/schema.prisma <<EOF
datasource db {
  provider = "$PROVIDER"
  url      = env("DATABASE_URL")
}
EOF

echo "Provider: $PROVIDER"

if [ "$PROVIDER" = "sqlite" ]; then
  echo "SQLite detected — skipping introspection, using file directly."
else
  echo "Introspecting database..."
  npx prisma db pull || echo "Warning: introspection failed (empty database or connection error) — starting Studio anyway."
fi

if [ -z "$AUTH_PASSWORD" ]; then
  echo "ERROR: AUTH_PASSWORD environment variable is required"
  exit 1
fi

echo "Starting Prisma Studio..."
npx prisma studio --port 5555 --browser none &

echo "Starting auth proxy..."
exec node /app/proxy.js
