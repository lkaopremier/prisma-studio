# prisma studio

A minimal Docker service that runs [Prisma Studio](https://www.prisma.io/studio) connected to any database via a `DATABASE_URL` environment variable. Designed to be deployed on [Coolify](https://coolify.io/) or any Docker-compatible platform.

## How it works

On container startup:

1. Detects the database provider from the `DATABASE_URL` URL scheme
2. Generates `prisma/schema.prisma` with the right provider
3. Introspects the database with `prisma db pull` (skipped for SQLite)
4. Launches Prisma Studio on the configured port

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
| `PORT`              | no       | `5555`       | Port Prisma Studio listens on                   |
| `DATABASE_PROVIDER` | no       | `postgresql` | Fallback provider if URL scheme is unrecognized |

## Usage

### Docker

```bash
docker build -t prisma-studio .

docker run \
  -e DATABASE_URL="postgresql://user:password@host:5432/dbname" \
  -p 5555:5555 \
  prisma-studio
```

Then open [http://localhost:5555](http://localhost:5555).

### SQLite (with volume mount)

```bash
docker run \
  -e DATABASE_URL="file:/data/db.sqlite" \
  -v /path/to/local/db.sqlite:/data/db.sqlite \
  -p 5555:5555 \
  prisma-studio
```

### Docker Compose

```yaml
services:
  prisma-studio:
    build: .
    ports:
      - "5555:5555"
    environment:
      DATABASE_URL: postgresql://user:password@db:5432/mydb
```

## Coolify deployment

1. Create a new service in Coolify → **Docker Build** → point to this repository
2. Set `DATABASE_URL` in the environment variables
3. Expose port `5555` (or set `PORT` to a different value)
4. Deploy — Prisma Studio will be available at the Coolify-assigned URL

## License

MIT
