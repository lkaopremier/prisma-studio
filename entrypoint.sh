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
  npx prisma db pull
fi

echo "Starting Prisma Studio..."
exec npx prisma studio --port "${PORT:-5555}" --browser none
