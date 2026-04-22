#!/bin/sh
set -e

if [ -z "$AUTH_PASSWORD" ]; then
  echo "ERROR: AUTH_PASSWORD environment variable is required"
  exit 1
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL environment variable is required"
  exit 1
fi

exec node /app/proxy.js
