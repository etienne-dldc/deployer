# @dldc/deployer

Standalone headless deploy engine for **Docker Swarm**. No UI — it exposes a
type-safe RPC API
([ts-api](https://github.com/dldc-packages/ts-api)), an SSE event stream, and a
tar-deploy endpoint. Any UI (SPA, CLI) is a separate consumer of this API.

This repository is the standalone core that used to live inside
[tower-control](https://github.com/etienne-dldc/tower-control). See
[`plans/core-standalone`](./plans/core-standalone) for the (adapted) implementation
plan.

## Status

Early development. The scaffolding boots and serves the three endpoints; the
deploy pipeline (tar → git → plan → Docker Swarm) is being built slice by slice
per the plan. Not yet production-ready.

## Endpoints

| Endpoint | Protocol | Purpose |
|---|---|---|
| `POST /api/graph` | ts-api RPC (`{ path, args }` JSON, superjson transport) | All queries + mutations |
| `GET /api/events` | SSE (JSON events) | Real-time subscription to deploys, steps, queue, services, backups |
| `POST /api/tar-deploy` | Binary upload (bearer auth) | Accept tar archive, queue a `"tar"` deploy |
| `GET /status` | Plain HTTP | Liveness probe (used by the container healthcheck) |

## Running with Docker

```sh
docker run --rm \
  -p 3000:3000 \
  -e DATABASE_PATH=/src/data/deployer/db.sqlite \
  -e TRIGGER_TOKEN=change-me \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /path/to/repo:/src/source \
  -v /path/to/secrets:/src/secrets \
  -v /path/to/data:/src/data \
  ghcr.io/etienne-dldc/deployer:<version>
```

### Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `DATABASE_PATH` | `/src/data/deployer/db.sqlite` | SQLite database path |
| `TRIGGER_TOKEN` | *(none)* | Bearer token required by `/api/tar-deploy` |

Planned (mirrors tower-control): `DEPLOY_ENVIRONMENT`, `DEV_MODE`, `REPO_DIR`,
`SECRETS_DIR`, `DATA_DIR`, `REGISTRY_TOKEN`, `DEPLOY_CONCURRENCY`, and the
`BACKUP_*` block.

### Mounts

- `/src/source` — the synced source repo (includes the `deploy/` compose stacks)
- `/src/secrets` — secrets dir (`.env`, Docker config)
- `/src/data` — sqlite db, uploaded tars, backups
- `/var/run/docker.sock` — Docker Engine socket (the pipeline drives Swarm over
  the Docker API)

## Development

```sh
deno task check    # fmt + lint + type-check (CI gate)
deno task start    # run the server locally (--allow-all)
deno task test:run
```

Published to [JSR](https://jsr.io/@dldc/deployer) and
[ghcr.io/etienne-dldc/deployer](https://github.com/etienne-dldc/deployer/pkgs/container/deployer)
via GitHub Actions on push to `main`.
