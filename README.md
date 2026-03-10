# prisma studio

A minimal Docker service that runs [Prisma Studio](https://www.prisma.io/studio) behind a Basic Auth proxy, connected to any database via a `DATABASE_URL` environment variable. Designed to be deployed on [Coolify](https://coolify.io/) or any Docker-compatible platform.

## How it works

On container startup:

1. Detects the database provider from the `DATABASE_URL` URL scheme
2. Generates `prisma/schema.prisma` with the right provider
3. Introspects the database with `prisma db pull` (skipped for SQLite)
4. Launches Prisma Studio internally on port 5555
5. Starts a Basic Auth proxy on the public port (default: 3000)

## Supported databases

| URL scheme                      | Provider   |
| ------------------------------- | ---------- |
| `postgresql://` / `postgres://` | PostgreSQL |
| `mysql://`                      | MySQL      |
| `sqlserver://`                  | SQL Server |
| `mongodb://` / `mongodb+srv://` | MongoDB    |
| `file:`                         | SQLite     |

## Environment variables

| Variable            | Required | Default      | Description                                     |
| ------------------- | -------- | ------------ | ----------------------------------------------- |
| `DATABASE_URL`      | yes      | —            | Full database connection string                 |
| `AUTH_PASSWORD`     | yes      | —            | Password for Basic Auth                         |
| `AUTH_USER`         | no       | `admin`      | Username for Basic Auth                         |
| `PORT`              | no       | `3000`       | Port the auth proxy listens on                  |
| `DATABASE_PROVIDER` | no       | `postgresql` | Fallback provider if URL scheme is unrecognized |

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

Then open [http://localhost:3000](http://localhost:3000) — a login prompt will appear.

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
      AUTH_USER: admin
```

## Coolify deployment

1. Create a new service in Coolify → **Docker Build** → point to this repository
2. Set `DATABASE_URL` and `AUTH_PASSWORD` in the environment variables
3. Expose port `3000` (or set `PORT` to a different value)
4. Deploy — Prisma Studio will be available at the Coolify-assigned URL behind Basic Auth

## License

MIT
