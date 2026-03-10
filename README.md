# prisma studio

A minimal Docker service that runs [Prisma Studio](https://www.prisma.io/studio) behind a custom login page, connected to any database via a `DATABASE_URL` environment variable. Designed to be deployed on [Coolify](https://coolify.io/) or any Docker-compatible platform.

## How it works

On container startup:

1. Detects the database provider from the `DATABASE_URL` URL scheme
2. Generates `prisma/schema.prisma` with the right provider
3. Introspects the database with `prisma db pull` (skipped for SQLite)
4. Launches Prisma Studio internally on port 5555
5. Waits for Prisma Studio to be ready
6. Starts an authenticated proxy on the public port (default: 3000)

## Features

- **Custom login page** — session-based authentication with a modern UI
- **Rate limiting** — 10 login attempts per 15 minutes per IP
- **Logout bar** — injected into Prisma Studio with a "Sign out" button
- **Schema refresh** — re-runs `prisma db pull` without restarting the container
- **Health check** — `GET /healthz` for Coolify / Docker health probes

## Supported databases

| URL scheme                      | Provider   |
| ------------------------------- | ---------- |
| `postgresql://` / `postgres://` | PostgreSQL |
| `mysql://`                      | MySQL      |
| `sqlserver://`                  | SQL Server |
| `mongodb://` / `mongodb+srv://` | MongoDB    |
| `file:`                         | SQLite     |

## Environment variables

| Variable            | Required | Default       | Description                                          |
| ------------------- | -------- | ------------- | ---------------------------------------------------- |
| `DATABASE_URL`      | yes      | —             | Full database connection string                      |
| `AUTH_PASSWORD`     | yes      | —             | Login password                                       |
| `AUTH_USER`         | no       | `admin`       | Login username                                       |
| `SESSION_SECRET`    | no       | AUTH_PASSWORD | Secret for session signing (use a dedicated value)   |
| `SECURE_COOKIE`     | no       | `false`       | Set to `true` when behind an HTTPS reverse proxy     |
| `PORT`              | no       | `3000`        | Port the auth proxy listens on                       |
| `DATABASE_PROVIDER` | no       | `postgresql`  | Fallback provider if URL scheme is unrecognized      |

## Usage

### Docker

```bash
docker build -t prisma-studio .

docker run \
  -e DATABASE_URL="postgresql://user:password@host:5432/dbname" \
  -e AUTH_PASSWORD="secret" \
  -p 3000:3000 \
  prisma-studio
```

Then open [http://localhost:3000](http://localhost:3000).

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
      DATABASE_URL: postgresql://user:password@db:5432/mydb
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
   - `DATABASE_URL` (required)
   - `AUTH_PASSWORD` (required)
   - `SESSION_SECRET` (recommended)
   - `SECURE_COOKIE=true` (recommended — Coolify handles HTTPS termination)
3. Expose port `3000`
4. Set the health check path to `/healthz`
5. Deploy

## License

MIT
