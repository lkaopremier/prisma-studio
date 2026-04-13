# prisma studio

A minimal Docker service that runs [Prisma Studio](https://www.prisma.io/studio) behind a custom login page, connected to one or more databases via `DATABASE_URL`. Designed to be deployed on [Coolify](https://coolify.io/) or any Docker-compatible platform.

## How it works

On container startup:

1. Parses `DATABASE_URL` — one URL or several separated by `|`
2. For each database: detects the provider, generates a schema, introspects with `prisma db pull`
3. Launches one Prisma Studio instance per database on sequential internal ports
4. Waits for all instances to be ready
5. Starts an authenticated proxy on the public port (default: 3000)

Requests are routed to the Studio instance matching the database selected in the current session.

## Features

- **Custom login page** — session-based authentication, rate-limited (10 attempts / 15 min)
- **Onboarding page** — database picker with live status indicators shown after login
- **Multi-database** — manage several databases simultaneously, switch with a dropdown or the onboarding page
- **Auto-restart** — each Studio instance is monitored and restarted automatically if it crashes
- **Graceful shutdown** — `SIGTERM` / `SIGINT` cleanly terminates all Studio child processes
- **CSRF protection** — all mutating endpoints are protected with a per-session token
- **Security headers** — `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`
- **Configurable session** — duration controlled via `SESSION_MAX_AGE` (default: 8 h)
- **Custom error page** — friendly 502 page when a Studio instance is offline
- **Schema refresh** — re-runs `prisma db pull` on the active database without restarting
- **Health check** — `GET /healthz` returns per-database status for Coolify / Docker probes

## Supported databases

| URL scheme                      | Provider   |
| ------------------------------- | ---------- |
| `postgresql://` / `postgres://` | PostgreSQL |
| `mysql://`                      | MySQL      |
| `sqlserver://`                  | SQL Server |
| `mongodb://` / `mongodb+srv://` | MongoDB    |
| `file:`                         | SQLite     |

## Environment variables

| Variable            | Required | Default       | Description                                        |
| ------------------- | -------- | ------------- | -------------------------------------------------- |
| `DATABASE_URL`      | yes      | —             | One or more connection strings, separated by `\|`  |
| `AUTH_PASSWORD`     | yes      | —             | Login password                                     |
| `AUTH_USER`         | no       | `admin`       | Login username                                     |
| `SESSION_SECRET`    | no       | AUTH_PASSWORD | Secret for session signing (use a dedicated value) |
| `SESSION_MAX_AGE`   | no       | `28800000`    | Session duration in milliseconds (default: 8 h)    |
| `SECURE_COOKIE`     | no       | `false`       | Set to `true` when behind an HTTPS reverse proxy   |
| `PORT`              | no       | `3000`        | Port the auth proxy listens on                     |
| `DATABASE_PROVIDER` | no       | `postgresql`  | Fallback provider if URL scheme is unrecognized    |

Database names are automatically extracted from the URL path (e.g. `/production` → `production`). For SQL Server, the `database=` parameter is used. Custom labels can be set with the `Label::url` syntax.

## Usage

### Single database

```bash
docker run \
  -e DATABASE_URL="postgresql://user:password@host:5432/mydb" \
  -e AUTH_PASSWORD="secret" \
  -p 3000:3000 \
  prisma-studio
```

### Multiple databases

Separate URLs with `|`. An onboarding page appears after login to pick the database:

```bash
docker run \
  -e DATABASE_URL="postgresql://user:password@host:5432/production|mysql://user:password@host:3306/staging" \
  -e AUTH_PASSWORD="secret" \
  -p 3000:3000 \
  prisma-studio
```

Custom labels can be set with the `Label::url` syntax:

```
DATABASE_URL="Production::postgresql://...host/prod|Staging::mysql://...host/staging"
```

### SQLite (with volume mount)

```bash
docker run \
  -e DATABASE_URL="file:/data/db.sqlite" \
  -e AUTH_PASSWORD="secret" \
  -v /path/to/local/db.sqlite:/data/db.sqlite \
  -p 3000:3000 \
  prisma-studio
```

### Docker Compose

```yaml
services:
  prisma-studio:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: "postgresql://user:password@db:5432/production|mysql://user:password@db2:3306/staging"
      AUTH_PASSWORD: secret
      SESSION_SECRET: a-long-random-secret
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
```

## Coolify deployment

1. Create a new service in Coolify → **Docker Build** → point to this repository
2. Set the environment variables:
   - `DATABASE_URL` (required — single URL or `url1|url2` for multiple databases)
   - `AUTH_PASSWORD` (required)
   - `SESSION_SECRET` (recommended)
   - `SECURE_COOKIE=true` (recommended — Coolify handles HTTPS termination)
3. Expose port `3000`
4. Set the health check path to `/healthz`
5. Deploy

## License

MIT
